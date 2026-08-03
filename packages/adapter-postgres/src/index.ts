import type { DataRow } from '@treeport/schema';
import {
  buildPositionalValues,
  normalizeNamedParameters,
  PARENT_VALUES_PARAM,
  type Executor,
} from '@treeport/core';

/**
 * Adapter PostgreSQL para o Treeport.
 *
 * Vive num pacote separado de propósito: o `@treeport/core` não pode depender
 * de driver nenhum, senão quem usa SQL Server acabaria instalando `pg` sem
 * precisar. O `pg` é peerDependency — o adapter usa, mas quem escolhe a versão
 * é a aplicação.
 *
 * Escrever um adapter para outro banco é o mesmo trabalho: implementar
 * `execute(sql, params)` traduzindo os parâmetros `:nome` para o dialeto do
 * driver. Este arquivo serve de modelo.
 */

/** O mínimo que o adapter precisa de um client `pg` (Pool ou Client). */
export interface PgQueryable {
  query(
    config: { text: string; values?: unknown[] },
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface PostgresExecutorOptions {
  /**
   * Chamado antes de cada query, com a SQL já traduzida. Útil para log e
   * diagnóstico de desempenho sem embutir um logger na lib.
   */
  onQuery?: (sql: string, values: unknown[]) => void;
}

/**
 * Cria um `Executor` sobre um `Pool` ou `Client` do `pg`.
 *
 * ```ts
 * import { Pool } from 'pg';
 * import { createPostgresExecutor } from '@treeport/adapter-postgres';
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const executor = createPostgresExecutor(pool);
 * ```
 */
export function createPostgresExecutor(
  client: PgQueryable,
  options: PostgresExecutorOptions = {},
): Executor {
  return {
    async execute(sql: string, params: Record<string, unknown>): Promise<DataRow[]> {
      const prepared = prepareQuery(sql, params);

      options.onQuery?.(prepared.text, prepared.values);

      const result = await client.query({ text: prepared.text, values: prepared.values });
      return result.rows;
    },
  };
}

export interface PreparedQuery {
  text: string;
  values: unknown[];
}

/**
 * Traduz a SQL do formato do Treeport (`:nome`) para o do Postgres (`$1`).
 *
 * O caso especial é o `IN (:parentValues)` da estratégia batched: no Postgres,
 * a forma correta de passar uma lista é `= ANY($1)` com um array, e NÃO
 * expandir para `IN ($1, $2, $3, ...)`. Expandir estoura o limite de 65535
 * parâmetros do protocolo com poucos milhares de linhas, e ainda faz o
 * planejador recompilar o plano a cada tamanho de lista diferente.
 */
export function prepareQuery(sql: string, params: Record<string, unknown>): PreparedQuery {
  const rewritten = rewriteInClause(sql);
  const { sql: text, order } = normalizeNamedParameters(rewritten, 'numbered');
  const values = buildPositionalValues(order, params);
  return { text, values };
}

/**
 * Reescreve `IN (:parentValues)` para `= ANY(:parentValues)`.
 *
 * Cobre também `NOT IN`, que vira `<> ALL(...)`. O usuário continua escrevendo
 * a query da forma natural e portável; o adapter cuida do dialeto.
 */
function rewriteInClause(sql: string): string {
  const listParams = `(?:${PARENT_VALUES_PARAM})`;

  return sql
    .replace(
      new RegExp(`\\bNOT\\s+IN\\s*\\(\\s*:(${listParams})\\s*\\)`, 'gi'),
      '<> ALL(:$1)',
    )
    .replace(new RegExp(`\\bIN\\s*\\(\\s*:(${listParams})\\s*\\)`, 'gi'), '= ANY(:$1)');
}
