/**
 * Exemplo da Fase 8 — relatório saindo de um Postgres de verdade.
 *
 * Cria o schema, popula, resolve a árvore master/detail e gera o PDF.
 *
 * Precisa de um banco. Para subir um descartável:
 *
 *   docker run -d --rm --name treeport-pg \
 *     -e POSTGRES_PASSWORD=treeport -e POSTGRES_DB=treeport \
 *     -p 55432:5432 postgres:16-alpine
 *
 * Rodar:
 *   TREEPORT_TEST_DATABASE_URL=postgres://postgres:treeport@localhost:55432/treeport \
 *     pnpm example:phase8
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { DataSourceTree, Template } from '@treeport/schema';
import { generateReport } from '@treeport/core';
import { createPostgresExecutor } from '../src/index.js';

const url = process.env['TREEPORT_TEST_DATABASE_URL'];
if (!url) {
  console.error('Defina TREEPORT_TEST_DATABASE_URL para rodar este exemplo.');
  console.error('Veja o cabeçalho do arquivo para subir um Postgres com Docker.');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

// --- schema e dados de exemplo --------------------------------------------

await pool.query(`
  DROP TABLE IF EXISTS pedido_item;
  DROP TABLE IF EXISTS pedido_ex;

  CREATE TABLE pedido_ex (
    id      BIGSERIAL PRIMARY KEY,
    numero  VARCHAR(20)  NOT NULL,
    cliente VARCHAR(100) NOT NULL,
    emitido DATE         NOT NULL
  );

  CREATE TABLE pedido_item (
    id         BIGSERIAL PRIMARY KEY,
    pedido_id  BIGINT       NOT NULL REFERENCES pedido_ex(id),
    descricao  VARCHAR(100) NOT NULL,
    quantidade INT          NOT NULL,
    valor      NUMERIC(12,2) NOT NULL
  );

  INSERT INTO pedido_ex (numero, cliente, emitido) VALUES
    ('PED-001', 'Acme Comercio Exterior Ltda', '2026-08-03'),
    ('PED-002', 'Global Trading S.A.',         '2026-08-04'),
    ('PED-003', 'Nordeste Importacao',         '2026-08-05');

  INSERT INTO pedido_item (pedido_id, descricao, quantidade, valor) VALUES
    (1, 'Frete internacional',       1, 1500.00),
    (1, 'THC - Terminal Handling',   1,  300.50),
    (1, 'Armazenagem',               3,  120.00),
    (2, 'Frete rodoviario',          2,  475.00),
    (3, 'Frete aereo',               1, 4200.00),
    (3, 'Seguro de carga',           1,  380.25);
`);

// --- a árvore de dados -----------------------------------------------------

const tree: DataSourceTree = {
  id: 'pedido-tree',
  name: 'Pedidos',
  parameters: [{ name: 'cliente', type: 'string', nullable: true, testValue: null }],
  root: {
    id: 'PEDIDO',
    name: 'Pedido',
    // o cast ::text é exigência do Postgres quando o parâmetro só aparece em
    // IS NULL — sem ele, "could not determine data type of parameter"
    sql: `
      SELECT * FROM pedido_ex
      WHERE (:cliente::text IS NULL OR cliente ILIKE :cliente::text)
      ORDER BY numero
    `,
    children: [
      {
        id: 'ITEM',
        name: 'Itens',
        // o adapter converte este IN para = ANY($1) automaticamente
        sql: 'SELECT * FROM pedido_item WHERE pedido_id IN (:parentValues) ORDER BY id',
        linkFields: { parentField: 'id', childField: 'pedido_id' },
      },
    ],
  },
};

const CINZA = '#555555';

const template: Template = {
  id: 'pedidos-pg',
  name: 'Pedidos (Postgres)',
  boundDataSourceNodeId: 'PEDIDO',
  pageSize: 'A4',
  margins: { top: 40, right: 40, bottom: 40, left: 40 },
  bands: {
    header: {
      height: 44,
      elements: [
        {
          id: 'h',
          type: 'label',
          x: 0,
          y: 0,
          width: 515,
          height: 20,
          content: 'Pedidos',
          style: { fontSize: 16, bold: true },
        },
        {
          id: 'h2',
          type: 'label',
          x: 0,
          y: 24,
          width: 515,
          height: 12,
          content: 'Dados vindos de um PostgreSQL real',
          style: { fontSize: 9, color: CINZA },
        },
      ],
    },
    details: {
      height: 40,
      elements: [
        {
          id: 'ped',
          type: 'label',
          x: 0,
          y: 4,
          width: 515,
          height: 14,
          content: "{{numero}} — {{cliente}}  ({{FORMAT(emitido, 'dd/MM/yyyy')}})",
          style: { fontSize: 11, bold: true },
        },
        {
          id: 'itens',
          type: 'subreport',
          x: 14,
          y: 22,
          width: 500,
          height: 13,
          dataSourceNodeId: 'ITEM',
          canGrow: true,
          template: {
            details: {
              height: 13,
              elements: [
                {
                  id: 'd',
                  type: 'label',
                  x: 0,
                  y: 0,
                  width: 340,
                  height: 11,
                  content: '{{quantidade}}x {{descricao}}',
                  style: { fontSize: 9 },
                },
                {
                  id: 'v',
                  type: 'label',
                  x: 350,
                  y: 0,
                  width: 150,
                  height: 11,
                  // NUMERIC volta como string do driver; FORMAT lida com isso
                  content: "R$ {{FORMAT(quantidade * valor, '#,##0.00')}}",
                  style: { fontSize: 9, align: 'right' },
                },
              ],
            },
          },
        },
      ],
    },
    footer: {
      height: 18,
      elements: [
        {
          id: 'f',
          type: 'label',
          x: 0,
          y: 4,
          width: 515,
          height: 11,
          content: 'Gerado pelo Treeport a partir do PostgreSQL',
          style: { fontSize: 8, color: CINZA },
        },
      ],
    },
  },
};

// --- gerar -----------------------------------------------------------------

const queries: string[] = [];
const executor = createPostgresExecutor(pool, { onQuery: (sql) => queries.push(sql) });

const pdf = await generateReport(tree, template, executor, {
  parameters: { cliente: null },
  title: 'Pedidos',
});

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'output');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, 'pedidos-postgres.pdf');
await writeFile(outPath, pdf);

await pool.end();

console.log(`PDF gerado: ${outPath}\n`);
console.log(`Queries executadas: ${queries.length} (estratégia batched)`);
for (const sql of queries) {
  console.log(`  ${sql.trim().replace(/\s+/g, ' ').slice(0, 78)}`);
}
console.log('\nRepare que o "IN (:parentValues)" virou "= ANY($1)": e a forma');
console.log('correta no Postgres, e nao estoura o limite de parametros.');
