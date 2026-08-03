import { toCanvas } from 'bwip-js/browser';
import type { BarcodeElement, QrCodeElement } from '@treeport/schema';

/**
 * Geração de código de barras e QR **no browser** (itens 15-17 do feedback).
 *
 * Antes o designer só desenhava um retângulo listrado no lugar do código, o
 * que impedia conferir se ele saiu legível ou se o valor está certo. Agora usa
 * o mesmo `bwip-js` que o motor usa no servidor — mesma lib, mesmas
 * simbologias, mesmo resultado. O que se vê no designer é o que sai no PDF.
 *
 * O resultado é um data URI, guardado num cache: redesenhar o canvas a cada
 * movimento do mouse não pode regerar a imagem toda vez.
 */

/** Mapeia a simbologia do schema para o identificador do bwip-js. */
const BARCODE_IDS: Record<string, string> = {
  code128: 'code128',
  code39: 'code39',
  code93: 'code93',
  ean13: 'ean13',
  ean8: 'ean8',
  upca: 'upca',
  upce: 'upce',
  itf14: 'itf14',
  interleaved2of5: 'interleaved2of5',
  codabar: 'rationalizedCodabar',
  msi: 'msi',
  pharmacode: 'pharmacode',
  datamatrix: 'datamatrix',
  pdf417: 'pdf417',
  azteccode: 'azteccode',
};

export interface CodeImage {
  /** Data URI do PNG, pronto para um `<img src>`. */
  dataUrl: string;
  width: number;
  height: number;
}

export interface CodeError {
  message: string;
}

export type CodeResult = CodeImage | CodeError;

export function isCodeError(result: CodeResult): result is CodeError {
  return 'message' in result;
}

/** Cache por chave de conteúdo, para não regerar a cada re-render. */
const cache = new Map<string, CodeResult>();
const CACHE_LIMIT = 200;

/** Quem está esperando uma geração em curso, para não disparar duas. */
const pending = new Map<string, Promise<CodeResult>>();

function remember(key: string, result: CodeResult): CodeResult {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

/** O resultado já pronto, se estiver em cache. */
export function peekCode(key: string): CodeResult | undefined {
  return cache.get(key);
}

/** Chave estável do conteúdo de um código. */
export function codeKey(element: BarcodeElement | QrCodeElement, value: string): string {
  if (element.type === 'barcode') {
    return `bc|${element.format}|${element.includeText ? 1 : 0}|${value}`;
  }
  return [
    'qr',
    element.contentKind ?? 'text',
    element.errorCorrection ?? 'M',
    element.foregroundColor ?? '#000000',
    element.backgroundColor ?? '#ffffff',
    value,
  ].join('|');
}

/**
 * Gera a imagem do código, reaproveitando o cache.
 *
 * Devolve erro em vez de lançar: um valor inválido é normal enquanto se
 * digita, e não deve quebrar a renderização do canvas.
 */
export async function renderCode(
  element: BarcodeElement | QrCodeElement,
  value: string,
): Promise<CodeResult> {
  const key = codeKey(element, value);

  const cached = cache.get(key);
  if (cached) return cached;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const task = generate(element, value)
    .then((result) => remember(key, result))
    .finally(() => pending.delete(key));

  pending.set(key, task);
  return task;
}

async function generate(
  element: BarcodeElement | QrCodeElement,
  value: string,
): Promise<CodeResult> {
  if (value.trim() === '') {
    return { message: 'Informe um valor' };
  }

  try {
    const canvas = document.createElement('canvas');

    if (element.type === 'qrcode') {
      // `eclevel` falta na tipagem do bwip-js, mas funciona em runtime
      toCanvas(canvas, {
        bcid: 'qrcode',
        text: value,
        scale: 4,
        barcolor: hex(element.foregroundColor ?? '#000000'),
        backgroundcolor: hex(element.backgroundColor ?? '#ffffff'),
        paddingwidth: 2,
        paddingheight: 2,
        eclevel: element.errorCorrection ?? 'M',
      } as unknown as Parameters<typeof toCanvas>[1]);
    } else {
      const bcid = BARCODE_IDS[element.format] ?? 'code128';
      toCanvas(canvas, {
        bcid,
        text: value,
        scale: 3,
        // altura em mm; o designer trabalha em pt (1pt = 0.3528mm)
        height: Math.max(6, element.height * 0.3528),
        includetext: element.includeText ?? false,
        textxalign: 'center',
        backgroundcolor: 'FFFFFF',
        paddingwidth: 2,
        paddingheight: 2,
      });
    }

    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } catch (err) {
    return { message: describe(err, element) };
  }
}

/** Mensagem de erro útil, em vez do texto cru do bwip-js. */
function describe(err: unknown, element: BarcodeElement | QrCodeElement): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (element.type === 'barcode') {
    const dicas: Record<string, string> = {
      ean13: 'Precisa de 12 ou 13 dígitos',
      ean8: 'Precisa de 7 ou 8 dígitos',
      upca: 'Precisa de 11 ou 12 dígitos',
      upce: 'Precisa de 7 ou 8 dígitos',
      itf14: 'Precisa de 13 ou 14 dígitos',
      code39: 'Aceita A-Z, 0-9 e - . $ / + %',
      msi: 'Aceita apenas dígitos',
      pharmacode: 'Aceita um número entre 3 e 131070',
    };
    const dica = dicas[element.format];
    if (dica) return dica;
  }

  // o bwip-js prefixa com "bwipp.algumaCoisa:", que não ajuda o usuário
  return raw.replace(/^bwipp\.\w+:\s*/, '');
}

function hex(color: string): string {
  return color.replace(/^#/, '').toUpperCase();
}
