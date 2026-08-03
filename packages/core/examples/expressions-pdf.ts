/**
 * Exemplo da Fase 3 — labels calculados com expressões `{{...}}`.
 *
 * Mostra os casos que aparecem de verdade num relatório de taxas:
 *   - concatenação de campos
 *   - conta (quantidade x valor unitário)
 *   - condicional IF para classificar a linha
 *   - FORMAT com máscara dentro da expressão
 *   - parâmetro do relatório usado no cabeçalho
 *
 * Rodar:  pnpm example:phase3
 * Saída:  packages/core/examples/output/expressions.pdf
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSourceTree, Template } from '@treeport/schema';
import { MemoryExecutor, generateReport } from '../src/index.js';

const SQL = 'SELECT * FROM offer_fee WHERE offer_id = :offerId';

const FEES = [
  { code: 'TX-001', name: 'Frete internacional', qty: 2, unitPrice: 1500, currency: 'USD' },
  { code: 'TX-002', name: 'THC', qty: 1, unitPrice: 300, currency: 'BRL' },
  { code: 'TX-003', name: 'Armazenagem', qty: 5, unitPrice: 120.5, currency: 'BRL' },
  { code: 'TX-004', name: 'Liberação de BL', qty: 1, unitPrice: 90, currency: 'BRL' },
  { code: 'TX-005', name: 'Desconsolidação', qty: 3, unitPrice: 450, currency: 'USD' },
];

const tree: DataSourceTree = {
  id: 'fee-tree',
  name: 'Taxas da oferta',
  parameters: [
    { name: 'offerId', type: 'int', nullable: false, testValue: 10 },
    { name: 'emitente', type: 'string', nullable: false, defaultValue: 'Treeport Logistica' },
  ],
  root: { id: 'FEE', name: 'Taxas', sql: SQL },
};

const executor = new MemoryExecutor().on(SQL, () => FEES);

const CINZA = '#555555';

const template: Template = {
  id: 'fee-expressions',
  name: 'Taxas com expressoes',
  boundDataSourceNodeId: 'FEE',
  pageSize: 'A4',
  margins: { top: 40, right: 40, bottom: 40, left: 40 },

  bands: {
    header: {
      height: 74,
      elements: [
        {
          id: 'titulo',
          type: 'label',
          x: 0,
          y: 0,
          width: 515,
          height: 22,
          // parâmetro do relatório usado direto na expressão
          content: '{{emitente}} — Oferta #{{offerId}}',
          style: { fontSize: 16, bold: true },
        },
        {
          id: 'gerado',
          type: 'label',
          x: 0,
          y: 26,
          width: 515,
          height: 12,
          // função de data + máscara, tudo dentro da expressão
          content: "Emitido em {{FORMAT(TODAY(), 'dd/MM/yyyy')}}",
          style: { fontSize: 9, color: CINZA },
        },
        {
          id: 'th-item',
          type: 'label',
          x: 0,
          y: 48,
          width: 250,
          height: 12,
          content: 'Item',
          style: { fontSize: 9, bold: true, color: CINZA },
        },
        {
          id: 'th-classe',
          type: 'label',
          x: 260,
          y: 48,
          width: 80,
          height: 12,
          content: 'Faixa',
          style: { fontSize: 9, bold: true, color: CINZA },
        },
        {
          id: 'th-total',
          type: 'label',
          x: 350,
          y: 48,
          width: 165,
          height: 12,
          content: 'Total',
          style: { fontSize: 9, bold: true, color: CINZA, align: 'right' },
        },
        {
          id: 'linha',
          type: 'line',
          x: 0,
          y: 64,
          width: 515,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: CINZA, borderWidth: 1 },
        },
      ],
    },

    details: {
      height: 20,
      elements: [
        {
          id: 'item',
          type: 'label',
          x: 0,
          y: 3,
          width: 250,
          height: 12,
          // concatenação de campos, com a quantidade entre parênteses
          content: '{{code}} — {{name}} ({{qty}}x)',
          style: { fontSize: 9 },
        },
        {
          id: 'faixa',
          type: 'label',
          x: 260,
          y: 3,
          width: 80,
          height: 12,
          // condicional aninhado sobre o total calculado
          content:
            "{{IF(qty * unitPrice > 2000, 'ALTA', IF(qty * unitPrice > 500, 'MEDIA', 'BAIXA'))}}",
          style: { fontSize: 9, bold: true },
        },
        {
          id: 'total',
          type: 'label',
          x: 350,
          y: 3,
          width: 165,
          height: 12,
          // conta + máscara + moeda vinda de outro campo
          content: "{{currency}} {{FORMAT(qty * unitPrice, '#,##0.00')}}",
          style: { fontSize: 9, align: 'right' },
        },
        {
          id: 'sep',
          type: 'line',
          x: 0,
          y: 19,
          width: 515,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: '#DDDDDD', borderWidth: 0.5 },
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
          content: '{{UPPER(emitente)}} — gerado pelo Treeport',
          style: { fontSize: 8, color: CINZA },
        },
      ],
    },
  },
};

const pdf = await generateReport(tree, template, executor, {
  parameters: { offerId: 10, emitente: 'Treeport Logistica' },
  title: 'Taxas com expressoes',
});

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'output');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, 'expressions.pdf');
await writeFile(outPath, pdf);

console.log(`PDF gerado: ${outPath}`);
console.log('\nExpressões usadas neste relatório:');
console.log("  {{emitente}} — Oferta #{{offerId}}          (parâmetros)");
console.log('  {{code}} — {{name}} ({{qty}}x)              (concatenação)');
console.log("  {{IF(qty * unitPrice > 2000, 'ALTA', ...)}} (condicional aninhado)");
console.log("  {{FORMAT(qty * unitPrice, '#,##0.00')}}     (conta + máscara)");
console.log("  {{FORMAT(TODAY(), 'dd/MM/yyyy')}}           (data)");
