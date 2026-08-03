import type { PDFFont } from 'pdf-lib';

/**
 * Medição e quebra de texto.
 *
 * O pdf-lib não quebra linha sozinho — quem desenha decide onde cortar. Como o
 * motor de bandas já controla o Y manualmente, isso é o esperado (e é o que
 * permite o auto-grow em cascata da Fase 5).
 */

/** Quebra o texto para caber em `maxWidth`, respeitando as quebras explícitas. */
export function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  if (text === '') return [''];

  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    lines.push(...wrapParagraph(paragraph, font, fontSize, maxWidth));
  }

  return lines;
}

function wrapParagraph(
  paragraph: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const words = paragraph.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;

    if (measure(candidate, font, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current !== '') lines.push(current);

    // palavra sozinha maior que a largura: quebra no meio dela
    if (measure(word, font, fontSize) > maxWidth) {
      const pieces = breakLongWord(word, font, fontSize, maxWidth);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? '';
    } else {
      current = word;
    }
  }

  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/** Quebra uma palavra que não cabe inteira em nenhuma linha. */
function breakLongWord(
  word: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const pieces: string[] = [];
  let current = '';

  for (const char of word) {
    const candidate = current + char;
    if (current !== '' && measure(candidate, font, fontSize) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current !== '') pieces.push(current);
  return pieces.length > 0 ? pieces : [''];
}

/**
 * Largura do texto em pontos.
 *
 * As fontes padrão do PDF (WinAnsi) não codificam todo caractere Unicode — um
 * emoji ou um caractere CJK faz o pdf-lib lançar. Aqui a medição é defensiva:
 * se falhar, cai numa estimativa em vez de derrubar o relatório inteiro.
 */
export function measure(text: string, font: PDFFont, fontSize: number): number {
  try {
    return font.widthOfTextAtSize(text, fontSize);
  } catch {
    // aproximação: a média de uma fonte proporcional fica perto de 0.5em
    return text.length * fontSize * 0.5;
  }
}

/**
 * Remove caracteres que as fontes padrão do PDF não conseguem codificar.
 *
 * Sem isso, um único emoji vindo do banco quebra a geração inteira com uma
 * exceção do pdf-lib. Preferimos perder o caractere a perder o relatório.
 */
export function sanitizeForStandardFont(text: string, font: PDFFont): string {
  try {
    font.widthOfTextAtSize(text, 12);
    return text;
  } catch {
    let out = '';
    for (const char of text) {
      try {
        font.widthOfTextAtSize(char, 12);
        out += char;
      } catch {
        out += '?';
      }
    }
    return out;
  }
}

/** Altura de uma linha para um dado corpo de fonte. */
export function lineHeight(fontSize: number): number {
  return fontSize * 1.2;
}
