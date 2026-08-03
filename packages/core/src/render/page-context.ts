import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';
import { rgb } from 'pdf-lib';
import type { PageMargins } from '@treeport/schema';
import { parseColor } from './color.js';
import { measure, sanitizeForStandardFont } from './text.js';

/**
 * Controla a página atual, o cursor vertical e a conversão de coordenadas.
 *
 * O PDF tem origem no canto **inferior** esquerdo e Y crescendo para cima; o
 * template usa origem no canto **superior** esquerdo com Y crescendo para
 * baixo (que é como todo designer visual funciona). Esta classe concentra essa
 * inversão num lugar só — o resto do motor pensa sempre em coordenadas de
 * template, o que evita erro de sinal espalhado pelo código.
 */

export interface PageContextOptions {
  doc: PDFDocument;
  width: number;
  height: number;
  margins: PageMargins;
  /** Chamado a cada página nova, para desenhar o cabeçalho. */
  onPageStart?: (ctx: PageContext) => void | Promise<void>;
  /** Chamado ao fechar cada página, para desenhar o rodapé. */
  onPageEnd?: (ctx: PageContext) => void | Promise<void>;
}

export interface TextBoxOptions {
  x: number;
  y: number;
  width: number;
  font: PDFFont;
  fontSize: number;
  color?: string | undefined;
  align?: 'left' | 'center' | 'right' | undefined;
}

export class PageContext {
  readonly doc: PDFDocument;
  readonly width: number;
  readonly height: number;
  readonly margins: PageMargins;

  private currentPage: PDFPage | undefined;
  /** Cursor vertical em coordenadas de template (0 = topo da página). */
  private cursorY = 0;
  private readonly onPageStart: ((ctx: PageContext) => void | Promise<void>) | undefined;
  private readonly onPageEnd: ((ctx: PageContext) => void | Promise<void>) | undefined;
  private pageCount = 0;

  constructor(options: PageContextOptions) {
    this.doc = options.doc;
    this.width = options.width;
    this.height = options.height;
    this.margins = options.margins;
    this.onPageStart = options.onPageStart;
    this.onPageEnd = options.onPageEnd;
  }

  /** Número de páginas já iniciadas. */
  get pages(): number {
    return this.pageCount;
  }

  /** Y atual do cursor, em coordenadas de template. */
  get y(): number {
    return this.cursorY;
  }

  set y(value: number) {
    this.cursorY = value;
  }

  /** Y máximo utilizável antes de estourar a margem inferior. */
  get bottomLimit(): number {
    return this.height - this.margins.bottom;
  }

  /** Espaço vertical ainda disponível na página atual. */
  get remaining(): number {
    return this.bottomLimit - this.cursorY;
  }

  /** A página atual, criando a primeira sob demanda. */
  async page(): Promise<PDFPage> {
    if (!this.currentPage) await this.newPage();
    return this.currentPage!;
  }

  /** Fecha a página atual (desenhando o rodapé) e começa outra. */
  async newPage(): Promise<PDFPage> {
    if (this.currentPage && this.onPageEnd) await this.onPageEnd(this);

    this.currentPage = this.doc.addPage([this.width, this.height]);
    this.pageCount += 1;
    this.cursorY = this.margins.top;

    if (this.onPageStart) await this.onPageStart(this);
    return this.currentPage;
  }

  /** Fecha a última página, desenhando o rodapé nela. */
  async finish(): Promise<void> {
    if (this.currentPage && this.onPageEnd) await this.onPageEnd(this);
  }

  /**
   * Garante espaço para um bloco de altura `blockHeight`, abrindo página nova
   * se não couber. Devolve true se houve quebra.
   */
  async ensureSpace(blockHeight: number): Promise<boolean> {
    if (!this.currentPage) {
      await this.newPage();
      return false;
    }
    // um bloco maior que a página inteira nunca cabe: não adianta quebrar em
    // loop, desenha na página atual e deixa transbordar de forma controlada
    const usable = this.bottomLimit - this.margins.top;
    if (blockHeight > usable) return false;

    if (this.remaining < blockHeight) {
      await this.newPage();
      return true;
    }
    return false;
  }

  /** Converte um Y de template para o Y do PDF (origem embaixo). */
  toPdfY(templateY: number, elementHeight = 0): number {
    return this.height - templateY - elementHeight;
  }

  // --- Primitivas de desenho, todas em coordenadas de template -------------

  async drawRect(opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string | undefined;
    borderColor?: string | undefined;
    borderWidth?: number | undefined;
  }): Promise<void> {
    const page = await this.page();
    const borderWidth = opts.borderWidth ?? 0;
    const hasFill = opts.fill !== undefined;
    const hasBorder = borderWidth > 0;
    if (!hasFill && !hasBorder) return;

    page.drawRectangle({
      x: opts.x,
      y: this.toPdfY(opts.y, opts.height),
      width: opts.width,
      height: opts.height,
      ...(hasFill ? { color: parseColor(opts.fill) } : {}),
      ...(hasBorder
        ? {
            borderColor: parseColor(opts.borderColor, rgb(0, 0, 0)),
            borderWidth,
          }
        : {}),
    });
  }

  async drawLine(opts: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    color?: string | undefined;
    thickness?: number | undefined;
  }): Promise<void> {
    const page = await this.page();
    page.drawLine({
      start: { x: opts.from.x, y: this.toPdfY(opts.from.y) },
      end: { x: opts.to.x, y: this.toPdfY(opts.to.y) },
      thickness: opts.thickness ?? 1,
      color: parseColor(opts.color, rgb(0, 0, 0)),
    });
  }

  /**
   * Desenha uma linha de texto dentro de uma caixa, tratando alinhamento.
   * `y` é o topo da linha; o baseline é calculado a partir dele.
   */
  async drawTextLine(text: string, opts: TextBoxOptions): Promise<void> {
    if (text === '') return;
    const page = await this.page();
    const safe = sanitizeForStandardFont(text, opts.font);

    const textWidth = measure(safe, opts.font, opts.fontSize);
    let x = opts.x;
    if (opts.align === 'center') x = opts.x + (opts.width - textWidth) / 2;
    else if (opts.align === 'right') x = opts.x + opts.width - textWidth;

    // desce do topo da linha até o baseline (a altura da fonte acima da linha base)
    const baseline = this.toPdfY(opts.y) - opts.font.heightAtSize(opts.fontSize) * 0.8;

    page.drawText(safe, {
      x,
      y: baseline,
      size: opts.fontSize,
      font: opts.font,
      color: parseColor(opts.color, rgb(0, 0, 0)),
    });
  }
}
