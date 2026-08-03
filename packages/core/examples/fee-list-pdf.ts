/**
 * Exemplo da Fase 2 — do banco ao PDF.
 *
 * Monta uma lista de taxas (o cenário real do autor), liga a árvore de dados a
 * um template com Header/Details/Footer e gera um PDF de verdade em disco.
 *
 * São 60 taxas de propósito: assim o relatório passa de uma página e dá para
 * conferir visualmente que o cabeçalho e o rodapé se repetem em todas.
 *
 * Rodar:  pnpm example:phase2
 * Saída:  packages/core/examples/output/fee-list.pdf
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSourceTree, Template } from '@treeport/schema';
import { MemoryExecutor, generateReport } from '../src/index.js';

// --- 1. Dados fake (num projeto real, viria do banco via Executor) ---------

const SQL_FEES = 'SELECT * FROM offer_fee WHERE offer_id = :offerId';

const TIPOS = [
  'Frete internacional',
  'THC - Terminal Handling',
  'Armazenagem',
  'Desconsolidação',
  'Liberação de BL',
  'Taxa de emissão',
];

const FEES = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  offerId: 10,
  code: `TX-${String(i + 1).padStart(4, '0')}`,
  name: `${TIPOS[i % TIPOS.length]}`,
  currency: i % 3 === 0 ? 'USD' : 'BRL',
  amount: Math.round((150 + i * 37.5) * 100) / 100,
}));

// --- 2. A árvore de fonte de dados ----------------------------------------

const tree: DataSourceTree = {
  id: 'fee-tree',
  name: 'Taxas da oferta',
  parameters: [{ name: 'offerId', type: 'int', nullable: false, testValue: 10 }],
  root: {
    id: 'FEE',
    name: 'Taxas',
    sql: SQL_FEES,
  },
};

const executor = new MemoryExecutor().on(SQL_FEES, (p) =>
  FEES.filter((f) => f.offerId === p['offerId']),
);

// --- 3. O template (nesta fase, JSON escrito à mão) ------------------------
// A partir da Fase 9 este JSON sai pronto do designer visual.

const CINZA = '#555555';
const LINHA = '#CCCCCC';

const template: Template = {
  id: 'fee-list',
  name: 'Relatorio de Taxas',
  boundDataSourceNodeId: 'FEE',
  pageSize: 'A4',
  margins: { top: 40, right: 40, bottom: 40, left: 40 },

  bands: {
    // Header: repete no topo de toda página, como um timbrado
    header: {
      height: 60,
      elements: [
        {
          id: 'titulo',
          type: 'label',
          x: 0,
          y: 0,
          width: 400,
          height: 22,
          content: 'Relatorio de Taxas',
          style: { fontSize: 18, bold: true },
        },
        {
          id: 'subtitulo',
          type: 'label',
          x: 0,
          y: 24,
          width: 400,
          height: 14,
          content: 'Oferta de frete #10 — Santos / Roterda',
          style: { fontSize: 10, color: CINZA },
        },
        // cabeçalho das colunas
        {
          id: 'th-codigo',
          type: 'label',
          x: 0,
          y: 44,
          width: 70,
          height: 12,
          content: 'Codigo',
          style: { fontSize: 9, bold: true, color: CINZA },
        },
        {
          id: 'th-desc',
          type: 'label',
          x: 75,
          y: 44,
          width: 250,
          height: 12,
          content: 'Descricao',
          style: { fontSize: 9, bold: true, color: CINZA },
        },
        {
          id: 'th-moeda',
          type: 'label',
          x: 330,
          y: 44,
          width: 50,
          height: 12,
          content: 'Moeda',
          style: { fontSize: 9, bold: true, color: CINZA },
        },
        {
          id: 'th-valor',
          type: 'label',
          x: 385,
          y: 44,
          width: 130,
          height: 12,
          content: 'Valor',
          style: { fontSize: 9, bold: true, color: CINZA, align: 'right' },
        },
        {
          id: 'linha-header',
          type: 'line',
          x: 0,
          y: 58,
          width: 515,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: CINZA, borderWidth: 1 },
        },
      ],
    },

    // Details: repete uma vez por linha de dados
    details: {
      height: 18,
      elements: [
        {
          id: 'codigo',
          type: 'field',
          x: 0,
          y: 2,
          width: 70,
          height: 12,
          fieldName: 'code',
          style: { fontSize: 9 },
        },
        {
          id: 'descricao',
          type: 'field',
          x: 75,
          y: 2,
          width: 250,
          height: 12,
          fieldName: 'name',
          style: { fontSize: 9 },
        },
        {
          id: 'moeda',
          type: 'field',
          x: 330,
          y: 2,
          width: 50,
          height: 12,
          fieldName: 'currency',
          style: { fontSize: 9 },
        },
        {
          id: 'valor',
          type: 'field',
          x: 385,
          y: 2,
          width: 130,
          height: 12,
          fieldName: 'amount',
          format: '#,##0.00',
          style: { fontSize: 9, align: 'right' },
        },
        {
          id: 'separador',
          type: 'line',
          x: 0,
          y: 17,
          width: 515,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: LINHA, borderWidth: 0.5 },
        },
      ],
    },

    // Footer: ancorado na base de toda página
    footer: {
      height: 24,
      elements: [
        {
          id: 'linha-footer',
          type: 'line',
          x: 0,
          y: 0,
          width: 515,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: CINZA, borderWidth: 0.5 },
        },
        {
          id: 'rodape',
          type: 'label',
          x: 0,
          y: 6,
          width: 300,
          height: 12,
          content: 'Gerado pelo Treeport',
          style: { fontSize: 8, color: CINZA },
        },
      ],
    },
  },
};

// --- 4. Gerar o PDF --------------------------------------------------------

const pdf = await generateReport(tree, template, executor, {
  parameters: { offerId: 10 },
  title: 'Relatorio de Taxas',
  author: 'Treeport',
});

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'output');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, 'fee-list.pdf');
await writeFile(outPath, pdf);

console.log(`PDF gerado: ${outPath}`);
console.log(`${FEES.length} taxas, ${(pdf.byteLength / 1024).toFixed(1)} KB`);
console.log('Abra o arquivo para conferir que header e footer repetem em todas as páginas.');
