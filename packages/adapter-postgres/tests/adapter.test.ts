import { describe, it, expect } from 'vitest';
import { createPostgresExecutor, prepareQuery, type PgQueryable } from '../src/index.js';

/**
 * Testes do adapter sem banco de verdade: um client fake registra o que
 * receberia. O que importa aqui é a TRADUÇÃO (`:nome` -> `$1`, `IN` -> `ANY`),
 * não o Postgres em si — a integração real fica no exemplo, que precisa de um
 * banco e por isso não roda no CI.
 */
class FakePg implements PgQueryable {
  readonly calls: { text: string; values: unknown[] }[] = [];

  constructor(private readonly rows: Record<string, unknown>[] = []) {}

  async query(config: { text: string; values?: unknown[] }) {
    this.calls.push({ text: config.text, values: config.values ?? [] });
    return { rows: this.rows };
  }
}

describe('prepareQuery', () => {
  it('traduz :nome para $1 na ordem de uso', () => {
    const { text, values } = prepareQuery(
      'SELECT * FROM t WHERE a = :x AND b = :y',
      { x: 1, y: 'dois' },
    );

    expect(text).toBe('SELECT * FROM t WHERE a = $1 AND b = $2');
    expect(values).toEqual([1, 'dois']);
  });

  it('reusa o mesmo $n para parâmetro repetido', () => {
    const { text, values } = prepareQuery('SELECT * FROM t WHERE a = :x OR b = :x', { x: 7 });

    expect(text).toBe('SELECT * FROM t WHERE a = $1 OR b = $1');
    expect(values).toEqual([7]);
  });

  it('converte IN (:parentValues) para = ANY($1)', () => {
    // expandir para IN ($1,$2,$3...) estouraria o limite de parâmetros do
    // protocolo com poucos milhares de linhas
    const { text, values } = prepareQuery(
      'SELECT * FROM item WHERE pedido_id IN (:parentValues)',
      { parentValues: [1, 2, 3] },
    );

    expect(text).toBe('SELECT * FROM item WHERE pedido_id = ANY($1)');
    expect(values).toEqual([[1, 2, 3]]);
  });

  it('um único parâmetro carrega o array inteiro, não um por valor', () => {
    const { values } = prepareQuery('SELECT * FROM t WHERE id IN (:parentValues)', {
      parentValues: Array.from({ length: 5000 }, (_, i) => i),
    });

    expect(values).toHaveLength(1);
    expect((values[0] as number[]).length).toBe(5000);
  });

  it('converte NOT IN para <> ALL', () => {
    const { text } = prepareQuery('SELECT * FROM t WHERE id NOT IN (:parentValues)', {
      parentValues: [1],
    });

    expect(text).toBe('SELECT * FROM t WHERE id <> ALL($1)');
  });

  it('aceita variações de espaçamento e caixa no IN', () => {
    for (const sql of [
      'WHERE id IN (:parentValues)',
      'WHERE id in ( :parentValues )',
      'WHERE id  IN  (:parentValues)',
    ]) {
      expect(prepareQuery(sql, { parentValues: [] }).text).toContain('= ANY($1)');
    }
  });

  it('não mexe num IN com lista literal', () => {
    const { text } = prepareQuery("SELECT * FROM t WHERE tipo IN ('A', 'B')", {});
    expect(text).toBe("SELECT * FROM t WHERE tipo IN ('A', 'B')");
  });

  it('não confunde o cast :: do Postgres com parâmetro', () => {
    const { text, values } = prepareQuery(
      'SELECT valor::numeric FROM t WHERE id = :id',
      { id: 1 },
    );

    expect(text).toBe('SELECT valor::numeric FROM t WHERE id = $1');
    expect(values).toEqual([1]);
  });

  it('ignora dois-pontos dentro de literal e comentário', () => {
    const { values } = prepareQuery(
      "-- filtra :naoEhParam\nSELECT 'hora 10:30' FROM t WHERE id = :id",
      { id: 1 },
    );

    expect(values).toEqual([1]);
  });

  it('erro claro quando falta um parâmetro usado na query', () => {
    expect(() => prepareQuery('SELECT * FROM t WHERE a = :faltando', {})).toThrow(
      /":faltando" usado na query mas não informado/,
    );
  });

  it('null é um valor legítimo, não ausência', () => {
    const { values } = prepareQuery('SELECT * FROM t WHERE a = :x', { x: null });
    expect(values).toEqual([null]);
  });
});

describe('createPostgresExecutor', () => {
  it('devolve as linhas do driver', async () => {
    const client = new FakePg([{ id: 1, nome: 'Acme' }]);
    const executor = createPostgresExecutor(client);

    const rows = await executor.execute('SELECT * FROM t WHERE id = :id', { id: 1 });

    expect(rows).toEqual([{ id: 1, nome: 'Acme' }]);
  });

  it('manda a SQL já traduzida para o driver', async () => {
    const client = new FakePg();
    const executor = createPostgresExecutor(client);

    await executor.execute('SELECT * FROM t WHERE a = :x AND b IN (:parentValues)', {
      x: 10,
      parentValues: [1, 2],
    });

    expect(client.calls[0]!.text).toBe('SELECT * FROM t WHERE a = $1 AND b = ANY($2)');
    expect(client.calls[0]!.values).toEqual([10, [1, 2]]);
  });

  it('o hook onQuery recebe a SQL final, para log', async () => {
    const vistas: string[] = [];
    const executor = createPostgresExecutor(new FakePg(), {
      onQuery: (sql) => vistas.push(sql),
    });

    await executor.execute('SELECT * FROM t WHERE id = :id', { id: 1 });

    expect(vistas).toEqual(['SELECT * FROM t WHERE id = $1']);
  });

  it('erro do driver sobe para o chamador', async () => {
    const client: PgQueryable = {
      async query() {
        throw new Error('relation "inexistente" does not exist');
      },
    };

    await expect(
      createPostgresExecutor(client).execute('SELECT * FROM inexistente', {}),
    ).rejects.toThrow(/does not exist/);
  });

  it('funciona com a árvore master/detail do core', async () => {
    // prova que o adapter encaixa no contrato Executor de verdade
    const { resolveDataSourceTree } = await import('@treeport/core');

    const client: PgQueryable = {
      async query(config) {
        // "FROM pedido" e "FROM item": o texto tem `pedido_id` nos dois,
        // então a distinção precisa ser pela cláusula FROM
        if (config.text.includes('FROM pedido')) {
          return { rows: [{ id: 1, numero: 'PED-001' }] };
        }
        return { rows: [{ id: 10, pedidoId: 1, descricao: 'Item A' }] };
      },
    };

    const dataSet = await resolveDataSourceTree(
      {
        id: 'tree',
        name: 'Pedidos',
        parameters: [{ name: 'pedidoId', type: 'int', nullable: false }],
        root: {
          id: 'PEDIDO',
          name: 'Pedido',
          sql: 'SELECT * FROM pedido WHERE id = :pedidoId',
          children: [
            {
              id: 'ITEM',
              name: 'Itens',
              sql: 'SELECT * FROM item WHERE pedido_id IN (:parentValues)',
              linkFields: { parentField: 'id', childField: 'pedidoId' },
            },
          ],
        },
      },
      createPostgresExecutor(client),
      { parameters: { pedidoId: 1 } },
    );

    expect(dataSet.rows).toHaveLength(1);
    expect(dataSet.rows[0]!.children['ITEM']).toHaveLength(1);
  });
});
