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
import { renderSubreport } from './subreport.js';
import type { FontSet, RenderElementContext } from './elements.js';
import type { FormatOptions } from './format.js';
import type { EvaluateOptions } from '../expressions/evaluate.js';

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
  /**
   * Parâmetros do relatório, visíveis nas expressões pelo nome.
   * `generateReport` preenche isso sozinho a partir dos parâmetros validados.
   */
  parameters?: Record<string, unknown>;
  /** Funções extras e modo estrito do motor de expressões. */
  expressionOptions?: EvaluateOptions;
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
  const furnitureResolved = dataSet.rows[0];

  /**
   * Monta o contexto de renderização para uma linha de dados.
   * `resolvedRow` só existe quando a linha veio da árvore resolvida — é o que
   * dá aos subreports acesso aos filhos aninhados.
   */
  const contextFor = (
    pageCtx: PageContext,
    row: Record<string, unknown>,
    resolvedRow?: ResolvedRow,
  ): RenderElementContext => ({
    ctx: pageCtx,
    fonts,
    row,
    scope: {
      current: row,
      ...(options.parameters ? { parameters: options.parameters } : {}),
    },
    renderSubreport,
    ...(resolvedRow ? { resolvedRow } : {}),
    ...(options.formatOptions ? { formatOptions: options.formatOptions } : {}),
    ...(options.expressionOptions ? { expressionOptions: options.expressionOptions } : {}),
  });

  const ctx = new PageContext({
    doc,
    width,
    height,
    margins,
    onPageStart: async (pageCtx) => {
      if (!header) return;
      await renderBand(header, margins.top, contextFor(pageCtx, furnitureRow, furnitureResolved));
    },
    onPageEnd: async (pageCtx) => {
      if (!footer) return;
      // o rodapé fica ancorado na base da página, não no cursor
      await renderBand(
        footer,
        height - margins.bottom - footerHeight,
        contextFor(pageCtx, furnitureRow, furnitureResolved),
      );
    },
  });

  // primeira página: já dispara o header
  await ctx.newPage();
  ctx.y = margins.top + headerHeight;

  const details = template.bands.details;

  for (const row of dataSet.rows) {
    // a altura precisa ser medida POR LINHA: uma banda com subreport dentro
    // cresce conforme a quantidade de filhos daquela linha específica
    const detailHeight = measureBand(details, row);

    await placeDetail(ctx, detailHeight, headerHeight, footerHeight, async (y) =>
      renderBand(details, y, contextFor(ctx, row.data, row)),
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
  detailHeight: number,
  headerHeight: number,
  footerHeight: number,
  draw: (y: number) => Promise<number>,
): Promise<void> {
  const limit = ctx.height - ctx.margins.bottom - footerHeight;
  const usableHeight = limit - ctx.margins.top - headerHeight;

  // um bloco maior que a página inteira nunca vai caber: quebrar aqui só
  // geraria uma página em branco antes dele
  const fitsInAPage = detailHeight <= usableHeight;

  if (fitsInAPage && ctx.y + detailHeight > limit) {
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
