import type { DataRow } from '@treeport/schema';

/**
 * Contrato de acesso a banco (seção 4.3 do brief).
 *
 * O `core` NUNCA depende de um driver específico: quem usa a lib escreve a
 * própria query e injeta um `Executor` — um wrapper fino em cima de `pg`,
 * `mssql`, `node-firebird`, `better-sqlite3`, ou até de uma API HTTP.
 *
 * O contrato é deliberadamente mínimo: recebe SQL com parâmetros nomeados e
 * um mapa de valores, devolve linhas. Cabe ao adapter traduzir os parâmetros
 * nomeados para o dialeto do driver (`$1` no pg, `@nome` no mssql, `?` no
 * SQLite) — ver `normalizeNamedParameters` em ./named-parameters.ts, que faz
 * esse trabalho pesado para os adapters oficiais.
 */
export interface Executor {
  /**
   * Executa uma query e devolve as linhas.
   *
   * @param sql SQL crua, com parâmetros nomeados no formato `:nome`.
   * @param params Valores dos parâmetros, indexados pelo nome (sem os dois-pontos).
   */
  execute(sql: string, params: Record<string, unknown>): Promise<DataRow[]>;
}
