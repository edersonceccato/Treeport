import type { DataSourceTree, Template } from '@treeport/schema';
import type { Executor } from '../adapters/executor.js';
import { resolveDataSourceTree, type ResolveOptions } from '../data-source/resolver.js';
import { renderReport, type RenderOptions } from './renderer.js';

/**
 * Atalho de ponta a ponta: resolve a árvore de dados e já devolve o PDF.
 *
 * É o que a aplicação hospedeira chama em produção. Quem precisa inspecionar
 * os dados entre uma coisa e outra usa `resolveDataSourceTree` + `renderReport`
 * separadamente.
 */
export interface GenerateReportOptions extends ResolveOptions, RenderOptions {}

export async function generateReport(
  tree: DataSourceTree,
  template: Template,
  executor: Executor,
  options: GenerateReportOptions = {},
): Promise<Uint8Array> {
  const dataSet = await resolveDataSourceTree(tree, executor, options);
  return renderReport(template, dataSet, options);
}
