# Designer visual

O `@treeport/designer` é um **Web Component** — um Custom Element nativo, não
um componente de framework. Uma implementação só funciona em React, Vue,
Angular, Next.js ou numa página HTML pura, sem adapters.

> **Status:** Fase 9 completa (sub-fases 9.1 a 9.7).

## Instalação

```bash
npm install @treeport/designer
```

```ts
import '@treeport/designer';
// registra <treeport-designer> automaticamente
```

Ou sem build, direto no HTML:

```html
<script type="module" src="https://esm.sh/@treeport/designer"></script>
<treeport-designer></treeport-designer>
```

## Uso

```html
<treeport-designer id="designer"></treeport-designer>

<script type="module">
  import '@treeport/designer';

  const designer = document.getElementById('designer');

  designer.template = meuTemplate;          // carrega
  designer.addEventListener('template-change', (e) => {
    salvar(e.detail.template);              // salva
  });
</script>
```

### Em React

```tsx
import '@treeport/designer';
import { useEffect, useRef } from 'react';

function Editor({ template, onChange }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    el.template = template;
    const handler = (e) => onChange(e.detail.template);
    el.addEventListener('template-change', handler);
    return () => el.removeEventListener('template-change', handler);
  }, [template, onChange]);

  return <treeport-designer ref={ref} />;
}
```

O mesmo padrão vale para Vue (`:template.prop`) e Angular (`[template]`).

## Propriedades

| Propriedade | Tipo | Default | O que faz |
|---|---|---|---|
| `template` | `Template` | vazio | O template sendo editado |
| `dataSource` | `DataSourceTree` | — | Alimenta o explorador de campos |
| `gridSize` | `number` | `5` | Grade em pontos; `0` desliga o snap |
| `showGrid` | `boolean` | `true` | Mostra a grade |
| `unit` | `'mm' \| 'in'` | `'mm'` | Unidade da régua |
| `zoom` | `number` | `1` | `1` = 100% |

Como atributos HTML: `grid-size`, `show-grid`.

## Eventos

| Evento | `detail` | Quando |
|---|---|---|
| `template-change` | `{ template }` | Qualquer edição |
| `selection-change` | `{ ids, elements }` | A seleção muda |

Ambos sobem com `bubbles` e `composed`, então funcionam através do Shadow DOM.

## A tela

```
┌── Designer | Preview ── fonte, cor, alinhamento, agrupar, zoom ────────┐
│ paleta │            a folha A4 em escala            │ Propriedades     │
│        │   ┌─ margens de segurança ─────────┐       │ Camadas          │
│        │   │ Cabeçalho ─────────────── 78pt │       │ Dados            │
│        │   │ Detalhe ····· repete ···· 26pt │       │                  │
│        │   │ Rodapé ────────────────── 34pt │       │                  │
│        │   └────────────────────────────────┘       │                  │
└────────────────────────────────────────────────────────────────────────┘
```

O canvas é a **folha inteira**, no tamanho real da página escolhida, com as
margens marcadas em tracejado. As bandas ficam empilhadas dentro da área útil,
com a altura de cada uma etiquetada à direita.

## Interação

| Ação | Como |
|---|---|
| Criar elemento | Clique na paleta, ou arraste para a banda |
| Menu de opções | Botão direito sobre o elemento |
| Renomear | Duplo clique na camada, ou botão direito → Renomear |
| Mover entre bandas | Botão direito → Mover para o cabeçalho/detalhe/rodapé |
| Girar uma forma | Arraste a alça acima dela (Shift trava de 15 em 15°) |
| Selecionar | Clique no elemento |
| Selecionar vários | Shift + clique |
| Mover | Arraste, ou use as setas |
| Mover mais rápido | Shift + setas (10pt) |
| Redimensionar | Arraste uma das 8 alças |
| **Mudar a altura de uma banda** | Arraste a borda inferior dela |
| Agrupar numa região | Ctrl/Cmd+G |
| Duplicar | Ctrl/Cmd+D |
| Remover | Delete ou Backspace |
| Desfazer / refazer | Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z |
| Entrar num subrelatório | Duplo clique nele |

## Guias de alinhamento

Ao arrastar, o elemento **gruda** nas bordas e no centro dos vizinhos, e uma
linha rosa mostra o alinhamento — como no Photoshop ou no Figma. As guias azuis
marcam as bordas e o centro da página.

Desligue no botão "Guias" da barra quando quiser posicionamento livre.

## Regiões

Uma região agrupa elementos. Os filhos guardam coordenada **relativa** a ela,
então arrastar a região move tudo junto sem recalcular nada — e o motor de
renderização entende isso do mesmo jeito no PDF.

- Selecione dois ou mais elementos e aperte **Ctrl+G** para agrupar;
- "Tirar da região", no painel de propriedades, devolve o elemento à banda com
  a coordenada absoluta recalculada;
- Com **altura automática**, a região cresce para caber o conteúdo.

## Camadas

O painel Camadas lista os elementos por banda, do mais à frente para o mais
atrás. Cada linha permite **ocultar**, **travar**, **duplicar** e **excluir**.

- Travado não é selecionável nem arrastável no canvas (mas continua no PDF);
- Oculto some do designer **e** do PDF.

Clicar numa camada seleciona o elemento no canvas, e vice-versa.

## Painel de Dados

Um seletor escolhe a consulta (a master ou qualquer detalhe da árvore) e a
lista abaixo mostra os campos daquela consulta, mais os das consultas acima
dela. Trocar a consulta troca os campos.

Arrastar um campo para a folha cria o elemento já vinculado — campo da consulta
atual vira um `field`; campo de uma consulta acima vira um label com
`{{parent.campo}}`.

## Aba Preview

Mostra o relatório paginado com dados de amostra: header e rodapé repetidos em
todas as páginas, quebra no lugar certo, numeração resolvida. Serve para julgar
o layout sem gerar PDF nem precisar de servidor.

Não é o PDF final — fontes do browser e do pdf-lib diferem um pouco. Para o
resultado exato, use `POST /report-templates/:id/preview`.

## Regras condicionais

Cada elemento aceita regras que mudam o que ele faz conforme os dados:

| Quando | O que fazer |
|---|---|
| `total < 0` | esconder |
| `total < 0` | trocar o conteúdo por `0,00` |
| `situacao == 'ATRASADO'` | pintar de vermelho |
| `SUM(ITENS.valor) > 1000` | negrito |

A **primeira regra que der verdadeira é a que vale** — previsível de explicar, e
evita a confusão de várias regras se sobrepondo. Uma condição que não compila é
ignorada: uma regra quebrada não deve impedir a emissão do documento.

## Posição relativa

Um elemento pode se posicionar **depois de outro** em vez de numa coordenada
fixa. Quando o de referência não aparece (escondido por regra, ou uma lista sem
linhas), este sobe e ocupa o lugar dele em vez de deixar um buraco.

Configurável em Propriedades → Posição relativa.

## Formas

O componente **Forma** oferece retângulo, círculo/elipse, triângulo, losango,
estrela (com número de pontas ajustável), pentágono, hexágono e seta. Todas
aceitam preenchimento, borda (contínua, tracejada ou pontilhada), espessura e
rotação; o retângulo aceita cantos arredondados.

O que aparece no designer é um SVG com a mesma geometria que o motor desenha
no PDF — se divergissem, você desenharia uma coisa e imprimiria outra.

## Códigos de barras e QR

O designer gera o código **de verdade**, com a mesma biblioteca que o motor usa
no servidor. Um valor inválido mostra o motivo em vez de um retângulo cinza.

**15 simbologias:** Code 128, Code 39, Code 93, EAN-13, EAN-8, UPC-A, UPC-E,
ITF-14, Intercalado 2 de 5, Codabar, MSI, Pharmacode, e as 2D DataMatrix,
PDF417 e Aztec.

O **QR** não precisa de um tipo diferente para cada uso — ele codifica texto, e
o que muda é a sintaxe. O campo "Conteúdo" monta essa sintaxe:

| Tipo | Vira |
|---|---|
| Site / URL | `https://…` (o protocolo é acrescentado se faltar) |
| E-mail | `mailto:…?subject=…` |
| Telefone | `tel:…` |
| SMS | `SMSTO:numero:mensagem` |
| Wi-Fi | `WIFI:T:WPA;S:rede;P:senha;;` |
| Contato | vCard 3.0 |
| Localização | `geo:lat,long` |

Também dá para ajustar a correção de erro (L/M/Q/H) e as cores. Fundo claro e
contraste alto não é estética: é o que o leitor óptico precisa.

## Totalizador

Soma, conta, tira média, mínimo ou máximo de um campo — de **qualquer**
consulta da árvore, não só da banda onde está.

Para combinar consultas diferentes, use o campo "Cálculo entre consultas":

```
{{SUM('ITEM','valor') / COUNT('PEDIDO')}}      ticket médio
{{COUNTDISTINCT('PEDIDO','cliente')}}          quantos clientes
{{SUM('ITEM','valor') / COUNTDISTINCT('PEDIDO','cliente')}}   média por cliente
```

### Sintaxe

```
SUM(ITENS.valor_total)              soma um campo da consulta ITENS
COUNT(PEDIDOS)                      quantas linhas PEDIDOS tem
COUNTDISTINCT(PEDIDOS.cliente)      quantos clientes diferentes
AVG(ITENS.valor_unitario)           média
SUMDISTINCT(PEDIDOS.frete)          soma ignorando repetidos
MINOF(ITENS.valor) / MAXOF(...)     menor e maior
```

Os nomes de consulta seguem o formato `MAIUSCULA_COM_UNDERSCORE` — "Itens do
pedido" vira `ITENS_DO_PEDIDO`. Assim não é preciso aspas nem escapar acento.

A forma antiga com aspas (`SUM('ITENS','valor')`) continua funcionando.

### Combinando consultas

```
{{SUM(ITENS.valor) / COUNT(PEDIDOS)}}                    ticket médio
{{SUM(ITENS.valor) / COUNTDISTINCT(PEDIDOS.cliente)}}    média por cliente
```

## Componentes prontos

A seção "Prontos" da paleta traz blocos que todo relatório precisa:

| Grupo | Componente | O que insere |
|---|---|---|
| Página | Página X de Y | `{{sys.pageNumber}}` e `{{sys.totalPages}}` |
| Página | Nº da página | Só o número atual |
| Página | Data de emissão | `{{FORMAT(sys.now, 'dd/MM/yyyy HH:mm')}}` |
| Blocos | Bloco de título | Região com título, subtítulo e régua |
| Blocos | Caixa de total | Região com fundo, rótulo e valor |
| Blocos | **Tabela de itens** | Subrelatório com cabeçalho, linhas e total |
| Blocos | Cabeçalho de colunas | Faixa com títulos e régua |
| Blocos | Linha de assinatura | Traço com nome embaixo |
| Totais | Soma / Contagem / Média | Totalizadores prontos |
| Códigos | QR do documento | QR com URL montada por expressão |
| Códigos | Código de barras | Code 128 com dígitos legíveis |

Clique num componente para inserir na banda ativa, ou arraste para posicionar
onde quiser.

### Variáveis de sistema

Disponíveis em qualquer expressão, resolvidas na geração:

| Variável | O que é |
|---|---|
| `sys.pageNumber` | Número da página atual |
| `sys.totalPages` | Total de páginas do documento |
| `sys.now` | Data e hora da geração |

`sys.totalPages` faz o motor renderizar duas vezes: a primeira descobre quantas
páginas há, a segunda usa o número certo. É o mesmo truque dos motores
clássicos, e só acontece quando o template realmente usa a variável.

Um arrasto inteiro conta como **um** passo de desfazer — sem isso, arrastar 40
pixels viraria 40 undos e desfazer devolveria o elemento um pixel por vez.

## A API de edição

Para toolbar própria, use `designer.api` (um `TemplateEditor`):

```ts
const api = designer.api;

api.align(['a', 'b', 'c'], 'left');       // left|center|right|top|middle|bottom
api.distribute(['a', 'b', 'c'], 'horizontal');
api.bringToFront('a');
api.sendToBack('b');

api.updateElement('a', { x: 100, width: 200 });
api.updateStyle('a', { fontSize: 14, bold: true });

api.setBandHeight('details', 60);
api.toggleBand('footer', false);

api.groupIntoRegion(['a', 'b'], regionId);
api.ungroupFromRegion('a');
api.duplicateElement('a');
api.setLocked('a', true);
api.setHidden('a', true);

api.undo();
api.redo();

api.toJSON();      // exportar
```

Depois de mexer via API, chame `designer.requestUpdate()` para o canvas
redesenhar.

### Usando o modelo sem a UI

O `TemplateEditor` não depende de DOM — serve para testes ou para montar outra
interface:

```ts
import { TemplateEditor, createEmptyTemplate, createElement } from '@treeport/designer';

const editor = new TemplateEditor(createEmptyTemplate());
editor.addElement('details', createElement('label', 0, 0));
```

## Unidades e coordenadas

O template guarda tudo em **pontos PDF** (1pt = 1/72"), que é o que o motor
usa. A régua mostra milímetros, porque é assim que se pensa um relatório.

```ts
import { mmToPt, ptToMm } from '@treeport/designer';
mmToPt(10);   // 28.35
```

O `x`/`y` de um elemento é relativo ao **topo da banda**, e o canvas tem a
largura da área útil (página menos as margens laterais) — exatamente como o
motor de renderização calcula. O que você vê no designer é o que sai no PDF.

## Explorador de campos

Informe a árvore de dados e o painel de campos aparece sozinho:

```ts
designer.dataSource = await api.getDataSource('pedidos');
```

Arrastar um campo para o canvas cria o elemento **já vinculado** — o usuário
não digita o nome da coluna, que é onde mora metade dos erros num relatório:

- campo do nó atual → um `field` com `fieldName` preenchido;
- campo de um ancestral → um `label` com `{{parent.campo}}`, porque é assim que
  o motor de expressões o alcança.

Os campos de um nó vêm de `fields` (o backend informou), de `sampleRow`, ou
como último recurso são extraídos do `SELECT`. Com `SELECT *` a lista fica
vazia de propósito: devolver nomes adivinhados seria pior que não devolver
nada — o usuário confiaria num campo que não existe.

## Subrelatórios: onde vai o que repete

**Tudo que tem mais de uma linha deve morar num subrelatório.** É ele que tem
cabeçalho, corpo e rodapé próprios: o cabeçalho aparece uma vez com os títulos
das colunas, o corpo repete por linha, e o rodapé fecha com os totais. Assim a
página principal fica limpa e cada detalhe fica no seu bloco.

O componente pronto **Tabela de itens** já vem montado nesse formato.

Duplo clique na aba renomeia o subrelatório; o nome aparece encurtado, com o
nome completo e a consulta no tooltip.

## Subrelatórios: abas de design

Cada subreport tem seu próprio design. As abas no topo do canvas navegam entre
eles, em qualquer profundidade:

```
Principal   ↳ OFFER   ↳ OFFER_FEE
```

Duplo clique num subreport no canvas também entra no design dele. Ao trocar de
aba, o explorador de campos passa a mostrar o escopo daquele nó — os campos
dele **e** os dos ancestrais, exatamente o que o motor enxerga.

Apagar um subreport fecha a aba dele automaticamente, voltando para o ancestral
mais próximo que ainda exista.

```ts
designer.openDesign(['sub-offer', 'sub-fee']);  // entra
designer.openDesign([]);                        // volta ao principal
designer.designPath;                            // onde estou
```

## Editor de expressão

Funções de apoio para montar um campo de expressão com destaque e autocomplete
— um `<textarea>` basta, sem editor de código pesado:

```ts
import { highlight, suggest, applySuggestion, validateSyntax } from '@treeport/designer';

highlight('Total: {{valor}}');   // segmentos text/delimiter/expression
suggest(texto, cursor, { fields: designer.availableFields });
applySuggestion(texto, cursor, escolhida);
validateSyntax('{{IF(a, 1}}');   // ["Parênteses desbalanceados..."]
```

O autocomplete só age dentro de `{{ }}` — no texto literal o usuário escreve
prosa e uma lista aparecendo atrapalharia. Campos vêm antes de funções, e os
de ancestrais já entram com o prefixo `parent.` correto.

## Integração com o backend

O Designer nunca fala com o banco — só com as rotas que o seu backend expõe
(seção 7.5.3 do brief):

```ts
import { TreeportApiClient } from '@treeport/designer';

const api = new TreeportApiClient({
  baseUrl: '/api',
  // função, não objeto: o token expira, e congelá-lo na inicialização
  // quebraria as chamadas depois de um tempo
  headers: () => ({ Authorization: `Bearer ${sessao.token}` }),
});

designer.dataSource = await api.getDataSource('pedidos');
designer.template = await api.getTemplate('t1');

// salvar
await api.saveTemplate(designer.template);

// pré-visualizar, inclusive mudanças ainda não salvas
const url = await api.previewUrl('t1', designer.template);
iframe.src = url;   // o browser já sabe exibir PDF
```

### Do lado do servidor

O `@treeport/core` traz os handlers prontos, framework-neutros:

```ts
import { createRouteHandlers } from '@treeport/core';

const handlers = createRouteHandlers({ store: meuStore, executor });

app.get('/report-templates/:id', requireAuth, async (req, res) => {
  const r = await handlers.getTemplate({ params: req.params });
  res.status(r.status).json(r.body);
});

app.post('/report-templates/:id/preview', requireAuth, async (req, res) => {
  const r = await handlers.previewTemplate({ params: req.params, body: req.body });
  if (r.contentType) res.type(r.contentType).status(r.status).send(Buffer.from(r.body));
  else res.status(r.status).json(r.body);
});
```

Autenticação é **do host** (`requireAuth` acima): os handlers recebem
requisições já autorizadas. Persistência também — você implementa
`TemplateStore` contra o seu banco. Ver [storage.md](storage.md).

### Importar e exportar arquivo

```ts
import { exportTemplate, importTemplate } from '@treeport/designer';

const json = exportTemplate(designer.template);   // formatado, para o Git
designer.template = importTemplate(conteudoDoArquivo);
```

Útil para versionar templates ou movê-los entre ambientes sem passar pelo
servidor.

## Personalizando a aparência

O componente expõe variáveis CSS:

```css
treeport-designer {
  --tp-accent: #7c3aed;
  --tp-border: #e5e7eb;
  --tp-grid: #f3f4f6;
  --tp-bg: #ffffff;
  --tp-panel: #f9fafb;
  --tp-text: #111827;
  --tp-muted: #6b7280;
}
```

## Exemplo executável

```bash
npx vite packages/designer/examples
```

Abre uma página com o designer, uma toolbar completa (desfazer, alinhar,
z-order, grade, zoom, exportar) e um painel de propriedades ligado à seleção.
O JSON do template aparece ao vivo embaixo.

Fonte: [`packages/designer/examples/index.html`](../packages/designer/examples/index.html)

## Por que Web Component

O brief pede que a lib encaixe em qualquer stack de frontend. Um componente
React obrigaria quem usa Vue a ter um adapter; um componente Vue, o contrário.
Custom Elements são padrão do browser e funcionam nativamente dentro de todos
os frameworks — é o mesmo caminho que o pdfme adota.

Os elementos do canvas são `<div>`s posicionados com CSS absoluto, não um
`<canvas>` de pixels. Assim seleção, hit-testing e drag são DOM normal, e a
posição bate 1:1 com o que o motor vai desenhar.
