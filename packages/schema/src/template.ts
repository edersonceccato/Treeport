/**
 * Modelo do template de layout (seção 5 do brief).
 *
 * Todas as medidas (`x`, `y`, `width`, `height`, `pageSize`) estão em
 * **pontos PDF** (1pt = 1/72 pol), que é a unidade nativa do pdf-lib.
 * O Designer converte de/para mm na hora de exibir a régua.
 */

/** Estilo visual aplicável a qualquer elemento. */
export interface ElementStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Cor do texto/traço em hexadecimal, ex.: "#333333". */
  color?: string;
  /** Cor de preenchimento do fundo, ex.: "#EEEEEE". */
  backgroundColor?: string;
  borderWidth?: number;
  borderColor?: string;
}

export interface BaseElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style?: ElementStyle;
  /**
   * Se true, o elemento pode renderizar mais alto que sua `height` nominal
   * (texto que quebra em várias linhas, subreport com N linhas) e empurra
   * para baixo todos os elementos abaixo dele na mesma banda (Anexo C).
   * Default: false, para não pagar o custo de reflow onde não é preciso.
   */
  canGrow?: boolean;
  /**
   * Elemento travado no designer: não é selecionável nem arrastável.
   * Ignorado pelo motor de renderização — é só apoio à edição.
   */
  locked?: boolean;
  /** Oculto no designer E na geração do PDF. */
  hidden?: boolean;
  /** Nome amigável, mostrado no painel de camadas. */
  name?: string;
}

/** Texto estático ou expressão `{{...}}` avaliada em runtime. */
export interface LabelElement extends BaseElement {
  type: 'label';
  content: string;
  /** Se true, `content` passa pelo motor de expressões (seção 6). */
  isExpression?: boolean;
}

/** Texto ligado diretamente a uma coluna da linha de dados atual. */
export interface FieldElement extends BaseElement {
  type: 'field';
  fieldName: string;
  /** Máscara de formatação, ex.: "dd/MM/yyyy" ou "#,##0.00". */
  format?: string;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  /** Data URI, URL, ou expressão que resolve para uma delas. */
  source: string;
  fit?: 'contain' | 'cover' | 'fill';
}

export interface BarcodeElement extends BaseElement {
  type: 'barcode';
  format: 'code128' | 'ean13' | 'code39';
  /** Nome de campo direto ou expressão `{{...}}`. */
  valueExpression: string;
  /**
   * Imprimir os dígitos legíveis abaixo das barras. Default: false.
   * Uma etiqueta de EAN costuma mostrar; um código interno, não.
   */
  includeText?: boolean;
}

export interface QrCodeElement extends BaseElement {
  type: 'qrcode';
  valueExpression: string;
}

export interface LineElement extends BaseElement {
  type: 'line';
  orientation: 'horizontal' | 'vertical';
}

export interface RectElement extends BaseElement {
  type: 'rect';
}

export interface TableColumn {
  fieldName: string;
  header: string;
  width: number;
  format?: string;
}

export interface TableElement extends BaseElement {
  type: 'table';
  columns: TableColumn[];
  /** Nó da árvore que alimenta as linhas da tabela. */
  dataSourceNodeId?: string;
  rowHeight: number;
}

/**
 * Um subreport é "o design de um nó filho", embutido dentro de uma banda do
 * nó pai — não é uma banda separada (Anexo C). Pode aninhar em qualquer
 * profundidade.
 */
export interface SubreportElement extends BaseElement {
  type: 'subreport';
  /** Nó da árvore ao qual este subreport se conecta. */
  dataSourceNodeId: string;
  /** Mini-template próprio, com suas próprias bandas. */
  template: BandSet;
}

/**
 * Agrupa elementos numa área. Os filhos guardam `x`/`y` **relativos ao canto
 * superior esquerdo da região**, então mover a região move tudo junto sem
 * recalcular nada.
 *
 * Serve para blocos que andam juntos (um bloco de endereço, uma caixa de
 * totais) e para o que precisa de fundo/borda em volta de vários elementos.
 */
export interface RegionElement extends BaseElement {
  type: 'region';
  elements: ReportElement[];
  /**
   * A região cresce para caber o conteúdo que transbordou.
   * Combina com `canGrow` para empurrar o que vem depois dela.
   */
  autoHeight?: boolean;
}

export type ReportElement =
  | RegionElement
  | LabelElement
  | FieldElement
  | ImageElement
  | BarcodeElement
  | QrCodeElement
  | LineElement
  | RectElement
  | TableElement
  | SubreportElement;

export interface Band {
  height: number;
  elements: ReportElement[];
}

/**
 * Conjunto de bandas de um nó. Header aparece 1x no início do design daquele
 * nó, Details repete 1x por linha, Footer aparece 1x no fim (Anexo C).
 */
export interface BandSet {
  header?: Band;
  details: Band;
  footer?: Band;
}

export type NamedPageSize = 'A4' | 'Letter';
export type PageSize = NamedPageSize | { width: number; height: number };

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  /** Árvore de dados que este template consome. */
  dataSourceId?: string;
  /** Nó da árvore ao qual este template está ligado (normalmente o master). */
  boundDataSourceNodeId: string;
  pageSize: PageSize;
  margins?: PageMargins;
  orientation?: 'portrait' | 'landscape';
  bands: BandSet;
  /** Tags de contexto de uso (Anexo B). */
  contexts?: ReportContextRef[];
}

export interface ReportContextRef {
  contextTag: string;
  parameterDefaults?: Record<string, unknown>;
}

/** Dimensões em pontos PDF dos tamanhos de página nomeados. */
/**
 * Variáveis de sistema disponíveis nas expressões de qualquer template.
 * Resolvidas na renderização, não vêm da consulta.
 */
export interface SystemVariables {
  pageNumber: number;
  totalPages: number;
  now: Date;
}

export const PAGE_SIZES: Record<NamedPageSize, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
};

/** Resolve um `PageSize` (nomeado ou explícito) para largura/altura em pontos. */
export function resolvePageSize(size: PageSize): { width: number; height: number } {
  return typeof size === 'string' ? PAGE_SIZES[size] : size;
}
