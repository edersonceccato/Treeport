import { PNG } from 'pngjs';
import jsQR from 'jsqr';

/**
 * Decodifica um QR Code a partir do PNG gerado.
 *
 * Existe para os testes provarem que o código é REALMENTE legível por um
 * leitor óptico — e não apenas que a geração devolveu alguns bytes. Foi assim
 * que descobrimos que o PNG saía com fundo transparente, o que deixava o
 * código indecifrável dependendo do visualizador de PDF.
 */
export function decodeQrCode(png: Uint8Array): string | undefined {
  const image = PNG.sync.read(Buffer.from(png));
  const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  return result?.data;
}

/** Dimensões do PNG, para conferir proporção e densidade. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const image = PNG.sync.read(Buffer.from(png));
  return { width: image.width, height: image.height };
}

/**
 * O PNG tem fundo opaco?
 *
 * Um código de barras precisa de contraste; fundo transparente sobre uma área
 * escura do relatório fica ilegível para o scanner.
 */
export function isOpaque(png: Uint8Array): boolean {
  const image = PNG.sync.read(Buffer.from(png));
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] !== 255) return false;
  }
  return true;
}
