import { describe, it, expect } from 'vitest';
import type { ResolvedDataSet, Template } from '@treeport/schema';
import { renderReport } from '../src/index.js';
import { inspectPdf, findItem } from './helpers/pdf-inspect.js';

/** Monta um dataSet resolvido sem passar por banco nenhum. */
function dataSet(rows: Record<string, unknown>[]): ResolvedDataSet {
  return { nodeId: 'FEE', rows: rows.map((data) => ({ data, children: {} })) };
}

/** Template mínimo de lista de taxas, no espírito do cenário real. */
function feeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'fee-list',
    name: 'Lista de taxas',
    boundDataSourceNodeId: 'FEE',
    pageSize: 'A4',
    margins: { top: 50, right: 50, bottom: 50, left: 50 },
    bands: {
      header: {
        height: 40,
        elements: [
          {
            id: 'title',
            type: 'label',
            x: 0,
            y: 0,
            width: 300,
            height: 20,
            content: 'Relatorio de Taxas',
            style: { fontSize: 16, bold: true },
          },
        ],
      },
      details: {
        height: 20,
        elements: [
          {
            id: 'name',
            type: 'field',
            x: 0,
            y: 0,
            width: 200,
            height: 14,
            fieldName: 'name',
          },
          {
            id: 'amount',
            type: 'field',
            x: 220,
            y: 0,
            width: 100,
            height: 14,
            fieldName: 'amount',
            format: '#,##0.00',
            style: { align: 'right' },
          },
        ],
      },
      footer: {
        height: 20,
        elements: [
          {
            id: 'foot',
            type: 'label',
            x: 0,
            y: 0,
            width: 200,
            height: 14,
            content: 'Documento gerado pelo Treeport',
            style: { fontSize: 8 },
          },
        ],
      },
    },
    ...overrides,
  };
}

describe('renderReport', () => {
  it('gera um PDF válido', async () => {
    const bytes = await renderReport(feeTemplate(), dataSet([{ name: 'Frete', amount: 1500 }]));

    // assinatura do formato
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it('desenha o header, os detalhes e o footer', async () => {
    const bytes = await renderReport(
      feeTemplate(),
      dataSet([
        { name: 'Frete', amount: 1500 },
        { name: 'THC', amount: 300 },
      ]),
    );

    const pdf = await inspectPdf(bytes);
    expect(pdf.pageCount).toBe(1);
    expect(pdf.text).toContain('Relatorio de Taxas');
    expect(pdf.text).toContain('Frete');
    expect(pdf.text).toContain('THC');
    expect(pdf.text).toContain('Documento gerado pelo Treeport');
  });

  it('aplica a máscara de número no Field', async () => {
    const bytes = await renderReport(feeTemplate(), dataSet([{ name: 'Frete', amount: 1500 }]));
    const pdf = await inspectPdf(bytes);

    // #,##0.00 com separadores pt-BR
    expect(pdf.text).toContain('1.500,00');
  });

  it('repete uma banda de detalhe por linha, empilhando verticalmente', async () => {
    const bytes = await renderReport(
      feeTemplate(),
      dataSet([
        { name: 'Primeira', amount: 1 },
        { name: 'Segunda', amount: 2 },
        { name: 'Terceira', amount: 3 },
      ]),
    );

    const pdf = await inspectPdf(bytes);
    const page = pdf.pages[0]!;

    const first = findItem(page, 'Primeira')!;
    const second = findItem(page, 'Segunda')!;
    const third = findItem(page, 'Terceira')!;

    expect(first).toBeDefined();
    // no PDF o Y cresce para cima, então cada linha seguinte tem Y MENOR
    expect(second.y).toBeLessThan(first.y);
    expect(third.y).toBeLessThan(second.y);

    // espaçamento igual à altura da banda (20pt)
    expect(first.y - second.y).toBeCloseTo(20, 1);
  });

  it('respeita o alinhamento à direita', async () => {
    const bytes = await renderReport(feeTemplate(), dataSet([{ name: 'X', amount: 1 }]));
    const pdf = await inspectPdf(bytes);
    const page = pdf.pages[0]!;

    const amount = findItem(page, '1,00')!;
    const name = findItem(page, 'X')!;

    // x do template é relativo à área útil, então soma a margem esquerda (50)
    // a caixa do valor vai de x=220 a x=320; alinhado à direita, o texto
    // começa bem depois do início da caixa
    expect(amount.x).toBeGreaterThan(50 + 280);
    expect(name.x).toBeCloseTo(50, 0);
  });

  it('respeita as margens laterais declaradas', async () => {
    const bytes = await renderReport(
      feeTemplate({ margins: { top: 40, right: 40, bottom: 40, left: 40 } }),
      dataSet([{ name: 'Frete', amount: 1 }]),
    );
    const pdf = await inspectPdf(bytes);
    const page = pdf.pages[0]!;

    // nada pode encostar na borda física da folha
    const menorX = Math.min(...page.items.map((i) => i.x));
    expect(menorX).toBeCloseTo(40, 0);
  });

  it('conteúdo alinhado à direita não estoura a margem direita', async () => {
    const bytes = await renderReport(
      feeTemplate({ margins: { top: 40, right: 40, bottom: 40, left: 40 } }),
      dataSet([{ name: 'Frete', amount: 1234567.89 }]),
    );
    const pdf = await inspectPdf(bytes);
    const page = pdf.pages[0]!;

    const limiteDireito = page.width - 40;
    for (const item of page.items) {
      expect(item.x).toBeLessThanOrEqual(limiteDireito);
    }
  });

  it('quebra a página quando os detalhes não cabem mais', async () => {
    // A4 = 841.89pt de altura; menos margens (100) e header (40) e footer (20)
    // sobram ~680pt, ou seja ~34 bandas de 20pt por página
    const rows = Array.from({ length: 80 }, (_, i) => ({ name: `Taxa ${i + 1}`, amount: i }));
    const bytes = await renderReport(feeTemplate(), dataSet(rows));

    const pdf = await inspectPdf(bytes);
    expect(pdf.pageCount).toBeGreaterThan(1);

    // nenhuma linha pode ter sumido na quebra
    expect(pdf.text).toContain('Taxa 1');
    expect(pdf.text).toContain('Taxa 80');
  });

  it('repete header e footer em TODAS as páginas', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ name: `Taxa ${i + 1}`, amount: i }));
    const bytes = await renderReport(feeTemplate(), dataSet(rows));
    const pdf = await inspectPdf(bytes);

    expect(pdf.pageCount).toBeGreaterThan(1);
    for (const page of pdf.pages) {
      expect(page.text).toContain('Relatorio de Taxas');
      expect(page.text).toContain('Documento gerado pelo Treeport');
    }
  });

  it('nenhum detalhe invade a área do rodapé', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ name: `Taxa ${i + 1}`, amount: i }));
    const bytes = await renderReport(feeTemplate(), dataSet(rows));
    const pdf = await inspectPdf(bytes);

    // rodapé começa em y(template) = 841.89 - 50 - 20 = 771.89
    // em coordenada PDF isso é y = 70; nenhum detalhe pode ficar abaixo disso
    for (const page of pdf.pages) {
      const details = page.items.filter((it) => it.text.startsWith('Taxa '));
      for (const item of details) {
        expect(item.y).toBeGreaterThan(69);
      }
    }
  });

  it('usa o tamanho de página A4 por padrão', async () => {
    const bytes = await renderReport(feeTemplate(), dataSet([{ name: 'X', amount: 1 }]));
    const pdf = await inspectPdf(bytes);

    expect(pdf.pages[0]!.width).toBeCloseTo(595.28, 1);
    expect(pdf.pages[0]!.height).toBeCloseTo(841.89, 1);
  });

  it('inverte as dimensões em landscape', async () => {
    const bytes = await renderReport(
      feeTemplate({ orientation: 'landscape' }),
      dataSet([{ name: 'X', amount: 1 }]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.pages[0]!.width).toBeCloseTo(841.89, 1);
    expect(pdf.pages[0]!.height).toBeCloseTo(595.28, 1);
  });

  it('aceita tamanho de página customizado', async () => {
    const bytes = await renderReport(
      feeTemplate({ pageSize: { width: 300, height: 400 } }),
      dataSet([{ name: 'X', amount: 1 }]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.pages[0]!.width).toBeCloseTo(300, 1);
    expect(pdf.pages[0]!.height).toBeCloseTo(400, 1);
  });

  it('gera um PDF de uma página só quando não há linhas', async () => {
    const bytes = await renderReport(feeTemplate(), dataSet([]));
    const pdf = await inspectPdf(bytes);

    expect(pdf.pageCount).toBe(1);
    // o timbrado continua aparecendo, mesmo sem dados
    expect(pdf.text).toContain('Relatorio de Taxas');
  });

  it('campo nulo vira string vazia, nunca "null"', async () => {
    const bytes = await renderReport(feeTemplate(), dataSet([{ name: null, amount: null }]));
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).not.toContain('null');
    expect(pdf.text).not.toContain('undefined');
  });

  it('campo inexistente na linha não quebra a renderização', async () => {
    const bytes = await renderReport(feeTemplate(), dataSet([{ outraCoisa: 1 }]));
    const pdf = await inspectPdf(bytes);

    expect(pdf.pageCount).toBe(1);
    expect(pdf.text).not.toContain('undefined');
  });

  it('funciona sem header e sem footer', async () => {
    const template = feeTemplate();
    delete template.bands.header;
    delete template.bands.footer;

    const bytes = await renderReport(template, dataSet([{ name: 'Solo', amount: 1 }]));
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('Solo');
    expect(pdf.text).not.toContain('Relatorio de Taxas');
  });

  it('grava título e creator nos metadados do PDF', async () => {
    const bytes = await renderReport(feeTemplate(), dataSet([{ name: 'X', amount: 1 }]), {
      title: 'Meu Relatorio',
      author: 'Treeport Tests',
    });

    const pdf = await inspectPdf(bytes);
    expect(pdf.info['Title']).toBe('Meu Relatorio');
    expect(pdf.info['Author']).toBe('Treeport Tests');
    expect(pdf.info['Creator']).toBe('Treeport');
  });

  it('usa o nome do template como título quando não informado', async () => {
    const bytes = await renderReport(feeTemplate(), dataSet([{ name: 'X', amount: 1 }]));
    const pdf = await inspectPdf(bytes);

    expect(pdf.info['Title']).toBe('Lista de taxas');
  });

  it('não derruba o relatório com caractere fora da fonte padrão', async () => {
    // emoji não existe na WinAnsi; sem tratamento o pdf-lib lança
    const bytes = await renderReport(feeTemplate(), dataSet([{ name: 'Taxa 🚢', amount: 1 }]));
    const pdf = await inspectPdf(bytes);

    expect(pdf.pageCount).toBe(1);
    expect(pdf.text).toContain('Taxa');
  });

  it('desenha acentuação corretamente', async () => {
    const bytes = await renderReport(
      feeTemplate(),
      dataSet([{ name: 'Armazenagem à vista', amount: 1 }]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('Armazenagem à vista');
  });
});
