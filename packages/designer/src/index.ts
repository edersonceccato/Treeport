/**
 * @treeport/designer — designer visual de relatórios, como Web Component.
 *
 * Registrar o componente é só importar o pacote:
 *
 *   import '@treeport/designer';
 *   // <treeport-designer></treeport-designer>
 *
 * Funciona em React, Vue, Angular, Next.js ou HTML puro, porque é um Custom
 * Element nativo — não um componente de framework.
 *
 * O modelo (`TemplateEditor`, paleta, geometria) é exportado à parte para quem
 * quiser montar a própria UI ou testar sem browser.
 */

// --- modelo (sem DOM) ---
export {
  TemplateEditor,
  createEmptyTemplate,
  MIN_SIZE,
} from './model/template-editor.js';
export type {
  BandName,
  ElementLocation,
  TemplateEditorOptions,
  AlignMode,
} from './model/template-editor.js';

export { PALETTE, paletteItem, createElement } from './model/palette.js';
export type { PaletteItem, PaletteItemType } from './model/palette.js';

export {
  dragBox,
  resizeBox,
  handleCursor,
  intersects,
} from './model/interaction.js';
export type { Box, Handle, DragOptions } from './model/interaction.js';

export {
  mmToPt,
  ptToMm,
  inToPt,
  ptToIn,
  ptToUnit,
  unitToPt,
  snap,
  formatUnit,
  PT_PER_MM,
  PT_PER_INCH,
} from './model/units.js';
export type { RulerUnit } from './model/units.js';

export {
  describeTree,
  describeNode,
  fieldsOf,
  extractFieldsFromSql,
  findNode,
  pathToNode,
  fieldsInScope,
  fieldReference,
  fieldExpression,
  parameterFields,
} from './model/field-explorer.js';
export type { ExplorerNode, ExplorerField } from './model/field-explorer.js';

export {
  resolveDesign,
  resolveSubreportElement,
  listDesignTabs,
  samePath,
  pathKey,
  nearestValidPath,
  DesignPathError,
} from './model/subreport-tabs.js';
export type { DesignPath, DesignTab } from './model/subreport-tabs.js';

export {
  highlight,
  suggest,
  applySuggestion,
  insertPlaceholder,
  isInsideExpression,
  wordAtCursor,
  validateSyntax,
  BUILTIN_FUNCTION_NAMES,
} from './model/expression-editor.js';
export type {
  Suggestion,
  SuggestionKind,
  HighlightSegment,
  SuggestOptions,
  ApplyResult,
} from './model/expression-editor.js';

export {
  TreeportApiClient,
  ApiError,
  exportTemplate,
  importTemplate,
} from './model/api-client.js';
export type { ApiClientOptions, TemplateSummary } from './model/api-client.js';

// --- o Web Component ---
export { TreeportDesigner } from './report-designer.js';
