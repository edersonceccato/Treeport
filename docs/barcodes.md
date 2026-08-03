# Códigos de barras, QR Code e imagens

O Treeport gera códigos com o [`bwip-js`](https://github.com/metafloor/bwip-js),
que tem **zero dependências** e cobre tanto barcode quanto QR — por isso não
usamos uma segunda lib só para o QR (a `qrcode` puxaria o `yargs`, uma CLI
inteira, junto).

O código vira um PNG e é embutido no PDF como imagem. É assim que qualquer
motor de relatório faz: desenhar as barras vetorialmente exigiria reimplementar
as ~100 simbologias.

## Código de barras

```json
{
  "id": "bc",
  "type": "barcode",
  "x": 14, "y": 76, "width": 240, "height": 44,
  "format": "code128",
  "valueExpression": "code",
  "includeText": false
}
```

| Campo | O que faz |
|---|---|
| `format` | `code128`, `ean13` ou `code39` |
| `valueExpression` | Nome de coluna direto **ou** expressão `{{...}}` |
| `includeText` | Imprime os dígitos legíveis abaixo das barras. Default: `false` |

### Simbologias

| Formato | Aceita | Uso típico |
|---|---|---|
| **Code 128** | Qualquer ASCII | Código interno, número de volume, nota |
| **EAN-13** | 12 ou 13 dígitos | Produto de varejo |
| **Code 39** | `A-Z`, `0-9` e `- . $ / + %` e espaço | Sistemas legados, industrial |

**Code 39 não aceita minúscula nem acento** — é limitação da simbologia, não da
lib. Use `{{UPPER(campo)}}` se o dado vier em caixa baixa.

**EAN-13** é normalizado antes de gerar: separadores (`-`, espaço) são
removidos, zeros à esquerda recompostos se faltarem dígitos, e com 12 dígitos o
verificador é calculado sozinho. Isso existe porque um código vindo do banco
quase sempre chega com hífen ou perdeu o zero inicial numa conversão numérica —
sem tratar, o relatório quebraria por um detalhe de formatação do dado.

## QR Code

```json
{
  "id": "qr",
  "type": "qrcode",
  "x": 420, "y": 32, "width": 82, "height": 82,
  "valueExpression": "{{'https://rastreio.exemplo.com/v/' + code}}"
}
```

Aceita qualquer texto, incluindo acento e símbolo. Use uma caixa **quadrada**:
o QR é gerado quadrado e, numa caixa retangular, sobra espaço nas laterais
(o encaixe preserva a proporção em vez de distorcer, que tornaria o código
ilegível).

## Fundo branco e quiet zone

Os códigos são gerados com **fundo branco opaco** e uma **margem clara** ao
redor (quiet zone de 2 módulos). Isso não é estética:

- um leitor óptico precisa de contraste entre as barras e o fundo. O `bwip-js`
  gera PNG **transparente** por padrão, e transparência num PDF fica escura
  dependendo do visualizador — o código vira ilegível;
- sem a margem clara o scanner não delimita onde o código começa e termina.
  A especificação exige, e a maioria dos leitores falha sem ela.

Os testes provam que funciona decodificando o PNG gerado com um leitor de
verdade (`jsqr`) e conferindo que o conteúdo volta idêntico — não apenas que a
geração devolveu alguns bytes.

Para mudar o fundo (raramente necessário):

```ts
await renderReport(template, dataSet, {
  barcodeOptions: { backgroundColor: 'FFFFCC' },
});
```

## Nitidez na impressão

```ts
await renderReport(template, dataSet, {
  barcodeOptions: { scale: 4 },   // default: 3 para barcode, 4 para QR
});
```

Quanto maior o `scale`, mais nítido no papel — o custo é o tamanho do arquivo.
3 já dá bom resultado impresso; suba para 4–6 se o código for pequeno ou a
impressora for de baixa resolução.

## Imagens

```json
{
  "id": "logo",
  "type": "image",
  "x": 0, "y": 0, "width": 120, "height": 40,
  "source": "data:image/png;base64,iVBORw0KGgo...",
  "fit": "contain"
}
```

`source` aceita um **data URI** (PNG ou JPEG) ou uma expressão que resolva para
um — o que permite guardar o logo do cliente numa coluna e usar
`"source": "{{logo_base64}}"`.

| `fit` | Comportamento |
|---|---|
| `contain` (default) | Preserva a proporção e centraliza na caixa |
| `fill` | Estica para preencher, distorcendo se preciso |
| `cover` | Preenche a caixa cortando o excesso |

> **O motor não baixa imagem da rede.** Um relatório que depende de download
> externo fica lento e frágil (e trava se o host estiver fora do ar). A
> aplicação hospedeira sabe melhor como buscar — com autenticação, cache e
> timeout — e passa os bytes prontos como data URI. Um `source` que o motor não
> consegue ler é ignorado e o resto do relatório é gerado normalmente.

## Reuso automático de imagens

O mesmo PNG usado em várias linhas é embutido **uma vez só** no PDF. Um código
de barras repetido em 500 linhas não vira 500 cópias do arquivo.

## Erros

Um valor incompatível com a simbologia lança `BarcodeGenerationError` com o
valor que causou o problema e o que aquele formato aceita:

```
Não foi possível gerar o código code39 para "minúsculas!":
bwipp.code39badCharacter... (Code 39 aceita A-Z, 0-9 e os símbolos - . $ / + % espaço)
```

Valor **vazio ou nulo** não é erro: o elemento simplesmente não desenha nada e
o relatório segue.

## Exemplo executável

```bash
pnpm example:phase6
```

Gera `packages/core/examples/output/barcodes.pdf`: etiquetas de volume com Code
128, EAN-13 com dígitos legíveis e QR de rastreio montado por expressão.

Fonte: [`packages/core/examples/barcode-pdf.ts`](../packages/core/examples/barcode-pdf.ts)
