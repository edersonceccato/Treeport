import type {
  DataRow,
  DataSourceNode,
  DataSourceTree,
  ResolvedDataSet,
  ResolvedRow,
} from '@treeport/schema';
import type { Executor } from '../adapters/executor.js';
import { validateParameters } from './parameters.js';

/**
 * Resolução da árvore master→detail (seção 4.2 do brief).
 *
 * Duas estratégias, escolhidas por `strategy`:
 *
 * - `per-row` (N+1): para cada linha do pai, roda a query do filho passando o
 *   valor de ligação em `:parentValue`. Simples e previsível; a query do
 *   usuário fica com um `WHERE x = :parentValue` normal.
 *
 * - `batched` (default): roda a query do filho UMA vez por nível, passando
 *   todos os valores de ligação distintos do nível em `:parentValues`, e
 *   agrupa em memória por `childField`. Reduz drasticamente o número de
 *   round-trips no banco. Exige que a query do usuário use um
 *   `WHERE x IN (:parentValues)` — cabe ao Executor/driver expandir a lista.
 *
 * Se o nó não declara nada, `batched` é usado. Um nó pode forçar a estratégia
 * dele via `strategyByNode`.
 */

export type ResolveStrategy = 'batched' | 'per-row';

export interface ResolveOptions {
  /** Estratégia padrão para todos os nós filhos. Default: 'batched'. */
  strategy?: ResolveStrategy;
  /** Sobrescreve a estratégia para nós específicos, indexado pelo id do nó. */
  strategyByNode?: Record<string, ResolveStrategy>;
  /**
   * Valores dos parâmetros do relatório. São validados contra
   * `tree.parameters` antes de qualquer query rodar.
   */
  parameters?: Record<string, unknown>;
  /**
   * Se true, usa `testValue` dos parâmetros como fallback quando o valor não
   * foi informado (usado pelo preview do Designer). Default: false.
   */
  useTestValues?: boolean;
}

/** Nome do parâmetro que recebe o valor de ligação do pai (estratégia per-row). */
export const PARENT_VALUE_PARAM = 'parentValue';
/** Nome do parâmetro que recebe a lista de valores do nível (estratégia batched). */
export const PARENT_VALUES_PARAM = 'parentValues';

/** Erro estrutural na definição da árvore (pego antes de rodar qualquer SQL). */
export class DataSourceTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceTreeError';
  }
}

/**
 * Executa a árvore inteira e devolve as linhas do master já com os filhos
 * aninhados recursivamente.
 */
export async function resolveDataSourceTree(
  tree: DataSourceTree,
  executor: Executor,
  options: ResolveOptions = {},
): Promise<ResolvedDataSet> {
  validateTreeShape(tree.root);

  const provided = { ...(options.parameters ?? {}) };
  if (options.useTestValues) {
    for (const param of tree.parameters) {
      if (provided[param.name] === undefined && param.testValue !== undefined) {
        provided[param.name] = param.testValue;
      }
    }
  }
  const params = validateParameters(tree.parameters, provided);

  const rootRows = await executor.execute(tree.root.sql, params);
  const ordered = applyOrderBy(rootRows, tree.root.orderBy);

  const rows = await resolveChildrenFor(ordered, tree.root, executor, params, options);

  return { nodeId: tree.root.id, rows };
}

/**
 * Resolve todos os nós filhos para um conjunto de linhas de um mesmo nível,
 * devolvendo as linhas embrulhadas em `ResolvedRow`.
 */
async function resolveChildrenFor(
  parentRows: DataRow[],
  parentNode: DataSourceNode,
  executor: Executor,
  params: Record<string, unknown>,
  options: ResolveOptions,
): Promise<ResolvedRow[]> {
  const resolved: ResolvedRow[] = parentRows.map((data) => ({ data, children: {} }));

  const children = parentNode.children ?? [];
  if (children.length === 0 || resolved.length === 0) return resolved;

  for (const child of children) {
    const link = child.linkFields!;
    const strategy = options.strategyByNode?.[child.id] ?? options.strategy ?? 'batched';

    if (strategy === 'batched') {
      // Uma query só para o nível inteiro, agrupando o resultado em memória.
      const values = distinctLinkValues(resolved, link.parentField);

      let childRows: DataRow[] = [];
      if (values.length > 0) {
        childRows = await executor.execute(child.sql, {
          ...params,
          [PARENT_VALUES_PARAM]: values,
        });
      }

      const skip = shouldSkip(child, childRows);

      // resolve os netos de uma vez só, para o nível inteiro
      const ordered = applyOrderBy(childRows, child.orderBy);
      const grandchildren = skip
        ? []
        : await resolveChildrenFor(ordered, child, executor, params, options);
      const byRow = indexResolvedByKey(grandchildren, link.childField);

      for (const row of resolved) {
        if (skip) {
          row.children[child.id] = [];
          continue;
        }
        const key = normalizeKeyValue(row.data[link.parentField]);
        row.children[child.id] = key === null ? [] : (byRow.get(key) ?? []);
      }
    } else {
      // per-row: uma query por linha do pai
      for (const row of resolved) {
        const parentValue = row.data[link.parentField];
        const childRows = await executor.execute(child.sql, {
          ...params,
          [PARENT_VALUE_PARAM]: parentValue,
        });

        if (shouldSkip(child, childRows)) {
          row.children[child.id] = [];
          continue;
        }
        const ordered = applyOrderBy(childRows, child.orderBy);
        row.children[child.id] = await resolveChildrenFor(
          ordered,
          child,
          executor,
          params,
          options,
        );
      }
    }
  }

  return resolved;
}

/**
 * Um nó com `skipWhenNoRecords` (default true) que não devolveu linhas é
 * simplesmente pulado; com `false`, um nó vazio também resulta em array
 * vazio — a diferença é semântica para o renderizador, que pode decidir
 * esconder a banda inteira.
 */
function shouldSkip(node: DataSourceNode, rows: DataRow[]): boolean {
  const skip = node.skipWhenNoRecords ?? true;
  return skip && rows.length === 0;
}

/** Valores distintos e não-nulos do campo de ligação, para o `IN (...)`. */
function distinctLinkValues(rows: ResolvedRow[], field: string): unknown[] {
  const seen = new Set<string>();
  const values: unknown[] = [];
  for (const row of rows) {
    const value = row.data[field];
    const key = normalizeKeyValue(value);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

/** Agrupa linhas já resolvidas (com netos dentro) pelo campo de ligação. */
function indexResolvedByKey(rows: ResolvedRow[], field: string): Map<string, ResolvedRow[]> {
  const map = new Map<string, ResolvedRow[]>();
  for (const row of rows) {
    const key = normalizeKeyValue(row.data[field]);
    if (key === null) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/**
 * Normaliza o valor da chave de ligação para comparação.
 *
 * Importante: bancos diferentes devolvem o mesmo id ora como number, ora como
 * string (o `pg` devolve BIGINT como string, por exemplo). Comparar por
 * `String(valor)` evita que a ligação silenciosamente não case.
 */
function normalizeKeyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Ordenação em memória, no formato "campo" ou "campo DESC".
 * O ideal é ordenar no próprio SQL; isso aqui existe para o caso batched, em
 * que as linhas de vários pais voltam misturadas numa query só.
 */
function applyOrderBy(rows: DataRow[], orderBy?: string): DataRow[] {
  if (!orderBy) return rows;

  const terms = orderBy.split(',').map((term) => {
    const parts = term.trim().split(/\s+/);
    const field = parts[0] ?? '';
    const desc = (parts[1] ?? '').toUpperCase() === 'DESC';
    return { field, desc };
  });

  return [...rows].sort((a, b) => {
    for (const { field, desc } of terms) {
      const cmp = compareValues(a[field], b[field]);
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b));
}

/**
 * Valida a forma da árvore antes de rodar qualquer query: ids únicos, filhos
 * com `linkFields`, raiz sem `linkFields`.
 */
export function validateTreeShape(root: DataSourceNode): void {
  const seen = new Set<string>();

  if (root.linkFields) {
    throw new DataSourceTreeError(
      `O nó raiz "${root.id}" não pode ter linkFields — ele é o master da árvore.`,
    );
  }

  const walk = (node: DataSourceNode, isRoot: boolean): void => {
    if (!node.id) throw new DataSourceTreeError('Todo nó precisa de um id.');
    if (seen.has(node.id)) {
      throw new DataSourceTreeError(
        `Id de nó duplicado: "${node.id}". Cada nó da árvore precisa de um id único.`,
      );
    }
    seen.add(node.id);

    if (!isRoot) {
      const link = node.linkFields;
      if (!link || !link.parentField || !link.childField) {
        throw new DataSourceTreeError(
          `O nó "${node.id}" é um detail e precisa declarar linkFields { parentField, childField }.`,
        );
      }
    }

    for (const child of node.children ?? []) walk(child, false);
  };

  walk(root, true);
}

/** Busca um nó pelo id em qualquer profundidade da árvore. */
export function findNode(root: DataSourceNode, nodeId: string): DataSourceNode | undefined {
  if (root.id === nodeId) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return undefined;
}
