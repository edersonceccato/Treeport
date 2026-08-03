import { toBuffer } from 'bwip-js/node';
import type { BarcodeElement, QrCodeElement } from '@treeport/schema';

/**
 * Geração de códigos de barras e QR (Fase 6 do brief).
 *
 * Usa `bwip-js`, que tem ZERO dependências e cobre tanto barcode quanto QR —
 * daí não precisarmos de uma segunda lib só para o QR (a `qrcode` puxaria
 * `yargs` junto, uma CLI inteira que o motor nunca usaria).
 *
 * O código é gerado como PNG e embutido no PDF como imagem: é assim que
 * qualquer motor de relatório faz, porque desenhar as barras vetorialmente
 * exigiria reimplementar as ~100 simbologias.
 */

/** Simbologias suportadas, mapeadas para o identificador do bwip-js. */
const BARCODE_IDS = {
  code128: 'code128',
  ean13: 'ean13',
  code39: 'code39',
} as const;

export type BarcodeFormat = keyof typeof BARCODE_IDS;

/** Erro ao gerar um código, já com o valor que causou o problema. */
export class BarcodeGenerationError extends Error {
  constructor(message: string, readonly value: string) {
    super(message);
    this.name = 'BarcodeGenerationError';
  }
}

export interface BarcodeRenderOptions {
  /**
   * Densidade da imagem gerada. Quanto maior, mais nítido no PDF impresso —
   * o custo é o tamanho do arquivo. 3 dá um resultado bom em impressão.
   */
  scale?: number;
  /** Desenhar o texto legível abaixo das barras. Default: false. */
  includeText?: boolean;
  /**
   * Cor de fundo em hexadecimal, sem "#". Default: branco.
   *
   * NÃO deixe transparente: um leitor óptico precisa de contraste entre as
   * barras e o fundo, e um PNG transparente sobre fundo escuro (ou sobre um
   * `backgroundColor` do próprio elemento) fica ilegível. O branco garante a
   * "zona clara" que a especificação de código de barras exige.
   */
  backgroundColor?: string;
}

/**
 * Margem clara ao redor do código ("quiet zone"), em módulos.
 *
 * Sem ela o leitor não consegue delimitar onde o código começa e termina —
 * a especificação exige, e a maioria dos scanners falha sem isso.
 */
const QUIET_ZONE = 2;

/**
 * Gera o PNG de um código de barras linear.
 *
 * A altura pedida em pontos vira a altura do bwip-js em milímetros — a lib
 * trabalha nessa unidade. A conversão é feita aqui para o resto do motor
 * continuar pensando só em pontos PDF.
 */
export async function generateBarcode(
  format: BarcodeFormat,
  value: string,
  heightInPoints: number,
  options: BarcodeRenderOptions = {},
): Promise<Uint8Array> {
  const bcid = BARCODE_IDS[format];
  if (!bcid) {
    throw new BarcodeGenerationError(`Formato de código de barras desconhecido: ${format}`, value);
  }

  const text = normalizeValue(format, value);

  try {
    const png = await toBuffer({
      bcid,
      text,
      scale: options.scale ?? 3,
      // bwip-js mede a altura em mm; 1pt = 0.3528mm
      height: Math.max(4, heightInPoints * 0.3528),
      includetext: options.includeText ?? false,
      textxalign: 'center',
      backgroundcolor: options.backgroundColor ?? 'FFFFFF',
      paddingwidth: QUIET_ZONE,
      paddingheight: QUIET_ZONE,
    });
    return new Uint8Array(png);
  } catch (err) {
    throw new BarcodeGenerationError(
      `Não foi possível gerar o código ${format} para "${value}": ${describeError(err, format)}`,
      value,
    );
  }
}

/** Gera o PNG de um QR Code. */
export async function generateQrCode(
  value: string,
  options: BarcodeRenderOptions = {},
): Promise<Uint8Array> {
  try {
    const png = await toBuffer({
      bcid: 'qrcode',
      text: value,
      scale: options.scale ?? 4,
      backgroundcolor: options.backgroundColor ?? 'FFFFFF',
      paddingwidth: QUIET_ZONE,
      paddingheight: QUIET_ZONE,
    });
    return new Uint8Array(png);
  } catch (err) {
    throw new BarcodeGenerationError(
      `Não foi possível gerar o QR Code para "${value}": ${describeError(err, 'qrcode')}`,
      value,
    );
  }
}

/**
 * Ajustes por simbologia antes de gerar.
 *
 * O EAN-13 é o caso chato: exige exatamente 12 ou 13 dígitos e nada mais. Um
 * código vindo do banco costuma chegar com espaço, hífen ou com o zero à
 * esquerda perdido numa conversão numérica — sem tratar isso aqui, o relatório
 * quebraria por um detalhe de formatação do dado.
 */
function normalizeValue(format: BarcodeFormat, value: string): string {
  if (format !== 'ean13') return value;

  const digits = value.replace(/\D/g, '');
  // 12 dígitos: o bwip-js calcula o dígito verificador sozinho
  if (digits.length === 12 || digits.length === 13) return digits;
  if (digits.length < 12) return digits.padStart(12, '0');
  return digits.slice(0, 13);
}

/** Mensagem de erro do bwip-js costuma ser críptica; contextualiza. */
function describeError(err: unknown, format: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (format === 'ean13') {
    return `${raw} (EAN-13 exige 12 ou 13 dígitos numéricos)`;
  }
  if (format === 'code39') {
    return `${raw} (Code 39 aceita A-Z, 0-9 e os símbolos - . $ / + % espaço)`;
  }
  return raw;
}

/** Tipos de elemento que geram imagem de código. */
export type CodeElement = BarcodeElement | QrCodeElement;
