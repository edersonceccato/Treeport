/**
 * Exemplo da Fase 5 — auto-grow em cascata (Anexo C do brief).
 *
 * Duas coisas acontecendo no mesmo relatório:
 *
 * 1. **Texto que quebra em várias linhas** empurra para baixo tudo que vem
 *    depois dele na mesma banda. As descrições têm tamanhos bem diferentes de
 *    propósito — repare que a linha de observação e o traço separador descem
 *    junto, sem sobrepor nada.
 *
 * 2. **Subreport de tamanho variável** faz o mesmo: o bloco de "total" fica
 *    depois da lista de taxas, então sua posição depende de quantas taxas
 *    aquele pedido tem.
 *
 * Sem `canGrow`, os elementos ficariam na posição absoluta declarada e o
 * conteúdo maior passaria por cima deles.
 *
 * Rodar:  pnpm example:phase5
 * Saída:  packages/core/examples/output/autogrow.pdf
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSourceTree, Template } from '@treeport/schema';
import { MemoryExecutor, generateReport } from '../src/index.js';

const SQL_ORDER = 'SELECT * FROM orders WHERE id = :orderId';
const SQL_ITEM = 'SELECT * FROM order_item WHERE order_id IN (:parentValues)';

// descrições de tamanhos bem diferentes, para o crescimento ficar visível
const ORDERS = [
  {
    id: 1,
    number: 'PED-001',
    customer: 'Acme Ltda',
    notes: 'Entrega urgente.',
  },
  {
    id: 2,
    number: 'PED-002',
    customer: 'Global Trading S.A.',
    notes:
      'Carga com necessidade de refrigeracao constante entre 2 e 8 graus, ' +
      'exige certificado sanitario emitido na origem e conferencia dupla no ' +
      'momento do embarque, conforme acordo comercial vigente.',
  },
  {
    id: 3,
    number: 'PED-003',
    customer: 'Nordeste Importacao',
    notes: 'Cliente solicita agendamento previo de descarga com 48h de antecedencia.',
  },
];

// quantidades diferentes de itens, para o subreport variar de altura
const ITEMS = [
  { id: 1, orderId: 1, name: 'Frete rodoviario', amount: 1200 },
  { id: 2, orderId: 1, name: 'Pedagio', amount: 180.5 },
  { id: 3, orderId: 2, name: 'Frete refrigerado', amount: 4300 },
  { id: 4, orderId: 2, name: 'Gerador de apoio', amount: 890 },
  { id: 5, orderId: 2, name: 'Monitoramento de temperatura', amount: 350 },
  { id: 6, orderId: 2, name: 'Seguro de carga', amount: 720.75 },
  { id: 7, orderId: 2, name: 'Certificado sanitario', amount: 210 },
  { id: 8, orderId: 3, name: 'Frete rodoviario', amount: 950 },
];

const tree: DataSourceTree = {
  id: 'order-tree',
  name: 'Pedidos',
  parameters: [{ name: 'orderId', type: 'int', nullable: true, testValue: null }],
  root: {
    id: 'ORDER',
    name: 'Pedido',
    sql: SQL_ORDER,
    children: [
      {
        id: 'ITEM',
        name: 'Itens',
        sql: SQL_ITEM,
        linkFields: { parentField: 'id', childField: 'orderId' },
        orderBy: 'amount DESC',
      },
    ],
  },
};

const inList = (p: Record<string, unknown>): string[] =>
  ((p['parentValues'] as unknown[]) ?? [p['parentValue']]).map(String);

const executor = new MemoryExecutor()
  // orderId nulo devolve todos os pedidos
  .on(SQL_ORDER, (p) =>
    p['orderId'] === null ? ORDERS : ORDERS.filter((o) => o.id === p['orderId']),
  )
  .on(SQL_ITEM, (p) => ITEMS.filter((i) => inList(p).includes(String(i.orderId))));

const CINZA = '#555555';
const CLARO = '#888888';

const template: Template = {
  id: 'autogrow',
  name: 'Auto-grow em cascata',
  boundDataSourceNodeId: 'ORDER',
  pageSize: 'A4',
  margins: { top: 40, right: 40, bottom: 40, left: 40 },

  bands: {
    header: {
      height: 46,
      elements: [
        {
          id: 'titulo',
          type: 'label',
          x: 0,
          y: 0,
          width: 515,
          height: 22,
          content: 'Pedidos — auto-grow em cascata',
          style: { fontSize: 16, bold: true },
        },
        {
          id: 'sub',
          type: 'label',
          x: 0,
          y: 24,
          width: 515,
          height: 12,
          content: 'Cada bloco ocupa so o espaco que precisa',
          style: { fontSize: 9, color: CLARO },
        },
        {
          id: 'regua',
          type: 'line',
          x: 0,
          y: 42,
          width: 515,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: CINZA, borderWidth: 1 },
        },
      ],
    },

    details: {
      height: 60,
      elements: [
        {
          id: 'numero',
          type: 'label',
          x: 0,
          y: 6,
          width: 515,
          height: 14,
          content: '{{number}} — {{customer}}',
          style: { fontSize: 12, bold: true },
        },

        // (1) texto de tamanho variável: com canGrow, empurra o que vem depois
        {
          id: 'obs',
          type: 'label',
          x: 0,
          y: 24,
          width: 515,
          height: 11,
          content: '{{notes}}',
          canGrow: true,
          style: { fontSize: 9, color: CINZA },
        },

        // (2) subreport de itens: altura depende de quantos itens o pedido tem
        {
          id: 'itens',
          type: 'subreport',
          x: 12,
          y: 40,
          width: 503,
          height: 13,
          dataSourceNodeId: 'ITEM',
          canGrow: true,
          template: {
            details: {
              height: 13,
              elements: [
                {
                  id: 'it-nome',
                  type: 'label',
                  x: 0,
                  y: 0,
                  width: 320,
                  height: 11,
                  content: '{{name}}',
                  style: { fontSize: 9 },
                },
                {
                  id: 'it-valor',
                  type: 'label',
                  x: 330,
                  y: 0,
                  width: 173,
                  height: 11,
                  content: "{{FORMAT(amount, '#,##0.00')}}",
                  style: { fontSize: 9, align: 'right' },
                },
              ],
            },
          },
        },

        // este bloco vem DEPOIS dos dois anteriores: sua posição final depende
        // do tamanho do texto de observação E da quantidade de itens
        {
          id: 'rodape-item',
          type: 'label',
          x: 0,
          y: 58,
          width: 515,
          height: 11,
          content: 'Pedido {{number}} — {{customer}}',
          style: { fontSize: 8, color: CLARO },
        },
        {
          id: 'sep',
          type: 'line',
          x: 0,
          y: 74,
          width: 515,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: '#DDDDDD', borderWidth: 0.5 },
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
  parameters: { orderId: null },
  title: 'Auto-grow em cascata',
});

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'output');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, 'autogrow.pdf');
await writeFile(outPath, pdf);

console.log(`PDF gerado: ${outPath}\n`);
console.log('Pedido   observacao   itens');
for (const order of ORDERS) {
  const itens = ITEMS.filter((i) => i.orderId === order.id).length;
  console.log(
    `  ${order.number}   ${String(order.notes.length).padStart(3)} chars   ${itens} item(ns)`,
  );
}
console.log('\nCada pedido ocupa uma altura diferente: o bloco de rodape e o');
console.log('separador descem conforme o texto e a lista de itens crescem.');
