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
import { measureBandContent } from './measure.js';
import type { FontSet, RenderElementContext } from './elements.js';
import type { FormatOptions } from '@treeport/schema';
import type { EvaluateOptions } from '@treeport/schema';
import { createAggregateFunctions } from '@treeport/schema';
import type { BarcodeRenderOptions } from './barcode.js';

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
  /** Densidade e legenda dos códigos de barras/QR. */
  barcodeOptions?: BarcodeRenderOptions;
  /**
   * Total de páginas já conhecido, usado internamente na segunda passada de
   * renderização quando o template usa `sys.totalPages`.
   */
  totalPagesHint?: number;
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

  // `sys.totalPages` só é conhecido depois de paginar. Renderizamos uma vez
  // para descobrir o total e, se algum elemento usa a variável, uma segunda
  // vez com o valor correto — é o mesmo truque que os motores clássicos usam.
  // as agregações precisam da árvore inteira: um totalizador no rodapé soma
  // linhas que estão em qualquer nó, não só na banda onde ele está
  const aggregates = createAggregateFunctions({
    rootRows: dataSet.rows,
    currentNodeId: template.boundDataSourceNodeId,
    currentRows: dataSet.rows,
    knownNodeIds: collectNodeIds(dataSet.rows, template.boundDataSourceNodeId),
  });

  const expressionOptions: EvaluateOptions = {
    ...options.expressionOptions,
    functions: { ...aggregates, ...options.expressionOptions?.functions },
  };

  const usesTotalPages = templateUsesTotalPages(template);
  let totalPagesHint = options.totalPagesHint ?? 1;

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
      system: {
        pageNumber: pageCtx.pages,
        // só se sabe o total ao terminar; a 2a passada corrige (ver abaixo)
        totalPages: totalPagesHint,
        now: new Date(),
      },
    },
    renderSubreport,
    ...(resolvedRow ? { resolvedRow } : {}),
    ...(options.formatOptions ? { formatOptions: options.formatOptions } : {}),
    expressionOptions,
    ...(options.barcodeOptions ? { barcodeOptions: options.barcodeOptions } : {}),
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
    // (ou com texto que quebra) cresce conforme os dados daquela linha
    const detailHeight = measureBandContent(details, {
      fonts,
      row: row.data,
      resolvedRow: row,
      scope: {
        current: row.data,
        ...(options.parameters ? { parameters: options.parameters } : {}),
      },
      ...(options.formatOptions ? { formatOptions: options.formatOptions } : {}),
      expressionOptions,
    });

    await placeDetail(ctx, detailHeight, headerHeight, footerHeight, async (y) =>
      renderBand(details, y, contextFor(ctx, row.data, row)),
    );
  }

  await ctx.finish();

  if (usesTotalPages && options.totalPagesHint === undefined && ctx.pages !== totalPagesHint) {
    // segunda passada, agora sabendo quantas páginas o documento tem
    return renderReport(template, dataSet, { ...options, totalPagesHint: ctx.pages });
  }

  return doc.save();
}

/**
 * Ids de nó presentes no resultado, para as agregações distinguirem
 * `COUNT('ITEM')` (um nó) de `COUNT('valor')` (um campo).
 */
function collectNodeIds(rows: ResolvedRow[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);

  const walk = (current: ResolvedRow[]): void => {
    for (const row of current) {
      for (const [childId, children] of Object.entries(row.children)) {
        ids.add(childId);
        walk(children);
      }
    }
  };

  walk(rows);
  return ids;
}

/** O template referencia `sys.totalPages` em algum lugar? */
function templateUsesTotalPages(template: Template): boolean {
  return JSON.stringify(template).includes('totalPages');
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
