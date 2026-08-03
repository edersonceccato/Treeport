/**
 * @treeport/core — motor de relatórios do Treeport.
 *
 * Fase 1 (atual): árvore de fonte de dados — resolução master/detail
 * recursiva, validação de parâmetros e o contrato `Executor` de banco.
 * As fases seguintes (renderização PDF, expressões, subreports) entram aqui.
 */

// --- Adapters de banco ---
export type { Executor } from './adapters/executor.js';
export { MemoryExecutor } from './adapters/memory-executor.js';
export type { MemoryHandler, MemoryQueryCall } from './adapters/memory-executor.js';
export {
  normalizeNamedParameters,
  buildPositionalValues,
} from './adapters/named-parameters.js';
export type { NormalizedQuery, PlaceholderStyle } from './adapters/named-parameters.js';

// --- Fonte de dados ---
export {
  resolveDataSourceTree,
  validateTreeShape,
  findNode,
  DataSourceTreeError,
  PARENT_VALUE_PARAM,
  PARENT_VALUES_PARAM,
} from './data-source/resolver.js';
export type { ResolveOptions, ResolveStrategy } from './data-source/resolver.js';

export {
  validateParameters,
  ParameterValidationError,
} from './data-source/parameters.js';

export {
  childRows,
  pathToNode,
  flattenNodes,
  inferFieldNames,
} from './data-source/navigation.js';

// Reexporta os tipos do schema por conveniência de quem só instala o core.
export type {
  DataSourceNode,
  DataSourceTree,
  DataRow,
  ReportParameter,
  ResolvedDataSet,
  ResolvedRow,
  Template,
} from '@treeport/schema';
