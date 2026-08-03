# Designer visual

O `@treeport/designer` é um **Web Component** — um Custom Element nativo, não
um componente de framework. Uma implementação só funciona em React, Vue,
Angular, Next.js ou numa página HTML pura, sem adapters.

> **Status:** sub-fases 9.1–9.3 do brief (canvas, paleta, propriedades).
> Faltam: explorador de campos (9.4), abas de subreport (9.5), editor de
> expressão (9.6) e integração com o backend (9.7).

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

## Interação

| Ação | Como |
|---|---|
| Criar elemento | Arraste da paleta para uma banda |
| Selecionar | Clique no elemento |
| Selecionar vários | Shift + clique |
| Mover | Arraste o elemento, ou use as setas |
| Mover mais rápido | Shift + setas (10pt) |
| Redimensionar | Arraste uma das 8 alças |
| Remover | Delete ou Backspace |
| Desfazer / refazer | Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z |

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
