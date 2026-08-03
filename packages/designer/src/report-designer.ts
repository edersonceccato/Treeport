import { LitElement, html, css, type PropertyValues, type TemplateResult } from 'lit';
import type { ReportElement, Template } from '@treeport/schema';
import { resolvePageSize } from '@treeport/schema';
import {
  TemplateEditor,
  createEmptyTemplate,
  type BandName,
} from './model/template-editor.js';
import { PALETTE, createElement, type PaletteItemType } from './model/palette.js';
import { dragBox, resizeBox, handleCursor, type Box, type Handle } from './model/interaction.js';
import { ptToMm, type RulerUnit } from './model/units.js';

/**
 * `<treeport-designer>` — o designer visual.
 *
 * É um Custom Element nativo (via Lit), então funciona igual dentro de React,
 * Vue, Angular, Next.js ou numa página HTML pura. Uma implementação cobre
 * todos os casos, sem adapters por framework.
 *
 * Os elementos do canvas são `<div>`s posicionados com CSS absoluto, não um
 * `<canvas>` de pixels: hit-testing, seleção e drag viram DOM normal, e a
 * posição bate 1:1 com o que o motor de renderização vai desenhar.
 */
export class TreeportDesigner extends LitElement {
  static override properties = {
    template: { type: Object },
    gridSize: { type: Number, attribute: 'grid-size' },
    showGrid: { type: Boolean, attribute: 'show-grid' },
    unit: { type: String },
    zoom: { type: Number },
    selectedIds: { state: true },
    activeBand: { state: true },
  };

  /** O template sendo editado. Ler devolve o estado atual. */
  declare template: Template;
  /** Tamanho do grid em pontos. 0 desliga o snap. */
  declare gridSize: number;
  declare showGrid: boolean;
  declare unit: RulerUnit;
  declare zoom: number;

  declare selectedIds: string[];
  declare activeBand: BandName;

  private editor!: TemplateEditor;
  /** A última atribuição a `template` veio de dentro do componente? */
  private selfAssigned = false;
  /** Estado do arrasto em curso. */
  private drag:
    | {
        handle: Handle;
        band: BandName;
        pointerId: number;
        startX: number;
        startY: number;
        origins: Map<string, Box>;
      }
    | undefined;

  constructor() {
    super();
    this.template = createEmptyTemplate();
    this.gridSize = 5;
    this.showGrid = true;
    this.unit = 'mm';
    this.zoom = 1;
    this.selectedIds = [];
    this.activeBand = 'details';
    this.editor = new TemplateEditor(this.template, {
      onChange: (t) => this.handleChange(t),
    });
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // Só recria o editor quando o template vem DE FORA (host carregou outro
    // do servidor, importou um arquivo). Sem essa distinção, a atribuição
    // feita pelo próprio `handleChange` recriaria o editor a cada edição e
    // zeraria o histórico — o undo nunca funcionaria.
    if (changed.has('template') && !this.selfAssigned) {
      this.editor = new TemplateEditor(this.template, {
        onChange: (t) => this.handleChange(t),
      });
      this.selectedIds = [];
    }
    this.selfAssigned = false;
  }

  /** Propaga a mudança para fora, para o host salvar. */
  private handleChange(template: Template): void {
    // marca que esta atribuição veio de dentro, para o willUpdate não
    // interpretar como "o host trocou o template"
    this.selfAssigned = true;
    this.template = template;
    this.dispatchEvent(
      new CustomEvent('template-change', {
        detail: { template },
        bubbles: true,
        composed: true,
      }),
    );
    this.requestUpdate();
  }

  private emitSelection(): void {
    this.dispatchEvent(
      new CustomEvent('selection-change', {
        detail: {
          ids: [...this.selectedIds],
          elements: this.selectedIds
            .map((id) => this.editor.element(id))
            .filter((e): e is ReportElement => e !== undefined),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // --- API pública ----------------------------------------------------------

  /** O editor, para o host chamar operações (undo, alinhar, etc.). */
  get api(): TemplateEditor {
    return this.editor;
  }

  undo(): void {
    this.editor.undo();
  }

  redo(): void {
    this.editor.redo();
  }

  /** Seleciona elementos pelo id. */
  select(ids: string[]): void {
    this.selectedIds = [...ids];
    this.emitSelection();
  }

  /** Remove os elementos selecionados. */
  deleteSelection(): void {
    for (const id of this.selectedIds) this.editor.removeElement(id);
    this.selectedIds = [];
    this.emitSelection();
  }

  // --- geometria da página --------------------------------------------------

  private get pageWidth(): number {
    const size = resolvePageSize(this.template.pageSize);
    return this.template.orientation === 'landscape' ? size.height : size.width;
  }

  private get contentWidth(): number {
    const margins = this.template.margins;
    return this.pageWidth - (margins?.left ?? 0) - (margins?.right ?? 0);
  }

  // --- eventos de ponteiro --------------------------------------------------

  private onElementPointerDown(
    event: PointerEvent,
    elementId: string,
    band: BandName,
    handle: Handle,
  ): void {
    event.preventDefault();
    event.stopPropagation();

    // shift+clique acumula na seleção; clique simples troca
    const multi = event.shiftKey;
    if (!this.selectedIds.includes(elementId)) {
      this.selectedIds = multi ? [...this.selectedIds, elementId] : [elementId];
      this.emitSelection();
    } else if (multi) {
      this.selectedIds = this.selectedIds.filter((id) => id !== elementId);
      this.emitSelection();
      return;
    }

    this.activeBand = band;

    const origins = new Map<string, Box>();
    for (const id of this.selectedIds) {
      const element = this.editor.element(id);
      if (element) {
        origins.set(id, {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        });
      }
    }

    this.drag = {
      handle,
      band,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origins,
    };

    // o arrasto inteiro conta como um único passo de desfazer
    this.editor.beginBatch();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    // o zoom afeta o deslocamento na tela, não no modelo
    const deltaX = (event.clientX - drag.startX) / this.zoom;
    const deltaY = (event.clientY - drag.startY) / this.zoom;

    const band = this.editor.band(drag.band);
    const bounds = band
      ? { width: this.contentWidth, height: band.height }
      : undefined;

    for (const [id, origin] of drag.origins) {
      const box =
        drag.handle === 'move'
          ? dragBox(origin, deltaX, deltaY, {
              gridSize: this.gridSize,
              ...(bounds ? { bounds } : {}),
            })
          : resizeBox(origin, drag.handle, deltaX, deltaY, { gridSize: this.gridSize });

      this.editor.updateElement(id, box as Partial<ReportElement>);
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) return;
    this.drag = undefined;
    this.editor.endBatch();
  }

  /** Clique no vazio limpa a seleção. */
  private onCanvasPointerDown(): void {
    if (this.selectedIds.length > 0) {
      this.selectedIds = [];
      this.emitSelection();
    }
  }

  // --- drag da paleta -------------------------------------------------------

  private onPaletteDragStart(event: DragEvent, type: PaletteItemType): void {
    event.dataTransfer?.setData('text/treeport-element', type);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  private onBandDragOver(event: DragEvent): void {
    // sem isto o drop nunca dispara
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  private onBandDrop(event: DragEvent, band: BandName): void {
    event.preventDefault();

    const type = event.dataTransfer?.getData('text/treeport-element') as PaletteItemType;
    if (!type) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.zoom;
    const y = (event.clientY - rect.top) / this.zoom;

    const element = createElement(type, snapTo(x, this.gridSize), snapTo(y, this.gridSize));
    const id = this.editor.addElement(band, element);

    this.activeBand = band;
    this.selectedIds = [id];
    this.emitSelection();
  }

  // --- teclado --------------------------------------------------------------

  private onKeyDown(event: KeyboardEvent): void {
    if (this.selectedIds.length === 0) return;

    const step = event.shiftKey ? 10 : this.gridSize || 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };

    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      for (const id of this.selectedIds) {
        const element = this.editor.element(id);
        if (element) this.editor.moveElement(id, element.x + move[0], element.y + move[1]);
      }
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    }
  }

  // --- render ---------------------------------------------------------------

  override render(): TemplateResult {
    return html`
      <div class="designer" @keydown=${this.onKeyDown} tabindex="0">
        ${this.renderPalette()}
        <div class="workspace">
          ${this.renderRuler()}
          <div
            class="canvas"
            style="width:${this.contentWidth * this.zoom}px"
            @pointerdown=${this.onCanvasPointerDown}
            @pointermove=${this.onPointerMove}
            @pointerup=${this.onPointerUp}
            @pointercancel=${this.onPointerUp}
          >
            ${this.editor.bands().map(({ name, band }) => this.renderBand(name, band.height))}
          </div>
        </div>
      </div>
    `;
  }

  private renderPalette(): TemplateResult {
    return html`
      <aside class="palette">
        <h3>Elementos</h3>
        ${PALETTE.map(
          (item) => html`
            <div
              class="palette-item"
              draggable="true"
              title=${item.hint}
              @dragstart=${(e: DragEvent) => this.onPaletteDragStart(e, item.type)}
            >
              <span class="icon">${item.icon}</span>
              <span>${item.label}</span>
            </div>
          `,
        )}
      </aside>
    `;
  }

  private renderRuler(): TemplateResult {
    const width = this.contentWidth;
    const stepPt = this.unit === 'mm' ? 10 * (72 / 25.4) : 72; // 1cm ou 1"
    const marks: TemplateResult[] = [];

    for (let pt = 0; pt <= width; pt += stepPt) {
      const value = this.unit === 'mm' ? Math.round(ptToMm(pt)) : Math.round(pt / 72);
      marks.push(
        html`<span class="tick" style="left:${pt * this.zoom}px">${value}</span>`,
      );
    }

    return html`
      <div class="ruler" style="width:${width * this.zoom}px">
        ${marks}
        <span class="unit">${this.unit}</span>
      </div>
    `;
  }

  private renderBand(name: BandName, height: number): TemplateResult {
    const band = this.editor.band(name)!;
    const label = { header: 'Cabeçalho', details: 'Detalhe', footer: 'Rodapé' }[name];

    return html`
      <section
        class="band ${name === this.activeBand ? 'active' : ''}"
        style="height:${height * this.zoom}px; ${this.gridStyle()}"
        @dragover=${this.onBandDragOver}
        @drop=${(e: DragEvent) => this.onBandDrop(e, name)}
      >
        <span class="band-label">
          ${label}${name === 'details' ? html` <em>(repete por linha)</em>` : ''}
        </span>
        ${band.elements.map((element) => this.renderElement(element, name))}
      </section>
    `;
  }

  private renderElement(element: ReportElement, band: BandName): TemplateResult {
    const selected = this.selectedIds.includes(element.id);
    const z = this.zoom;

    return html`
      <div
        class="element ${selected ? 'selected' : ''} type-${element.type}"
        style="left:${element.x * z}px; top:${element.y * z}px;
               width:${element.width * z}px;
               height:${Math.max(element.height, 2) * z}px;
               ${elementStyle(element)}"
        @pointerdown=${(e: PointerEvent) =>
          this.onElementPointerDown(e, element.id, band, 'move')}
      >
        <span class="element-label">${elementLabel(element)}</span>
        ${selected ? this.renderHandles(element, band) : ''}
      </div>
    `;
  }

  private renderHandles(element: ReportElement, band: BandName): TemplateResult {
    const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    return html`${handles.map(
      (handle) => html`
        <span
          class="handle handle-${handle}"
          style="cursor:${handleCursor(handle)}"
          @pointerdown=${(e: PointerEvent) =>
            this.onElementPointerDown(e, element.id, band, handle)}
        ></span>
      `,
    )}`;
  }

  private gridStyle(): string {
    if (!this.showGrid || this.gridSize <= 0) return '';
    const size = this.gridSize * this.zoom;
    return `background-size:${size}px ${size}px;background-image:
      linear-gradient(to right, var(--tp-grid) 1px, transparent 1px),
      linear-gradient(to bottom, var(--tp-grid) 1px, transparent 1px);`;
  }

  static override styles = css`
    :host {
      --tp-border: #d0d4da;
      --tp-grid: #eef1f4;
      --tp-accent: #2563eb;
      --tp-bg: #ffffff;
      --tp-panel: #f7f8fa;
      --tp-text: #1f2937;
      --tp-muted: #6b7280;

      display: block;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: var(--tp-text);
    }

    .designer {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      outline: none;
    }

    .palette {
      width: 130px;
      flex: 0 0 auto;
      background: var(--tp-panel);
      border: 1px solid var(--tp-border);
      border-radius: 6px;
      padding: 8px;
    }

    .palette h3 {
      margin: 0 0 8px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--tp-muted);
    }

    .palette-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin-bottom: 4px;
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 4px;
      cursor: grab;
      user-select: none;
    }

    .palette-item:hover {
      border-color: var(--tp-accent);
    }

    .palette-item .icon {
      width: 18px;
      text-align: center;
      color: var(--tp-muted);
      font-weight: 600;
    }

    .workspace {
      flex: 1 1 auto;
      overflow: auto;
      /* espaço à direita para os rótulos das bandas */
      padding-right: 70px;
    }

    .ruler {
      position: relative;
      height: 18px;
      border-bottom: 1px solid var(--tp-border);
      margin-bottom: 4px;
      font-size: 9px;
      color: var(--tp-muted);
    }

    .ruler .tick {
      position: absolute;
      top: 4px;
      transform: translateX(-50%);
    }

    .ruler .tick::before {
      content: '';
      position: absolute;
      left: 50%;
      bottom: -4px;
      height: 4px;
      border-left: 1px solid var(--tp-border);
    }

    .ruler .unit {
      position: absolute;
      right: 0;
      top: 4px;
    }

    .canvas {
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
    }

    .band {
      position: relative;
      border-bottom: 1px dashed var(--tp-border);
      box-sizing: border-box;
      /* os elementos são recortados, mas o rótulo à direita transborda */
      overflow: visible;
    }

    .band.active {
      box-shadow: inset 0 0 0 1px var(--tp-accent);
    }

    .band-label {
      position: absolute;
      /* fora da área de conteúdo: dentro dela sobrepõe elementos no topo,
         e z-index não resolve porque cada elemento cria seu contexto */
      top: 0;
      left: 100%;
      margin-left: 6px;
      white-space: nowrap;
      font-size: 9px;
      color: var(--tp-muted);
      pointer-events: none;
      user-select: none;
    }

    .band-label em {
      font-style: normal;
      opacity: 0.7;
    }

    .element {
      position: absolute;
      box-sizing: border-box;
      border: 1px solid transparent;
      overflow: hidden;
      cursor: move;
      user-select: none;
      display: flex;
      align-items: center;
    }

    .element:hover {
      border-color: var(--tp-border);
    }

    .element.selected {
      border-color: var(--tp-accent);
    }

    .element-label {
      font-size: inherit;
      padding: 0 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
    }

    .type-line {
      border-top: 1px solid var(--tp-text);
      align-items: flex-start;
    }

    .type-barcode,
    .type-qrcode,
    .type-image,
    .type-subreport {
      background: repeating-linear-gradient(
        45deg,
        var(--tp-panel),
        var(--tp-panel) 6px,
        transparent 6px,
        transparent 12px
      );
      border-color: var(--tp-border);
      justify-content: center;
      color: var(--tp-muted);
      font-size: 10px;
    }

    .handle {
      position: absolute;
      width: 7px;
      height: 7px;
      background: var(--tp-bg);
      border: 1px solid var(--tp-accent);
      border-radius: 1px;
    }

    .handle-nw { left: -4px; top: -4px; }
    .handle-n  { left: 50%; top: -4px; margin-left: -3px; }
    .handle-ne { right: -4px; top: -4px; }
    .handle-e  { right: -4px; top: 50%; margin-top: -3px; }
    .handle-se { right: -4px; bottom: -4px; }
    .handle-s  { left: 50%; bottom: -4px; margin-left: -3px; }
    .handle-sw { left: -4px; bottom: -4px; }
    .handle-w  { left: -4px; top: 50%; margin-top: -3px; }
  `;
}

/** Texto mostrado dentro do elemento no canvas. */
function elementLabel(element: ReportElement): string {
  switch (element.type) {
    case 'label':
      return element.content || '(vazio)';
    case 'field':
      return element.fieldName ? `{${element.fieldName}}` : '(sem campo)';
    case 'barcode':
      return `|||| ${element.format}`;
    case 'qrcode':
      return 'QR';
    case 'image':
      return 'Imagem';
    case 'subreport':
      return `⊞ ${element.dataSourceNodeId || '(sem nó)'}`;
    case 'table':
      return 'Tabela';
    default:
      return '';
  }
}

/** Estilo inline que espelha o que o motor vai desenhar. */
function elementStyle(element: ReportElement): string {
  const style = element.style;
  if (!style) return '';

  const parts: string[] = [];
  if (style.fontSize) parts.push(`font-size:${style.fontSize}px`);
  if (style.bold) parts.push('font-weight:700');
  if (style.italic) parts.push('font-style:italic');
  if (style.color) parts.push(`color:${style.color}`);
  if (style.backgroundColor) parts.push(`background:${style.backgroundColor}`);
  if (style.align === 'center') parts.push('justify-content:center');
  if (style.align === 'right') parts.push('justify-content:flex-end');
  if (style.borderWidth && element.type === 'rect') {
    parts.push(`border:${style.borderWidth}px solid ${style.borderColor ?? '#333'}`);
  }
  return parts.join(';');
}

function snapTo(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : Math.round(value);
}

if (typeof customElements !== 'undefined' && !customElements.get('treeport-designer')) {
  customElements.define('treeport-designer', TreeportDesigner);
}
