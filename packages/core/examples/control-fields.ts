/**
 * Exemplo da Fase 7 — campos de controle e tags de contexto.
 *
 * A query decide coisas sobre a geração, sem a lib saber as regras do negócio:
 *
 *   __templateId    escolhe o layout (compacto ou completo) por valor do pedido
 *   __block         bloqueia a emissão quando falta dado obrigatório
 *   __blockMessage  explica ao usuário o que falta
 *   __arquivo       nome sugerido, repassado ao hook onGenerated
 *
 * Repare que o `CASE WHEN` que decide tudo isso está na SQL — o motor só lê o
 * resultado. É o que mantém a lib agnóstica de qualquer ERP.
 *
 * Rodar:  pnpm example:phase7
 * Saída:  packages/core/examples/output/pedido-*.pdf
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSourceTree, Template } from '@treeport/schema';
import {
  MemoryExecutor,
  TemplateRegistry,
  generate,
  ReportBlockedError,
} from '../src/index.js';

// --- A query, com os campos de controle calculados por CASE WHEN -----------

const SQL = `
  SELECT
    p.*,
    -- pedido grande usa o layout completo; pequeno, o compacto
    CASE WHEN p.total >= 5000 THEN 'completo' ELSE 'compacto' END AS __templateId,
    -- bloqueia a emissão se faltar dado obrigatório
    CASE WHEN p.incoterm IS NULL THEN 1 ELSE 0 END               AS __block,
    CASE WHEN p.incoterm IS NULL
         THEN 'Informe o Incoterm antes de emitir o pedido ' || p.numero
         ELSE NULL END                                            AS __blockMessage,
    -- nome sugerido do arquivo, repassado ao onGenerated
    'pedido-' || p.numero || '.pdf'                               AS __arquivo
  FROM pedido p
  WHERE p.id = :pedidoId
`;

/** O "banco": o CASE WHEN acima simulado em JS. */
const PEDIDOS = [
  { id: 1, numero: 'PED-001', cliente: 'Acme Ltda', incoterm: 'FOB', total: 8500 },
  { id: 2, numero: 'PED-002', cliente: 'Global Trading', incoterm: 'CIF', total: 1200 },
  { id: 3, numero: 'PED-003', cliente: 'Nordeste Imp.', incoterm: null, total: 3000 },
];

const executor = new MemoryExecutor().on(SQL, (params) =>
  PEDIDOS.filter((p) => p.id === params['pedidoId']).map((p) => ({
    ...p,
    __templateId: p.total >= 5000 ? 'completo' : 'compacto',
    __block: p.incoterm === null ? 1 : 0,
    __blockMessage:
      p.incoterm === null ? `Informe o Incoterm antes de emitir o pedido ${p.numero}` : null,
    __arquivo: `pedido-${p.numero}.pdf`,
  })),
);

const tree: DataSourceTree = {
  id: 'pedido-tree',
  name: 'Pedido',
  parameters: [{ name: 'pedidoId', type: 'int', nullable: false, testValue: 1 }],
  root: { id: 'PEDIDO', name: 'Pedido', sql: SQL },
};

// --- Dois layouts para a mesma árvore de dados (a aba "Modelos") -----------

const CINZA = '#555555';

function base(id: string, titulo: string): Template {
  return {
    id,
    name: titulo,
    dataSourceId: 'pedido-tree',
    boundDataSourceNodeId: 'PEDIDO',
    pageSize: 'A4',
    margins: { top: 40, right: 40, bottom: 40, left: 40 },
    // em quais telas do sistema este layout aparece
    contexts: [
      { contextTag: 'pedido.imprimir' },
      { contextTag: 'pedido.email', parameterDefaults: { via: 'email' } },
    ],
    bands: { details: { height: 0, elements: [] } },
  };
}

const completo: Template = {
  ...base('completo', 'Pedido — layout completo'),
  bands: {
    header: {
      height: 40,
      elements: [
        {
          id: 'h',
          type: 'label',
          x: 0,
          y: 0,
          width: 515,
          height: 20,
          content: 'PEDIDO {{numero}}',
          style: { fontSize: 16, bold: true },
        },
        {
          id: 'h2',
          type: 'label',
          x: 0,
          y: 22,
          width: 515,
          height: 12,
          content: 'Layout completo (pedidos acima de R$ 5.000)',
          style: { fontSize: 9, color: CINZA },
        },
      ],
    },
    details: {
      height: 70,
      elements: [
        {
          id: 'cli',
          type: 'label',
          x: 0,
          y: 0,
          width: 515,
          height: 14,
          content: 'Cliente: {{cliente}}',
          style: { fontSize: 11 },
        },
        {
          id: 'inc',
          type: 'label',
          x: 0,
          y: 18,
          width: 515,
          height: 12,
          content: 'Incoterm: {{incoterm}}',
          style: { fontSize: 10, color: CINZA },
        },
        {
          id: 'tot',
          type: 'label',
          x: 0,
          y: 36,
          width: 515,
          height: 16,
          content: "Total: R$ {{FORMAT(total, '#,##0.00')}}",
          style: { fontSize: 13, bold: true },
        },
      ],
    },
  },
};

const compacto: Template = {
  ...base('compacto', 'Pedido — layout compacto'),
  bands: {
    details: {
      height: 30,
      elements: [
        {
          id: 'l',
          type: 'label',
          x: 0,
          y: 0,
          width: 515,
          height: 14,
          content: "{{numero}} — {{cliente}} — R$ {{FORMAT(total, '#,##0.00')}}",
          style: { fontSize: 11 },
        },
        {
          id: 'l2',
          type: 'label',
          x: 0,
          y: 16,
          width: 515,
          height: 11,
          content: 'Layout compacto (pedidos até R$ 5.000)',
          style: { fontSize: 8, color: CINZA },
        },
      ],
    },
  },
};

const registry = new TemplateRegistry([completo, compacto]);

// --- Gerar os três pedidos -------------------------------------------------

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'output');
await mkdir(outDir, { recursive: true });

console.log('Gerando os 3 pedidos:\n');

for (const pedido of PEDIDOS) {
  try {
    const result = await generate(tree, registry, executor, {
      parameters: { pedidoId: pedido.id },
      // a aplicação hospedeira decide o que fazer com o PDF pronto
      onGenerated: async (row, pdf) => {
        const nome = String(row['__arquivo'] ?? `pedido-${pedido.id}.pdf`);
        await writeFile(join(outDir, nome), pdf);
      },
    });

    console.log(
      `  ${pedido.numero}  R$ ${String(pedido.total).padStart(5)}  ` +
        `-> template "${result.template.id}"  (${result.control.all['arquivo']})`,
    );
  } catch (err) {
    if (err instanceof ReportBlockedError) {
      console.log(`  ${pedido.numero}  BLOQUEADO: ${err.message}`);
      continue;
    }
    throw err;
  }
}

// --- Tags de contexto (Anexo B) -------------------------------------------

console.log('\nTemplates por contexto de uso:');
for (const tag of registry.listContextTags()) {
  const ids = registry.listForContext(tag).map((t) => t.id);
  console.log(`  ${tag.padEnd(18)} -> ${ids.join(', ')}`);
}

const defaults = registry.parameterDefaultsFor('completo', 'pedido.email');
console.log(`\nDefaults do contexto "pedido.email": ${JSON.stringify(defaults)}`);
console.log('\nO PED-003 nao gerou PDF: a query bloqueou por falta de Incoterm,');
console.log('antes de desenhar qualquer coisa.');
