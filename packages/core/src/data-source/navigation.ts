import type { DataSourceNode, ResolvedRow } from '@treeport/schema';

/**
 * Utilitários de navegação no resultado resolvido. O motor de renderização
 * (Fase 2+) e os subreports (Fase 4) usam isso para achar as linhas de um nó
 * a partir da linha do pai.
 */

/** Linhas de um nó filho a partir de uma linha resolvida do pai. */
export function childRows(row: ResolvedRow, childNodeId: string): ResolvedRow[] {
  return row.children[childNodeId] ?? [];
}

/** Caminho de ids da raiz até o nó informado (inclusive), ou undefined. */
export function pathToNode(root: DataSourceNode, nodeId: string): string[] | undefined {
  if (root.id === nodeId) return [root.id];
  for (const child of root.children ?? []) {
    const sub = pathToNode(child, nodeId);
    if (sub) return [root.id, ...sub];
  }
  return undefined;
}

/** Todos os nós da árvore, em pré-ordem. */
export function flattenNodes(root: DataSourceNode): DataSourceNode[] {
  const out: DataSourceNode[] = [root];
  for (const child of root.children ?? []) out.push(...flattenNodes(child));
  return out;
}

/**
 * Nomes de coluna observados nas linhas de um nó já resolvido.
 * Usado pelo explorador de campos do Designer, que precisa saber quais campos
 * existem sem que o usuário digite a lista à mão.
 */
export function inferFieldNames(rows: ResolvedRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.data)) names.add(key);
  }
  return [...names];
}
