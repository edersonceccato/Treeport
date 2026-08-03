import type { DataRow } from '@treeport/schema';
import type { Executor } from './executor.js';

/**
 * `Executor` fake em memória, para testes e exemplos (Fase 1 do brief).
 *
 * Não interpreta SQL de verdade: o usuário registra um "handler" por query e
 * decide o que devolver. Duas formas de registrar:
 *
 * 1. Por tabela (`table`): o handler filtra um array de objetos.
 * 2. Por chave arbitrária: a SQL é usada como chave literal.
 *
 * Além disso guarda o log das chamadas (`calls`), o que permite testar a
 * estratégia de resolução (N+1 vs. batched) contando quantas queries rodaram.
 */

export interface MemoryQueryCall {
  sql: string;
  params: Record<string, unknown>;
}

export type MemoryHandler = (params: Record<string, unknown>) => DataRow[];

export class MemoryExecutor implements Executor {
  /** Log de todas as chamadas, na ordem em que aconteceram. */
  readonly calls: MemoryQueryCall[] = [];

  private readonly handlers = new Map<string, MemoryHandler>();

  constructor(handlers: Record<string, MemoryHandler | DataRow[]> = {}) {
    for (const [sql, handler] of Object.entries(handlers)) {
      this.on(sql, handler);
    }
  }

  /**
   * Registra o que responder para uma SQL. Aceita um array fixo de linhas ou
   * uma função que recebe os parâmetros e decide.
   */
  on(sql: string, handler: MemoryHandler | DataRow[]): this {
    const key = normalizeKey(sql);
    this.handlers.set(key, Array.isArray(handler) ? () => handler : handler);
    return this;
  }

  async execute(sql: string, params: Record<string, unknown>): Promise<DataRow[]> {
    this.calls.push({ sql, params: { ...params } });
    const handler = this.handlers.get(normalizeKey(sql));
    if (!handler) {
      throw new Error(
        `MemoryExecutor: nenhum handler registrado para a query:\n${sql}\n` +
          `Registre com executor.on(sql, linhas).`,
      );
    }
    // clona as linhas para o motor não mutar os dados do teste sem querer
    return handler(params).map((row) => ({ ...row }));
  }

  /** Zera o log de chamadas (útil entre asserções do mesmo teste). */
  resetCalls(): void {
    this.calls.length = 0;
  }
}

/** Ignora diferenças de espaçamento na hora de casar a SQL com o handler. */
function normalizeKey(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ');
}
