# Subreports

Um subreport é **o design de um nó filho da árvore de dados**, embutido dentro
de uma banda do nó pai. Não é uma banda separada — é um elemento como qualquer
outro, que por acaso desenha bandas inteiras dentro de si.

É o que permite o cenário clássico de proposta comercial:

```
Proposta (master)
  └─ Oferta de frete          subreport no Details da proposta
       ├─ Taxas               subreport no Details da oferta
       └─ Embalagens          subreport no Details da oferta
```

A profundidade é livre: subreport dentro de subreport dentro de subreport.

## O elemento

```ts
{
  id: 'sub-taxas',
  type: 'subreport',
  x: 12, y: 34, width: 490, height: 14,
  dataSourceNodeId: 'OFFER_FEE',   // qual nó da árvore alimenta este subreport
  canGrow: true,                    // empurra o que estiver abaixo dele
  template: {                       // as bandas próprias deste nó
    details: { height: 13, elements: [ /* ... */ ] },
  },
}
```

`dataSourceNodeId` tem que ser um **filho** (em qualquer profundidade) do nó em
que o subreport está. O motor pega as linhas de
`resolvedRow.children[dataSourceNodeId]` — que é exatamente o que o resolver da
Fase 1 montou.

## Bandas dentro do subreport

Cada subreport tem seu próprio conjunto, escopado a ele:

| Banda | Quantas vezes |
|---|---|
| `header` | **1x**, no início da lista daquele nó |
| `details` | **1x por linha** daquele nó |
| `footer` | **1x**, no fim da lista |

> **Pegadinha comum:** o `header` aparece **uma vez só**, não uma por linha.
> Um título que muda a cada registro (`Oferta {{route}}`) pertence ao
> `details`, não ao `header`. No `header` cabe o que é fixo: "OPÇÕES DE
> EMBARQUE", cabeçalho de colunas, etc.

O `header` recebe a **primeira** linha como contexto de dados e o `footer`, a
**última** — útil para um total no rodapé que ainda precisa alcançar campos do
pai.

## Acessando campos do pai

Dentro de um subreport, a expressão enxerga a corrente de escopos inteira
(ver [expressões](expressions.md)):

```
{{name}}                     campo da linha atual (a taxa)
{{parent.route}}             campo da oferta
{{parent.parent.customer}}   campo da proposta
```

E um nome solto que não existe na linha atual **sobe a corrente sozinho**:

```
{{customer}}   acha o campo da proposta mesmo estando na banda de taxas
```

Os parâmetros do relatório continuam visíveis em qualquer profundidade.

Isso vale também para `FieldElement`: um campo não encontrado na linha atual é
procurado nos escopos acima.

## Auto-grow em cascata

Um subreport tem **altura variável** — depende de quantas linhas o nó devolveu
naquela execução. Elementos posicionados **abaixo** dele precisam descer junto,
senão o layout se sobrepõe.

Marque `canGrow: true` no subreport (e em qualquer elemento que cresça):

```ts
elements: [
  { id: 'taxas',  type: 'subreport', y: 34, height: 14, canGrow: true, /* ... */ },
  { id: 'emb',    type: 'subreport', y: 64, height: 14, canGrow: true, /* ... */ },
  { id: 'resumo', type: 'label',     y: 84, height: 12, content: '...' },
]
```

Com 4 taxas, o bloco de embalagens e o resumo descem; com 1 taxa, sobem. O
motor ordena os elementos por `y`, mantém um deslocamento acumulado e aplica a
todos os que vêm depois — a semântica do Anexo C do brief.

Sem `canGrow`, o elemento fica na posição absoluta declarada e o que cresce
passa por cima dele. É o default porque reflow tem custo, e a maioria dos
elementos não precisa.

## Quebra de página

O motor mede a altura real do bloco de detalhe **antes** de desenhar — somando
recursivamente todos os subreports aninhados e suas linhas. Se não couber na
página atual, quebra antes de começar, de forma que um registro e seus filhos
nunca ficam partidos entre duas páginas.

A exceção é o bloco maior que uma página inteira: aí não adianta quebrar (só
geraria uma página em branco antes), então ele é desenhado e transborda de
forma controlada.

## Subreport sem linhas

Um nó que não devolveu linhas ocupa apenas a `height` nominal declarada e não
desenha nada — nem header, nem footer. Para ele sumir de vez, declare
`height: 0`.

Um `dataSourceNodeId` que não existe na árvore daquele relatório também não
quebra a geração: o subreport simplesmente fica vazio. Isso é proposital —
o mesmo template pode ser usado com árvores ligeiramente diferentes.

## Exemplo completo

```bash
pnpm example:phase4
```

Gera `packages/core/examples/output/proposal-subreports.pdf`: uma proposta com
3 ofertas, cada uma com sua lista de taxas e embalagens, e um bloco de resumo
que desce conforme a quantidade de linhas.

Fonte: [`packages/core/examples/proposal-subreports-pdf.ts`](../packages/core/examples/proposal-subreports-pdf.ts)

## Esqueleto mínimo

```ts
const template: Template = {
  id: 'proposta',
  name: 'Proposta',
  boundDataSourceNodeId: 'PROPOSAL',
  pageSize: 'A4',
  bands: {
    details: {
      height: 40,
      elements: [
        { id: 'c', type: 'label', x: 0, y: 0, width: 400, height: 14,
          content: 'Cliente: {{customer}}' },

        { id: 'ofertas', type: 'subreport',
          x: 0, y: 20, width: 515, height: 20,
          dataSourceNodeId: 'OFFER',
          canGrow: true,
          template: {
            details: {
              height: 40,
              elements: [
                { id: 'r', type: 'label', x: 0, y: 0, width: 400, height: 12,
                  content: '{{route}}' },

                { id: 'taxas', type: 'subreport',
                  x: 12, y: 16, width: 490, height: 14,
                  dataSourceNodeId: 'OFFER_FEE',
                  canGrow: true,
                  template: {
                    details: {
                      height: 13,
                      elements: [
                        { id: 't', type: 'label', x: 0, y: 0, width: 400, height: 11,
                          content: "{{name}}: {{FORMAT(amount, '#,##0.00')}}" },
                      ],
                    },
                  } },
              ],
            },
          } },
      ],
    },
  },
};
```
