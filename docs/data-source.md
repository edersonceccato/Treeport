# Fonte de dados (árvore master/detail)

Uma fonte de dados no Treeport é uma **árvore de queries**: uma query *master* e,
penduradas nela, queries *detail* recursivas. Cada nó filho declara qual campo do
pai casa com qual campo dele — o equivalente a um JOIN, só que resolvido pelo
motor em tempo de execução, não pelo SQL.

Você escreve o SQL na mão. O Treeport nunca gera SQL, nunca inspeciona o schema
do seu banco e não depende de driver nenhum.

## Anatomia de um nó

```ts
interface DataSourceNode {
  id: string;                  // único na árvore inteira
  name: string;                // nome de exibição (aparece no Designer)
  sql: string;                 // sua query, com parâmetros :nomeados
  linkFields?: {               // ausente só no nó raiz
    parentField: string;       // campo da linha do PAI
    childField: string;        // campo deste nó que casa com o do pai
  };
  orderBy?: string;            // "campo" ou "campo DESC" (ordenação em memória)
  skipWhenNoRecords?: boolean; // default: true
  children?: DataSourceNode[]; // details (recursivo, profundidade livre)
}
```

## Exemplo de 3 níveis

```ts
import type { DataSourceTree } from '@treeport/schema';

const tree: DataSourceTree = {
  id: 'proposal-tree',
  name: 'Proposta comercial',
  parameters: [{ name: 'proposalId', type: 'int', nullable: false, testValue: 1 }],
  root: {
    id: 'PROPOSAL',
    name: 'Proposta',
    sql: 'SELECT * FROM proposal WHERE id = :proposalId',
    children: [
      {
        id: 'OFFER',
        name: 'Oferta de frete',
        sql: 'SELECT * FROM offer WHERE proposal_id IN (:parentValues)',
        linkFields: { parentField: 'id', childField: 'proposalId' },
        children: [
          {
            id: 'OFFER_FEE',
            name: 'Taxas',
            sql: 'SELECT * FROM offer_fee WHERE offer_id IN (:parentValues)',
            linkFields: { parentField: 'id', childField: 'offerId' },
            orderBy: 'amount DESC',
          },
        ],
      },
    ],
  },
};
```

## Parâmetros do motor: `:parentValue` e `:parentValues`

Além dos seus próprios parâmetros, o motor injeta o valor de ligação vindo do pai.
Qual dos dois você usa depende da **estratégia de resolução**:

| Estratégia | Parâmetro injetado | Sua query usa | Nº de queries |
|---|---|---|---|
| `batched` (default) | `:parentValues` (array) | `WHERE x IN (:parentValues)` | 1 por **nó** |
| `per-row` | `:parentValue` (escalar) | `WHERE x = :parentValue` | 1 por **linha do pai** |

`batched` roda uma query só por nível e agrupa em memória — é bem mais rápido e
é o default. Só use `per-row` quando a query do filho não puder ser reescrita
com `IN` (por exemplo, quando ela chama uma stored procedure por linha).

Dá para misturar as duas na mesma árvore:

```ts
await resolveDataSourceTree(tree, executor, {
  parameters: { proposalId: 1 },
  strategy: 'batched',
  strategyByNode: { OFFER_FEE: 'per-row' }, // só as taxas viram N+1
});
```

> **Importante:** as duas estratégias produzem exatamente o mesmo resultado — há
> um teste garantindo isso. Só muda o número de idas ao banco.

## Parâmetros do relatório

```ts
interface ReportParameter {
  name: string;
  type: 'string' | 'int' | 'decimal' | 'date' | 'boolean';
  size?: number;         // só para string
  defaultValue?: unknown;
  nullable: boolean;
  testValue?: unknown;   // usado no preview do Designer
}
```

Os valores são validados **antes de qualquer query rodar** — se faltar um
obrigatório, nada é executado no banco. A validação também converte tipos, o que
importa porque parâmetro vindo de query string HTTP chega sempre como texto:

```ts
validateParameters([{ name: 'id', type: 'int', nullable: false }], { id: '42' });
// -> { id: 42 }   (number, não string)
```

Booleanos entendem `true/false`, `1/0`, `sim/não`, `s/n`, `yes/no`.
String vazia (`''`) é tratada como ausente — é o que um formulário HTML manda
quando o campo não foi preenchido.

Passar um parâmetro **não declarado** é erro, de propósito: pega typo
(`propostaId` vs `proposalId`) que de outro jeito viraria um filtro silenciosamente
ignorado.

## O adapter de banco (`Executor`)

Todo o acesso a banco passa por uma interface de um método só:

```ts
interface Executor {
  execute(sql: string, params: Record<string, unknown>): Promise<DataRow[]>;
}
```

É isso. Qualquer banco serve — basta escrever o wrapper. Exemplo com `pg`:

```ts
import { Pool } from 'pg';
import { normalizeNamedParameters, buildPositionalValues } from '@treeport/core';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const executor: Executor = {
  async execute(sql, params) {
    // traduz :nome -> $1, $2... (o dialeto do Postgres)
    const { sql: text, order } = normalizeNamedParameters(sql, 'numbered');
    const values = buildPositionalValues(order, params);
    const result = await pool.query(text, values);
    return result.rows;
  },
};
```

Para SQL Server troque o estilo para `'at-named'` (`@nome`); para SQLite/MySQL,
`'positional'` (`?`). O tradutor respeita literais de string, comentários,
identificadores entre aspas/colchetes e o cast `::` do Postgres — ou seja,
`SELECT valor::int FROM t WHERE id = :id` converte só o `:id`.

### Testando sem banco

`MemoryExecutor` responde queries a partir de arrays em memória:

```ts
import { MemoryExecutor } from '@treeport/core';

const executor = new MemoryExecutor()
  .on('SELECT * FROM proposal WHERE id = :proposalId', [{ id: 1, customer: 'Acme' }]);

executor.calls; // log de todas as queries — útil para testar quantas rodaram
```

## Resultado resolvido

```ts
const dataSet = await resolveDataSourceTree(tree, executor, {
  parameters: { proposalId: 1 },
});
```

Cada linha vira um `ResolvedRow`, com os filhos aninhados indexados pelo `id` do nó:

```ts
interface ResolvedRow {
  data: Record<string, unknown>;             // a linha como veio do banco
  children: Record<string, ResolvedRow[]>;   // { OFFER: [...], ... }
}
```

```ts
for (const proposal of dataSet.rows) {
  for (const offer of proposal.children['OFFER'] ?? []) {
    for (const fee of offer.children['OFFER_FEE'] ?? []) {
      console.log(fee.data['name'], fee.data['amount']);
    }
  }
}
```

## Detalhes que evitam dor de cabeça

- **Ids como string vs number.** O `pg` devolve `BIGINT` como string. A ligação
  compara os valores normalizados como texto, então `1` casa com `'1'` — a
  ligação não quebra silenciosamente por causa do driver.
- **Nó vazio não derruba o relatório.** Com `skipWhenNoRecords` (default `true`),
  um filho sem linhas vira array vazio e os irmãos continuam resolvendo.
- **Master vazio encerra cedo.** Se a query master não retorna nada, nenhuma
  query de filho roda.
- **A árvore é validada antes das queries**: id duplicado, filho sem `linkFields`
  e raiz *com* `linkFields` são erros estruturais detectados antes do banco.
- **O motor não muta seus dados.** As linhas são clonadas na saída do executor.
- **`orderBy` é em memória.** Prefira ordenar no próprio SQL; o `orderBy` existe
  para o caso `batched`, em que as linhas de vários pais voltam misturadas numa
  query só.

## Exemplo executável

```bash
pnpm example:phase1
```

Fonte: [`packages/core/examples/proposal-offer-fees.ts`](../packages/core/examples/proposal-offer-fees.ts)
