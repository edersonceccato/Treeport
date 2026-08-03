import type { PDFFont } from 'pdf-lib';
import type {
  BarcodeElement,
  RegionElement,
  ElementStyle,
  FieldElement,
  ImageElement,
  LabelElement,
  LineElement,
  RectElement,
  QrCodeElement,
  ReportElement,
  ResolvedRow,
  SubreportElement,
} from '@treeport/schema';
import type { PageContext } from './page-context.js';
import { formatValue, type FormatOptions } from './format.js';
import { lineHeight, wrapText } from './text.js';
import { interpolate, evaluateExpression } from '../expressions/interpolate.js';
import { hasField } from '../expressions/evaluate.js';
import { generateBarcode, generateQrCode, type BarcodeRenderOptions } from './barcode.js';
import type { EvaluateOptions, ExpressionScope } from '../expressions/evaluate.js';

/**
 * Desenho dos elementos individuais dentro de uma banda.
 *
 * Todo elemento é desenhado em coordenadas ABSOLUTAS de página (o chamador já
 * somou o Y de origem da banda e o offset de auto-grow). Cada função devolve a
 * altura realmente ocupada, que é o que alimenta o auto-grow em cascata da
 * Fase 5 — por isso o retorno existe já agora, mesmo que nesta fase quase
 * sempre seja igual à `height` nominal.
 */

export interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

export interface RenderElementContext {
  ctx: PageContext;
  fonts: FontSet;
  /** A linha de dados atual, de onde os FieldElement leem seus valores. */
  row: Record<string, unknown>;
  formatOptions?: FormatOptions;
  /**
   * Escopo das expressões. Traz a corrente `current`/`parent`, que é o que
   * permite um Label dentro de um subreport referenciar campos do nó pai.
   * Quando ausente, é montado a partir de `row`.
   */
  scope?: ExpressionScope;
  expressionOptions?: EvaluateOptions;
  /** Densidade e legenda dos códigos de barras/QR. */
  barcodeOptions?: BarcodeRenderOptions;
  /**
   * A linha resolvida completa (com os filhos aninhados). Só é necessária
   * quando a banda contém um `SubreportElement`, que precisa alcançar
   * `row.children[nodeId]`.
   */
  resolvedRow?: ResolvedRow;
  /**
   * Como renderizar um subreport. Injetado pelo renderer para quebrar a
   * dependência circular — `elements` desenha os elementos e `subreport`
   * desenha bandas, que por sua vez contêm elementos.
   */
  renderSubreport?: (
    element: SubreportElement,
    absoluteY: number,
    context: RenderElementContext,
  ) => Promise<number>;
}

const DEFAULT_FONT_SIZE = 10;

/** Escolhe a variante de fonte conforme negrito/itálico do estilo. */
export function pickFont(fonts: FontSet, style?: ElementStyle): PDFFont {
  if (style?.bold && style?.italic) return fonts.boldItalic;
  if (style?.bold) return fonts.bold;
  if (style?.italic) return fonts.italic;
  return fonts.regular;
}

/**
 * Desenha um elemento na posição absoluta informada.
 * Devolve a altura ocupada (>= `element.height`).
 */
export async function renderElement(
  element: ReportElement,
  absoluteY: number,
  context: RenderElementContext,
): Promise<number> {
  // `hidden` some do PDF também, não só do designer
  if (element.hidden) return 0;

  switch (element.type) {
    case 'region':
      return renderRegion(element, absoluteY, context);

    case 'label':
      return renderText(resolveLabelText(element, context), element, absoluteY, context);

    case 'field':
      return renderText(resolveFieldText(element, context), element, absoluteY, context);

    case 'rect':
      return renderRect(element, absoluteY, context);

    case 'line':
      return renderLine(element, absoluteY, context);

    case 'subreport':
      // delegado ao renderer, que sabe desenhar bandas (ver `renderSubreport`)
      return context.renderSubreport
        ? context.renderSubreport(element, absoluteY, context)
        : element.height;

    case 'barcode':
      return renderBarcode(element, absoluteY, context);

    case 'qrcode':
      return renderQrCode(element, absoluteY, context);

    case 'image':
      return renderImage(element, absoluteY, context);

    // `table` entra depois; reservar o espaço é melhor que ignorar em
    // silêncio, porque o layout ao redor continua correto.
    default:
      return element.height;
  }
}

/**
 * Texto de um Label, resolvendo expressões `{{...}}`.
 *
 * A interpolação roda sempre que o texto tem `{{}}`, mesmo sem
 * `isExpression: true` — o flag existe para o Designer saber qual editor
 * abrir, e exigir os dois seria uma pegadinha silenciosa (o usuário escreve
 * a expressão, esquece o flag e vê `{{VALOR}}` impresso no PDF).
 *
 * `isExpression: true` com um texto SEM `{{}}` trata o conteúdo inteiro como
 * expressão, que é como o Designer salva um label puramente calculado.
 */
function resolveLabelText(element: LabelElement, context: RenderElementContext): string {
  const scope = resolveScope(context);

  if (element.isExpression && !element.content.includes('{{')) {
    return toDisplayText(
      evaluateExpression(element.content, scope, context.expressionOptions ?? {}),
    );
  }

  return interpolate(element.content, scope, context.expressionOptions ?? {});
}

/** Escopo das expressões: o informado, ou um montado a partir da linha. */
export function resolveScope(context: RenderElementContext): ExpressionScope {
  return context.scope ?? { current: context.row };
}

/** Converte o resultado de uma expressão para texto de exibição. */
function toDisplayText(value: unknown): string {
  return formatValue(value);
}

/**
 * Texto de um Field: valor da coluna, com a máscara aplicada.
 *
 * `fieldName` normalmente é um nome de coluna cru (o caminho rápido, sem
 * parser). Se vier com `{{}}`, é tratado como expressão — o que permite
 * `{{parent.CLIENTE}}` num Field dentro de um subreport sem precisar trocar
 * o elemento por um Label.
 */
function resolveFieldText(element: FieldElement, context: RenderElementContext): string {
  const raw = element.fieldName.includes('{{')
    ? evaluateExpression(
        element.fieldName,
        resolveScope(context),
        context.expressionOptions ?? {},
      )
    : lookupField(element.fieldName, context);

  return formatValue(raw, element.format, context.formatOptions ?? {});
}

/**
 * Busca o campo na linha atual e, se não achar, sobe a corrente de escopos.
 * Sem isso, um Field dentro de um subreport não enxergaria os campos do pai —
 * que é justamente o que o Report Builder de origem faz.
 */
function lookupField(fieldName: string, context: RenderElementContext): unknown {
  if (hasField(context.row, fieldName)) return context.row[fieldName];

  for (let s = context.scope; s; s = s.parent) {
    if (hasField(s.current, fieldName)) return s.current[fieldName];
  }
  return undefined;
}

/**
 * Desenha texto dentro da caixa do elemento, com fundo/borda opcionais.
 * Quebra em várias linhas quando `canGrow`; senão corta na altura nominal.
 */
async function renderText(
  text: string,
  element: ReportElement,
  absoluteY: number,
  context: RenderElementContext,
): Promise<number> {
  const { ctx, fonts } = context;
  const style = element.style;
  const fontSize = style?.fontSize ?? DEFAULT_FONT_SIZE;
  const font = pickFont(fonts, style);
  const lh = lineHeight(fontSize);

  const lines = wrapText(text, font, fontSize, element.width);
  const maxLines = element.canGrow
    ? lines.length
    : Math.max(1, Math.floor(element.height / lh));
  const visible = lines.slice(0, maxLines);

  const usedHeight = Math.max(element.height, visible.length * lh);

  // fundo e borda ocupam a altura final (já crescida)
  if (style?.backgroundColor !== undefined || (style?.borderWidth ?? 0) > 0) {
    await ctx.drawRect({
      x: element.x,
      y: absoluteY,
      width: element.width,
      height: usedHeight,
      fill: style?.backgroundColor,
      borderColor: style?.borderColor,
      borderWidth: style?.borderWidth,
    });
  }

  let lineY = absoluteY;
  for (const line of visible) {
    await ctx.drawTextLine(line, {
      x: element.x,
      y: lineY,
      width: element.width,
      font,
      fontSize,
      color: style?.color,
      align: style?.align,
    });
    lineY += lh;
  }

  return usedHeight;
}

/**
 * Desenha um código de barras.
 *
 * `valueExpression` pode ser um nome de campo direto ou uma expressão — a
 * mesma flexibilidade do `fieldName` do Field.
 */
async function renderBarcode(
  element: BarcodeElement,
  absoluteY: number,
  context: RenderElementContext,
): Promise<number> {
  const value = resolveCodeValue(element.valueExpression, context);
  if (value === '') return element.height;

  const png = await generateBarcode(element.format, value, element.height, {
    ...(context.barcodeOptions ?? {}),
    // o que o elemento declara ganha da opção global do relatório
    ...(element.includeText === undefined ? {} : { includeText: element.includeText }),
  });

  await context.ctx.drawImage({
    data: png,
    x: element.x,
    y: absoluteY,
    width: element.width,
    height: element.height,
    fit: 'contain',
  });

  return element.height;
}

async function renderQrCode(
  element: QrCodeElement,
  absoluteY: number,
  context: RenderElementContext,
): Promise<number> {
  const value = resolveCodeValue(element.valueExpression, context);
  if (value === '') return element.height;

  const png = await generateQrCode(value, context.barcodeOptions ?? {});

  await context.ctx.drawImage({
    data: png,
    x: element.x,
    y: absoluteY,
    width: element.width,
    height: element.height,
    fit: 'contain',
  });

  return element.height;
}

/**
 * Desenha uma imagem.
 *
 * `source` aceita data URI (`data:image/png;base64,...`) ou uma expressão que
 * resolva para uma. O motor NÃO busca URL da rede: um relatório que depende de
 * download externo fica lento e frágil, e a aplicação hospedeira sabe melhor
 * que nós como buscar (com auth, cache, timeout) — ela passa os bytes prontos.
 */
async function renderImage(
  element: ImageElement,
  absoluteY: number,
  context: RenderElementContext,
): Promise<number> {
  const source = element.source.includes('{{')
    ? String(
        evaluateExpression(element.source, resolveScope(context), context.expressionOptions ?? {}) ??
          '',
      )
    : element.source;

  const data = decodeImageSource(source);
  if (!data) return element.height;

  await context.ctx.drawImage({
    data,
    x: element.x,
    y: absoluteY,
    width: element.width,
    height: element.height,
    ...(element.fit ? { fit: element.fit } : {}),
  });

  return element.height;
}

/** Extrai os bytes de um data URI; devolve undefined para o que não souber ler. */
function decodeImageSource(source: string): Uint8Array | undefined {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(source.trim());
  if (!match) return undefined;

  try {
    return new Uint8Array(Buffer.from(match[2]!, 'base64'));
  } catch {
    return undefined;
  }
}

/** Valor de um barcode/QR: nome de campo direto ou expressão. */
function resolveCodeValue(expression: string, context: RenderElementContext): string {
  const scope = resolveScope(context);

  // caminho rápido: nome de coluna cru, sem passar pelo parser
  if (!expression.includes('{{')) {
    const direct = lookupField(expression, context);
    if (direct !== undefined) return formatValue(direct);
  }

  const value = evaluateExpression(expression, scope, context.expressionOptions ?? {});
  return formatValue(value);
}

/**
 * Desenha uma região: o fundo/borda dela e depois os filhos, cujas
 * coordenadas são RELATIVAS ao canto superior esquerdo da região.
 *
 * Devolve a altura ocupada. Com `autoHeight`, cresce para caber um filho que
 * tenha transbordado — é o que faz uma caixa de totais acompanhar o conteúdo.
 */
async function renderRegion(
  element: RegionElement,
  absoluteY: number,
  context: RenderElementContext,
): Promise<number> {
  const style = element.style;

  if (style?.backgroundColor !== undefined || (style?.borderWidth ?? 0) > 0) {
    await context.ctx.drawRect({
      x: element.x,
      y: absoluteY,
      width: element.width,
      height: element.height,
      fill: style?.backgroundColor,
      borderColor: style?.borderColor,
      borderWidth: style?.borderWidth,
    });
  }

  let bottom = element.height;

  for (const child of element.elements) {
    if (child.hidden) continue;

    // filho em coordenada relativa: soma a origem da região
    const absoluteChild = { ...child, x: element.x + child.x } as ReportElement;
    const used = await renderElement(absoluteChild, absoluteY + child.y, context);

    const childBottom = child.y + used;
    if (childBottom > bottom) bottom = childBottom;
  }

  return element.autoHeight ? Math.max(element.height, bottom) : element.height;
}

async function renderRect(
  element: RectElement,
  absoluteY: number,
  context: RenderElementContext,
): Promise<number> {
  const style = element.style;
  await context.ctx.drawRect({
    x: element.x,
    y: absoluteY,
    width: element.width,
    height: element.height,
    fill: style?.backgroundColor,
    borderColor: style?.borderColor,
    // um retângulo sem nenhuma borda declarada ainda deve aparecer
    borderWidth: style?.borderWidth ?? (style?.backgroundColor ? 0 : 1),
  });
  return element.height;
}

async function renderLine(
  element: LineElement,
  absoluteY: number,
  context: RenderElementContext,
): Promise<number> {
  const style = element.style;
  const thickness = style?.borderWidth ?? 1;
  const color = style?.borderColor ?? style?.color;

  const from =
    element.orientation === 'horizontal'
      ? { x: element.x, y: absoluteY }
      : { x: element.x, y: absoluteY };
  const to =
    element.orientation === 'horizontal'
      ? { x: element.x + element.width, y: absoluteY }
      : { x: element.x, y: absoluteY + element.height };

  await context.ctx.drawLine({ from, to, color, thickness });
  return element.height;
}
