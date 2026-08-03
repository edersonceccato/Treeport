import { describe, it, expect } from 'vitest';
import type { BandSet, Band, Template } from '@treeport/schema';
import { generateReport, renderReport, measureSubreport } from '../src/index.js';
import { inspectPdf, findItem } from './helpers/pdf-inspect.js';
import { proposalTree, proposalExecutor, row, buildDataSet } from './helpers/proposal-fixture.js';

/**
 * Fase 4 — subreports aninhados, com o fixture do Anexo D:
 *   Proposal → Offer → (OfferFee | OfferPackage)
 */

/** Label simples, para montar bandas de teste sem verbosidade. */
const label = (
  id: string,
  content: string,
  y: number,
  extra: Record<string, unknown> = {},
): Band['elements'][number] => ({
  id,
  type: 'label',
  x: 0,
  y,
  width: 400,
  height: 12,
  content,
  style: { fontSize: 9 },
  ...extra,
});

/** Bandas do subreport de taxas: uma linha por taxa. */
function feeBands(): BandSet {
  return {
    details: { height: 14, elements: [label('fee', '  Taxa: {{name}} = {{amount}}', 0)] },
  };
}

/** Bandas do subreport de embalagens. */
function packageBands(): BandSet {
  return {
    details: { height: 14, elements: [label('pkg', '  Embalagem: {{qty}}x {{kind}}', 0)] },
  };
}

describe('subreport simples', () => {
  it('itera as linhas do nó filho', async () => {
    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'PROPOSAL',
      pageSize: 'A4',
      bands: {
        details: {
          height: 80,
          elements: [
            label('cliente', 'Cliente: {{customer}}', 0),
            {
              id: 'sub',
              type: 'subreport',
              x: 0,
              y: 16,
              width: 400,
              height: 60,
              dataSourceNodeId: 'OFFER',
              template: {
                details: { height: 14, elements: [label('rota', 'Oferta: {{route}}', 0)] },
              },
            },
          ],
        },
      },
    };

    const pdf = await inspectPdf(
      await generateReport(proposalTree(), template, proposalExecutor(), {
        parameters: { proposalId: 1 },
      }),
    );

    expect(pdf.text).toContain('Cliente: Acme Ltda');
    // as DUAS ofertas têm que aparecer
    expect(pdf.text).toContain('Oferta: Santos > Roterda');
    expect(pdf.text).toContain('Oferta: Santos > Hamburgo');
  });

  it('desenha Header e Footer próprios do subreport', async () => {
    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'PROPOSAL',
      pageSize: 'A4',
      bands: {
        details: {
          height: 100,
          elements: [
            {
              id: 'sub',
              type: 'subreport',
              x: 0,
              y: 0,
              width: 400,
              height: 90,
              dataSourceNodeId: 'OFFER',
              template: {
                header: { height: 14, elements: [label('h', '--- OFERTAS ---', 0)] },
                details: { height: 14, elements: [label('d', 'Oferta: {{route}}', 0)] },
                footer: { height: 14, elements: [label('f', '--- FIM OFERTAS ---', 0)] },
              },
            },
          ],
        },
      },
    };

    const pdf = await inspectPdf(
      await generateReport(proposalTree(), template, proposalExecutor(), {
        parameters: { proposalId: 1 },
      }),
    );
    const page = pdf.pages[0]!;

    const header = findItem(page, '--- OFERTAS ---')!;
    const footer = findItem(page, '--- FIM OFERTAS ---')!;
    expect(header).toBeDefined();
    expect(footer).toBeDefined();

    // header 1x no topo, footer 1x embaixo (Y do PDF cresce para cima)
    expect(header.y).toBeGreaterThan(footer.y);
    expect(page.items.filter((i) => i.text.includes('OFERTAS'))).toHaveLength(2);
  });

  it('subreport sem linhas não quebra o relatório', async () => {
    const dataSet = buildDataSet([{ data: { customer: 'Acme' }, children: { OFFER: [] } }]);

    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'PROPOSAL',
      pageSize: 'A4',
      bands: {
        details: {
          height: 40,
          elements: [
            label('c', 'Cliente: {{customer}}', 0),
            {
              id: 'sub',
              type: 'subreport',
              x: 0,
              y: 16,
              width: 400,
              height: 20,
              dataSourceNodeId: 'OFFER',
              template: { details: { height: 14, elements: [label('d', '{{route}}', 0)] } },
            },
          ],
        },
      },
    };

    const pdf = await inspectPdf(await renderReport(template, dataSet));
    expect(pdf.text).toContain('Cliente: Acme');
    expect(pdf.pageCount).toBe(1);
  });

  it('subreport apontando para nó inexistente não quebra', async () => {
    const dataSet = buildDataSet([{ data: { customer: 'Acme' } }]);

    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'PROPOSAL',
      pageSize: 'A4',
      bands: {
        details: {
          height: 40,
          elements: [
            label('c', '{{customer}}', 0),
            {
              id: 'sub',
              type: 'subreport',
              x: 0,
              y: 16,
              width: 400,
              height: 20,
              dataSourceNodeId: 'NAO_EXISTE',
              template: { details: { height: 14, elements: [label('d', 'x', 0)] } },
            },
          ],
        },
      },
    };

    const pdf = await inspectPdf(await renderReport(template, dataSet));
    expect(pdf.text).toContain('Acme');
  });
});

describe('subreports aninhados (3 níveis)', () => {
  /** Proposta → Oferta → (Taxas + Embalagens), como no Anexo D. */
  function nestedTemplate(): Template {
    return {
      id: 'nested',
      name: 'Proposta completa',
      boundDataSourceNodeId: 'PROPOSAL',
      pageSize: 'A4',
      bands: {
        details: {
          height: 200,
          elements: [
            label('cliente', 'Cliente: {{customer}} ({{number}})', 0),
            {
              id: 'sub-offer',
              type: 'subreport',
              x: 0,
              y: 16,
              width: 500,
              height: 180,
              dataSourceNodeId: 'OFFER',
              canGrow: true,
              template: {
                // o cabeçalho do subreport aparece 1x (Anexo C); o título de
                // cada oferta é por linha, então mora no Details
                header: { height: 14, elements: [label('oh', '=== OFERTAS ===', 0)] },
                details: {
                  height: 100,
                  elements: [
                    label('rota', 'Oferta {{route}}', 0),
                    {
                      id: 'sub-fee',
                      type: 'subreport',
                      x: 0,
                      y: 16,
                      width: 480,
                      height: 40,
                      dataSourceNodeId: 'OFFER_FEE',
                      canGrow: true,
                      template: feeBands(),
                    },
                    {
                      id: 'sub-pkg',
                      type: 'subreport',
                      x: 0,
                      y: 60,
                      width: 480,
                      height: 30,
                      dataSourceNodeId: 'OFFER_PACKAGE',
                      canGrow: true,
                      template: packageBands(),
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };
  }

  it('renderiza a árvore inteira de 3 níveis', async () => {
    const pdf = await inspectPdf(
      await generateReport(proposalTree(), nestedTemplate(), proposalExecutor(), {
        parameters: { proposalId: 1 },
      }),
    );

    // nível 1
    expect(pdf.text).toContain('Cliente: Acme Ltda');
    // nível 2 (as duas ofertas)
    expect(pdf.text).toContain('Santos > Roterda');
    expect(pdf.text).toContain('Santos > Hamburgo');
    // nível 3 — taxas
    expect(pdf.text).toContain('Frete internacional');
    expect(pdf.text).toContain('THC');
    expect(pdf.text).toContain('Armazenagem');
    // nível 3 — embalagens
    expect(pdf.text).toContain('Container 20');
    expect(pdf.text).toContain('Container 40');
  });

  it('cada oferta lista apenas as PRÓPRIAS taxas', async () => {
    const pdf = await inspectPdf(
      await generateReport(proposalTree(), nestedTemplate(), proposalExecutor(), {
        parameters: { proposalId: 1 },
      }),
    );
    const page = pdf.pages[0]!;

    const roterda = findItem(page, 'Oferta Santos > Roterda')!;
    const hamburgo = findItem(page, 'Oferta Santos > Hamburgo')!;
    expect(roterda).toBeDefined();
    expect(hamburgo).toBeDefined();

    // a oferta 10 tem 3 taxas, a 11 tem 1 — a THC (só da oferta 10) precisa
    // ficar acima do cabeçalho da oferta de Hamburgo
    const thc = page.items.find((i) => i.text.includes('THC'))!;
    expect(thc.y).toBeLessThan(roterda.y);
    expect(thc.y).toBeGreaterThan(hamburgo.y);

    // e só existe UMA THC no documento inteiro
    expect(page.items.filter((i) => i.text.includes('THC'))).toHaveLength(1);
  });

  it('as embalagens vêm depois das taxas de cada oferta', async () => {
    const pdf = await inspectPdf(
      await generateReport(proposalTree(), nestedTemplate(), proposalExecutor(), {
        parameters: { proposalId: 1 },
      }),
    );
    const page = pdf.pages[0]!;

    const armazenagem = page.items.find((i) => i.text.includes('Armazenagem'))!;
    const container20 = page.items.find((i) => i.text.includes('Container 20'))!;

    // Container 20 pertence à oferta 10 e vem depois das taxas dela
    expect(container20.y).toBeLessThan(armazenagem.y);
  });
});

describe('escopo parent dentro do subreport', () => {
  it('alcança campos do pai e do avô', async () => {
    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'PROPOSAL',
      pageSize: 'A4',
      bands: {
        details: {
          height: 150,
          elements: [
            {
              id: 'sub-offer',
              type: 'subreport',
              x: 0,
              y: 0,
              width: 500,
              height: 140,
              dataSourceNodeId: 'OFFER',
              template: {
                details: {
                  height: 60,
                  elements: [
                    {
                      id: 'sub-fee',
                      type: 'subreport',
                      x: 0,
                      y: 0,
                      width: 480,
                      height: 50,
                      dataSourceNodeId: 'OFFER_FEE',
                      template: {
                        details: {
                          height: 14,
                          elements: [
                            // current / parent / parent.parent, tudo numa linha
                            label(
                              'linha',
                              '{{name}} | {{parent.route}} | {{parent.parent.customer}}',
                              0,
                            ),
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };

    const pdf = await inspectPdf(
      await generateReport(proposalTree(), template, proposalExecutor(), {
        parameters: { proposalId: 1 },
      }),
    );

    expect(pdf.text).toContain('THC | Santos > Roterda | Acme Ltda');
    expect(pdf.text).toContain('Frete internacional | Santos > Hamburgo | Acme Ltda');
  });

  it('nome solto sobe a corrente sozinho', async () => {
    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'PROPOSAL',
      pageSize: 'A4',
      bands: {
        details: {
          height: 120,
          elements: [
            {
              id: 'sub-offer',
              type: 'subreport',
              x: 0,
              y: 0,
              width: 500,
              height: 110,
              dataSourceNodeId: 'OFFER',
              template: {
                details: {
                  height: 50,
                  elements: [
                    {
                      id: 'sub-fee',
                      type: 'subreport',
                      x: 0,
                      y: 0,
                      width: 480,
                      height: 40,
                      dataSourceNodeId: 'OFFER_FEE',
                      template: {
                        details: {
                          height: 14,
                          // "customer" só existe 2 níveis acima, sem "parent."
                          elements: [label('l', '{{name}} de {{customer}}', 0)],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };

    const pdf = await inspectPdf(
      await generateReport(proposalTree(), template, proposalExecutor(), {
        parameters: { proposalId: 1 },
      }),
    );

    expect(pdf.text).toContain('THC de Acme Ltda');
  });

  it('parâmetros continuam visíveis dentro do subreport', async () => {
    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'PROPOSAL',
      pageSize: 'A4',
      bands: {
        details: {
          height: 60,
          elements: [
            {
              id: 'sub',
              type: 'subreport',
              x: 0,
              y: 0,
              width: 400,
              height: 50,
              dataSourceNodeId: 'OFFER',
              template: {
                details: {
                  height: 14,
                  elements: [label('l', 'Proposta {{proposalId}}: {{route}}', 0)],
                },
              },
            },
          ],
        },
      },
    };

    const pdf = await inspectPdf(
      await generateReport(proposalTree(), template, proposalExecutor(), {
        parameters: { proposalId: 1 },
      }),
    );

    expect(pdf.text).toContain('Proposta 1: Santos > Roterda');
  });
});

describe('measureSubreport', () => {
  const subreport = {
    id: 'sub',
    type: 'subreport' as const,
    x: 0,
    y: 0,
    width: 400,
    height: 20,
    dataSourceNodeId: 'OFFER_FEE',
    template: { details: { height: 10, elements: [] } },
  };

  it('mede header + N detalhes + footer', () => {
    const parent = row({ id: 10 }, {
      OFFER_FEE: [row({ name: 'a' }), row({ name: 'b' }), row({ name: 'c' })],
    });

    // 3 linhas x 10pt = 30
    expect(measureSubreport(subreport, parent)).toBe(30);
  });

  it('cresce com o número de linhas', () => {
    const duas = row({ id: 10 }, { OFFER_FEE: [row({}), row({})] });
    const cinco = row({ id: 10 }, { OFFER_FEE: [row({}), row({}), row({}), row({}), row({})] });

    expect(measureSubreport(subreport, cinco)).toBeGreaterThan(
      measureSubreport(subreport, duas),
    );
  });

  it('sem linhas devolve a altura nominal', () => {
    expect(measureSubreport(subreport, row({ id: 10 }, { OFFER_FEE: [] }))).toBe(20);
    expect(measureSubreport(subreport, undefined)).toBe(20);
  });

  it('nunca devolve menos que a altura nominal', () => {
    const uma = row({ id: 10 }, { OFFER_FEE: [row({})] });
    // 1 linha x 10pt = 10, mas a altura nominal é 20
    expect(measureSubreport(subreport, uma)).toBe(20);
  });

  it('soma os subreports aninhados', () => {
    const aninhado = {
      ...subreport,
      dataSourceNodeId: 'OFFER',
      height: 0,
      template: {
        details: {
          height: 0,
          elements: [
            {
              id: 'inner',
              type: 'subreport' as const,
              x: 0,
              y: 0,
              width: 400,
              height: 0,
              dataSourceNodeId: 'OFFER_FEE',
              canGrow: true,
              template: { details: { height: 10, elements: [] } },
            },
          ],
        },
      },
    };

    // 2 ofertas, com 3 e 1 taxas = 4 linhas x 10pt
    const parent = row({ id: 1 }, {
      OFFER: [
        row({ id: 10 }, { OFFER_FEE: [row({}), row({}), row({})] }),
        row({ id: 11 }, { OFFER_FEE: [row({})] }),
      ],
    });

    expect(measureSubreport(aninhado, parent)).toBe(40);
  });
});

describe('quebra de página com subreport', () => {
  it('não parte um bloco de detalhe no meio da página', async () => {
    // 12 propostas, cada uma com um subreport de 3 taxas
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ customer: `Cliente ${i + 1}` }, {
        OFFER_FEE: [
          row({ name: `T${i}-a`, amount: 1 }),
          row({ name: `T${i}-b`, amount: 2 }),
          row({ name: `T${i}-c`, amount: 3 }),
        ],
      }),
    );

    const template: Template = {
      id: 't',
      name: 'Teste',
      boundDataSourceNodeId: 'PROPOSAL',
      pageSize: 'A4',
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      bands: {
        details: {
          height: 80,
          elements: [
            label('c', '{{customer}}', 0),
            {
              id: 'sub',
              type: 'subreport',
              x: 0,
              y: 16,
              width: 400,
              height: 60,
              dataSourceNodeId: 'OFFER_FEE',
              template: feeBands(),
            },
          ],
        },
      },
    };

    const pdf = await inspectPdf(
      await renderReport(template, { nodeId: 'PROPOSAL', rows }),
    );

    expect(pdf.pageCount).toBeGreaterThan(1);

    // nenhum cliente pode ter sumido, e cada um mantém suas 3 taxas
    for (let i = 0; i < 12; i += 1) {
      expect(pdf.text).toContain(`Cliente ${i + 1}`);
      expect(pdf.text).toContain(`T${i}-c`);
    }

    // o cliente e a última taxa dele têm que estar na MESMA página
    for (const [i] of Array.from({ length: 12 }).entries()) {
      const page = pdf.pages.find((p) => p.text.includes(`Cliente ${i + 1}`))!;
      expect(page.text).toContain(`T${i}-c`);
    }
  });
});
