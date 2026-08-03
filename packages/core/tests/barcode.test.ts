import { describe, it, expect } from 'vitest';
import type { ResolvedDataSet, Template } from '@treeport/schema';
import {
  generateBarcode,
  generateQrCode,
  renderReport,
  BarcodeGenerationError,
} from '../src/index.js';
import { inspectPdf } from './helpers/pdf-inspect.js';
import { decodeQrCode, pngSize, isOpaque } from './helpers/decode-qr.js';

/** PNG 1x1 vermelho, para testar o ImageElement sem depender de arquivo. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function dataSet(rows: Record<string, unknown>[]): ResolvedDataSet {
  return { nodeId: 'N', rows: rows.map((data) => ({ data, children: {} })) };
}

describe('generateQrCode', () => {
  it('gera um QR que um leitor consegue decodificar', async () => {
    const png = await generateQrCode('https://exemplo.com/pedido/42');

    // a prova real: o conteúdo volta idêntico ao que entrou
    expect(decodeQrCode(png)).toBe('https://exemplo.com/pedido/42');
  });

  it('gera com fundo opaco, senão o código fica ilegível', async () => {
    // bwip-js gera transparente por padrão; sobre fundo escuro num PDF isso
    // deixa o QR indecifrável para o scanner
    expect(isOpaque(await generateQrCode('teste'))).toBe(true);
  });

  it('preserva texto com acento e símbolo', async () => {
    const valor = 'Proposta nº 1 — Ação & Cia';
    expect(decodeQrCode(await generateQrCode(valor))).toBe(valor);
  });

  it('aguenta um texto longo', async () => {
    const longo = 'https://exemplo.com/rastreio?codigo=' + 'A'.repeat(150);
    expect(decodeQrCode(await generateQrCode(longo))).toBe(longo);
  });

  it('scale maior gera imagem maior', async () => {
    const pequeno = pngSize(await generateQrCode('x', { scale: 2 }));
    const grande = pngSize(await generateQrCode('x', { scale: 8 }));

    expect(grande.width).toBeGreaterThan(pequeno.width);
  });

  it('o QR é quadrado', async () => {
    const { width, height } = pngSize(await generateQrCode('teste'));
    expect(width).toBe(height);
  });
});

describe('generateBarcode', () => {
  it('gera code128', async () => {
    const png = await generateBarcode('code128', 'TX-0001', 30);
    expect(png.length).toBeGreaterThan(100);
    expect(isOpaque(png)).toBe(true);
  });

  it('gera code39', async () => {
    const png = await generateBarcode('code39', 'ABC123', 30);
    expect(png.length).toBeGreaterThan(100);
  });

  it('gera ean13 com 12 dígitos (calcula o verificador)', async () => {
    const png = await generateBarcode('ean13', '789123456789', 30);
    expect(png.length).toBeGreaterThan(100);
  });

  it('limpa separadores do EAN-13 vindos do banco', async () => {
    // um código costuma chegar com hífen ou espaço; sem normalizar, quebraria
    const png = await generateBarcode('ean13', '789-1234-56789', 30);
    expect(png.length).toBeGreaterThan(100);
  });

  it('completa com zero à esquerda quando faltam dígitos no EAN-13', async () => {
    // conversão numérica no meio do caminho costuma comer o zero inicial
    const png = await generateBarcode('ean13', '12345', 30);
    expect(png.length).toBeGreaterThan(100);
  });

  it('altura maior gera imagem mais alta', async () => {
    const baixo = pngSize(await generateBarcode('code128', 'ABC', 20));
    const alto = pngSize(await generateBarcode('code128', 'ABC', 80));

    expect(alto.height).toBeGreaterThan(baixo.height);
  });

  it('erro de valor inválido diz o que a simbologia aceita', async () => {
    // Code 39 não aceita minúsculas nem acento
    await expect(generateBarcode('code39', 'trem à vapor', 30)).rejects.toBeInstanceOf(
      BarcodeGenerationError,
    );
    await expect(generateBarcode('code39', 'trem à vapor', 30)).rejects.toThrow(/Code 39 aceita/);
  });

  it('o erro carrega o valor que causou o problema', async () => {
    try {
      await generateBarcode('code39', 'inválido!', 30);
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      expect((err as BarcodeGenerationError).value).toBe('inválido!');
    }
  });
});

describe('barcode e QR no PDF', () => {
  function template(elements: Template['bands']['details']['elements']): Template {
    return {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'N',
      pageSize: 'A4',
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      bands: { details: { height: 90, elements } },
    };
  }

  it('embute um código de barras no PDF', async () => {
    const bytes = await renderReport(
      template([
        {
          id: 'bc',
          type: 'barcode',
          x: 0,
          y: 0,
          width: 200,
          height: 50,
          format: 'code128',
          valueExpression: 'codigo',
        },
      ]),
      dataSet([{ codigo: 'TX-0001' }]),
    );

    const pdf = await inspectPdf(bytes);
    expect(pdf.pageCount).toBe(1);
    // o PDF cresce bem além de um documento só de texto
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it('embute um QR Code no PDF', async () => {
    const bytes = await renderReport(
      template([
        {
          id: 'qr',
          type: 'qrcode',
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          valueExpression: 'url',
        },
      ]),
      dataSet([{ url: 'https://exemplo.com/1' }]),
    );

    expect((await inspectPdf(bytes)).pageCount).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it('aceita expressão no valor do código', async () => {
    const bytes = await renderReport(
      template([
        {
          id: 'qr',
          type: 'qrcode',
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          valueExpression: "{{'https://exemplo.com/pedido/' + id}}",
        },
      ]),
      dataSet([{ id: 42 }]),
    );

    expect((await inspectPdf(bytes)).pageCount).toBe(1);
  });

  it('reaproveita a mesma imagem em vez de duplicar no PDF', async () => {
    const elemento = {
      id: 'qr',
      type: 'qrcode' as const,
      x: 0,
      y: 0,
      width: 60,
      height: 60,
      valueExpression: 'url',
    };

    // 20 linhas com o MESMO valor: o PNG deve ser embutido uma vez só
    const iguais = await renderReport(
      template([elemento]),
      dataSet(Array.from({ length: 20 }, () => ({ url: 'https://exemplo.com/fixo' }))),
    );

    // 20 linhas com valores diferentes: aí são 20 imagens mesmo
    const diferentes = await renderReport(
      template([elemento]),
      dataSet(Array.from({ length: 20 }, (_, i) => ({ url: `https://exemplo.com/${i}` }))),
    );

    expect(iguais.byteLength).toBeLessThan(diferentes.byteLength / 3);
  });

  it('valor vazio não quebra a geração', async () => {
    const bytes = await renderReport(
      template([
        {
          id: 'qr',
          type: 'qrcode',
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          valueExpression: 'url',
        },
      ]),
      dataSet([{ url: null }]),
    );

    expect((await inspectPdf(bytes)).pageCount).toBe(1);
  });

  it('erro de código inválido identifica o valor no relatório', async () => {
    await expect(
      renderReport(
        template([
          {
            id: 'bc',
            type: 'barcode',
            x: 0,
            y: 0,
            width: 200,
            height: 50,
            format: 'code39',
            valueExpression: 'codigo',
          },
        ]),
        dataSet([{ codigo: 'minúsculas!' }]),
      ),
    ).rejects.toThrow(/minúsculas!/);
  });

  it('convive com texto e subreport na mesma banda', async () => {
    const bytes = await renderReport(
      template([
        { id: 'l', type: 'label', x: 0, y: 0, width: 200, height: 14, content: '{{codigo}}' },
        {
          id: 'bc',
          type: 'barcode',
          x: 0,
          y: 20,
          width: 200,
          height: 40,
          format: 'code128',
          valueExpression: 'codigo',
        },
      ]),
      dataSet([{ codigo: 'TX-0001' }]),
    );

    const pdf = await inspectPdf(bytes);
    expect(pdf.text).toContain('TX-0001');
  });
});

describe('ImageElement', () => {
  it('desenha uma imagem a partir de data URI', async () => {
    const bytes = await renderReport(
      {
        id: 't',
        name: 'T',
        boundDataSourceNodeId: 'N',
        pageSize: 'A4',
        bands: {
          details: {
            height: 60,
            elements: [
              { id: 'img', type: 'image', x: 0, y: 0, width: 50, height: 50, source: PNG_1X1 },
            ],
          },
        },
      },
      dataSet([{}]),
    );

    expect((await inspectPdf(bytes)).pageCount).toBe(1);
  });

  it('source inválido não quebra o relatório', async () => {
    const bytes = await renderReport(
      {
        id: 't',
        name: 'T',
        boundDataSourceNodeId: 'N',
        pageSize: 'A4',
        bands: {
          details: {
            height: 60,
            elements: [
              {
                id: 'img',
                type: 'image',
                x: 0,
                y: 0,
                width: 50,
                height: 50,
                // URL de rede: o motor não busca da rede de propósito
                source: 'https://exemplo.com/logo.png',
              },
              { id: 'l', type: 'label', x: 0, y: 52, width: 200, height: 12, content: 'segue' },
            ],
          },
        },
      },
      dataSet([{}]),
    );

    const pdf = await inspectPdf(bytes);
    expect(pdf.text).toContain('segue');
  });

  it('aceita expressão no source', async () => {
    const bytes = await renderReport(
      {
        id: 't',
        name: 'T',
        boundDataSourceNodeId: 'N',
        pageSize: 'A4',
        bands: {
          details: {
            height: 60,
            elements: [
              { id: 'img', type: 'image', x: 0, y: 0, width: 50, height: 50, source: '{{logo}}' },
            ],
          },
        },
      },
      dataSet([{ logo: PNG_1X1 }]),
    );

    expect((await inspectPdf(bytes)).pageCount).toBe(1);
  });
});
