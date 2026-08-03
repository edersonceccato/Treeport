import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { resolveDataSourceTree, renderReport } from '@treeport/core';
import type { DataSourceTree } from '@treeport/schema';
import { createPostgresExecutor } from '../src/index.js';

/**
 * Integração contra um Postgres DE VERDADE.
 *
 * Só roda quando `TREEPORT_TEST_DATABASE_URL` está definida — assim a suíte
 * continua rodando em qualquer máquina sem exigir banco. Para rodar:
 *
 *   docker run -d --rm --name treeport-pg \
 *     -e POSTGRES_PASSWORD=treeport -e POSTGRES_DB=treeport \
 *     -p 55432:5432 postgres:16-alpine
 *
 *   TREEPORT_TEST_DATABASE_URL=postgres://postgres:treeport@localhost:55432/treeport \
 *     pnpm test
 *
 * Vale a pena existir porque há coisas que só o banco real confirma: o
 * `= ANY($1)` aceitando array, os tipos que o driver devolve (BIGINT vira
 * string, NUMERIC vira string), e a ligação master/detail casando com isso.
 */

const DATABASE_URL = process.env['TREEPORT_TEST_DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('integração com Postgres real', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(`
      DROP TABLE IF EXISTS item;
      DROP TABLE IF EXISTS pedido;

      CREATE TABLE pedido (
        id       BIGSERIAL PRIMARY KEY,
        numero   VARCHAR(20) NOT NULL,
        cliente  VARCHAR(100) NOT NULL,
        emitido  DATE NOT NULL,
        total    NUMERIC(12,2) NOT NULL
      );

      CREATE TABLE item (
        id         BIGSERIAL PRIMARY KEY,
        pedido_id  BIGINT NOT NULL REFERENCES pedido(id),
        descricao  VARCHAR(100) NOT NULL,
        quantidade INT NOT NULL,
        valor      NUMERIC(12,2) NOT NULL
      );

      INSERT INTO pedido (numero, cliente, emitido, total) VALUES
        ('PED-001', 'Acme Ltda',      '2026-08-03', 1800.50),
        ('PED-002', 'Global Trading', '2026-08-04',  950.00);

      INSERT INTO item (pedido_id, descricao, quantidade, valor) VALUES
        (1, 'Frete internacional', 1, 1500.00),
        (1, 'THC',                 1,  300.50),
        (2, 'Frete rodoviario',    2,  475.00);
    `);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const tree = (): DataSourceTree => ({
    id: 'pedido-tree',
    name: 'Pedidos',
    parameters: [{ name: 'clienteFiltro', type: 'string', nullable: true }],
    root: {
      id: 'PEDIDO',
      name: 'Pedido',
      // o cast `::text` é necessário: o Postgres não consegue inferir o tipo
      // de um parâmetro que só aparece em `IS NULL` (ver docs/adapters.md)
      sql: `
        SELECT * FROM pedido
        WHERE (:clienteFiltro::text IS NULL OR cliente = :clienteFiltro::text)
        ORDER BY numero
      `,
      children: [
        {
          id: 'ITEM',
          name: 'Itens',
          sql: 'SELECT * FROM item WHERE pedido_id IN (:parentValues) ORDER BY id',
          linkFields: { parentField: 'id', childField: 'pedido_id' },
        },
      ],
    },
  });

  it('resolve a árvore master/detail contra o banco', async () => {
    const dataSet = await resolveDataSourceTree(tree(), createPostgresExecutor(pool), {
      parameters: { clienteFiltro: null },
    });

    expect(dataSet.rows).toHaveLength(2);
    expect(dataSet.rows[0]!.data['numero']).toBe('PED-001');
    expect(dataSet.rows[0]!.children['ITEM']).toHaveLength(2);
    expect(dataSet.rows[1]!.children['ITEM']).toHaveLength(1);
  });

  it('a ligação casa mesmo o driver devolvendo BIGINT como string', async () => {
    // é o caso clássico: `id` volta como '1' e `pedido_id` como '1',
    // ou um como number e outro como string dependendo do tipo
    const dataSet = await resolveDataSourceTree(tree(), createPostgresExecutor(pool), {
      parameters: { clienteFiltro: null },
    });

    const itens = dataSet.rows[0]!.children['ITEM']!;
    expect(itens.map((i) => i.data['descricao'])).toEqual(['Frete internacional', 'THC']);
  });

  it('a estratégia batched roda uma query por nó', async () => {
    const queries: string[] = [];
    const executor = createPostgresExecutor(pool, { onQuery: (sql) => queries.push(sql) });

    await resolveDataSourceTree(tree(), executor, {
      parameters: { clienteFiltro: null },
      strategy: 'batched',
    });

    // 1 do master + 1 dos itens, mesmo havendo 2 pedidos
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain('= ANY($1)');
  });

  it('a estratégia per-row roda uma query por linha do pai', async () => {
    const queries: string[] = [];
    const executor = createPostgresExecutor(pool, { onQuery: (sql) => queries.push(sql) });

    const perRowTree = tree();
    perRowTree.root.children![0]!.sql =
      'SELECT * FROM item WHERE pedido_id = :parentValue ORDER BY id';

    await resolveDataSourceTree(perRowTree, executor, {
      parameters: { clienteFiltro: null },
      strategy: 'per-row',
    });

    // 1 do master + 1 por pedido
    expect(queries).toHaveLength(3);
  });

  it('as duas estratégias produzem o mesmo resultado', async () => {
    const executor = createPostgresExecutor(pool);

    const batched = await resolveDataSourceTree(tree(), executor, {
      parameters: { clienteFiltro: null },
      strategy: 'batched',
    });

    const perRowTree = tree();
    perRowTree.root.children![0]!.sql =
      'SELECT * FROM item WHERE pedido_id = :parentValue ORDER BY id';
    const perRow = await resolveDataSourceTree(perRowTree, executor, {
      parameters: { clienteFiltro: null },
      strategy: 'per-row',
    });

    expect(batched).toEqual(perRow);
  });

  it('o parâmetro do relatório filtra de verdade', async () => {
    const dataSet = await resolveDataSourceTree(tree(), createPostgresExecutor(pool), {
      parameters: { clienteFiltro: 'Acme Ltda' },
    });

    expect(dataSet.rows).toHaveLength(1);
    expect(dataSet.rows[0]!.data['cliente']).toBe('Acme Ltda');
  });

  it('gera o PDF de ponta a ponta, do banco ao arquivo', async () => {
    const dataSet = await resolveDataSourceTree(tree(), createPostgresExecutor(pool), {
      parameters: { clienteFiltro: null },
    });

    const pdf = await renderReport(
      {
        id: 'pedidos',
        name: 'Pedidos',
        boundDataSourceNodeId: 'PEDIDO',
        pageSize: 'A4',
        margins: { top: 40, right: 40, bottom: 40, left: 40 },
        bands: {
          details: {
            height: 40,
            elements: [
              {
                id: 'l',
                type: 'label',
                x: 0,
                y: 0,
                width: 500,
                height: 14,
                // NUMERIC volta como string do driver; a máscara tem que lidar
                content: "{{numero}} — {{cliente}} — R$ {{FORMAT(total, '#,##0.00')}}",
              },
              {
                id: 'sub',
                type: 'subreport',
                x: 12,
                y: 18,
                width: 480,
                height: 14,
                dataSourceNodeId: 'ITEM',
                canGrow: true,
                template: {
                  details: {
                    height: 12,
                    elements: [
                      {
                        id: 'i',
                        type: 'label',
                        x: 0,
                        y: 0,
                        width: 460,
                        height: 10,
                        content: "{{quantidade}}x {{descricao}} — {{FORMAT(valor, '#,##0.00')}}",
                        style: { fontSize: 8 },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      dataSet,
    );

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it('NUMERIC vindo como string é formatado corretamente', async () => {
    const dataSet = await resolveDataSourceTree(tree(), createPostgresExecutor(pool), {
      parameters: { clienteFiltro: 'Acme Ltda' },
    });

    // o driver devolve NUMERIC como string para não perder precisão
    const total = dataSet.rows[0]!.data['total'];
    expect(typeof total).toBe('string');
    expect(Number(total)).toBe(1800.5);
  });

  it('erro de SQL inválida sobe com a mensagem do Postgres', async () => {
    await expect(
      createPostgresExecutor(pool).execute('SELECT * FROM tabela_que_nao_existe', {}),
    ).rejects.toThrow(/does not exist/);
  });
});
