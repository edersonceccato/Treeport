# Campos de controle e contextos de uso

A query pode devolver, além dos campos de negócio, campos que dizem ao motor
**como se comportar** — não para aparecer no PDF. Eles usam o prefixo `__`
(configurável) para o motor reconhecê-los sem configuração extra.

A regra de negócio mora inteira na sua SQL. O motor só lê o resultado:

```sql
SELECT
  p.*,
  CASE WHEN p.total >= 5000 THEN 'completo' ELSE 'compacto' END AS __templateId,
  CASE WHEN p.incoterm IS NULL THEN 1 ELSE 0 END                AS __block,
  CASE WHEN p.incoterm IS NULL
       THEN 'Informe o Incoterm antes de emitir o pedido'
       ELSE NULL END                                             AS __blockMessage,
  'pedido-' || p.numero || '.pdf'                                AS __arquivo
FROM pedido p
WHERE p.id = :pedidoId
```

## A função `generate`

Campos de controle exigem a função `generate`, que recebe um **conjunto** de
templates em vez de um só:

```ts
import { generate, TemplateRegistry } from '@treeport/core';

const registry = new TemplateRegistry([templateCompleto, templateCompacto]);

const { pdf, template, control } = await generate(tree, registry, executor, {
  parameters: { pedidoId: 1 },
  onGenerated: async (row, pdf) => {
    await salvarAnexo(String(row['__arquivo']), pdf);
  },
});
```

Para o caso simples — uma árvore, um template, sem campos de controle —
`generateReport` continua sendo o caminho mais direto.

## Os campos que o motor interpreta

### `__templateId` — qual layout usar

Quando presente, o motor busca esse id entre os templates registrados. A ordem
de prioridade:

1. o `templateId` **explícito** passado na chamada
2. o `__templateId` **calculado** pela query
3. o template único, quando só há um registrado

O explícito ganhar é intencional: quem chama a API sabe o que quer, e a query
é um default inteligente, não uma imposição.

### `__block` e `__blockMessage` — bloquear a emissão

Com `__block` verdadeiro, o motor lança `ReportBlockedError` **antes de
desenhar qualquer coisa** — nunca um PDF pela metade:

```ts
try {
  await generate(tree, registry, executor, { parameters: { pedidoId: 3 } });
} catch (err) {
  if (err instanceof ReportBlockedError) {
    mostrarAvisoAoUsuario(err.message);   // a __blockMessage da query
    console.log(err.row);                 // a linha inteira, para diagnóstico
    return;
  }
  throw err;
}
```

Isso replica a validação de campos obrigatórios do Report Builder de origem
(bloquear a emissão se faltar Incoterm, transportadora, anexo…), **sem a lib
saber o que está sendo validado**.

`__block` é lido de forma tolerante, porque cada banco devolve booleano de um
jeito: `true`, `1`, `'S'`, `'sim'`, `'y'`, `'t'` contam como verdadeiro;
`false`, `0`, `'N'`, `null` como falso.

### Qualquer outro campo `__`

O `core` **não trata de forma especial** — só repassa. Nome de arquivo,
classe de destino, flag de pós-processamento: a lib não sabe o que significam
no seu sistema, e é exatamente isso que a mantém agnóstica.

## `onGenerated`: o que fazer com o PDF pronto

```ts
onGenerated: async (rootRow, pdf) => {
  const nome = String(rootRow['__arquivo']);
  await anexarAoRegistro(rootRow['id'], nome, pdf);
}
```

Recebe a **linha inteira** do master, incluindo os campos de controle, e os
bytes do PDF. É por aqui que a aplicação faz o que o `core` não deve fazer:
anexar a um registro, nomear conforme uma regra sua, disparar um e-mail.

- É aguardado se for `async`.
- Um erro dentro dele **sobe** para quem chamou — a aplicação decide se um
  pós-processamento falho invalida a geração.
- Não é chamado quando a geração é bloqueada, nem quando o master não tem linhas.

## Prefixo customizado

Se `__` conflitar com uma convenção do seu banco:

```ts
await generate(tree, registry, executor, {
  controlFieldPrefix: 'ctl$',
});
```

## Tags de contexto de uso

Um template pode declarar em quais telas do sistema ele aparece:

```ts
const template: Template = {
  id: 'completo',
  // ...
  contexts: [
    { contextTag: 'pedido.imprimir' },
    { contextTag: 'pedido.email', parameterDefaults: { via: 'email' } },
  ],
};
```

O `core` **não interpreta** o significado da tag — para ele `"pedido.imprimir"`
é só uma string. Ele guarda, filtra e devolve; quem monta o menu "Imprimir
como…" é a sua aplicação, que sabe o que aquela tela significa.

```ts
registry.listForContext('pedido.imprimir');       // templates daquela tela
registry.parameterDefaultsFor('completo', 'pedido.email');  // { via: 'email' }
registry.listContextTags();                        // todas as tags existentes
registry.listForDataSource('pedido-tree');         // a aba "Modelos"
```

`parameterDefaults` permite a mesma tela abrir o relatório já com filtros
preenchidos, sem a aplicação repetir essa configuração em código.

## O que `generate` devolve

```ts
interface GenerateResult {
  pdf: Uint8Array;
  template: Template;        // o layout efetivamente usado
  rootRow: DataRow | undefined;
  control: ControlFields;    // os campos de controle já separados
}
```

Útil para logar qual layout foi escolhido, ou para a aplicação ler um campo de
controle sem precisar do hook.

## Lendo os campos por fora

```ts
import { readControlFields, stripControlFields } from '@treeport/core';

const control = readControlFields(row);
// { templateId: 'compacto', blocked: false, all: { templateId: 'compacto', arquivo: '...' } }

stripControlFields(row);   // a linha só com os campos de negócio
```

O motor **não** remove os campos de controle antes de renderizar: um
`{{__arquivo}}` numa expressão continua funcionando, caso você queira mesmo
imprimir um deles.

## Exemplo executável

```bash
pnpm example:phase7
```

Três pedidos: um usa o layout completo, outro o compacto (decidido pela query),
e o terceiro é bloqueado por falta de Incoterm — sem gerar arquivo nenhum.

Fonte: [`packages/core/examples/control-fields.ts`](../packages/core/examples/control-fields.ts)
