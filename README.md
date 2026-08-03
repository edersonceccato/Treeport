# Treeport

Motor de relatórios estilo *Report Builder* (SSRS / FastReport / JasperReports)
nativo em TypeScript, para Node e web.

A ideia central é a mesma dos Report Builders clássicos: uma **árvore de fonte de
dados** (uma query master, com queries detail recursivas penduradas nela), um
**template de layout** organizado em bandas, e um motor que junta os dois e
cospe um PDF.

O que diferencia:

- **Agnóstico de banco.** Você escreve seu SQL e injeta um adapter de um método
  só. Postgres, SQL Server, Firebird, SQLite, MySQL ou uma API HTTP — o `core`
  não conhece driver nenhum.
- **Agnóstico de framework de UI.** O designer visual é um Web Component: roda
  igual em React, Vue, Angular, Next.js ou HTML puro.
- **Subreports aninhados em profundidade livre**, que é o que falta na maioria
  das libs de PDF em JS.
- **Campos calculados** com expressões `{{VALOR_A + VALOR_B}}`, avaliadas por um
  parser próprio — sem `eval()`, porque templates vêm do banco.

## Status

🚧 Em construção, por fases. **Fase 7 concluída: metadados de controle.**

| Fase | Escopo | Status |
|---|---|---|
| 1 | Árvore de dados, resolução master/detail, parâmetros, `Executor` | ✅ |
| 2 | Renderização PDF básica (Header/Details/Footer, Label/Field) | ✅ |
| 3 | Motor de expressões `{{...}}` | ✅ |
| 4 | Subreports aninhados | ✅ |
| 5 | Auto-grow em cascata | ✅ |
| 6 | Barcode e QRCode | ✅ |
| 7 | Metadados de controle (`__block`, `__templateId`) e contexto | ✅ |
| 8 | Adapters de banco reais (Postgres primeiro) | ⬜ |
| 9 | Designer visual web (Web Component) | ⬜ |
| 10 | Persistência e documentação final | ⬜ |

## Pacotes

| Pacote | Onde roda | Para que serve |
|---|---|---|
| `@treeport/schema` | qualquer lugar | Tipos e validação compartilhados — a "spec" |
| `@treeport/core` | backend | Árvore de dados, expressões, renderização PDF |
| `@treeport/designer` | frontend | Designer drag-and-drop (Web Component) |

`core` e `designer` não dependem um do outro em runtime: compartilham só o
schema JSON do `Template`/`DataSourceTree` como contrato.

## Exemplo mínimo: do banco ao PDF

```ts
import { generateReport } from '@treeport/core';
import type { DataSourceTree, Template } from '@treeport/schema';

const tree: DataSourceTree = {
  id: 'fee-tree',
  name: 'Taxas',
  parameters: [{ name: 'offerId', type: 'int', nullable: false }],
  root: { id: 'FEE', name: 'Taxas', sql: 'SELECT * FROM offer_fee WHERE offer_id = :offerId' },
};

const template: Template = {
  id: 'fee-list',
  name: 'Relatório de Taxas',
  boundDataSourceNodeId: 'FEE',
  pageSize: 'A4',
  bands: {
    header: {
      height: 30,
      elements: [{
        id: 't', type: 'label', x: 0, y: 0, width: 400, height: 20,
        content: 'Relatório de Taxas', style: { fontSize: 16, bold: true },
      }],
    },
    details: {
      height: 18,
      elements: [
        { id: 'n', type: 'field', x: 0, y: 0, width: 300, height: 12, fieldName: 'name' },
        {
          id: 'v', type: 'field', x: 320, y: 0, width: 120, height: 12,
          fieldName: 'amount', format: '#,##0.00', style: { align: 'right' },
        },
      ],
    },
  },
};

const pdf = await generateReport(tree, template, executor, { parameters: { offerId: 10 } });
await writeFile('taxas.pdf', pdf);
```

Header e footer repetem em toda página, os detalhes quebram de página sozinhos.

## Só a árvore de dados

```ts
import { MemoryExecutor, resolveDataSourceTree } from '@treeport/core';
import type { DataSourceTree } from '@treeport/schema';

const tree: DataSourceTree = {
  id: 'proposal-tree',
  name: 'Proposta comercial',
  parameters: [{ name: 'proposalId', type: 'int', nullable: false }],
  root: {
    id: 'PROPOSAL',
    name: 'Proposta',
    sql: 'SELECT * FROM proposal WHERE id = :proposalId',
    children: [
      {
        id: 'OFFER',
        name: 'Ofertas',
        sql: 'SELECT * FROM offer WHERE proposal_id IN (:parentValues)',
        linkFields: { parentField: 'id', childField: 'proposalId' },
      },
    ],
  },
};

const dataSet = await resolveDataSourceTree(tree, executor, {
  parameters: { proposalId: 1 },
});

for (const proposal of dataSet.rows) {
  console.log(proposal.data['customer']);
  for (const offer of proposal.children['OFFER'] ?? []) {
    console.log('  ', offer.data['route']);
  }
}
```

Conectando num banco de verdade, o `executor` é só isto:

```ts
import { Pool } from 'pg';
import { normalizeNamedParameters, buildPositionalValues } from '@treeport/core';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const executor = {
  async execute(sql: string, params: Record<string, unknown>) {
    const { sql: text, order } = normalizeNamedParameters(sql, 'numbered');
    const { rows } = await pool.query(text, buildPositionalValues(order, params));
    return rows;
  },
};
```

## Desenvolvimento

```bash
pnpm install
pnpm test            # roda a suíte (Vitest)
pnpm typecheck       # TypeScript em modo estrito
pnpm build           # compila os pacotes
pnpm example:phase1  # árvore de dados de 3 níveis (imprime no console)
pnpm example:phase2  # gera um PDF de 2 páginas em examples/output/
pnpm example:phase3  # PDF com labels calculados por expressão
pnpm example:phase4  # proposta > ofertas > taxas/embalagens (3 níveis)
pnpm example:phase5  # blocos que crescem e empurram o que vem depois
pnpm example:phase6  # etiquetas com Code 128, EAN-13 e QR de rastreio
pnpm example:phase7  # a query escolhe o layout e bloqueia emissão inválida
```

## Documentação

- [Fonte de dados](docs/data-source.md) — árvore master/detail, parâmetros, adapters
- [Template](docs/template-schema.md) — bandas, elementos, estilos, máscaras de formato
- [Expressões](docs/expressions.md) — sintaxe `{{...}}`, funções, escopo `parent`
- [Subreports](docs/subreports.md) — nós aninhados, auto-grow, quebra de página
- [Auto-grow](docs/auto-grow.md) — `canGrow`, deslocamento em cascata, medição
- [Códigos e imagens](docs/barcodes.md) — barcode, QR Code, `ImageElement`
- [Campos de controle](docs/control-fields.md) — `__block`, `__templateId`, contextos

Os demais documentos (`storage.md`, `designer-ui.md`) entram junto com as fases
correspondentes.

## Licença

MIT
