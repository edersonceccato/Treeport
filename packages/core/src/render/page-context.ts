import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import { rgb, degrees } from 'pdf-lib';
import type { PageMargins, ShapeKind } from '@treeport/schema';
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
  /** Imagens já embutidas, para não duplicar os mesmos bytes no PDF. */
  private readonly imageCache = new Map<string, PDFImage>();

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

  /**
   * Converte um X de template para o X do PDF.
   *
   * O `x` de um elemento é relativo à área útil da página (depois da margem
   * esquerda), do mesmo jeito que o `y` é relativo ao topo útil. Sem somar a
   * margem aqui, todo o conteúdo encostaria na borda física da folha.
   */
  toPdfX(templateX: number): number {
    return this.margins.left + templateX;
  }

  /** Largura utilizável, já descontadas as duas margens laterais. */
  get contentWidth(): number {
    return this.width - this.margins.left - this.margins.right;
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
      x: this.toPdfX(opts.x),
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
      start: { x: this.toPdfX(opts.from.x), y: this.toPdfY(opts.from.y) },
      end: { x: this.toPdfX(opts.to.x), y: this.toPdfY(opts.to.y) },
      thickness: opts.thickness ?? 1,
      color: parseColor(opts.color, rgb(0, 0, 0)),
    });
  }

  /**
   * Desenha uma forma geométrica.
   *
   * Retângulo e elipse usam as primitivas do pdf-lib; as demais viram um path
   * SVG, que é como o pdf-lib desenha contorno arbitrário. O path é montado em
   * coordenadas de tela e desenhado a partir do canto superior esquerdo, com o
   * eixo Y já invertido pelo próprio pdf-lib.
   */
  async drawShape(opts: {
    shape: ShapeKind;
    x: number;
    y: number;
    width: number;
    height: number;
    points?: number;
    rotation?: number;
    fill?: string | undefined;
    borderColor?: string | undefined;
    borderWidth?: number | undefined;
    borderRadius?: number | undefined;
  }): Promise<void> {
    const page = await this.page();
    const borderWidth = opts.borderWidth ?? 0;

    const paint = {
      ...(opts.fill !== undefined ? { color: parseColor(opts.fill) } : {}),
      ...(borderWidth > 0
        ? {
            borderColor: parseColor(opts.borderColor, rgb(0, 0, 0)),
            borderWidth,
          }
        : {}),
    };

    // nada a pintar nem contornar
    if (Object.keys(paint).length === 0) return;

    if (opts.shape === 'rectangle') {
      page.drawRectangle({
        x: this.toPdfX(opts.x),
        y: this.toPdfY(opts.y, opts.height),
        width: opts.width,
        height: opts.height,
        ...(opts.rotation ? { rotate: degrees(-opts.rotation) } : {}),
        ...paint,
      });
      return;
    }

    if (opts.shape === 'ellipse') {
      page.drawEllipse({
        // a elipse do pdf-lib é desenhada a partir do CENTRO
        x: this.toPdfX(opts.x + opts.width / 2),
        y: this.toPdfY(opts.y + opts.height / 2),
        xScale: opts.width / 2,
        yScale: opts.height / 2,
        ...paint,
      });
      return;
    }

    const path = shapePath(opts.shape, opts.width, opts.height, opts.points);
    page.drawSvgPath(path, {
      x: this.toPdfX(opts.x),
      y: this.toPdfY(opts.y),
      ...(opts.rotation ? { rotate: degrees(-opts.rotation) } : {}),
      ...paint,
    });
  }

  /**
   * Desenha uma imagem (PNG ou JPEG) na caixa informada.
   *
   * `fit` decide o que fazer quando a proporção da imagem não bate com a da
   * caixa: `contain` (default) preserva a proporção e centraliza, `fill`
   * estica para preencher, `cover` preenche cortando o excesso.
   */
  async drawImage(opts: {
    data: Uint8Array;
    x: number;
    y: number;
    width: number;
    height: number;
    fit?: 'contain' | 'cover' | 'fill' | undefined;
  }): Promise<void> {
    const page = await this.page();
    const image = await this.embedImage(opts.data);

    const box = fitBox(
      { width: image.width, height: image.height },
      { width: opts.width, height: opts.height },
      opts.fit ?? 'contain',
    );

    page.drawImage(image, {
      x: this.toPdfX(opts.x + box.offsetX),
      y: this.toPdfY(opts.y + box.offsetY, box.height),
      width: box.width,
      height: box.height,
    });
  }

  /**
   * Embute a imagem no documento, reaproveitando quando os mesmos bytes já
   * foram embutidos. Sem o cache, um código de barras repetido em 500 linhas
   * viraria 500 cópias do PNG dentro do PDF.
   */
  private async embedImage(data: Uint8Array): Promise<PDFImage> {
    const key = imageKey(data);
    const cached = this.imageCache.get(key);
    if (cached) return cached;

    const image = isJpeg(data)
      ? await this.doc.embedJpg(data)
      : await this.doc.embedPng(data);

    this.imageCache.set(key, image);
    return image;
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
    let x = this.toPdfX(opts.x);
    if (opts.align === 'center') x += (opts.width - textWidth) / 2;
    else if (opts.align === 'right') x += opts.width - textWidth;

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

/** JPEG começa com os bytes FF D8 FF; qualquer outra coisa tratamos como PNG. */
function isJpeg(data: Uint8Array): boolean {
  return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

/**
 * Chave de cache das imagens.
 *
 * Usa tamanho + uma amostra de bytes em vez de hash criptográfico: é barato e
 * suficiente para o propósito (evitar reembutir a MESMA imagem), já que uma
 * colisão exigiria dois PNGs de tamanho idêntico e mesmos bytes nas posições
 * amostradas.
 */
function imageKey(data: Uint8Array): string {
  const parts = [data.length];
  const step = Math.max(1, Math.floor(data.length / 32));
  for (let i = 0; i < data.length; i += step) parts.push(data[i]!);
  return parts.join(',');
}

/**
 * Calcula a caixa de desenho da imagem conforme o modo de encaixe.
 * Devolve o tamanho final e o deslocamento dentro da caixa original.
 */
function fitBox(
  image: { width: number; height: number },
  box: { width: number; height: number },
  fit: 'contain' | 'cover' | 'fill',
): { width: number; height: number; offsetX: number; offsetY: number } {
  if (fit === 'fill' || image.width === 0 || image.height === 0) {
    return { width: box.width, height: box.height, offsetX: 0, offsetY: 0 };
  }

  const scale =
    fit === 'cover'
      ? Math.max(box.width / image.width, box.height / image.height)
      : Math.min(box.width / image.width, box.height / image.height);

  const width = image.width * scale;
  const height = image.height * scale;

  return {
    width,
    height,
    // centraliza o que sobrar (ou o que transbordar, no caso do cover)
    offsetX: (box.width - width) / 2,
    offsetY: (box.height - height) / 2,
  };
}

/**
 * Path SVG de cada forma, em coordenadas locais (origem no canto superior
 * esquerdo, Y crescendo para baixo — o pdf-lib inverte ao desenhar).
 */
function shapePath(shape: ShapeKind, width: number, height: number, points = 5): string {
  switch (shape) {
    case 'triangle':
      return `M ${width / 2} 0 L ${width} ${height} L 0 ${height} Z`;

    case 'diamond':
      return `M ${width / 2} 0 L ${width} ${height / 2} L ${width / 2} ${height} L 0 ${height / 2} Z`;

    case 'arrow': {
      // seta apontando para a direita, com a haste na metade da altura
      const shaft = height * 0.3;
      const headStart = width * 0.6;
      return [
        `M 0 ${(height - shaft) / 2}`,
        `L ${headStart} ${(height - shaft) / 2}`,
        `L ${headStart} 0`,
        `L ${width} ${height / 2}`,
        `L ${headStart} ${height}`,
        `L ${headStart} ${(height + shaft) / 2}`,
        `L 0 ${(height + shaft) / 2}`,
        'Z',
      ].join(' ');
    }

    case 'star':
      return starPath(width, height, Math.max(3, points));

    case 'pentagon':
      return polygonPath(width, height, 5);

    case 'hexagon':
      return polygonPath(width, height, 6);

    default:
      return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
  }
}

/** Polígono regular inscrito na caixa, com um vértice no topo. */
function polygonPath(width: number, height: number, sides: number): string {
  const cx = width / 2;
  const cy = height / 2;
  const parts: string[] = [];

  for (let i = 0; i < sides; i += 1) {
    // -90° põe o primeiro vértice no topo, que é como se espera ver a forma
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * cx;
    const y = cy + Math.sin(angle) * cy;
    parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  return `${parts.join(' ')} Z`;
}

/** Estrela: alterna entre o raio externo e um interno de ~38%. */
function starPath(width: number, height: number, points: number): string {
  const cx = width / 2;
  const cy = height / 2;
  const inner = 0.382; // proporção clássica da estrela de 5 pontas
  const parts: string[] = [];

  for (let i = 0; i < points * 2; i += 1) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const scale = i % 2 === 0 ? 1 : inner;
    const x = cx + Math.cos(angle) * cx * scale;
    const y = cy + Math.sin(angle) * cy * scale;
    parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  return `${parts.join(' ')} Z`;
}
