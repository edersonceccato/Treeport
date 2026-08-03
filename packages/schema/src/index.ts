export type {
  ParameterType,
  ReportParameter,
  LinkFields,
  DataSourceNode,
  ReportContext,
  DataSourceTree,
  DataRow,
  ResolvedRow,
  ResolvedDataSet,
} from './data-source.js';

export type {
  ElementStyle,
  BaseElement,
  ElementRule,
  RelativePosition,
  LabelElement,
  FieldElement,
  ImageElement,
  BarcodeElement,
  QrCodeElement,
  LineElement,
  RectElement,
  ShapeElement,
  ShapeKind,
  AggregateElement,
  AggregateFunction,
  BarcodeFormat,
  QrContentKind,
  FontFamily,
  TableColumn,
  TableElement,
  SubreportElement,
  RegionElement,
  ReportElement,
  SystemVariables,
  Band,
  BandSet,
  NamedPageSize,
  PageSize,
  PageMargins,
  Template,
  ReportContextRef,
} from './template.js';

export { PAGE_SIZES, resolvePageSize } from './template.js';

// --- Motor de expressões (compartilhado entre core e designer) ---
export {
  interpolate,
  evaluateExpression,
  compileTemplate,
  hasPlaceholders,
  clearExpressionCache,
} from './expressions/interpolate.js';
export type { CompiledTemplate } from './expressions/interpolate.js';

export { parseExpression } from './expressions/parser.js';
export { tokenize, ExpressionSyntaxError } from './expressions/tokenizer.js';
export type { Token, TokenType } from './expressions/tokenizer.js';

export { evaluateNode, hasField, ExpressionEvaluationError } from './expressions/evaluate.js';
export type { ExpressionScope, EvaluateOptions } from './expressions/evaluate.js';

export { BUILTIN_FUNCTIONS, toBoolean, toNumber, toText } from './expressions/functions.js';
export type { ExpressionFunction } from './expressions/functions.js';

export type { ExpressionNode } from './expressions/ast.js';

export {
  createAggregateFunctions,
  collectRows,
  AGGREGATE_FUNCTION_NAMES,
  AGGREGATE_DOCS,
  normalizeNodeId,
} from './expressions/aggregates.js';
export type { AggregateContext, AggregateDoc } from './expressions/aggregates.js';

export { applyRules, hasRules } from './expressions/rules.js';
export type { AppliedRules } from './expressions/rules.js';

export { formatValue, formatDate, formatNumber } from './format.js';
export type { FormatOptions } from './format.js';
