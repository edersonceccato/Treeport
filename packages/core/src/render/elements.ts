import type { PDFFont } from 'pdf-lib';
import type {
  ElementStyle,
  FieldElement,
  LabelElement,
  LineElement,
  RectElement,
  ReportElement,
} from '@treeport/schema';
import type { PageContext } from './page-context.js';
import { formatValue, type FormatOptions } from './format.js';
import { lineHeight, wrapText } from './text.js';

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
  switch (element.type) {
    case 'label':
      return renderText(resolveLabelText(element), element, absoluteY, context);

    case 'field':
      return renderText(resolveFieldText(element, context), element, absoluteY, context);

    case 'rect':
      return renderRect(element, absoluteY, context);

    case 'line':
      return renderLine(element, absoluteY, context);

    // Os demais tipos entram nas fases seguintes (imagem/barcode/qrcode na
    // Fase 6, subreport na Fase 4, table depois). Ignorar em silêncio aqui
    // seria pior que reservar o espaço: o layout continua correto.
    default:
      return element.height;
  }
}

/** Texto de um Label. Expressões `{{...}}` entram na Fase 3. */
function resolveLabelText(element: LabelElement): string {
  return element.content;
}

/** Texto de um Field: valor da coluna, com a máscara aplicada. */
function resolveFieldText(element: FieldElement, context: RenderElementContext): string {
  const raw = context.row[element.fieldName];
  return formatValue(raw, element.format, context.formatOptions ?? {});
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
