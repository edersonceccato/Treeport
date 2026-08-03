/**
 * Exemplo da Fase 4 — subreports aninhados em 3 níveis (Anexo D do brief).
 *
 *   Proposta (master)
 *     └─ Oferta de frete            (subreport dentro do Details da proposta)
 *          ├─ Taxas                 (subreport dentro do Details da oferta)
 *          └─ Embalagens            (idem)
 *
 * É o mesmo cenário do ERP que inspirou o projeto: uma proposta com várias
 * ofertas, cada oferta com sua lista de taxas e de embalagens.
 *
 * Repare no layout: o bloco de "resumo" da oferta fica DEPOIS dos dois
 * subreports, com `canGrow` neles — então ele desce sozinho conforme a
 * quantidade de taxas muda. É o deslocamento em cascata do Anexo C.
 *
 * Rodar:  pnpm example:phase4
 * Saída:  packages/core/examples/output/proposal-subreports.pdf
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSourceTree, Template } from '@treeport/schema';
import { MemoryExecutor, generateReport } from '../src/index.js';

// --- Dados fake ------------------------------------------------------------

const SQL_PROPOSAL = 'SELECT * FROM proposal WHERE id = :proposalId';
const SQL_OFFER = 'SELECT * FROM offer WHERE proposal_id IN (:parentValues)';
const SQL_FEE = 'SELECT * FROM offer_fee WHERE offer_id IN (:parentValues)';
const SQL_PACKAGE = 'SELECT * FROM offer_package WHERE offer_id IN (:parentValues)';

const PROPOSALS = [
  { id: 1, customer: 'Acme Comercio Exterior Ltda', number: 'P-2026-001', validUntil: '2026-09-30' },
];

const OFFERS = [
  { id: 10, proposalId: 1, route: 'Santos > Roterda', modal: 'Maritimo', transitDays: 22 },
  { id: 11, proposalId: 1, route: 'Santos > Hamburgo', modal: 'Maritimo', transitDays: 25 },
  { id: 12, proposalId: 1, route: 'Guarulhos > Frankfurt', modal: 'Aereo', transitDays: 3 },
];

// quantidades diferentes de propósito, para o resumo descer de forma diferente
// em cada oferta e o auto-grow ficar visível
const FEES = [
  { id: 100, offerId: 10, name: 'Frete internacional', currency: 'USD', amount: 1500 },
  { id: 101, offerId: 10, name: 'THC - Terminal Handling', currency: 'BRL', amount: 300 },
  { id: 102, offerId: 10, name: 'Armazenagem', currency: 'BRL', amount: 220.5 },
  { id: 103, offerId: 10, name: 'Liberacao de BL', currency: 'BRL', amount: 90 },
  { id: 104, offerId: 11, name: 'Frete internacional', currency: 'USD', amount: 1800 },
  { id: 105, offerId: 11, name: 'THC - Terminal Handling', currency: 'BRL', amount: 320 },
  { id: 106, offerId: 12, name: 'Frete aereo', currency: 'USD', amount: 4200 },
];

const PACKAGES = [
  { id: 200, offerId: 10, kind: 'Container 20 pes', qty: 2, weight: 18000 },
  { id: 201, offerId: 10, kind: 'Container 40 pes', qty: 1, weight: 26000 },
  { id: 202, offerId: 11, kind: 'Container 40 pes', qty: 1, weight: 26000 },
  { id: 203, offerId: 12, kind: 'Palete', qty: 8, weight: 3200 },
];

const tree: DataSourceTree = {
  id: 'proposal-tree',
  name: 'Proposta comercial',
  parameters: [{ name: 'proposalId', type: 'int', nullable: false, testValue: 1 }],
  root: {
    id: 'PROPOSAL',
    name: 'Proposta',
    sql: SQL_PROPOSAL,
    children: [
      {
        id: 'OFFER',
        name: 'Oferta de frete',
        sql: SQL_OFFER,
        linkFields: { parentField: 'id', childField: 'proposalId' },
        children: [
          {
            id: 'OFFER_FEE',
            name: 'Taxas',
            sql: SQL_FEE,
            linkFields: { parentField: 'id', childField: 'offerId' },
            orderBy: 'amount DESC',
          },
          {
            id: 'OFFER_PACKAGE',
            name: 'Embalagens',
            sql: SQL_PACKAGE,
            linkFields: { parentField: 'id', childField: 'offerId' },
          },
        ],
      },
    ],
  },
};

const inList = (p: Record<string, unknown>): string[] =>
  ((p['parentValues'] as unknown[]) ?? [p['parentValue']]).map(String);

const executor = new MemoryExecutor()
  .on(SQL_PROPOSAL, (p) => PROPOSALS.filter((r) => r.id === p['proposalId']))
  .on(SQL_OFFER, (p) => OFFERS.filter((r) => inList(p).includes(String(r.proposalId))))
  .on(SQL_FEE, (p) => FEES.filter((r) => inList(p).includes(String(r.offerId))))
  .on(SQL_PACKAGE, (p) => PACKAGES.filter((r) => inList(p).includes(String(r.offerId))));

// --- Template com subreports aninhados -------------------------------------

const CINZA = '#555555';
const CLARO = '#888888';
const LINHA = '#DDDDDD';

const template: Template = {
  id: 'proposal-full',
  name: 'Proposta comercial completa',
  boundDataSourceNodeId: 'PROPOSAL',
  pageSize: 'A4',
  margins: { top: 40, right: 40, bottom: 40, left: 40 },

  bands: {
    header: {
      height: 56,
      elements: [
        {
          id: 'titulo',
          type: 'label',
          x: 0,
          y: 0,
          width: 515,
          height: 22,
          content: 'Proposta {{number}}',
          style: { fontSize: 18, bold: true },
        },
        {
          id: 'cliente',
          type: 'label',
          x: 0,
          y: 26,
          width: 515,
          height: 12,
          content: '{{customer}} — validade {{FORMAT(validUntil, \'dd/MM/yyyy\')}}',
          style: { fontSize: 10, color: CINZA },
        },
        {
          id: 'regua',
          type: 'line',
          x: 0,
          y: 48,
          width: 515,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: CINZA, borderWidth: 1 },
        },
      ],
    },

    // Details da proposta: contém o subreport de ofertas
    details: {
      height: 40,
      elements: [
        {
          id: 'sub-ofertas',
          type: 'subreport',
          x: 0,
          y: 0,
          width: 515,
          height: 40,
          dataSourceNodeId: 'OFFER',
          canGrow: true,

          // --- design do nó OFERTA ---
          template: {
            // Header do subreport: aparece 1x, no início da lista de ofertas
            header: {
              height: 20,
              elements: [
                {
                  id: 'oh',
                  type: 'label',
                  x: 0,
                  y: 4,
                  width: 515,
                  height: 12,
                  content: 'OPCOES DE EMBARQUE',
                  style: { fontSize: 10, bold: true, color: CINZA },
                },
              ],
            },

            // Details do subreport: repete 1x por oferta
            details: {
              height: 150,
              elements: [
                {
                  id: 'rota',
                  type: 'label',
                  x: 0,
                  y: 4,
                  width: 400,
                  height: 14,
                  content: '{{route}}  ({{modal}}, {{transitDays}} dias)',
                  style: { fontSize: 11, bold: true },
                },

                // subreport de TAXAS (neto)
                {
                  id: 'th-taxas',
                  type: 'label',
                  x: 12,
                  y: 22,
                  width: 300,
                  height: 10,
                  content: 'Taxas',
                  style: { fontSize: 8, bold: true, color: CLARO },
                },
                {
                  id: 'sub-taxas',
                  type: 'subreport',
                  x: 12,
                  y: 34,
                  width: 490,
                  height: 14,
                  dataSourceNodeId: 'OFFER_FEE',
                  canGrow: true,
                  template: {
                    details: {
                      height: 13,
                      elements: [
                        {
                          id: 'tx-nome',
                          type: 'label',
                          x: 0,
                          y: 0,
                          width: 300,
                          height: 11,
                          content: '{{name}}',
                          style: { fontSize: 9 },
                        },
                        {
                          id: 'tx-valor',
                          type: 'label',
                          x: 310,
                          y: 0,
                          width: 180,
                          height: 11,
                          content: "{{currency}} {{FORMAT(amount, '#,##0.00')}}",
                          style: { fontSize: 9, align: 'right' },
                        },
                      ],
                    },
                  },
                },

                // subreport de EMBALAGENS (neto) — desce conforme as taxas
                {
                  id: 'th-emb',
                  type: 'label',
                  x: 12,
                  y: 52,
                  width: 300,
                  height: 10,
                  content: 'Embalagens',
                  style: { fontSize: 8, bold: true, color: CLARO },
                  canGrow: true,
                },
                {
                  id: 'sub-emb',
                  type: 'subreport',
                  x: 12,
                  y: 64,
                  width: 490,
                  height: 14,
                  dataSourceNodeId: 'OFFER_PACKAGE',
                  canGrow: true,
                  template: {
                    details: {
                      height: 13,
                      elements: [
                        {
                          id: 'em-desc',
                          type: 'label',
                          x: 0,
                          y: 0,
                          width: 300,
                          height: 11,
                          // alcança o campo da OFERTA (nó pai) de dentro da embalagem
                          content: '{{qty}}x {{kind}} — {{parent.modal}}',
                          style: { fontSize: 9 },
                        },
                        {
                          id: 'em-peso',
                          type: 'label',
                          x: 310,
                          y: 0,
                          width: 180,
                          height: 11,
                          content: "{{FORMAT(weight, '#,##0')}} kg",
                          style: { fontSize: 9, align: 'right' },
                        },
                      ],
                    },
                  },
                },

                // bloco de resumo: fica DEPOIS dos dois subreports, então
                // desce sozinho conforme a quantidade de linhas deles
                {
                  id: 'resumo',
                  type: 'label',
                  x: 12,
                  y: 84,
                  width: 490,
                  height: 12,
                  content:
                    'Proposta {{parent.number}} — opcao via {{route}} para {{parent.customer}}',
                  style: { fontSize: 8, color: CLARO },
                },
                {
                  id: 'sep',
                  type: 'line',
                  x: 0,
                  y: 100,
                  width: 515,
                  height: 0,
                  orientation: 'horizontal',
                  style: { borderColor: LINHA, borderWidth: 0.5 },
                },
              ],
            },
          },
        },
      ],
    },

    footer: {
      height: 20,
      elements: [
        {
          id: 'rodape',
          type: 'label',
          x: 0,
          y: 4,
          width: 515,
          height: 12,
          content: 'Proposta {{number}} — gerado pelo Treeport',
          style: { fontSize: 8, color: CINZA },
        },
      ],
    },
  },
};

const pdf = await generateReport(tree, template, executor, {
  parameters: { proposalId: 1 },
  title: 'Proposta comercial',
});

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'output');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, 'proposal-subreports.pdf');
await writeFile(outPath, pdf);

console.log(`PDF gerado: ${outPath}`);
console.log('\nArvore renderizada:');
for (const offer of OFFERS) {
  const fees = FEES.filter((f) => f.offerId === offer.id);
  const packs = PACKAGES.filter((p) => p.offerId === offer.id);
  console.log(`  ${offer.route}: ${fees.length} taxa(s), ${packs.length} embalagem(ns)`);
}
console.log('\nRepare no PDF que o bloco de resumo de cada oferta desce conforme');
console.log('a quantidade de taxas dela — deslocamento em cascata (Anexo C).');
