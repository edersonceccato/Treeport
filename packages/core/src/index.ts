/**
 * @treeport/core — motor de relatórios do Treeport.
 *
 * Fase 1: árvore de fonte de dados — resolução master/detail recursiva,
 * validação de parâmetros e o contrato `Executor` de banco.
 * Fase 2 (atual): renderização PDF de Header/Details/Footer com Label,
 * Field, Line e Rect, com quebra de página automática.
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
  testValuesOf,
  ParameterValidationError,
} from './data-source/parameters.js';

export {
  childRows,
  pathToNode,
  flattenNodes,
  inferFieldNames,
} from './data-source/navigation.js';

// --- Motor de expressões (reexportado de @treeport/schema) ---
export {
  interpolate,
  evaluateExpression,
  compileTemplate,
  hasPlaceholders,
  clearExpressionCache,
  parseExpression,
  tokenize,
  ExpressionSyntaxError,
  evaluateNode,
  hasField,
  ExpressionEvaluationError,
  BUILTIN_FUNCTIONS,
  toBoolean,
  toNumber,
  toText,
} from '@treeport/schema';
export type {
  CompiledTemplate,
  Token,
  TokenType,
  ExpressionScope,
  EvaluateOptions,
  ExpressionFunction,
  ExpressionNode,
} from '@treeport/schema';

export {
  createAggregateFunctions,
  collectRows,
  AGGREGATE_FUNCTION_NAMES,
} from '@treeport/schema';
export type { AggregateContext } from '@treeport/schema';

// --- Metadados de controle e contexto (Anexo A e B) ---
export {
  generate,
  type GenerateOptions,
  type GenerateResult,
} from './control/engine.js';

export {
  readControlFields,
  assertNotBlocked,
  stripControlFields,
  ReportBlockedError,
  DEFAULT_CONTROL_PREFIX,
} from './control/control-fields.js';
export type { ControlFields } from './control/control-fields.js';

export {
  TemplateRegistry,
  resolveTemplate,
  TemplateNotFoundError,
} from './control/template-registry.js';

// --- Rotas do contrato Designer<->backend (seção 7.5.3) ---
export { createRouteHandlers } from './routes/handlers.js';
export type {
  RouteRequest,
  RouteResponse,
  RouteHandler,
  RouteHandlers,
  RouteHandlersOptions,
  TemplateStore,
  TemplateSummary,
} from './routes/handlers.js';

// --- Renderização PDF ---
export { renderReport, loadFonts } from './render/renderer.js';
export type { RenderOptions } from './render/renderer.js';

export { generateReport } from './render/generate.js';
export type { GenerateReportOptions } from './render/generate.js';

export { renderBand, measureBand } from './render/band.js';
export { renderSubreport, measureSubreport } from './render/subreport.js';
export type { SubreportMeasureContext } from './render/subreport.js';
export { measureElement, measureBandContent } from './render/measure.js';
export type { MeasureContext } from './render/measure.js';
export type { BandRenderOptions } from './render/band.js';
export { renderElement, pickFont } from './render/elements.js';
export type { FontSet, RenderElementContext } from './render/elements.js';

export { PageContext } from './render/page-context.js';
export type { PageContextOptions, TextBoxOptions } from './render/page-context.js';

export {
  generateBarcode,
  generateQrCode,
  BarcodeGenerationError,
} from './render/barcode.js';
export type { BarcodeFormat, BarcodeRenderOptions, QrRenderOptions } from './render/barcode.js';
export { BARCODE_IDS, TWO_DIMENSIONAL } from './render/barcode.js';
export { formatQrContent, QR_CONTENT_FIELDS, QR_VALUE_LABEL } from './render/qr-content.js';
export type { QrContentParts } from './render/qr-content.js';

export { formatValue, formatDate, formatNumber } from '@treeport/schema';
export type { FormatOptions } from '@treeport/schema';

export { wrapText, measure, lineHeight } from './render/text.js';
export { parseColor } from './render/color.js';

// Reexporta os tipos do schema por conveniência de quem só instala o core.
export type {
  DataSourceNode,
  DataSourceTree,
  DataRow,
  ReportParameter,
  ResolvedDataSet,
  ResolvedRow,
  Template,
  Band,
  BandSet,
  ReportElement,
  LabelElement,
  FieldElement,
  ElementStyle,
  PageSize,
  PageMargins,
  ReportContext,
  ReportContextRef,
} from '@treeport/schema';
