import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { Band, ResolvedDataSet, Template } from '@treeport/schema';
import {
  renderReport,
  loadFonts,
  measureElement,
  measureBandContent,
  type FontSet,
} from '../src/index.js';
import { inspectPdf, findItem } from './helpers/pdf-inspect.js';
import { row } from './helpers/proposal-fixture.js';

/**
 * Fase 5 — auto-grow em cascata (Anexo C).
 *
 * Duas coisas: um elemento que cresce (texto que quebra em várias linhas, ou
 * subreport com N linhas) empurra para baixo tudo que vem depois dele na mesma
 * banda; e uma banda encolhível não reserva espaço que o conteúdo não usou.
 */

let fonts: FontSet;

beforeAll(async () => {
  fonts = await loadFonts(await PDFDocument.create());
});

const TEXTO_LONGO =
  'Armazenagem de carga no terminal portuario de Santos com taxa adicional de movimentacao';

function dataSet(rows: Record<string, unknown>[]): ResolvedDataSet {
  return { nodeId: 'N', rows: rows.map((data) => ({ data, children: {} })) };
}

describe('measureElement', () => {
  it('sem canGrow, fica na altura nominal mesmo com texto longo', () => {
    const height = measureElement(
      {
        id: 'l',
        type: 'label',
        x: 0,
        y: 0,
        width: 100,
        height: 12,
        content: TEXTO_LONGO,
        style: { fontSize: 9 },
      },
      { fonts, row: {} },
    );

    expect(height).toBe(12);
  });

  it('com canGrow, cresce conforme as linhas quebradas', () => {
    const height = measureElement(
      {
        id: 'l',
        type: 'label',
        x: 0,
        y: 0,
        width: 100,
        height: 12,
        content: TEXTO_LONGO,
        canGrow: true,
        style: { fontSize: 9 },
      },
      { fonts, row: {} },
    );

    // 9pt de fonte -> 10.8pt por linha; o texto não cabe em uma só
    expect(height).toBeGreaterThan(12);

    // a altura é um número inteiro de linhas
    const linhas = height / 10.8;
    expect(linhas).toBeCloseTo(Math.round(linhas), 5);
    expect(Math.round(linhas)).toBeGreaterThan(1);
  });

  it('texto curto com canGrow não encolhe abaixo do nominal', () => {
    const height = measureElement(
      {
        id: 'l',
        type: 'label',
        x: 0,
        y: 0,
        width: 300,
        height: 40,
        content: 'curto',
        canGrow: true,
      },
      { fonts, row: {} },
    );

    expect(height).toBe(40);
  });

  it('mede o texto já com a expressão resolvida', () => {
    const curto = measureElement(
      {
        id: 'l',
        type: 'label',
        x: 0,
        y: 0,
        width: 100,
        height: 12,
        content: '{{TEXTO}}',
        canGrow: true,
        style: { fontSize: 9 },
      },
      { fonts, row: { TEXTO: 'ok' } },
    );

    const longo = measureElement(
      {
        id: 'l',
        type: 'label',
        x: 0,
        y: 0,
        width: 100,
        height: 12,
        content: '{{TEXTO}}',
        canGrow: true,
        style: { fontSize: 9 },
      },
      { fonts, row: { TEXTO: TEXTO_LONGO } },
    );

    expect(longo).toBeGreaterThan(curto);
  });

  it('fonte maior ocupa mais altura para o mesmo texto', () => {
    const base = {
      id: 'l',
      type: 'label' as const,
      x: 0,
      y: 0,
      width: 150,
      height: 10,
      content: TEXTO_LONGO,
      canGrow: true,
    };

    const pequena = measureElement({ ...base, style: { fontSize: 8 } }, { fonts, row: {} });
    const grande = measureElement({ ...base, style: { fontSize: 14 } }, { fonts, row: {} });

    expect(grande).toBeGreaterThan(pequena);
  });

  it('sem fontes no contexto, não tenta medir texto', () => {
    const height = measureElement(
      {
        id: 'l',
        type: 'label',
        x: 0,
        y: 0,
        width: 100,
        height: 12,
        content: TEXTO_LONGO,
        canGrow: true,
      },
      { row: {} },
    );

    expect(height).toBe(12);
  });
});

describe('cascata dentro da banda', () => {
  /** Banda com um texto que cresce e um bloco logo abaixo dele. */
  function bandaComTexto(content: string): Band {
    return {
      height: 50,
      elements: [
        {
          id: 'texto',
          type: 'label',
          x: 0,
          y: 0,
          width: 100,
          height: 12,
          content,
          canGrow: true,
          style: { fontSize: 9 },
        },
        {
          id: 'abaixo',
          type: 'label',
          x: 0,
          y: 16,
          width: 300,
          height: 12,
          content: 'RESUMO',
          style: { fontSize: 9 },
        },
      ],
    };
  }

  it('a banda cresce quando o texto dentro dela cresce', () => {
    const curta = measureBandContent(bandaComTexto('ok'), { fonts, row: {} });
    const longa = measureBandContent(bandaComTexto(TEXTO_LONGO), { fonts, row: {} });

    expect(longa).toBeGreaterThan(curta);
  });

  it('o elemento de baixo desce no PDF conforme o de cima cresce', async () => {
    const template = (content: string): Template => ({
      id: 't',
      name: 'T',
      boundDataSourceNodeId: 'N',
      pageSize: 'A4',
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      bands: { details: bandaComTexto(content) },
    });

    const curto = await inspectPdf(await renderReport(template('ok'), dataSet([{}])));
    const longo = await inspectPdf(await renderReport(template(TEXTO_LONGO), dataSet([{}])));

    const resumoCurto = findItem(curto.pages[0]!, 'RESUMO')!;
    const resumoLongo = findItem(longo.pages[0]!, 'RESUMO')!;

    // Y do PDF cresce para cima: descer = Y menor
    expect(resumoLongo.y).toBeLessThan(resumoCurto.y);
  });

  it('sem canGrow, o de baixo NÃO desce (posição absoluta)', async () => {
    const banda = (content: string): Band => ({
      height: 50,
      elements: [
        {
          id: 'texto',
          type: 'label',
          x: 0,
          y: 0,
          width: 100,
          height: 12,
          content,
          style: { fontSize: 9 },
        },
        {
          id: 'abaixo',
          type: 'label',
          x: 0,
          y: 16,
          width: 300,
          height: 12,
          content: 'RESUMO',
          style: { fontSize: 9 },
        },
      ],
    });

    const template = (content: string): Template => ({
      id: 't',
      name: 'T',
      boundDataSourceNodeId: 'N',
      pageSize: 'A4',
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      bands: { details: banda(content) },
    });

    const curto = await inspectPdf(await renderReport(template('ok'), dataSet([{}])));
    const longo = await inspectPdf(await renderReport(template(TEXTO_LONGO), dataSet([{}])));

    expect(findItem(longo.pages[0]!, 'RESUMO')!.y).toBeCloseTo(
      findItem(curto.pages[0]!, 'RESUMO')!.y,
      1,
    );
  });

  it('vários elementos que crescem acumulam o deslocamento', () => {
    const banda: Band = {
      height: 60,
      elements: [
        {
          id: 'a',
          type: 'label',
          x: 0,
          y: 0,
          width: 100,
          height: 12,
          content: TEXTO_LONGO,
          canGrow: true,
          style: { fontSize: 9 },
        },
        {
          id: 'b',
          type: 'label',
          x: 0,
          y: 16,
          width: 100,
          height: 12,
          content: TEXTO_LONGO,
          canGrow: true,
          style: { fontSize: 9 },
        },
        {
          id: 'c',
          type: 'label',
          x: 0,
          y: 32,
          width: 300,
          height: 12,
          content: 'FIM',
          style: { fontSize: 9 },
        },
      ],
    };

    const umSo: Band = { ...banda, elements: [banda.elements[0]!, banda.elements[2]!] };

    // com dois blocos crescendo, a banda tem que ficar mais alta que com um
    expect(measureBandContent(banda, { fonts, row: {} })).toBeGreaterThan(
      measureBandContent(umSo, { fonts, row: {} }),
    );
  });
});

describe('encolhimento para o conteúdo', () => {
  const bandaComSubreport: Band = {
    height: 100,
    elements: [
      {
        id: 'sub',
        type: 'subreport',
        x: 0,
        y: 0,
        width: 400,
        height: 90,
        dataSourceNodeId: 'ITENS',
        canGrow: true,
        template: { details: { height: 10, elements: [] } },
      },
    ],
  };

  it('banda encolhível ocupa o conteúdo, não a altura de design', () => {
    const duasLinhas = row({}, { ITENS: [row({}), row({})] });

    const fixa = measureBandContent(bandaComSubreport, {
      fonts,
      row: {},
      resolvedRow: duasLinhas,
    });
    const encolhida = measureBandContent(
      bandaComSubreport,
      { fonts, row: {}, resolvedRow: duasLinhas },
      { shrinkToContent: true },
    );

    expect(fixa).toBe(100); // reserva a altura de design
    expect(encolhida).toBe(20); // 2 linhas x 10pt
  });

  it('banda sem elemento variável mantém a altura mesmo encolhível', () => {
    const banda: Band = {
      height: 30,
      elements: [
        { id: 'l', type: 'label', x: 0, y: 0, width: 100, height: 12, content: 'x' },
      ],
    };

    expect(measureBandContent(banda, { fonts, row: {} }, { shrinkToContent: true })).toBe(30);
  });

  it('mais linhas ocupam mais espaço', () => {
    const uma = measureBandContent(
      bandaComSubreport,
      { fonts, row: {}, resolvedRow: row({}, { ITENS: [row({})] }) },
      { shrinkToContent: true },
    );
    const cinco = measureBandContent(
      bandaComSubreport,
      {
        fonts,
        row: {},
        resolvedRow: row({}, { ITENS: [row({}), row({}), row({}), row({}), row({})] }),
      },
      { shrinkToContent: true },
    );

    expect(cinco).toBeGreaterThan(uma);
    expect(cinco - uma).toBeCloseTo(40, 1); // 4 linhas a mais x 10pt
  });
});

describe('quebra de página com conteúdo variável', () => {
  it('leva em conta o texto que cresce ao decidir a quebra', async () => {
    // 40 registros com texto que ocupa várias linhas cada
    const rows = Array.from({ length: 40 }, (_, i) => ({
      TEXTO: `${i + 1}. ${TEXTO_LONGO}`,
    }));

    const template: Template = {
      id: 't',
      name: 'T',
      boundDataSourceNodeId: 'N',
      pageSize: 'A4',
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      bands: {
        details: {
          height: 14,
          elements: [
            {
              id: 'txt',
              type: 'label',
              x: 0,
              y: 0,
              width: 200,
              height: 12,
              content: '{{TEXTO}}',
              canGrow: true,
              style: { fontSize: 9 },
            },
          ],
        },
      },
    };

    const pdf = await inspectPdf(await renderReport(template, dataSet(rows)));

    expect(pdf.pageCount).toBeGreaterThan(1);

    // nada pode ter sido perdido nem ter caído fora da área útil
    expect(pdf.text).toContain('1.');
    expect(pdf.text).toContain('40.');
    for (const page of pdf.pages) {
      for (const item of page.items) {
        expect(item.y).toBeGreaterThan(30);
      }
    }
  });
});
