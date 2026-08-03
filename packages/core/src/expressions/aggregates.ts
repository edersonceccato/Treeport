import type { ResolvedRow } from '@treeport/schema';
import { toNumber } from './functions.js';

/**
 * Agregações sobre a árvore de dados (item 21 do feedback).
 *
 * Um totalizador precisa somar um campo de um nó — e, no caso interessante,
 * combinar nós diferentes: "valor total dos itens dividido pela quantidade de
 * pedidos" dá o ticket médio. Por isso as agregações são **funções de
 * expressão**, não um cálculo fechado: entram na mesma conta que qualquer
 * outra coisa.
 *
 *   {{SUM('ITEM', 'valor')}}
 *   {{SUM('ITEM', 'valor') / COUNT('PEDIDO')}}
 *   {{FORMAT(AVG('ITEM', 'valor'), '#,##0.00')}}
 *
 * O primeiro argumento é o id do nó na árvore de dados; vazio ou omitido usa
 * o nó do escopo atual.
 */

/** Todas as linhas de um nó, achatadas a partir da raiz do dataset. */
export function collectRows(rows: ResolvedRow[], nodeId: string): ResolvedRow[] {
  const out: ResolvedRow[] = [];

  const walk = (current: ResolvedRow[]): void => {
    for (const row of current) {
      for (const [childId, children] of Object.entries(row.children)) {
        if (childId === nodeId) out.push(...children);
        walk(children);
      }
    }
  };

  walk(rows);
  return out;
}

/** Valores de um campo nas linhas informadas, já convertidos para número. */
function numericValues(rows: ResolvedRow[], fieldName: string): number[] {
  const values: number[] = [];

  for (const row of rows) {
    const raw = row.data[fieldName];
    if (raw === null || raw === undefined || raw === '') continue;

    const value = toNumber(raw);
    // texto não numérico não entra na conta em vez de virar NaN e contaminar
    if (Number.isFinite(value)) values.push(value);
  }

  return values;
}

export interface AggregateContext {
  /** As linhas do master, de onde tudo é alcançável. */
  rootRows: ResolvedRow[];
  /** Nó do escopo atual, usado quando a expressão não informa um. */
  currentNodeId?: string;
  /** Linhas do nó atual, para agregar sem varrer a árvore inteira. */
  currentRows?: ResolvedRow[];
  /**
   * Ids de todos os nós da árvore.
   *
   * Serve para desambiguar `COUNT('X')`: se `X` é um id de nó, conta as linhas
   * dele; senão, é um nome de campo do nó atual. Sem essa lista teríamos de
   * adivinhar, e adivinhar errado dá um total silenciosamente errado.
   */
  knownNodeIds?: ReadonlySet<string>;
}

/**
 * Resolve quais linhas agregar.
 *
 * Sem `nodeId`, usa o nó do escopo atual — que é o que se espera de um
 * totalizador colocado dentro de um subrelatório.
 */
function resolveRows(context: AggregateContext, nodeId?: string): ResolvedRow[] {
  const target = nodeId?.trim();

  if (!target || target === context.currentNodeId) {
    return context.currentRows ?? context.rootRows;
  }
  // o nó raiz não é filho de ninguém, então é tratado à parte
  if (target === '__root__') return context.rootRows;

  return collectRows(context.rootRows, target);
}

/**
 * Funções de agregação para registrar no motor de expressões.
 *
 * Assinaturas aceitas:
 *   SUM('NO', 'campo')   COUNT('NO')   COUNT('NO', 'campo')
 *   SUM('campo')         — agrega o nó do escopo atual
 */
export function createAggregateFunctions(
  context: AggregateContext,
): Record<string, (...args: unknown[]) => unknown> {
  /**
   * Desambigua as formas aceitas:
   *   FN('NO', 'campo')  -> nó e campo explícitos
   *   FN('NO')           -> só o nó, quando 'NO' é um id conhecido
   *   FN('campo')        -> só o campo, agregando o nó atual
   */
  const parseArgs = (args: unknown[]): { nodeId?: string; fieldName?: string } => {
    const first = args[0] === undefined ? undefined : String(args[0]);
    const second = args[1] === undefined ? undefined : String(args[1]);

    if (second !== undefined) {
      return first === undefined ? { fieldName: second } : { nodeId: first, fieldName: second };
    }
    if (first === undefined) return {};

    return context.knownNodeIds?.has(first) ? { nodeId: first } : { fieldName: first };
  };

  const aggregate = (
    args: unknown[],
    reduce: (values: number[], rows: ResolvedRow[]) => number,
  ): number => {
    const { nodeId, fieldName } = parseArgs(args);
    const rows = resolveRows(context, nodeId);
    const values = fieldName ? numericValues(rows, fieldName) : [];
    return reduce(values, rows);
  };

  return {
    SUM: (...args) => aggregate(args, (values) => values.reduce((a, b) => a + b, 0)),

    // sem campo conta as linhas; com campo, conta os valores preenchidos
    COUNT: (...args) => {
      const { fieldName } = parseArgs(args);
      return aggregate(args, (values, rows) => (fieldName ? values.length : rows.length));
    },

    AVG: (...args) =>
      aggregate(args, (values) =>
        values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length,
      ),

    MINOF: (...args) => aggregate(args, (values) => (values.length ? Math.min(...values) : 0)),

    MAXOF: (...args) => aggregate(args, (values) => (values.length ? Math.max(...values) : 0)),

    /** Quantos valores distintos aquele campo tem — útil para "quantos clientes". */
    COUNTDISTINCT: (...args) => {
      const { nodeId, fieldName } = parseArgs(args);
      const rows = resolveRows(context, nodeId);
      if (!fieldName) return rows.length;

      const seen = new Set<string>();
      for (const row of rows) {
        const value = row.data[fieldName];
        if (value !== null && value !== undefined && value !== '') seen.add(String(value));
      }
      return seen.size;
    },
  };
}

/** Nomes das funções de agregação, para o autocomplete do Designer. */
export const AGGREGATE_FUNCTION_NAMES = [
  'SUM',
  'COUNT',
  'AVG',
  'MINOF',
  'MAXOF',
  'COUNTDISTINCT',
] as const;
