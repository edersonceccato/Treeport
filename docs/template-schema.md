# Template (layout)

Um template descreve **como** os dados viram páginas. Ele é um JSON puro — dá
para escrever à mão (é o que a Fase 2 faz) ou gerar pelo designer visual
(Fase 9). O motor não guarda estado: mesmo template + mesmos dados = mesmo PDF.

## Unidades e sistema de coordenadas

Todas as medidas estão em **pontos PDF** (1pt = 1/72 pol):

| Medida | Pontos |
|---|---|
| 1 mm | 2.835 |
| 1 cm | 28.35 |
| A4 | 595.28 × 841.89 |
| Letter | 612 × 792 |

A origem fica no **canto superior esquerdo**, com Y crescendo para baixo — como
em todo designer visual. O PDF internamente usa o canto inferior esquerdo; essa
inversão é resolvida num lugar só (`PageContext`), então você nunca precisa
pensar nela.

`x`/`y` de um elemento são **relativos ao topo da banda** em que ele está, não à
página. Isso é o que permite a banda de detalhe se repetir sem recalcular nada.

## Estrutura

```ts
interface Template {
  id: string;
  name: string;
  description?: string;
  dataSourceId?: string;
  boundDataSourceNodeId: string;   // a qual nó da árvore este template se liga
  pageSize: 'A4' | 'Letter' | { width: number; height: number };
  margins?: { top: number; right: number; bottom: number; left: number };
  orientation?: 'portrait' | 'landscape';
  bands: {
    header?: Band;   // repete no topo de TODA página
    details: Band;   // repete 1x por linha de dados
    footer?: Band;   // ancorado na base de TODA página
  };
}

interface Band {
  height: number;
  elements: ReportElement[];
}
```

Margem padrão quando omitida: 50pt de cada lado. `orientation: 'landscape'`
inverte largura e altura do `pageSize`.

## As bandas

- **Header** — desenhado uma vez por página, no topo, logo abaixo da margem.
  É um timbrado: título, logo, cabeçalho de colunas. Recebe como contexto de
  dados a **primeira linha** do master (não a linha corrente), porque descreve o
  documento, não o registro.
- **Details** — repete uma vez para cada linha de dados. Quando não cabe mais na
  página, o motor quebra sozinho e recomeça abaixo do header da página nova.
  Uma banda de detalhe nunca é partida no meio.
- **Footer** — ancorado na base da página, acima da margem inferior. O motor
  reserva essa altura, então nenhum detalhe invade a área do rodapé.

> Header e footer são por **nó da árvore**, não por página física. Um subreport
> (Fase 4) tem o próprio Header/Details/Footer, escopado a ele.

## Elementos

Todo elemento tem a base:

```ts
{
  id: string;
  x: number; y: number; width: number; height: number;
  style?: ElementStyle;
  canGrow?: boolean;   // pode crescer e empurrar o que está abaixo (Fase 5)
}
```

### Implementados na Fase 2

#### `label` — texto fixo

```json
{
  "id": "titulo",
  "type": "label",
  "x": 0, "y": 0, "width": 400, "height": 22,
  "content": "Relatório de Taxas",
  "style": { "fontSize": 18, "bold": true }
}
```

`isExpression: true` faz o `content` passar pelo motor de expressões — entra na
Fase 3.

#### `field` — valor de uma coluna

```json
{
  "id": "valor",
  "type": "field",
  "x": 385, "y": 2, "width": 130, "height": 12,
  "fieldName": "amount",
  "format": "#,##0.00",
  "style": { "align": "right" }
}
```

`fieldName` é o nome da coluna **como a query devolveu**. Coluna inexistente ou
nula vira string vazia — nunca `null` ou `undefined` no PDF.

#### `line` — traço

```json
{
  "id": "separador",
  "type": "line",
  "x": 0, "y": 17, "width": 515, "height": 0,
  "orientation": "horizontal",
  "style": { "borderColor": "#CCCCCC", "borderWidth": 0.5 }
}
```

Numa linha horizontal vale a `width`; numa vertical, a `height`.

#### `rect` — retângulo

```json
{
  "id": "caixa",
  "type": "rect",
  "x": 0, "y": 0, "width": 515, "height": 40,
  "style": { "backgroundColor": "#F5F5F5", "borderColor": "#999999", "borderWidth": 1 }
}
```

### Ainda não implementados

`image`, `barcode`, `qrcode` (Fase 6), `subreport` (Fase 4) e `table` já existem
no schema, mas o motor ainda não os desenha. Um elemento não implementado
**reserva o espaço dele** em vez de ser ignorado, então o layout ao redor
continua correto enquanto a fase não chega.

## Estilo

```ts
interface ElementStyle {
  fontSize?: number;        // default: 10
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  color?: string;           // "#333333" ou "#333"
  backgroundColor?: string;
  borderWidth?: number;
  borderColor?: string;
}
```

A fonte é a Helvetica padrão do PDF, nas 4 variantes (normal, negrito, itálico,
negrito-itálico) — nenhum arquivo de fonte externo é necessário. Acentuação do
português funciona normalmente. Caracteres que a fonte padrão não codifica
(emoji, CJK) viram `?` em vez de derrubar a geração.

## Máscaras de formatação (`format`)

### Números

| Máscara | 1500.5 vira |
|---|---|
| `#,##0.00` | `1.500,50` |
| `#,##0` | `1.501` |
| `0.00` | `1500,50` |
| `R$ #,##0.00` | `R$ 1.500,50` |
| `#,##0.00 kg` | `1.500,50 kg` |

Na máscara, `.` sempre marca a casa decimal e `,` o agrupamento (convenção do
Excel/Delphi). A **saída** usa separadores pt-BR por padrão; texto ao redor do
número é mantido como literal. Para outro locale:

```ts
await renderReport(template, dataSet, {
  formatOptions: { thousandSeparator: ',', decimalSeparator: '.' },
});
```

### Datas

| Máscara | Resultado |
|---|---|
| `dd/MM/yyyy` | `03/08/2026` |
| `dd/MM/yyyy HH:mm` | `03/08/2026 14:05` |
| `yyyy-MM-dd` | `2026-08-03` |
| `HH:mm:ss` | `14:05:09` |

Tokens: `yyyy` `yy` `MM` `dd` `HH` `mm` `ss`. Aceita `Date`, string ISO ou
timestamp. Usa a hora **local**, não UTC.

Sem máscara: `Date` sai como `dd/MM/yyyy` e booleano como `Sim`/`Não`.

## Gerando o PDF

Ponta a ponta, do banco ao PDF:

```ts
import { generateReport } from '@treeport/core';

const pdf = await generateReport(tree, template, executor, {
  parameters: { offerId: 10 },
  title: 'Relatório de Taxas',
});

await writeFile('taxas.pdf', pdf);
```

Ou em duas etapas, quando você precisa inspecionar os dados no meio:

```ts
import { resolveDataSourceTree, renderReport } from '@treeport/core';

const dataSet = await resolveDataSourceTree(tree, executor, { parameters: { offerId: 10 } });
const pdf = await renderReport(template, dataSet, { title: 'Relatório de Taxas' });
```

`renderReport` devolve `Uint8Array` — serve direto para `writeFile`, para
`Buffer.from(pdf)` ou para uma resposta HTTP com `Content-Type: application/pdf`.

## Exemplo executável

```bash
pnpm example:phase2
```

Gera `packages/core/examples/output/fee-list.pdf` com 60 taxas em 2 páginas.
Fonte: [`packages/core/examples/fee-list-pdf.ts`](../packages/core/examples/fee-list-pdf.ts)
