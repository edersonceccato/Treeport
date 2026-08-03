/**
 * Helper de teste: abre o PDF gerado e extrai o texto com as posições.
 *
 * Sem isto, os testes de renderização só conseguiriam afirmar "gerou bytes" —
 * o que não pega layout errado, texto faltando ou quebra de página no lugar
 * errado. Com o pdfjs conseguimos afirmar sobre o conteúdo de verdade.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Caminho dos dados das fontes padrão que vêm dentro do próprio pdfjs. */
const require = createRequire(import.meta.url);
const STANDARD_FONT_DATA_URL = `${join(
  dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')),
  '..',
  '..',
  'standard_fonts',
)}/`;

export interface TextItem {
  text: string;
  /** X em pontos, origem no canto inferior esquerdo (coordenada nativa do PDF). */
  x: number;
  /** Y em pontos, origem no canto inferior esquerdo. */
  y: number;
}

export interface InspectedPage {
  width: number;
  height: number;
  items: TextItem[];
  /** Todo o texto da página concatenado, útil para asserção rápida. */
  text: string;
}

export interface InspectedPdf {
  pageCount: number;
  pages: InspectedPage[];
  /** Texto de todas as páginas concatenado. */
  text: string;
  /** Metadados do documento (Title, Author, Creator). */
  info: Record<string, unknown>;
}

export async function inspectPdf(bytes: Uint8Array): Promise<InspectedPdf> {
  // o pdfjs consome o buffer que recebe; passamos uma cópia
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise;

  const pages: InspectedPage[] = [];

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items: TextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const transform = item.transform as number[];
      items.push({
        text: item.str,
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
      });
    }

    pages.push({
      width: viewport.width,
      height: viewport.height,
      items,
      text: items.map((it) => it.text).join(' '),
    });
  }

  const pageCount = doc.numPages;
  const metadata = await doc.getMetadata();
  await doc.cleanup();

  return {
    pageCount,
    pages,
    text: pages.map((p) => p.text).join('\n'),
    info: (metadata.info ?? {}) as Record<string, unknown>,
  };
}

/** Encontra o primeiro item cujo texto casa exatamente. */
export function findItem(page: InspectedPage, text: string): TextItem | undefined {
  return page.items.find((item) => item.text.trim() === text);
}
