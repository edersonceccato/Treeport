import { describe, it, expect } from 'vitest';
import { normalizeNamedParameters, buildPositionalValues } from '../src/index.js';

describe('normalizeNamedParameters', () => {
  it('converte para $1/$2 no estilo do Postgres', () => {
    const { sql, order } = normalizeNamedParameters(
      'SELECT * FROM t WHERE a = :x AND b = :y',
      'numbered',
    );

    expect(sql).toBe('SELECT * FROM t WHERE a = $1 AND b = $2');
    expect(order).toEqual(['x', 'y']);
  });

  it('reusa o mesmo índice para parâmetro repetido no estilo numbered', () => {
    const { sql, order } = normalizeNamedParameters(
      'SELECT * FROM t WHERE a = :x OR b = :x',
      'numbered',
    );

    expect(sql).toBe('SELECT * FROM t WHERE a = $1 OR b = $1');
    expect(order).toEqual(['x']);
  });

  it('converte para ? posicional repetindo o valor', () => {
    const { sql, order } = normalizeNamedParameters(
      'SELECT * FROM t WHERE a = :x OR b = :x',
      'positional',
    );

    expect(sql).toBe('SELECT * FROM t WHERE a = ? OR b = ?');
    expect(order).toEqual(['x', 'x']);
  });

  it('converte para @nome no estilo SQL Server', () => {
    const { sql } = normalizeNamedParameters('SELECT * FROM t WHERE a = :x', 'at-named');
    expect(sql).toBe('SELECT * FROM t WHERE a = @x');
  });

  it('mantém :nome no estilo colon-named', () => {
    const { sql, order } = normalizeNamedParameters('SELECT * FROM t WHERE a = :x', 'colon-named');
    expect(sql).toBe('SELECT * FROM t WHERE a = :x');
    expect(order).toEqual(['x']);
  });

  it('não confunde o cast :: do Postgres com parâmetro', () => {
    const { sql, order } = normalizeNamedParameters(
      "SELECT valor::int FROM t WHERE id = :id",
      'numbered',
    );

    expect(sql).toBe('SELECT valor::int FROM t WHERE id = $1');
    expect(order).toEqual(['id']);
  });

  it('ignora dois-pontos dentro de literal de string', () => {
    const { sql, order } = normalizeNamedParameters(
      "SELECT 'hora 10:30' AS t FROM x WHERE id = :id",
      'numbered',
    );

    expect(sql).toBe("SELECT 'hora 10:30' AS t FROM x WHERE id = $1");
    expect(order).toEqual(['id']);
  });

  it('entende apóstrofo escapado dentro de literal', () => {
    const { sql, order } = normalizeNamedParameters(
      "SELECT 'it''s 10:30' FROM x WHERE id = :id",
      'numbered',
    );

    expect(sql).toBe("SELECT 'it''s 10:30' FROM x WHERE id = $1");
    expect(order).toEqual(['id']);
  });

  it('ignora dois-pontos em comentários', () => {
    const sqlIn = [
      '-- filtra por :naoEhParametro',
      '/* bloco :tambemNao */',
      'SELECT * FROM t WHERE id = :id',
    ].join('\n');

    const { order } = normalizeNamedParameters(sqlIn, 'numbered');
    expect(order).toEqual(['id']);
  });

  it('ignora dois-pontos em identificador entre aspas e colchetes', () => {
    const { order } = normalizeNamedParameters(
      'SELECT "col:a", [col:b] FROM t WHERE id = :id',
      'numbered',
    );
    expect(order).toEqual(['id']);
  });

  it('não trata := como parâmetro', () => {
    const { sql, order } = normalizeNamedParameters('SET x := 1 WHERE id = :id', 'numbered');
    expect(sql).toBe('SET x := 1 WHERE id = $1');
    expect(order).toEqual(['id']);
  });
});

describe('buildPositionalValues', () => {
  it('monta os valores na ordem dos placeholders', () => {
    const values = buildPositionalValues(['b', 'a', 'b'], { a: 1, b: 2 });
    expect(values).toEqual([2, 1, 2]);
  });

  it('erro claro quando falta um parâmetro usado na query', () => {
    expect(() => buildPositionalValues(['x'], { y: 1 })).toThrow(
      /Parâmetro ":x" usado na query mas não informado/,
    );
  });

  it('aceita null como valor legítimo', () => {
    expect(buildPositionalValues(['x'], { x: null })).toEqual([null]);
  });
});
