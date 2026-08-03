# Expressões

Um Label pode conter expressões entre `{{ }}`, resolvidas em tempo de
renderização contra a linha de dados atual:

```json
{ "type": "label", "content": "{{NOME}} - Total: {{VALOR_A + VALOR_B}}" }
```

Com `NOME = "João"`, `VALOR_A = 100` e `VALOR_B = 50`, sai
`João - Total: 150`.

Texto e expressão se misturam livremente, e o mesmo texto pode ter vários
`{{ }}`. Um Label sem `{{ }}` é literal — nada é interpretado.

> **Sem `eval`.** A expressão passa por um tokenizer e um parser descendente
> recursivo escritos à mão. Isso não é detalhe de implementação: templates são
> salvos no banco e podem ser editados por qualquer usuário da sua aplicação,
> então um `eval()` ali seria execução arbitrária de código no seu servidor.
> Nomes como `constructor`, `__proto__` ou `process` não resolvem para nada —
> só colunas de verdade da linha contam como campo.

## Campos

Referencie a coluna pelo nome exato que a query devolveu:

```
{{VALOR_TOTAL}}
{{nome_cliente}}
```

Campo nulo vira string vazia — nunca `null` no PDF.

Campo que **não existe** é erro, com a lista dos campos disponíveis na
mensagem. Isso é proposital: um typo silencioso vira um relatório em branco em
produção, que é bem pior de descobrir. Para afrouxar (útil em preview):

```ts
await renderReport(template, dataSet, { expressionOptions: { strict: false } });
```

## Operadores

| Categoria | Operadores |
|---|---|
| Aritmética | `+` `-` `*` `/` `%` |
| Comparação | `==` `!=` `<` `<=` `>` `>=` |
| Lógica | `&&` `\|\|` `!` |
| Agrupamento | `( )` |

`=` e `<>` também funcionam, como sinônimos de `==` e `!=` — quem vem de SQL
escreve assim por reflexo.

A precedência é a usual: `2 + 3 * 4` dá `14`, e `(2 + 3) * 4` dá `20`.

### Detalhes que evitam surpresa

- **`+` soma ou concatena** conforme os operandos. `'100' + '50'` dá `150`
  (ambos são numéricos), mas `'Total: ' + 150` dá `'Total: 150'`. Isso importa
  porque drivers devolvem `DECIMAL` como string.
- **Divisão por zero dá `0`**, não `Infinity`. Um relatório com `Infinity`
  impresso é pior que um com zero.
- **`null` na aritmética conta como `0`.**
- **`&&` e `||` têm curto-circuito** — o lado direito só é avaliado se preciso.
- **Comparação é tolerante:** `VALOR == 100` é verdadeiro com `VALOR` sendo
  `100` ou `'100'`.

## Funções

### Condicional

| Função | O que faz |
|---|---|
| `IF(cond, seVerdadeiro, seFalso)` | Escolhe entre dois valores |
| `COALESCE(a, b, ...)` | Primeiro valor não nulo/vazio |
| `ISNULL(v)` | `true` se nulo ou vazio |

`IF` só avalia o ramo escolhido, então isto é seguro:

```
{{IF(ISNULL(QTD), 0, TOTAL / QTD)}}
```

E aninha:

```
{{IF(V > 1000, 'ALTA', IF(V > 500, 'MEDIA', 'BAIXA'))}}
```

### Texto

| Função | Exemplo | Resultado |
|---|---|---|
| `UPPER(v)` | `UPPER('frete')` | `FRETE` |
| `LOWER(v)` | `LOWER('FRETE')` | `frete` |
| `TRIM(v)` | `TRIM('  x  ')` | `x` |
| `LEN(v)` | `LEN('abc')` | `3` |
| `CONCAT(...)` | `CONCAT('a','b')` | `ab` |
| `SUBSTR(v, ini, tam)` | `SUBSTR('ABCDEF', 1, 3)` | `ABC` |
| `REPLACE(v, de, para)` | `REPLACE('a-b','-','/')` | `a/b` |
| `PAD(v, tam, char)` | `PAD('7', 3, '0')` | `007` |

`SUBSTR` é **1-based**, como em SQL.

### Número

`ROUND(v, casas)` · `FLOOR(v)` · `CEIL(v)` · `ABS(v)` · `MIN(...)` · `MAX(...)`

### Data

`TODAY()` · `NOW()` · `YEAR(v)` · `MONTH(v)` · `DAY(v)`

### Conversão

| Função | O que faz |
|---|---|
| `FORMAT(v, máscara)` | As mesmas máscaras do `FieldElement` |
| `NUMBER(v)` | Converte para número |
| `TEXT(v)` | Converte para texto |

```
{{FORMAT(QTD * VALOR, '#,##0.00')}}   ->  1.500,00
{{FORMAT(DATA, 'dd/MM/yyyy')}}        ->  03/08/2026
```

Nome de função é case-insensitive: `upper()` e `UPPER()` são a mesma coisa.

### Funções próprias

```ts
await renderReport(template, dataSet, {
  expressionOptions: {
    functions: {
      PESO_CUBADO: (m3) => Number(m3) * 167,
    },
  },
});
```

```
{{FORMAT(PESO_CUBADO(CUBAGEM), '#,##0.00')}} kg
```

## Escopo: `current` e `parent`

Dentro de um subreport (Fase 4), a expressão enxerga uma **corrente de
escopos**: a linha do nó atual, a do pai, a do avô, e assim por diante.

```
{{NOME}}                      linha atual
{{current.NOME}}              o mesmo, explícito
{{parent.CLIENTE}}            campo do nó pai
{{parent.parent.NUMERO}}      dois níveis acima
```

Um nome solto que não existe na linha atual **sobe a corrente sozinho**:

```
{{ROTA}}    encontra ROTA na oferta, mesmo estando na banda de taxas
```

Isso replica o comportamento do Report Builder de origem, onde o usuário
escreve só o nome do campo. Quando o mesmo nome existe em dois níveis, a linha
atual ganha — use `parent.` para ser explícito.

`parent` fora de um subreport é erro, com mensagem dizendo isso.

## Parâmetros do relatório

Os parâmetros ficam visíveis pelo nome, em qualquer nível:

```json
{ "content": "Oferta #{{offerId}} — emitida por {{emitente}}" }
```

Com `generateReport` isso funciona sozinho. Chamando `renderReport` direto,
passe-os:

```ts
await renderReport(template, dataSet, { parameters: { offerId: 10 } });
```

## Onde as expressões valem

| Lugar | Como |
|---|---|
| `label.content` | `{{ }}` no meio do texto |
| `label.content` com `isExpression: true` | O conteúdo inteiro é expressão, sem `{{ }}` |
| `field.fieldName` | Se contiver `{{ }}`; senão é nome de coluna direto |
| `barcode.valueExpression` / `qrcode.valueExpression` | Fase 6 |

O `isExpression` existe para o Designer saber qual editor abrir. Um texto com
`{{ }}` é interpolado **mesmo sem o flag** — exigir os dois seria uma pegadinha
(o usuário escreveria a expressão, esqueceria o flag e veria `{{VALOR}}` cru no
PDF).

## Desempenho

Cada texto é compilado uma vez para uma árvore sintática e reaproveitado em
todas as linhas — numa lista de 5.000 registros a expressão é parseada 1 vez,
não 5.000.

## Erros

Erro de sintaxe aponta a posição:

```
Esperava ")" para fechar o parêntese
  IF(A > 1, 'x'
               ^
```

Erro de campo mostra o que existe e em qual texto do template aconteceu:

```
Campo "CLEINTE" não existe na linha atual nem nos escopos acima.
Campos disponíveis: CLIENTE, VALOR, DATA.
  Expressão: {{CLEINTE}}
  Em: "Cliente: {{CLEINTE}}"
```

## Exemplo executável

```bash
pnpm example:phase3
```

Gera `packages/core/examples/output/expressions.pdf`.
Fonte: [`packages/core/examples/expressions-pdf.ts`](../packages/core/examples/expressions-pdf.ts)
