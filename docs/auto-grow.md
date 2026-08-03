# Auto-grow em cascata

Num relatório real quase nada tem altura fixa: uma observação pode ter uma
linha ou cinco, uma lista de taxas pode ter duas ou trinta. Se os elementos
ficassem na posição absoluta declarada, o conteúdo maior passaria por cima do
que vem depois.

O `canGrow` resolve isso: um elemento marcado assim pode ocupar mais que sua
altura nominal e **empurra para baixo** todos os elementos posicionados abaixo
dele na mesma banda.

```ts
elements: [
  { id: 'obs',    type: 'label',     y: 24, height: 11, canGrow: true, content: '{{notes}}' },
  { id: 'itens',  type: 'subreport', y: 40, height: 13, canGrow: true, /* ... */ },
  { id: 'rodape', type: 'label',     y: 58, height: 11, content: 'Pedido {{number}}' },
]
```

Com uma observação de 3 linhas e 5 itens, o rodapé desce o equivalente aos dois
crescimentos somados. Com 1 linha e 1 item, sobe.

## O que cresce

| Elemento | Cresce quando |
|---|---|
| `label` / `field` | O texto não cabe na largura e quebra em várias linhas |
| `subreport` | O nó tem mais linhas do que a altura reservada comporta |

Sem `canGrow` o elemento é **recortado** na altura nominal: o texto que sobra
não é impresso e nada abaixo se move. Esse é o default de propósito — reflow
tem custo e a maioria dos elementos (rótulo de coluna, traço, moldura) tem
altura fixa mesmo.

## Como o deslocamento é calculado

Ao renderizar uma banda, o motor:

1. ordena os elementos por `y`;
2. mantém um deslocamento acumulado (`offset`), começando em zero;
3. desenha cada elemento em `y + offset`;
4. quando o elemento tem `canGrow` e ocupou mais que `height`, soma a diferença
   ao `offset` — que passa a valer para os **próximos** elementos.

O passo 4 acontecer *depois* do 3 é o detalhe que importa: o crescimento de um
elemento desloca os seguintes, nunca ele mesmo. Somar antes contaria o mesmo
crescimento duas vezes e inflaria a altura da banda.

Como o `offset` é acumulado, vários elementos que crescem somam seus efeitos.

## Encolhimento

A altura de uma banda é o **espaço de design**, e por padrão funciona como
piso: mesmo que o conteúdo termine antes, a banda ocupa `band.height`. É o que
faz uma banda de detalhe servir de espaçamento uniforme entre registros.

Dentro de um **subreport** a regra é outra: as bandas encolhem para o conteúdo.
Sem isso, um nó com 1 linha deixaria um buraco até a altura declarada — que era
exatamente o espaço morto que aparecia entre ofertas no exemplo da Fase 4.

Na prática:

- banda **sem** elemento que cresce → mantém `band.height` sempre;
- banda **com** elemento que cresce, dentro de subreport → vale o que o
  conteúdo pediu, para mais ou para menos.

Um subreport **sem linhas** ocupa apenas a `height` nominal do elemento; para
sumir de vez, declare `height: 0`.

## Quebra de página

A altura é medida **antes** de desenhar — não dá para traçar meia banda,
descobrir que não coube e desfazer. O motor mede a banda de detalhe de cada
linha (incluindo texto que quebra e subreports aninhados em qualquer
profundidade), decide se cabe, e só então desenha.

Por isso um registro e seus filhos nunca ficam partidos entre duas páginas.

A medição espelha exatamente a renderização — as duas compartilham
`wrapText`, `pickFont` e `measureSubreport` em vez de cada uma ter a sua
lógica. Se divergissem, a altura reservada não bateria com a desenhada.

A exceção é o bloco maior que uma página inteira: aí não adianta quebrar (só
geraria uma página em branco antes), então ele é desenhado e transborda de
forma controlada.

## Medindo sem desenhar

Útil para testes ou para um preview no Designer:

```ts
import { measureElement, measureBandContent, loadFonts } from '@treeport/core';
import { PDFDocument } from 'pdf-lib';

const fonts = await loadFonts(await PDFDocument.create());

measureElement(elemento, { fonts, row });
measureBandContent(banda, { fonts, row, resolvedRow }, { shrinkToContent: true });
```

Sem `fonts` no contexto, a medição cobre só a geometria (subreports e alturas
nominais) e não tenta calcular quebra de texto.

## Exemplo executável

```bash
pnpm example:phase5
```

Gera `packages/core/examples/output/autogrow.pdf`: três pedidos com observações
e listas de tamanhos bem diferentes, cada um ocupando só o espaço que precisa.

Fonte: [`packages/core/examples/autogrow-pdf.ts`](../packages/core/examples/autogrow-pdf.ts)
