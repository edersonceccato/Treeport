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
  /** Estilo do traço da borda. Default: sólida. */
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  /** Raio dos cantos, em pontos. Só vale para formas com canto reto. */
  borderRadius?: number;
  /** Família da fonte. Default: a padrão do documento. */
  fontFamily?: FontFamily;
  /** Espaçamento entre linhas, múltiplo do corpo da fonte. Default: 1.2. */
  lineHeight?: number;
  /** Alinhamento vertical dentro da caixa. Default: topo. */
  verticalAlign?: 'top' | 'middle' | 'bottom';
}

/**
 * Fontes disponíveis.
 *
 * São as 14 fontes padrão do PDF, que não exigem embutir arquivo nenhum —
 * qualquer leitor de PDF já as tem. Fonte customizada exigiria enviar o
 * arquivo .ttf junto do template, o que fica para depois.
 */
export type FontFamily = 'helvetica' | 'times' | 'courier';

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
  /**
   * Data URI (`data:image/png;base64,...`), URL `http(s)`, ou expressão que
   * resolva para uma delas.
   *
   * URL só é baixada se o host permitir explicitamente (`allowRemoteImages`)
   * — um relatório que depende de download externo fica lento e frágil.
   */
  source: string;
  fit?: 'contain' | 'cover' | 'fill';
}

/** Simbologias de código de barras suportadas. */
export type BarcodeFormat =
  | 'code128'
  | 'code39'
  | 'code93'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'upce'
  | 'itf14'
  | 'interleaved2of5'
  | 'codabar'
  | 'msi'
  | 'pharmacode'
  | 'datamatrix'
  | 'pdf417'
  | 'azteccode';

export interface BarcodeElement extends BaseElement {
  type: 'barcode';
  format: BarcodeFormat;
  /** Nome de campo direto ou expressão `{{...}}`. */
  valueExpression: string;
  /**
   * Imprimir os dígitos legíveis abaixo das barras. Default: false.
   * Uma etiqueta de EAN costuma mostrar; um código interno, não.
   */
  includeText?: boolean;
}

/**
 * Tipo de conteúdo do QR.
 *
 * O QR em si não distingue tipos — quem interpreta é o app que lê. O que muda
 * é a FORMATAÇÃO do texto codificado: um vCard tem uma sintaxe, um wifi outra.
 * O designer monta essa sintaxe a partir de campos separados.
 */
export type QrContentKind = 'text' | 'url' | 'email' | 'phone' | 'sms' | 'wifi' | 'vcard' | 'geo';

export interface QrCodeElement extends BaseElement {
  type: 'qrcode';
  valueExpression: string;
  /** Como formatar o conteúdo. Default: `text` (codifica como veio). */
  contentKind?: QrContentKind;
  /**
   * Nível de correção de erro. Mais alto tolera mais sujeira/logo por cima,
   * ao custo de um código mais denso. Default: 'M'.
   */
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
  /** Cor dos módulos (as partes escuras). Default: preto. */
  foregroundColor?: string;
  /** Cor de fundo. Default: branco — nunca transparente, senão fica ilegível. */
  backgroundColor?: string;
}

export interface LineElement extends BaseElement {
  type: 'line';
  orientation: 'horizontal' | 'vertical';
}

export interface RectElement extends BaseElement {
  type: 'rect';
}

/** Formas geométricas desenháveis. */
export type ShapeKind =
  | 'rectangle'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'pentagon'
  | 'hexagon'
  | 'arrow';

/**
 * Uma forma geométrica.
 *
 * Substitui o `rect` como elemento genérico de desenho — `rect` continua no
 * schema para não quebrar templates já salvos, mas o designer cria `shape`.
 */
export interface ShapeElement extends BaseElement {
  type: 'shape';
  shape: ShapeKind;
  /** Pontas da estrela / lados do polígono, quando aplicável. */
  points?: number;
  /** Rotação em graus, no sentido horário. */
  rotation?: number;
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

/** Operações de agregação sobre um nó da árvore de dados. */
export type AggregateFunction = 'sum' | 'count' | 'avg' | 'min' | 'max';

/**
 * Totalizador: agrega um campo de um nó da árvore.
 *
 * Para contas entre fontes diferentes (média por cliente, por exemplo), use
 * `expression` com as funções de agregação:
 *
 *   {{SUM('ITEM', 'valor') / COUNT('PEDIDO')}}
 */
export interface AggregateElement extends BaseElement {
  type: 'aggregate';
  /** Nó da árvore a agregar. Vazio = o nó do design atual. */
  dataSourceNodeId?: string;
  fn: AggregateFunction;
  /** Campo a agregar. Dispensável em `count`. */
  fieldName?: string;
  /** Máscara de formatação do resultado. */
  format?: string;
  /**
   * Expressão livre, que ganha de `fn`/`fieldName` quando presente.
   * É o que permite combinar consultas diferentes numa conta só.
   */
  expression?: string;
  /** Texto antes do valor, ex.: "Total: ". */
  prefix?: string;
  suffix?: string;
}

export type ReportElement =
  | RegionElement
  | ShapeElement
  | AggregateElement
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
