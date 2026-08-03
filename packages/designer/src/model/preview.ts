import type { Band, ReportElement, Template } from '@treeport/schema';
import { resolvePageSize } from '@treeport/schema';

/**
 * Paginação simulada para a aba de Preview (item 12 do feedback).
 *
 * Reproduz o que o motor do `core` faz — header e footer em toda página,
 * detalhe repetido por linha, quebra quando não cabe — mas no browser, sem
 * servidor. Assim o usuário vê a paginação enquanto desenha.
 *
 * Não é o PDF final: fontes e quebra de texto do browser diferem um pouco do
 * pdf-lib. Para o resultado exato existe o botão de gerar PDF via backend.
 */

export interface PreviewPage {
  /** Número da página, 1-based. */
  number: number;
  /** Blocos posicionados em coordenadas absolutas da página. */
  blocks: PreviewBlock[];
}

export interface PreviewBlock {
  band: 'header' | 'details' | 'footer';
  /** Y absoluto na página (a partir do topo do papel). */
  y: number;
  height: number;
  elements: ReportElement[];
  /** Linha de dados usada, para resolver as expressões na exibição. */
  row: Record<string, unknown>;
  /** Índice da linha do master, para diferenciar repetições. */
  rowIndex: number;
}

export interface PreviewOptions {
  /** Linhas de dados de amostra. Sem elas, uma linha vazia é usada. */
  rows?: Record<string, unknown>[];
  /** Teto de páginas, para o preview não explodir com muitos dados. */
  maxPages?: number;
}

export interface PreviewResult {
  pages: PreviewPage[];
  pageWidth: number;
  pageHeight: number;
  /** Verdadeiro quando o teto de páginas foi atingido. */
  truncated: boolean;
}

/**
 * Pagina o template com os dados de amostra.
 *
 * A regra de quebra é a mesma do motor: reserva-se a altura do header e do
 * footer em toda página, e um bloco de detalhe que não cabe no espaço restante
 * vai inteiro para a página seguinte — nunca é partido no meio.
 */
export function paginate(template: Template, options: PreviewOptions = {}): PreviewResult {
  const size = resolvePageSize(template.pageSize);
  const landscape = template.orientation === 'landscape';
  const pageWidth = landscape ? size.height : size.width;
  const pageHeight = landscape ? size.width : size.height;

  const margins = template.margins ?? { top: 40, right: 40, bottom: 40, left: 40 };
  const maxPages = options.maxPages ?? 20;

  const header = template.bands.header;
  const footer = template.bands.footer;
  const details = template.bands.details;

  const headerHeight = header?.height ?? 0;
  const footerHeight = footer?.height ?? 0;

  const contentTop = margins.top + headerHeight;
  const contentBottom = pageHeight - margins.bottom - footerHeight;

  const rows = options.rows?.length ? options.rows : [{}];

  const pages: PreviewPage[] = [];
  let current = startPage(1, header, footer, margins, pageHeight, footerHeight, rows[0] ?? {});
  let cursorY = contentTop;
  let truncated = false;

  rows.forEach((row, rowIndex) => {
    if (truncated) return;

    const height = bandHeight(details);

    // não cabe: fecha a página e começa outra
    if (cursorY + height > contentBottom && cursorY > contentTop) {
      pages.push(current);

      if (pages.length >= maxPages) {
        truncated = true;
        return;
      }

      current = startPage(
        pages.length + 1,
        header,
        footer,
        margins,
        pageHeight,
        footerHeight,
        row,
      );
      cursorY = contentTop;
    }

    current.blocks.push({
      band: 'details',
      y: cursorY,
      height,
      elements: details.elements,
      row,
      rowIndex,
    });

    cursorY += height;
  });

  // a página em curso só entra se ainda houver espaço no teto — senão
  // devolveríamos maxPages + 1
  if (pages.length < maxPages) pages.push(current);

  return { pages, pageWidth, pageHeight, truncated };
}

/** Abre uma página já com o header no topo e o footer ancorado na base. */
function startPage(
  number: number,
  header: Band | undefined,
  footer: Band | undefined,
  margins: { top: number; bottom: number },
  pageHeight: number,
  footerHeight: number,
  row: Record<string, unknown>,
): PreviewPage {
  const blocks: PreviewBlock[] = [];

  if (header) {
    blocks.push({
      band: 'header',
      y: margins.top,
      height: header.height,
      elements: header.elements,
      row,
      rowIndex: 0,
    });
  }

  if (footer) {
    blocks.push({
      band: 'footer',
      // ancorado na base, não no cursor
      y: pageHeight - margins.bottom - footerHeight,
      height: footer.height,
      elements: footer.elements,
      row,
      rowIndex: 0,
    });
  }

  return { number, blocks };
}

function bandHeight(band: Band): number {
  return Math.max(band.height, 1);
}

/**
 * Linhas de amostra a partir dos nomes de campo conhecidos.
 *
 * Sem dados de verdade o preview mostraria tudo vazio, e o usuário não
 * conseguiria julgar o layout. Valores plausíveis por nome de campo dão uma
 * ideia melhor do resultado.
 */
export function sampleRows(fields: string[], count = 12): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const row: Record<string, unknown> = {};
    for (const field of fields) row[field] = sampleValue(field, i);
    return row;
  });
}

function sampleValue(field: string, index: number): unknown {
  const name = field.toLowerCase();

  if (/(valor|total|preco|price|amount|vlr)/.test(name)) {
    return Math.round((100 + index * 137.5) * 100) / 100;
  }
  if (/(qtd|quant|qty|numero_?itens)/.test(name)) return (index % 5) + 1;
  if (/(data|date|emiss|venc)/.test(name)) {
    const d = new Date(2026, 7, (index % 28) + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/(cliente|customer|nome|name|razao)/.test(name)) {
    return ['Acme Ltda', 'Global Trading', 'Nordeste Imp.', 'Sul Log'][index % 4];
  }
  if (/(numero|number|codigo|code|sku|doc)/.test(name)) {
    return `${field.slice(0, 3).toUpperCase()}-${String(index + 1).padStart(4, '0')}`;
  }
  if (/^id$|_id$/.test(name)) return index + 1;

  return `${field} ${index + 1}`;
}
