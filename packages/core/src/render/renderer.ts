import { PDFDocument, StandardFonts } from 'pdf-lib';
import type {
  PageMargins,
  ResolvedDataSet,
  ResolvedRow,
  Template,
} from '@treeport/schema';
import { resolvePageSize } from '@treeport/schema';
import { PageContext } from './page-context.js';
import { renderBand, measureBand } from './band.js';
import type { FontSet, RenderElementContext } from './elements.js';
import type { FormatOptions } from './format.js';

/**
 * Motor de renderização (seção 7 do brief).
 *
 * Fase 2: Header/Details/Footer com Label, Field, Line e Rect, controlando
 * quebra de página. Header e Footer se repetem em toda página, como um
 * timbrado; Details repete uma vez por linha de dados.
 */

export interface RenderOptions {
  /** Separadores numéricos usados nas máscaras de formato. Default: pt-BR. */
  formatOptions?: FormatOptions;
  /** Metadados gravados no PDF. */
  title?: string;
  author?: string;
}

/** Margens padrão (~1,76cm), próximas do que um relatório A4 costuma usar. */
const DEFAULT_MARGINS: PageMargins = { top: 50, right: 50, bottom: 50, left: 50 };

/**
 * Gera o PDF a partir de um template e de um conjunto de dados já resolvido.
 * Devolve os bytes do PDF.
 */
export async function renderReport(
  template: Template,
  dataSet: ResolvedDataSet,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await loadFonts(doc);

  doc.setTitle(options.title ?? template.name);
  if (options.author) doc.setAuthor(options.author);
  doc.setCreator('Treeport');

  const { width, height } = pageDimensions(template);
  const margins = template.margins ?? DEFAULT_MARGINS;

  const header = template.bands.header;
  const footer = template.bands.footer;
  const headerHeight = header ? measureBand(header) : 0;
  const footerHeight = footer ? measureBand(footer) : 0;

  /**
   * Header e footer são desenhados com a PRIMEIRA linha do master como
   * contexto (é um timbrado: mostra dados do documento, não da linha
   * corrente). Sem linhas, usa um contexto vazio.
   */
  const furnitureRow = dataSet.rows[0]?.data ?? {};

  const ctx = new PageContext({
    doc,
    width,
    height,
    margins,
    onPageStart: async (pageCtx) => {
      if (!header) return;
      await renderBand(header, margins.top, {
        ctx: pageCtx,
        fonts,
        row: furnitureRow,
        ...(options.formatOptions ? { formatOptions: options.formatOptions } : {}),
      });
    },
    onPageEnd: async (pageCtx) => {
      if (!footer) return;
      // o rodapé fica ancorado na base da página, não no cursor
      await renderBand(footer, height - margins.bottom - footerHeight, {
        ctx: pageCtx,
        fonts,
        row: furnitureRow,
        ...(options.formatOptions ? { formatOptions: options.formatOptions } : {}),
      });
    },
  });

  // primeira página: já dispara o header
  await ctx.newPage();
  ctx.y = margins.top + headerHeight;

  const details = template.bands.details;
  const detailHeight = measureBand(details);

  for (const row of dataSet.rows) {
    await placeDetail(ctx, row, detailHeight, headerHeight, footerHeight, async (y) =>
      renderBand(details, y, {
        ctx,
        fonts,
        row: row.data,
        ...(options.formatOptions ? { formatOptions: options.formatOptions } : {}),
      }),
    );
  }

  await ctx.finish();
  return doc.save();
}

/**
 * Posiciona uma banda de detalhe, quebrando a página quando não cabe.
 * Depois da quebra, o cursor recomeça abaixo do header da página nova.
 */
async function placeDetail(
  ctx: PageContext,
  _row: ResolvedRow,
  detailHeight: number,
  headerHeight: number,
  footerHeight: number,
  draw: (y: number) => Promise<number>,
): Promise<void> {
  const limit = ctx.height - ctx.margins.bottom - footerHeight;

  if (ctx.y + detailHeight > limit) {
    await ctx.newPage();
    ctx.y = ctx.margins.top + headerHeight;
  }

  const used = await draw(ctx.y);
  ctx.y += used;
}

/** Dimensões da página, já considerando a orientação. */
function pageDimensions(template: Template): { width: number; height: number } {
  const size = resolvePageSize(template.pageSize);
  if (template.orientation === 'landscape') {
    return { width: size.height, height: size.width };
  }
  return size;
}

/** Carrega as 4 variantes da Helvetica (fontes padrão, sem arquivo externo). */
export async function loadFonts(doc: PDFDocument): Promise<FontSet> {
  const [regular, bold, italic, boldItalic] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.HelveticaOblique),
    doc.embedFont(StandardFonts.HelveticaBoldOblique),
  ]);
  return { regular, bold, italic, boldItalic };
}

export type { RenderElementContext };
