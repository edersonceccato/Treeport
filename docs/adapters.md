# Adapters de banco

Todo acesso a banco no Treeport passa por uma interface de **um método só**:

```ts
interface Executor {
  execute(sql: string, params: Record<string, unknown>): Promise<DataRow[]>;
}
```

O `@treeport/core` não depende de driver nenhum — nem como dependência
opcional. Cada adapter mora no próprio pacote, então quem usa SQL Server nunca
instala `pg`.

| Pacote | Banco | Status |
|---|---|---|
| `@treeport/adapter-postgres` | PostgreSQL | ✅ |
| — | SQL Server, Firebird, MySQL, SQLite | escreva o seu (é curto) |

## PostgreSQL

```bash
npm install @treeport/adapter-postgres pg
```

```ts
import { Pool } from 'pg';
import { createPostgresExecutor } from '@treeport/adapter-postgres';
import { generateReport } from '@treeport/core';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const executor = createPostgresExecutor(pool);

const pdf = await generateReport(tree, template, executor, {
  parameters: { pedidoId: 1 },
});
```

`pg` é **peerDependency**: o adapter usa, mas quem escolhe a versão é a sua
aplicação. Funciona com `Pool` ou `Client`.

### Log das queries

```ts
const executor = createPostgresExecutor(pool, {
  onQuery: (sql, values) => logger.debug({ sql, values }, 'query do relatório'),
});
```

Recebe a SQL **já traduzida** — é o que o Postgres realmente executa.

### `IN (:parentValues)` vira `= ANY($1)`

Você escreve a query da forma natural e portável:

```sql
SELECT * FROM item WHERE pedido_id IN (:parentValues)
```

E o adapter traduz para:

```sql
SELECT * FROM item WHERE pedido_id = ANY($1)
```

Isso **não é cosmético**. Expandir para `IN ($1, $2, $3, ...)` teria dois
problemas sérios: estoura o limite de 65535 parâmetros do protocolo com poucos
milhares de linhas, e faz o planejador recompilar o plano a cada tamanho de
lista diferente. Com `= ANY($1)` a lista inteira vai como **um** parâmetro.

`NOT IN (:parentValues)` vira `<> ALL($1)` pelo mesmo motivo.

### Armadilha: `IS NULL` precisa de cast

Esta query **falha** no Postgres:

```sql
WHERE (:cliente IS NULL OR cliente = :cliente)   -- ❌
```

```
error: could not determine data type of parameter $1
```

Não é limitação do Treeport: o Postgres não consegue inferir o tipo de um
parâmetro que aparece só em `IS NULL`. Resolve-se com um cast explícito:

```sql
WHERE (:cliente::text IS NULL OR cliente = :cliente::text)   -- ✅
```

O padrão "filtro opcional" é comum em relatório, então vale memorizar. Use o
tipo certo: `::text`, `::int`, `::date`.

### Tipos que o driver devolve

O `pg` devolve alguns tipos como **string**, para não perder precisão:

| Tipo SQL | Vem como |
|---|---|
| `BIGINT`, `BIGSERIAL` | `string` |
| `NUMERIC`, `DECIMAL` | `string` |
| `INT`, `SMALLINT` | `number` |
| `DATE`, `TIMESTAMP` | `Date` |

Isso **não quebra nada** no Treeport:

- a ligação master/detail compara os valores normalizados como texto, então um
  `id` BIGINT (`'1'`) casa com um `pedido_id` BIGINT (`'1'`);
- as máscaras de formato e as expressões convertem string numérica
  automaticamente — `{{FORMAT(quantidade * valor, '#,##0.00')}}` funciona com
  `valor` vindo como `'120.00'`.

## Escrevendo um adapter para outro banco

São poucas linhas. O trabalho é traduzir `:nome` para o dialeto do driver, e o
`core` já oferece o tradutor:

```ts
import { normalizeNamedParameters, buildPositionalValues, type Executor } from '@treeport/core';

// SQL Server (mssql): usa @nome
const executor: Executor = {
  async execute(sql, params) {
    const { sql: text, order } = normalizeNamedParameters(sql, 'at-named');
    const request = pool.request();
    for (const name of order) request.input(name, params[name]);
    const result = await request.query(text);
    return result.recordset;
  },
};
```

Estilos disponíveis:

| Estilo | Formato | Bancos |
|---|---|---|
| `numbered` | `$1`, `$2` | PostgreSQL |
| `at-named` | `@nome` | SQL Server |
| `positional` | `?` | SQLite, MySQL |
| `colon-named` | `:nome` | Oracle, Firebird |

O tradutor respeita literais de string, comentários, identificadores entre
aspas/colchetes e o cast `::` do Postgres — `SELECT valor::int FROM t WHERE id = :id`
converte só o `:id`.

### O que o seu adapter precisa cobrir

1. **Parâmetros nomeados** → dialeto do driver (use `normalizeNamedParameters`).
2. **Lista do `IN (:parentValues)`** — cada banco tem sua forma. Se o seu não
   tiver um equivalente ao `= ANY()`, expanda para `IN (?, ?, ?)` mas **cuide do
   limite de parâmetros** do driver; alternativamente, use `strategy: 'per-row'`
   naquele nó.
3. **Devolver `Record<string, unknown>[]`** — a maioria dos drivers já devolve
   nesse formato.

Nada mais: sem transação, sem pool, sem migration. Isso é responsabilidade da
sua aplicação, que já sabe fazer.

## Testando sem banco

`MemoryExecutor` responde a partir de arrays em memória, e registra as queries:

```ts
import { MemoryExecutor } from '@treeport/core';

const executor = new MemoryExecutor()
  .on('SELECT * FROM pedido WHERE id = :id', [{ id: 1, cliente: 'Acme' }]);

executor.calls;  // log de tudo que foi executado
```

## Rodando os testes de integração

Os testes contra Postgres real só rodam quando há banco disponível — a suíte
continua verde em qualquer máquina sem ele.

```bash
pnpm pg:up      # sobe um Postgres descartável na porta 55432
pnpm test:pg    # roda a suíte inteira, incluindo a integração
pnpm pg:down    # derruba
```

Vale a pena existir porque há coisas que só o banco real confirma: o `= ANY($1)`
aceitando array, os tipos que o driver devolve, e a ligação master/detail
casando com eles.

## Exemplo executável

```bash
pnpm pg:up
TREEPORT_TEST_DATABASE_URL=postgres://postgres:treeport@localhost:55432/treeport pnpm example:phase8
```

Cria o schema, popula, e gera um PDF de pedidos com subreport de itens.
Fonte: [`packages/adapter-postgres/examples/postgres-report.ts`](../packages/adapter-postgres/examples/postgres-report.ts)
