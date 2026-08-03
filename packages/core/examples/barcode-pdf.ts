/**
 * Exemplo da Fase 6 — códigos de barras e QR Code.
 *
 * Etiquetas de volume, no formato que um operador logístico imprime e cola na
 * carga: um Code 128 com o número do volume, um QR com a URL de rastreio, e os
 * dados do embarque ao lado.
 *
 * O QR gerado é escaneável de verdade — os testes decodificam o PNG com um
 * leitor (`jsqr`) e conferem que o conteúdo volta idêntico.
 *
 * Rodar:  pnpm example:phase6
 * Saída:  packages/core/examples/output/barcodes.pdf
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSourceTree, Template } from '@treeport/schema';
import { MemoryExecutor, generateReport } from '../src/index.js';

const SQL = 'SELECT * FROM shipment_volume WHERE shipment_id = :shipmentId';

const VOLUMES = [
  { id: 1, code: 'VOL-2026-0001', ean: '7891234567895', kind: 'Caixa', weight: 18.4, dest: 'Roterda' },
  { id: 2, code: 'VOL-2026-0002', ean: '7891234567901', kind: 'Caixa', weight: 22.1, dest: 'Roterda' },
  { id: 3, code: 'VOL-2026-0003', ean: '7891234567918', kind: 'Palete', weight: 340, dest: 'Hamburgo' },
];

const tree: DataSourceTree = {
  id: 'volume-tree',
  name: 'Volumes do embarque',
  parameters: [{ name: 'shipmentId', type: 'int', nullable: false, testValue: 1 }],
  root: { id: 'VOLUME', name: 'Volumes', sql: SQL },
};

const executor = new MemoryExecutor().on(SQL, () => VOLUMES);

const CINZA = '#555555';
const CLARO = '#888888';

const template: Template = {
  id: 'etiquetas',
  name: 'Etiquetas de volume',
  boundDataSourceNodeId: 'VOLUME',
  pageSize: 'A4',
  margins: { top: 40, right: 40, bottom: 40, left: 40 },

  bands: {
    header: {
      height: 44,
      elements: [
        {
          id: 'titulo',
          type: 'label',
          x: 0,
          y: 0,
          width: 515,
          height: 22,
          content: 'Etiquetas de Volume',
          style: { fontSize: 16, bold: true },
        },
        {
          id: 'sub',
          type: 'label',
          x: 0,
          y: 24,
          width: 515,
          height: 12,
          content: 'Embarque #{{shipmentId}} — Code 128, EAN-13 e QR de rastreio',
          style: { fontSize: 9, color: CLARO },
        },
      ],
    },

    details: {
      height: 150,
      elements: [
        // moldura da etiqueta
        {
          id: 'moldura',
          type: 'rect',
          x: 0,
          y: 6,
          width: 515,
          height: 132,
          style: { borderColor: CINZA, borderWidth: 1 },
        },

        // --- coluna esquerda: dados do volume ---
        {
          id: 'codigo',
          type: 'label',
          x: 14,
          y: 18,
          width: 250,
          height: 18,
          content: '{{code}}',
          style: { fontSize: 14, bold: true },
        },
        {
          id: 'tipo',
          type: 'label',
          x: 14,
          y: 40,
          width: 250,
          height: 12,
          content: '{{kind}} — {{FORMAT(weight, "#,##0.00")}} kg',
          style: { fontSize: 10, color: CINZA },
        },
        {
          id: 'destino',
          type: 'label',
          x: 14,
          y: 56,
          width: 250,
          height: 12,
          content: 'Destino: {{UPPER(dest)}}',
          style: { fontSize: 10, color: CINZA },
        },

        // Code 128 com o código do volume
        {
          id: 'bc-code',
          type: 'barcode',
          x: 14,
          y: 76,
          width: 240,
          height: 44,
          format: 'code128',
          valueExpression: 'code',
        },

        // --- coluna do meio: EAN-13 ---
        {
          id: 'lbl-ean',
          type: 'label',
          x: 280,
          y: 18,
          width: 120,
          height: 10,
          content: 'EAN-13',
          style: { fontSize: 8, bold: true, color: CLARO },
        },
        {
          id: 'bc-ean',
          type: 'barcode',
          x: 280,
          y: 32,
          width: 120,
          height: 82,
          format: 'ean13',
          valueExpression: 'ean',
          // os dígitos saem desenhados pelo próprio gerador, abaixo das barras
          includeText: true,
        },

        // --- coluna direita: QR de rastreio ---
        {
          id: 'lbl-qr',
          type: 'label',
          x: 420,
          y: 18,
          width: 82,
          height: 10,
          content: 'Rastreio',
          style: { fontSize: 8, bold: true, color: CLARO, align: 'center' },
        },
        {
          id: 'qr',
          type: 'qrcode',
          x: 420,
          y: 32,
          width: 82,
          height: 82,
          // a expressão monta a URL a partir do código do volume
          valueExpression: "{{'https://rastreio.exemplo.com/v/' + code}}",
        },
      ],
    },

    footer: {
      height: 18,
      elements: [
        {
          id: 'rodape',
          type: 'label',
          x: 0,
          y: 4,
          width: 515,
          height: 11,
          content: 'Gerado pelo Treeport',
          style: { fontSize: 8, color: CLARO },
        },
      ],
    },
  },
};

const pdf = await generateReport(tree, template, executor, {
  parameters: { shipmentId: 1 },
  title: 'Etiquetas de Volume',
  // scale maior deixa o código mais nítido na impressão
  barcodeOptions: { scale: 4 },
});

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'output');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, 'barcodes.pdf');
await writeFile(outPath, pdf);

console.log(`PDF gerado: ${outPath}\n`);
console.log('Volume          EAN-13          QR de rastreio');
for (const v of VOLUMES) {
  console.log(`  ${v.code}   ${v.ean}   .../v/${v.code}`);
}
console.log('\nOs codigos sao gerados com fundo branco e margem clara (quiet zone),');
console.log('senao um leitor optico nao consegue delimitar onde o codigo comeca.');
