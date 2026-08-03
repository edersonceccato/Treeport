import { describe, it, expect } from 'vitest';
import type { ResolvedDataSet, Template } from '@treeport/schema';
import { renderReport, generateReport, MemoryExecutor } from '../src/index.js';
import { inspectPdf } from './helpers/pdf-inspect.js';

/**
 * Integração da Fase 3: as expressões precisam chegar no PDF de verdade, não
 * só passar nos testes unitários do parser.
 */

function dataSet(rows: Record<string, unknown>[]): ResolvedDataSet {
  return { nodeId: 'FEE', rows: rows.map((data) => ({ data, children: {} })) };
}

/** Template com um único Label no detalhe, para isolar a expressão testada. */
function templateWithLabel(content: string, isExpression?: boolean): Template {
  return {
    id: 't',
    name: 'Teste',
    boundDataSourceNodeId: 'FEE',
    pageSize: 'A4',
    bands: {
      details: {
        height: 20,
        elements: [
          {
            id: 'lbl',
            type: 'label',
            x: 0,
            y: 0,
            width: 500,
            height: 14,
            content,
            ...(isExpression === undefined ? {} : { isExpression }),
          },
        ],
      },
    },
  };
}

describe('expressões no PDF', () => {
  it('resolve um campo simples', async () => {
    const bytes = await renderReport(
      templateWithLabel('{{NOME}}'),
      dataSet([{ NOME: 'Frete internacional' }]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('Frete internacional');
    expect(pdf.text).not.toContain('{{');
  });

  it('resolve o exemplo do brief: texto + soma', async () => {
    const bytes = await renderReport(
      templateWithLabel('{{NOME}} - Total: {{VALOR_A + VALOR_B}}'),
      dataSet([{ NOME: 'João', VALOR_A: 100, VALOR_B: 50 }]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('João - Total: 150');
  });

  it('resolve condicional IF', async () => {
    const template = templateWithLabel("{{IF(VALOR > 1000, 'ALTO', 'NORMAL')}}");

    const alto = await inspectPdf(await renderReport(template, dataSet([{ VALOR: 5000 }])));
    expect(alto.text).toContain('ALTO');

    const normal = await inspectPdf(await renderReport(template, dataSet([{ VALOR: 10 }])));
    expect(normal.text).toContain('NORMAL');
  });

  it('resolve expressão por linha, não uma vez só', async () => {
    const bytes = await renderReport(
      templateWithLabel('{{NOME}}: {{QTD * VALOR}}'),
      dataSet([
        { NOME: 'A', QTD: 2, VALOR: 10 },
        { NOME: 'B', QTD: 3, VALOR: 10 },
        { NOME: 'C', QTD: 4, VALOR: 10 },
      ]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('A: 20');
    expect(pdf.text).toContain('B: 30');
    expect(pdf.text).toContain('C: 40');
  });

  it('aplica FORMAT dentro da expressão', async () => {
    const bytes = await renderReport(
      templateWithLabel("Total: {{FORMAT(VALOR, '#,##0.00')}}"),
      dataSet([{ VALOR: 1500.5 }]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('Total: 1.500,50');
  });

  it('isExpression true sem chaves avalia o conteúdo todo', async () => {
    const bytes = await renderReport(
      templateWithLabel("UPPER(NOME) + ' / ' + VALOR", true),
      dataSet([{ NOME: 'frete', VALOR: 10 }]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('FRETE / 10');
  });

  it('label sem expressão continua literal', async () => {
    const bytes = await renderReport(
      templateWithLabel('Texto fixo'),
      dataSet([{ NOME: 'x' }]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('Texto fixo');
  });

  it('expressão que cresce quebra em várias linhas com canGrow', async () => {
    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'FEE',
      pageSize: 'A4',
      bands: {
        details: {
          height: 20,
          elements: [
            {
              id: 'lbl',
              type: 'label',
              x: 0,
              y: 0,
              width: 120,
              height: 14,
              content: '{{TEXTO}}',
              canGrow: true,
              style: { fontSize: 9 },
            },
          ],
        },
      },
    };

    const bytes = await renderReport(
      template,
      dataSet([{ TEXTO: 'Armazenagem de carga no terminal portuario de Santos com taxa extra' }]),
    );
    const pdf = await inspectPdf(bytes);

    // o texto tem que aparecer inteiro, distribuído em mais de um item
    expect(pdf.text).toContain('Armazenagem');
    expect(pdf.text).toContain('Santos');
    expect(pdf.pages[0]!.items.length).toBeGreaterThan(1);
  });

  it('Field com {{}} aceita expressão', async () => {
    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'FEE',
      pageSize: 'A4',
      bands: {
        details: {
          height: 20,
          elements: [
            {
              id: 'f',
              type: 'field',
              x: 0,
              y: 0,
              width: 300,
              height: 14,
              fieldName: '{{QTD * VALOR}}',
              format: '#,##0.00',
            },
          ],
        },
      },
    };

    const bytes = await renderReport(template, dataSet([{ QTD: 3, VALOR: 500 }]));
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('1.500,00');
  });

  it('expressão no header usa a primeira linha do master', async () => {
    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'FEE',
      pageSize: 'A4',
      bands: {
        header: {
          height: 30,
          elements: [
            {
              id: 'h',
              type: 'label',
              x: 0,
              y: 0,
              width: 400,
              height: 14,
              content: 'Cliente: {{CLIENTE}}',
            },
          ],
        },
        details: {
          height: 20,
          elements: [
            { id: 'f', type: 'field', x: 0, y: 0, width: 200, height: 14, fieldName: 'NOME' },
          ],
        },
      },
    };

    const bytes = await renderReport(
      template,
      dataSet([
        { CLIENTE: 'Acme Ltda', NOME: 'Taxa 1' },
        { CLIENTE: 'Acme Ltda', NOME: 'Taxa 2' },
      ]),
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('Cliente: Acme Ltda');
  });

  it('parâmetros do relatório ficam visíveis nas expressões', async () => {
    const executor = new MemoryExecutor().on('SELECT 1', [{ NOME: 'Taxa' }]);

    const bytes = await generateReport(
      {
        id: 'tree',
        name: 'T',
        parameters: [{ name: 'ano', type: 'int', nullable: false }],
        root: { id: 'FEE', name: 'F', sql: 'SELECT 1' },
      },
      templateWithLabel('{{NOME}} / {{ano}}'),
      executor,
      { parameters: { ano: 2026 } },
    );

    const pdf = await inspectPdf(bytes);
    expect(pdf.text).toContain('Taxa / 2026');
  });

  it('erro de expressão diz qual template e qual campo', async () => {
    await expect(
      renderReport(templateWithLabel('{{CAMPO_ERRADO}}'), dataSet([{ NOME: 'x' }])),
    ).rejects.toThrow(/CAMPO_ERRADO/);
  });

  it('modo não estrito imprime vazio em vez de quebrar', async () => {
    const bytes = await renderReport(
      templateWithLabel('[{{CAMPO_ERRADO}}]'),
      dataSet([{ NOME: 'x' }]),
      { expressionOptions: { strict: false } },
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('[]');
  });

  it('aceita funções customizadas na renderização', async () => {
    const bytes = await renderReport(
      templateWithLabel('{{DOBRO(VALOR)}}'),
      dataSet([{ VALOR: 21 }]),
      { expressionOptions: { functions: { DOBRO: (v) => Number(v) * 2 } } },
    );
    const pdf = await inspectPdf(bytes);

    expect(pdf.text).toContain('42');
  });
});
