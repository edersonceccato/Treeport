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

  // os parâmetros já validados ficam visíveis nas expressões pelo nome, sem o
  // usuário precisar repassá-los à mão
  const parameters =
    options.parameters ?? (options.useTestValues ? testValuesOf(tree) : undefined);

  return renderReport(template, dataSet, {
    ...options,
    ...(parameters ? { parameters } : {}),
  });
}

/** Valores de teste declarados nos parâmetros, usados no preview. */
function testValuesOf(tree: DataSourceTree): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const param of tree.parameters) {
    if (param.testValue !== undefined) values[param.name] = param.testValue;
  }
  return values;
}
