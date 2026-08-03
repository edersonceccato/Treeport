import { LitElement, html, css, type PropertyValues, type TemplateResult } from 'lit';
import type { DataSourceTree, ReportElement, Template } from '@treeport/schema';
import { resolvePageSize } from '@treeport/schema';
import {
  TemplateEditor,
  createEmptyTemplate,
  type AlignMode,
  type BandName,
} from './model/template-editor.js';
import { PALETTE, createElement, type PaletteItemType } from './model/palette.js';
import { SNIPPETS, findSnippet } from './model/snippets.js';
import { dragBox, resizeBox, handleCursor, type Box, type Handle } from './model/interaction.js';
import { ptToMm, type RulerUnit } from './model/units.js';
import { listDesignTabs, samePath, type DesignPath } from './model/subreport-tabs.js';
import {
  describeTree,
  fieldExpression,
  findNode,
  pathToNode,
  type ExplorerField,
  type ExplorerNode,
} from './model/field-explorer.js';
import { snapToGuides, type Guide } from './model/smart-guides.js';
import { paginate, sampleRows, type PreviewPage } from './model/preview.js';

/**
 * `<treeport-designer>` — o designer visual de relatórios.
 *
 * Custom Element nativo (via Lit): funciona igual em React, Vue, Angular,
 * Next.js ou HTML puro, sem adapters por framework.
 *
 * Organização da tela:
 *
 *   ┌─── abas Designer|Preview + barra de formatação ────────────────────┐
 *   │ paleta │          a folha (A4 real)          │ propriedades/camadas │
 *   └────────────────────────────────────────────────── /dados ──────────┘
 *
 * O canvas é a folha inteira em escala, com as margens de segurança marcadas
 * e as bandas empilhadas dentro. Os elementos são `<div>`s posicionados por
 * CSS, então seleção e arrasto são DOM normal e a posição bate 1:1 com o que
 * o motor de renderização desenha.
 */
export class TreeportDesigner extends LitElement {
  static override properties = {
    template: { type: Object },
    dataSource: { type: Object },
    gridSize: { type: Number, attribute: 'grid-size' },
    showGrid: { type: Boolean, attribute: 'show-grid' },
    smartGuides: { type: Boolean, attribute: 'smart-guides' },
    unit: { type: String },
    zoom: { type: Number },
    selectedIds: { state: true },
    activeBand: { state: true },
    designPath: { state: true },
    mode: { state: true },
    sidePanel: { state: true },
    guides: { state: true },
    explorerNodeId: { state: true },
  };

  declare template: Template;
  declare dataSource: DataSourceTree | undefined;
  declare gridSize: number;
  declare showGrid: boolean;
  /** Ímã de alinhamento com os vizinhos (as guias tipo Photoshop). */
  declare smartGuides: boolean;
  declare unit: RulerUnit;
  declare zoom: number;

  declare selectedIds: string[];
  declare activeBand: BandName;
  declare designPath: DesignPath;
  declare mode: 'design' | 'preview';
  declare sidePanel: 'properties' | 'layers' | 'data';
  declare guides: Guide[];
  /** Nó escolhido no seletor de consulta do painel de dados. */
  declare explorerNodeId: string;

  private editor!: TemplateEditor;
  private selfAssigned = false;
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
  private bandDrag:
    | { band: BandName; pointerId: number; startY: number; startHeight: number }
    | undefined;

  constructor() {
    super();
    this.template = createEmptyTemplate();
    this.gridSize = 5;
    this.showGrid = true;
    this.smartGuides = true;
    this.unit = 'mm';
    this.zoom = 1;
    this.selectedIds = [];
    this.activeBand = 'details';
    this.designPath = [];
    this.mode = 'design';
    this.sidePanel = 'properties';
    this.guides = [];
    this.explorerNodeId = '';
    this.editor = new TemplateEditor(this.template, {
      onChange: (t) => this.handleChange(t),
    });
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // só recria o editor quando o template vem de fora; a atribuição interna
    // do handleChange zeraria o histórico e o undo pararia de funcionar
    if (changed.has('template') && !this.selfAssigned) {
      this.editor = new TemplateEditor(this.template, {
        onChange: (t) => this.handleChange(t),
      });
      this.selectedIds = [];
      this.designPath = [];
    }
    this.selfAssigned = false;

    if (changed.has('dataSource') && this.dataSource) {
      this.explorerNodeId = this.currentNodeId() ?? this.dataSource.root.id;
    }
  }

  private handleChange(template: Template): void {
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
        detail: { ids: [...this.selectedIds], elements: this.selection },
        bubbles: true,
        composed: true,
      }),
    );
    this.requestUpdate();
  }

  // --- API pública ----------------------------------------------------------

  get api(): TemplateEditor {
    return this.editor;
  }

  get selection(): ReportElement[] {
    return this.selectedIds
      .map((id) => this.editor.element(id))
      .filter((e): e is ReportElement => e !== undefined);
  }

  undo(): void {
    this.editor.undo();
  }

  redo(): void {
    this.editor.redo();
  }

  select(ids: string[]): void {
    this.selectedIds = [...ids];
    this.emitSelection();
  }

  deleteSelection(): void {
    this.editor.beginBatch();
    for (const id of this.selectedIds) this.editor.removeElement(id);
    this.editor.endBatch();
    this.selectedIds = [];
    this.emitSelection();
  }

  openDesign(path: DesignPath): void {
    this.editor.openDesign(path);
    this.designPath = [...path];
    this.selectedIds = [];
    this.explorerNodeId = this.currentNodeId() ?? this.explorerNodeId;
    this.emitSelection();
  }

  align(mode: AlignMode): void {
    if (this.editor.align(this.selectedIds, mode)) this.requestUpdate();
  }

  distribute(axis: 'horizontal' | 'vertical'): void {
    if (this.editor.distribute(this.selectedIds, axis)) this.requestUpdate();
  }

  /** Envolve a seleção numa região nova. */
  groupSelection(): void {
    const items = this.selection;
    if (items.length < 2) return;

    const x = Math.min(...items.map((e) => e.x));
    const y = Math.min(...items.map((e) => e.y));
    const right = Math.max(...items.map((e) => e.x + e.width));
    const bottom = Math.max(...items.map((e) => e.y + e.height));

    const region = createElement('region', x, y, {
      width: right - x,
      height: bottom - y,
    } as never);

    this.editor.beginBatch();
    const regionId = this.editor.addElement(this.activeBand, region);
    this.editor.groupIntoRegion(this.selectedIds, regionId);
    this.editor.endBatch();

    this.selectedIds = [regionId];
    this.emitSelection();
  }

  duplicateSelection(): void {
    this.editor.beginBatch();
    const ids = this.selectedIds
      .map((id) => this.editor.duplicateElement(id))
      .filter((id): id is string => id !== undefined);
    this.editor.endBatch();
    if (ids.length) this.select(ids);
  }

  private currentNodeId(): string | undefined {
    const tab = listDesignTabs(this.editor.peek()).find((t) =>
      samePath(t.path, this.designPath),
    );
    return tab?.dataSourceNodeId || this.template.boundDataSourceNodeId;
  }

  /** Campos do nó escolhido, incluindo os dos ancestrais. */
  get availableFields(): ExplorerField[] {
    if (!this.dataSource) return [];

    const root = describeTree(this.dataSource);
    const nodeId = this.explorerNodeId || this.currentNodeId();
    if (!nodeId) return [];

    const path = pathToNode(root, nodeId);
    if (!path) return [];

    const out: ExplorerField[] = [];
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const node = path[i]!;
      const depth = path.length - 1 - i;
      for (const name of node.fields) out.push({ name, nodeId: node.id, depth });
    }
    return out;
  }

  // --- geometria ------------------------------------------------------------

  private get pageSize(): { width: number; height: number } {
    const size = resolvePageSize(this.template.pageSize);
    return this.template.orientation === 'landscape'
      ? { width: size.height, height: size.width }
      : size;
  }

  private get margins(): { top: number; right: number; bottom: number; left: number } {
    return this.template.margins ?? { top: 40, right: 40, bottom: 40, left: 40 };
  }

  private get contentWidth(): number {
    return this.pageSize.width - this.margins.left - this.margins.right;
  }

  // --- interação ------------------------------------------------------------

  private onElementPointerDown(
    event: PointerEvent,
    element: ReportElement,
    band: BandName,
    handle: Handle,
  ): void {
    if (element.locked) return;

    event.preventDefault();
    event.stopPropagation();

    const multi = event.shiftKey;
    if (!this.selectedIds.includes(element.id)) {
      this.selectedIds = multi ? [...this.selectedIds, element.id] : [element.id];
      this.emitSelection();
    } else if (multi) {
      this.selectedIds = this.selectedIds.filter((id) => id !== element.id);
      this.emitSelection();
      return;
    }

    this.activeBand = band;

    const origins = new Map<string, Box>();
    for (const id of this.selectedIds) {
      const target = this.editor.element(id);
      if (target && !target.locked) {
        origins.set(id, {
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
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

    // o arrasto inteiro é um único passo de desfazer
    this.editor.beginBatch();
    capturePointer(event);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.bandDrag && this.bandDrag.pointerId === event.pointerId) {
      const delta = (event.clientY - this.bandDrag.startY) / this.zoom;
      this.editor.setBandHeight(this.bandDrag.band, this.bandDrag.startHeight + delta);
      return;
    }

    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = (event.clientX - drag.startX) / this.zoom;
    const deltaY = (event.clientY - drag.startY) / this.zoom;

    const band = this.editor.band(drag.band);
    const bounds = band ? { width: this.contentWidth, height: band.height } : undefined;

    const neighbours = (band?.elements ?? [])
      .filter((e) => !drag.origins.has(e.id) && !e.hidden)
      .map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));

    let activeGuides: Guide[] = [];

    for (const [id, origin] of drag.origins) {
      let box =
        drag.handle === 'move'
          ? dragBox(origin, deltaX, deltaY, {
              gridSize: this.gridSize,
              ...(bounds ? { bounds } : {}),
            })
          : resizeBox(origin, drag.handle, deltaX, deltaY, { gridSize: this.gridSize });

      // as guias atuam ao mover um elemento só; com vários, o ímã brigaria
      // com as posições relativas entre eles
      if (this.smartGuides && drag.handle === 'move' && drag.origins.size === 1) {
        const snapped = snapToGuides(box, neighbours, {
          pageWidth: this.contentWidth,
          ...(band ? { bandHeight: band.height } : {}),
        });
        box = snapped.box;
        activeGuides = snapped.guides;
      }

      this.editor.updateElement(id, box as Partial<ReportElement>);
    }

    this.guides = activeGuides;
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.bandDrag?.pointerId === event.pointerId) {
      this.bandDrag = undefined;
      this.editor.endBatch();
      return;
    }
    if (this.drag?.pointerId !== event.pointerId) return;

    this.drag = undefined;
    this.guides = [];
    this.editor.endBatch();
  }

  /** Arrasta a borda inferior de uma banda para mudar a altura dela. */
  private onBandResizeStart(event: PointerEvent, band: BandName): void {
    event.preventDefault();
    event.stopPropagation();

    const current = this.editor.band(band);
    if (!current) return;

    this.bandDrag = {
      band,
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: current.height,
    };
    this.editor.beginBatch();
    capturePointer(event);
  }

  private onCanvasPointerDown(): void {
    if (this.selectedIds.length > 0) {
      this.selectedIds = [];
      this.emitSelection();
    }
  }

  // --- drag para o canvas ---------------------------------------------------

  private onDragStart(event: DragEvent, payload: string, kind: string): void {
    event.dataTransfer?.setData(kind, payload);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  private onBandDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  private onBandDrop(event: DragEvent, band: BandName): void {
    event.preventDefault();

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = snapTo((event.clientX - rect.left) / this.zoom, this.gridSize);
    const y = snapTo((event.clientY - rect.top) / this.zoom, this.gridSize);

    const data = event.dataTransfer;
    if (!data) return;

    // campo do painel de dados: cria o elemento já vinculado
    const fieldJson = data.getData('text/treeport-field');
    if (fieldJson) {
      const field = JSON.parse(fieldJson) as ExplorerField;
      const element =
        field.depth === 0
          ? createElement('field', x, y, { fieldName: field.name } as never)
          : createElement('label', x, y, { content: fieldExpression(field) } as never);

      this.addAndSelect(band, element);
      return;
    }

    const snippetId = data.getData('text/treeport-snippet');
    if (snippetId) {
      const snippet = findSnippet(snippetId);
      if (snippet) this.addAndSelect(band, snippet.create(x, y, this.contentWidth));
      return;
    }

    const type = data.getData('text/treeport-element') as PaletteItemType;
    if (type) this.addAndSelect(band, createElement(type, x, y));
  }

  private addAndSelect(band: BandName, element: ReportElement): void {
    const id = this.editor.addElement(band, element);
    this.activeBand = band;
    this.selectedIds = [id];
    this.emitSelection();
  }

  // --- teclado --------------------------------------------------------------

  private onKeyDown(event: KeyboardEvent): void {
    const meta = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (meta && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (meta && key === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (meta && key === 'd') {
      event.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (meta && key === 'g') {
      event.preventDefault();
      this.groupSelection();
      return;
    }

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
      this.editor.beginBatch();
      for (const id of this.selectedIds) {
        const element = this.editor.element(id);
        if (element && !element.locked) {
          this.editor.moveElement(id, element.x + move[0], element.y + move[1]);
        }
      }
      this.editor.endBatch();
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
    }
  }

  // --- render ---------------------------------------------------------------

  override render(): TemplateResult {
    return html`
      <div class="app" @keydown=${this.onKeyDown} tabindex="0">
        ${this.renderTopBar()}
        <div class="body">
          ${this.mode === 'design' ? this.renderLeftPanel() : ''}
          <main class="stage">
            ${this.mode === 'design' ? this.renderDesignCanvas() : this.renderPreview()}
          </main>
          ${this.mode === 'design' ? this.renderRightPanel() : ''}
        </div>
      </div>
    `;
  }

  private renderTopBar(): TemplateResult {
    const selection = this.selection;
    const active = selection.length > 0;
    const style = selection[0]?.style ?? {};

    return html`
      <header class="topbar">
        <div class="tabs-main">
          <button
            class="tab-main ${this.mode === 'design' ? 'active' : ''}"
            @click=${() => (this.mode = 'design')}
          >
            ✎ Designer
          </button>
          <button
            class="tab-main ${this.mode === 'preview' ? 'active' : ''}"
            @click=${() => (this.mode = 'preview')}
          >
            ▣ Preview
          </button>
        </div>

        ${this.mode === 'preview'
          ? html`<span class="hint-inline">Paginação simulada com dados de amostra</span>
              <div class="toolgroup right">${this.zoomSelect()}</div>`
          : html`
              <div class="toolgroup">
                <button title="Desfazer (Ctrl+Z)" @click=${() => this.undo()}>↶</button>
                <button title="Refazer (Ctrl+Shift+Z)" @click=${() => this.redo()}>↷</button>
              </div>

              <div class="toolgroup">
                <select
                  title="Tamanho da fonte"
                  ?disabled=${!active}
                  @change=${(e: Event) =>
                    this.applyStyle({ fontSize: Number((e.target as HTMLSelectElement).value) })}
                >
                  ${[6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 24, 32].map(
                    (size) => html`<option
                      value=${size}
                      ?selected=${size === (style.fontSize ?? 10)}
                    >
                      ${size}
                    </option>`,
                  )}
                </select>
                <button
                  class="toggle ${style.bold ? 'on' : ''}"
                  title="Negrito"
                  ?disabled=${!active}
                  @click=${() => this.applyStyle({ bold: !style.bold })}
                >
                  <b>B</b>
                </button>
                <button
                  class="toggle ${style.italic ? 'on' : ''}"
                  title="Itálico"
                  ?disabled=${!active}
                  @click=${() => this.applyStyle({ italic: !style.italic })}
                >
                  <i>I</i>
                </button>
                <label class="color" title="Cor do texto">
                  <input
                    type="color"
                    .value=${style.color ?? '#000000'}
                    ?disabled=${!active}
                    @input=${(e: Event) =>
                      this.applyStyle({ color: (e.target as HTMLInputElement).value })}
                  />
                  <span>A</span>
                </label>
                <label class="color" title="Cor de fundo">
                  <input
                    type="color"
                    .value=${style.backgroundColor ?? '#ffffff'}
                    ?disabled=${!active}
                    @input=${(e: Event) =>
                      this.applyStyle({
                        backgroundColor: (e.target as HTMLInputElement).value,
                      })}
                  />
                  <span>▧</span>
                </label>
              </div>

              <div class="toolgroup">
                ${(
                  [
                    ['left', '⬅'],
                    ['center', '↔'],
                    ['right', '➡'],
                  ] as const
                ).map(
                  ([align, icon]) => html`
                    <button
                      class="toggle ${style.align === align ? 'on' : ''}"
                      title="Alinhar texto"
                      ?disabled=${!active}
                      @click=${() => this.applyStyle({ align })}
                    >
                      ${icon}
                    </button>
                  `,
                )}
              </div>

              <div class="toolgroup">
                ${(
                  [
                    ['left', '⇤', 'Alinhar à esquerda'],
                    ['center', '⇹', 'Centralizar na horizontal'],
                    ['right', '⇥', 'Alinhar à direita'],
                    ['top', '⇧', 'Alinhar ao topo'],
                    ['middle', '⇕', 'Centralizar na vertical'],
                    ['bottom', '⇩', 'Alinhar à base'],
                  ] as [AlignMode, string, string][]
                ).map(
                  ([mode, icon, title]) => html`
                    <button
                      title=${title}
                      ?disabled=${selection.length < 2}
                      @click=${() => this.align(mode)}
                    >
                      ${icon}
                    </button>
                  `,
                )}
                <button
                  title="Distribuir horizontalmente"
                  ?disabled=${selection.length < 3}
                  @click=${() => this.distribute('horizontal')}
                >
                  ⇿
                </button>
              </div>

              <div class="toolgroup">
                <button
                  title="Agrupar numa região (Ctrl+G)"
                  ?disabled=${selection.length < 2}
                  @click=${() => this.groupSelection()}
                >
                  ⬚
                </button>
                <button
                  title="Duplicar (Ctrl+D)"
                  ?disabled=${!active}
                  @click=${() => this.duplicateSelection()}
                >
                  ⧉
                </button>
                <button title="Excluir (Delete)" ?disabled=${!active} @click=${() =>
                  this.deleteSelection()}>
                  🗑
                </button>
              </div>

              <div class="toolgroup right">
                <label class="mini" title="Ímã de alinhamento com os vizinhos">
                  <input
                    type="checkbox"
                    .checked=${this.smartGuides}
                    @change=${(e: Event) =>
                      (this.smartGuides = (e.target as HTMLInputElement).checked)}
                  />
                  Guias
                </label>
                <select
                  title="Grade"
                  @change=${(e: Event) =>
                    (this.gridSize = Number((e.target as HTMLSelectElement).value))}
                >
                  ${[0, 5, 10].map(
                    (g) => html`<option value=${g} ?selected=${g === this.gridSize}>
                      ${g === 0 ? 'Livre' : `Grade ${g}`}
                    </option>`,
                  )}
                </select>
                ${this.zoomSelect()}
              </div>
            `}
      </header>
    `;
  }

  private zoomSelect(): TemplateResult {
    return html`
      <select
        title="Zoom"
        @change=${(e: Event) => (this.zoom = Number((e.target as HTMLSelectElement).value))}
      >
        ${[0.5, 0.75, 1, 1.25, 1.5].map(
          (z) => html`<option value=${z} ?selected=${z === this.zoom}>
            ${Math.round(z * 100)}%
          </option>`,
        )}
      </select>
    `;
  }

  private applyStyle(patch: Record<string, unknown>): void {
    this.editor.beginBatch();
    for (const id of this.selectedIds) this.editor.updateStyle(id, patch);
    this.editor.endBatch();
    this.requestUpdate();
  }

  // --- paleta ---------------------------------------------------------------

  private renderLeftPanel(): TemplateResult {
    return html`
      <aside class="panel left">
        <h3>Componentes</h3>
        <div class="palette-grid">
          ${PALETTE.map(
            (item) => html`
              <div
                class="palette-item"
                draggable="true"
                title=${item.hint}
                @dragstart=${(e: DragEvent) =>
                  this.onDragStart(e, item.type, 'text/treeport-element')}
              >
                <span class="icon">${item.icon}</span>
                <span class="label">${item.label}</span>
              </div>
            `,
          )}
        </div>

        <h3>Prontos</h3>
        <div class="snippets">
          ${SNIPPETS.map(
            (snippet) => html`
              <div
                class="snippet"
                draggable="true"
                title=${snippet.hint}
                @dragstart=${(e: DragEvent) =>
                  this.onDragStart(e, snippet.id, 'text/treeport-snippet')}
              >
                <span class="icon">${snippet.icon}</span>
                <span class="label">${snippet.label}</span>
              </div>
            `,
          )}
        </div>
      </aside>
    `;
  }

  // --- canvas ---------------------------------------------------------------

  private renderDesignCanvas(): TemplateResult {
    const { width, height } = this.pageSize;
    const z = this.zoom;
    const bands = this.editor.bands();
    const bandsHeight = bands.reduce((sum, b) => sum + b.band.height, 0);
    // a folha nunca fica menor que o papel real, mas cresce se as bandas
    // somarem mais que ele (aí o motor quebraria em várias páginas)
    const sheetHeight = Math.max(height, this.margins.top + bandsHeight + this.margins.bottom);

    return html`
      ${this.renderDesignTabs()}
      <div class="canvas-scroll">
        <div class="sheet-col" style="width:${width * z}px">
          ${this.renderRuler()}
          <div
            class="sheet"
            style="width:${width * z}px; height:${sheetHeight * z}px"
            @pointerdown=${this.onCanvasPointerDown}
            @pointermove=${this.onPointerMove}
            @pointerup=${this.onPointerUp}
            @pointercancel=${this.onPointerUp}
          >
            <div
              class="safe-area"
              style="left:${this.margins.left * z}px; top:${this.margins.top * z}px;
                     width:${this.contentWidth * z}px;
                     height:${(sheetHeight - this.margins.top - this.margins.bottom) * z}px"
            ></div>

            <div
              class="bands"
              style="left:${this.margins.left * z}px; top:${this.margins.top * z}px;
                     width:${this.contentWidth * z}px"
            >
              ${bands.map(({ name, band }) => this.renderBand(name, band.height))}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderDesignTabs(): TemplateResult | string {
    const tabs = listDesignTabs(this.editor.peek());
    if (tabs.length <= 1) return '';

    return html`
      <nav class="subtabs">
        ${tabs.map(
          (tab) => html`
            <button
              class="subtab ${samePath(tab.path, this.designPath) ? 'active' : ''}"
              title=${tab.dataSourceNodeId}
              @click=${() => this.openDesign(tab.path)}
            >
              ${tab.depth > 0 ? '↳ ' : ''}${tab.label}
            </button>
          `,
        )}
      </nav>
    `;
  }

  private renderRuler(): TemplateResult {
    const width = this.pageSize.width;
    const step = this.unit === 'mm' ? 10 * (72 / 25.4) : 72;
    const marks: TemplateResult[] = [];

    for (let pt = 0; pt <= width; pt += step) {
      const value = this.unit === 'mm' ? Math.round(ptToMm(pt)) : Math.round(pt / 72);
      marks.push(html`<span class="tick" style="left:${pt * this.zoom}px">${value}</span>`);
    }

    return html`<div class="ruler">${marks}</div>`;
  }

  private renderBand(name: BandName, height: number): TemplateResult {
    const band = this.editor.band(name)!;
    const label = { header: 'Cabeçalho', details: 'Detalhe', footer: 'Rodapé' }[name];
    const z = this.zoom;

    return html`
      <section
        class="band ${name === this.activeBand ? 'active' : ''}"
        style="height:${height * z}px; ${this.gridStyle()}"
        @dragover=${this.onBandDragOver}
        @drop=${(e: DragEvent) => this.onBandDrop(e, name)}
        @pointerdown=${() => (this.activeBand = name)}
      >
        <span class="band-tag">
          ${label}<em>${Math.round(height)}pt${name === 'details' ? ' · repete' : ''}</em>
        </span>

        ${band.elements.map((element) => this.renderElement(element, name, 0, 0))}
        ${name === this.activeBand ? this.renderGuides(height) : ''}

        <div
          class="band-resize"
          title="Arraste para mudar a altura do ${label.toLowerCase()}"
          @pointerdown=${(e: PointerEvent) => this.onBandResizeStart(e, name)}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerUp}
        ></div>
      </section>
    `;
  }

  private renderGuides(bandHeight: number): TemplateResult {
    const z = this.zoom;

    return html`${this.guides.map((guide) => {
      const start = Math.max(0, guide.start);

      return guide.orientation === 'vertical'
        ? html`<div
            class="guide vertical ${guide.kind}"
            style="left:${guide.position * z}px; top:${start * z}px;
                   height:${Math.min(bandHeight - start, guide.end - start) * z}px"
          ></div>`
        : html`<div
            class="guide horizontal ${guide.kind}"
            style="top:${guide.position * z}px; left:${start * z}px;
                   width:${(guide.end - start) * z}px"
          ></div>`;
    })}`;
  }

  /**
   * Desenha um elemento. `offsetX`/`offsetY` acumulam a origem das regiões
   * ancestrais, porque os filhos guardam coordenada relativa a elas.
   */
  private renderElement(
    element: ReportElement,
    band: BandName,
    offsetX: number,
    offsetY: number,
  ): TemplateResult | string {
    if (element.hidden) return '';

    const selected = this.selectedIds.includes(element.id);
    const z = this.zoom;
    const x = offsetX + element.x;
    const y = offsetY + element.y;

    return html`
      <div
        class="element type-${element.type} ${selected ? 'selected' : ''} ${element.locked
          ? 'locked'
          : ''}"
        style="left:${x * z}px; top:${y * z}px; width:${element.width * z}px;
               height:${Math.max(element.height, 2) * z}px; ${elementStyle(element)}"
        @pointerdown=${(e: PointerEvent) => this.onElementPointerDown(e, element, band, 'move')}
        @dblclick=${() => {
          if (element.type === 'subreport') {
            this.openDesign([...this.designPath, element.id]);
          }
        }}
      >
        ${element.type === 'region'
          ? html`
              <span class="region-tag">${element.name ?? 'Região'}</span>
              ${element.elements.map((child) => this.renderElement(child, band, x, y))}
            `
          : html`<span class="element-label">${elementLabel(element)}</span>`}
        ${selected && !element.locked ? this.renderHandles(element, band) : ''}
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
            this.onElementPointerDown(e, element, band, handle)}
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

  // --- painel direito -------------------------------------------------------

  private renderRightPanel(): TemplateResult {
    return html`
      <aside class="panel right">
        <div class="panel-tabs">
          ${(
            [
              ['properties', 'Propriedades'],
              ['layers', 'Camadas'],
              ['data', 'Dados'],
            ] as const
          ).map(
            ([key, label]) => html`
              <button
                class="panel-tab ${this.sidePanel === key ? 'active' : ''}"
                @click=${() => (this.sidePanel = key)}
              >
                ${label}
              </button>
            `,
          )}
        </div>
        <div class="panel-body">
          ${this.sidePanel === 'properties'
            ? this.renderProperties()
            : this.sidePanel === 'layers'
              ? this.renderLayers()
              : this.renderDataPanel()}
        </div>
      </aside>
    `;
  }

  private renderProperties(): TemplateResult {
    const selection = this.selection;

    if (selection.length === 0) return this.renderPageProperties();
    if (selection.length > 1) {
      return html`<p class="empty">
        ${selection.length} elementos selecionados. Use os botões de alinhar na barra, ou
        agrupe com Ctrl+G.
      </p>`;
    }

    const el = selection[0]!;
    const inRegion = this.editor.locate(el.id)?.parentRegionId;

    return html`
      <div class="prop-title">${el.type}</div>

      <div class="prop-grid">
        ${this.numberField('X', el.x, (v) => this.patch(el.id, { x: v }))}
        ${this.numberField('Y', el.y, (v) => this.patch(el.id, { y: v }))}
        ${this.numberField('Largura', el.width, (v) => this.patch(el.id, { width: v }))}
        ${this.numberField('Altura', el.height, (v) => this.patch(el.id, { height: v }))}
      </div>
      ${inRegion ? html`<p class="tip">Coordenadas relativas à região.</p>` : ''}

      ${this.typeSpecificProps(el)}

      <label class="check">
        <input
          type="checkbox"
          .checked=${el.canGrow ?? false}
          @change=${(e: Event) =>
            this.patch(el.id, { canGrow: (e.target as HTMLInputElement).checked })}
        />
        Cresce com o conteúdo
      </label>

      ${inRegion
        ? html`<button class="wide" @click=${() => this.ungroup(el.id)}>
            Tirar da região
          </button>`
        : ''}
    `;
  }

  private renderPageProperties(): TemplateResult {
    const m = this.margins;

    return html`
      <div class="prop-title">Página</div>

      <label class="row">
        <span>Tamanho</span>
        <select
          .value=${typeof this.template.pageSize === 'string' ? this.template.pageSize : 'A4'}
          @change=${(e: Event) =>
            this.editor.updateTemplate({
              pageSize: (e.target as HTMLSelectElement).value as 'A4' | 'Letter',
            })}
        >
          <option value="A4">A4 · 210×297mm</option>
          <option value="Letter">Letter</option>
        </select>
      </label>

      <label class="row">
        <span>Orientação</span>
        <select
          .value=${this.template.orientation ?? 'portrait'}
          @change=${(e: Event) =>
            this.editor.updateTemplate({
              orientation: (e.target as HTMLSelectElement).value as 'portrait' | 'landscape',
            })}
        >
          <option value="portrait">Retrato</option>
          <option value="landscape">Paisagem</option>
        </select>
      </label>

      <div class="prop-title spaced">Margens (pt)</div>
      <div class="prop-grid">
        ${(
          [
            ['top', 'Topo'],
            ['right', 'Direita'],
            ['bottom', 'Base'],
            ['left', 'Esquerda'],
          ] as const
        ).map(([side, label]) =>
          this.numberField(label, m[side], (v) =>
            this.editor.updateTemplate({ margins: { ...m, [side]: v } }),
          ),
        )}
      </div>

      <div class="prop-title spaced">Altura das bandas (pt)</div>
      ${this.editor.bands().map(
        ({ name, band }) => html`
          <label class="row">
            <span>${{ header: 'Cabeçalho', details: 'Detalhe', footer: 'Rodapé' }[name]}</span>
            <input
              type="number"
              .value=${String(Math.round(band.height))}
              @change=${(e: Event) =>
                this.editor.setBandHeight(name, Number((e.target as HTMLInputElement).value))}
            />
          </label>
        `,
      )}
      <p class="tip">Também dá para arrastar a borda inferior de cada banda na folha.</p>
    `;
  }

  private typeSpecificProps(el: ReportElement): TemplateResult | string {
    switch (el.type) {
      case 'label':
        return html`
          <label class="row stacked">
            <span>Texto / expressão</span>
            <textarea
              rows="2"
              .value=${el.content}
              @change=${(e: Event) =>
                this.patch(el.id, { content: (e.target as HTMLTextAreaElement).value })}
            ></textarea>
          </label>
          <p class="tip">
            <code>{{campo}}</code> insere um valor; <code>{{sys.pageNumber}}</code> numera a
            página.
          </p>
        `;

      case 'field':
        return html`
          <label class="row">
            <span>Campo</span>
            <select
              .value=${el.fieldName}
              @change=${(e: Event) =>
                this.patch(el.id, { fieldName: (e.target as HTMLSelectElement).value })}
            >
              <option value="">(escolha)</option>
              ${this.availableFields.map(
                (f) => html`<option value=${f.name}>${f.name}</option>`,
              )}
            </select>
          </label>
          ${this.textRow('Formato', el.format ?? '', (v) => this.patch(el.id, { format: v }))}
        `;

      case 'barcode':
        return html`
          <label class="row">
            <span>Simbologia</span>
            <select
              .value=${el.format}
              @change=${(e: Event) =>
                this.patch(el.id, { format: (e.target as HTMLSelectElement).value })}
            >
              ${['code128', 'ean13', 'code39'].map((f) => html`<option>${f}</option>`)}
            </select>
          </label>
          ${this.textRow('Valor', el.valueExpression, (v) =>
            this.patch(el.id, { valueExpression: v }),
          )}
        `;

      case 'qrcode':
        return this.textRow('Valor', el.valueExpression, (v) =>
          this.patch(el.id, { valueExpression: v }),
        );

      case 'image':
        return this.textRow('Origem', el.source, (v) => this.patch(el.id, { source: v }));

      case 'subreport':
        return html`
          <label class="row">
            <span>Consulta</span>
            <select
              .value=${el.dataSourceNodeId}
              @change=${(e: Event) =>
                this.patch(el.id, { dataSourceNodeId: (e.target as HTMLSelectElement).value })}
            >
              <option value="">(escolha)</option>
              ${this.childNodeOptions()}
            </select>
          </label>
          <button class="wide" @click=${() => this.openDesign([...this.designPath, el.id])}>
            Editar design deste subrelatório
          </button>
        `;

      case 'region':
        return html`
          <label class="check">
            <input
              type="checkbox"
              .checked=${el.autoHeight ?? false}
              @change=${(e: Event) =>
                this.patch(el.id, { autoHeight: (e.target as HTMLInputElement).checked })}
            />
            Altura automática
          </label>
          <p class="tip">${el.elements.length} elemento(s) dentro. Mover a região move todos.</p>
        `;

      default:
        return '';
    }
  }

  private childNodeOptions(): TemplateResult[] {
    if (!this.dataSource) return [];

    const root = describeTree(this.dataSource);
    const current = findNode(root, this.currentNodeId() ?? root.id);

    return (current?.children ?? []).map(
      (child) => html`<option value=${child.id}>${child.name}</option>`,
    );
  }

  private renderLayers(): TemplateResult {
    return html`
      <div class="layers">
        ${this.editor.bands().map(
          ({ name, band }) => html`
            <div class="layer-group-title">
              ${{ header: 'Cabeçalho', details: 'Detalhe', footer: 'Rodapé' }[name]}
            </div>
            ${band.elements.length === 0
              ? html`<p class="empty small">vazio</p>`
              : // invertido: o desenhado por último aparece no topo da lista
                [...band.elements].reverse().map((el) => this.renderLayerRow(el, 0))}
          `,
        )}
      </div>
    `;
  }

  private renderLayerRow(element: ReportElement, depth: number): TemplateResult {
    const selected = this.selectedIds.includes(element.id);

    return html`
      <div
        class="layer ${selected ? 'selected' : ''}"
        style="padding-left:${6 + depth * 12}px"
        @click=${() => this.select([element.id])}
      >
        <span class="layer-icon">${typeIcon(element.type)}</span>
        <span class="layer-name" title=${element.id}>${elementLabel(element)}</span>

        <button
          class="layer-btn"
          title=${element.hidden ? 'Mostrar' : 'Ocultar'}
          @click=${(e: Event) => {
            e.stopPropagation();
            this.editor.setHidden(element.id, !element.hidden);
            this.requestUpdate();
          }}
        >
          ${element.hidden ? '◌' : '◉'}
        </button>
        <button
          class="layer-btn"
          title=${element.locked ? 'Destravar' : 'Travar'}
          @click=${(e: Event) => {
            e.stopPropagation();
            this.editor.setLocked(element.id, !element.locked);
            this.requestUpdate();
          }}
        >
          ${element.locked ? '🔒' : '🔓'}
        </button>
        <button
          class="layer-btn"
          title="Duplicar"
          @click=${(e: Event) => {
            e.stopPropagation();
            const id = this.editor.duplicateElement(element.id);
            if (id) this.select([id]);
          }}
        >
          ⧉
        </button>
        <button
          class="layer-btn"
          title="Excluir"
          @click=${(e: Event) => {
            e.stopPropagation();
            this.editor.removeElement(element.id);
            this.selectedIds = this.selectedIds.filter((id) => id !== element.id);
            this.emitSelection();
          }}
        >
          ✕
        </button>
      </div>
      ${element.type === 'region'
        ? [...element.elements].reverse().map((child) => this.renderLayerRow(child, depth + 1))
        : ''}
    `;
  }

  private renderDataPanel(): TemplateResult {
    if (!this.dataSource) {
      return html`<p class="empty">
        Nenhuma fonte de dados. Defina a propriedade <code>dataSource</code> com a árvore de
        consultas.
      </p>`;
    }

    const root = describeTree(this.dataSource);
    const nodes = flattenExplorer(root);
    const fields = this.availableFields;

    return html`
      <label class="row">
        <span>Consulta</span>
        <select
          .value=${this.explorerNodeId || root.id}
          @change=${(e: Event) => (this.explorerNodeId = (e.target as HTMLSelectElement).value)}
        >
          ${nodes.map(
            ({ node, depth }) => html`
              <option value=${node.id}>
                ${'— '.repeat(depth)}${node.name}${depth === 0 ? ' (master)' : ''}
              </option>
            `,
          )}
        </select>
      </label>

      <p class="tip">
        Arraste um campo para a folha. Campos de consultas acima entram como
        <code>{{parent.campo}}</code>.
      </p>

      <div class="fields">
        ${fields.length === 0
          ? html`<p class="empty small">Esta consulta não declarou campos.</p>`
          : fields.map(
              (field) => html`
                <div
                  class="field"
                  draggable="true"
                  title=${field.depth === 0
                    ? field.nodeId
                    : `${field.nodeId} — ${field.depth} nível(is) acima`}
                  @dragstart=${(e: DragEvent) =>
                    this.onDragStart(e, JSON.stringify(field), 'text/treeport-field')}
                >
                  <span class="field-icon">{}</span>
                  <span class="field-name">${field.name}</span>
                  ${field.depth > 0
                    ? html`<span class="field-up">${'↑'.repeat(field.depth)}</span>`
                    : ''}
                </div>
              `,
            )}
      </div>
    `;
  }

  // --- preview --------------------------------------------------------------

  private renderPreview(): TemplateResult {
    const fields = this.availableFields.filter((f) => f.depth === 0).map((f) => f.name);
    const rows = sampleRows(fields.length ? fields : ['campo'], 25);
    const result = paginate(this.template, { rows });

    return html`
      <div class="preview-scroll">
        ${result.pages.map((page) =>
          this.renderPreviewPage(page, result.pageWidth, result.pageHeight, result.pages.length),
        )}
        ${result.truncated ? html`<p class="empty">Preview limitado às primeiras páginas.</p>` : ''}
      </div>
    `;
  }

  private renderPreviewPage(
    page: PreviewPage,
    pageWidth: number,
    pageHeight: number,
    totalPages: number,
  ): TemplateResult {
    const z = this.zoom;
    const m = this.margins;

    return html`
      <div class="preview-page-wrap">
        <div class="preview-number">Página ${page.number} de ${totalPages}</div>
        <div class="sheet preview" style="width:${pageWidth * z}px; height:${pageHeight * z}px">
          ${page.blocks.map(
            (block) => html`
              <div
                class="preview-block"
                style="left:${m.left * z}px; top:${block.y * z}px;
                       width:${this.contentWidth * z}px; height:${block.height * z}px"
              >
                ${block.elements.map((element) =>
                  this.renderPreviewElement(element, block.row, page.number, totalPages, 0, 0),
                )}
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderPreviewElement(
    element: ReportElement,
    row: Record<string, unknown>,
    pageNumber: number,
    totalPages: number,
    offsetX: number,
    offsetY: number,
  ): TemplateResult | string {
    if (element.hidden) return '';

    const z = this.zoom;
    const x = offsetX + element.x;
    const y = offsetY + element.y;

    return html`
      <div
        class="preview-element type-${element.type}"
        style="left:${x * z}px; top:${y * z}px; width:${element.width * z}px;
               height:${Math.max(element.height, 2) * z}px; ${elementStyle(element)}"
      >
        ${element.type === 'region'
          ? html`${element.elements.map((child) =>
              this.renderPreviewElement(child, row, pageNumber, totalPages, x, y),
            )}`
          : previewText(element, row, pageNumber, totalPages)}
      </div>
    `;
  }

  // --- utilidades -----------------------------------------------------------

  private patch(elementId: string, patch: Record<string, unknown>): void {
    this.editor.updateElement(elementId, patch as Partial<ReportElement>);
    this.requestUpdate();
  }

  private ungroup(elementId: string): void {
    this.editor.ungroupFromRegion(elementId);
    this.requestUpdate();
  }

  private numberField(
    label: string,
    value: number,
    onChange: (value: number) => void,
  ): TemplateResult {
    return html`
      <label class="num">
        <span>${label}</span>
        <input
          type="number"
          .value=${String(Math.round(value))}
          @change=${(e: Event) => onChange(Number((e.target as HTMLInputElement).value))}
        />
      </label>
    `;
  }

  private textRow(
    label: string,
    value: string,
    onChange: (value: string) => void,
  ): TemplateResult {
    return html`
      <label class="row">
        <span>${label}</span>
        <input
          .value=${value}
          @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
        />
      </label>
    `;
  }

  static override styles = css`
    :host {
      --tp-accent: #2563eb;
      --tp-accent-soft: #dbeafe;
      --tp-border: #d8dce2;
      --tp-grid: #eef1f5;
      --tp-bg: #ffffff;
      --tp-panel: #f7f8fa;
      --tp-chrome: #e9ecf1;
      --tp-text: #1f2937;
      --tp-muted: #6b7280;
      --tp-guide: #ec4899;

      display: block;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: var(--tp-text);
      background: var(--tp-chrome);
      border: 1px solid var(--tp-border);
      border-radius: 8px;
      overflow: hidden;
    }

    .app {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 600px;
      outline: none;
    }

    .topbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: var(--tp-panel);
      border-bottom: 1px solid var(--tp-border);
      flex-wrap: wrap;
    }

    .tabs-main {
      display: flex;
      gap: 2px;
    }

    .tab-main {
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 5px 12px;
      border: 1px solid transparent;
      border-radius: 5px;
      background: transparent;
      color: var(--tp-muted);
      cursor: pointer;
    }

    .tab-main.active {
      background: var(--tp-bg);
      border-color: var(--tp-border);
      color: var(--tp-accent);
    }

    .toolgroup {
      display: flex;
      align-items: center;
      gap: 2px;
      padding-left: 8px;
      border-left: 1px solid var(--tp-border);
    }

    .toolgroup.right {
      margin-left: auto;
      border-left: none;
    }

    .topbar button {
      font: inherit;
      font-size: 12px;
      min-width: 26px;
      height: 26px;
      padding: 0 6px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: var(--tp-text);
      cursor: pointer;
    }

    .topbar button:hover:not(:disabled) {
      background: var(--tp-bg);
      border-color: var(--tp-border);
    }

    .topbar button:disabled {
      opacity: 0.32;
      cursor: default;
    }

    .topbar button.toggle.on {
      background: var(--tp-accent-soft);
      border-color: var(--tp-accent);
      color: var(--tp-accent);
    }

    .topbar select {
      font: inherit;
      font-size: 12px;
      height: 26px;
      padding: 0 4px;
      border: 1px solid var(--tp-border);
      border-radius: 4px;
      background: var(--tp-bg);
      color: inherit;
    }

    .topbar .color {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    .topbar .color:hover {
      background: var(--tp-bg);
    }

    .topbar .color input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }

    .topbar .mini {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--tp-muted);
      margin-right: 4px;
    }

    .hint-inline {
      font-size: 12px;
      color: var(--tp-muted);
    }

    .body {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
    }

    .panel {
      background: var(--tp-panel);
      display: flex;
      flex-direction: column;
      flex: 0 0 auto;
      overflow: hidden;
    }

    .panel.left {
      width: 132px;
      border-right: 1px solid var(--tp-border);
      overflow-y: auto;
      padding: 8px;
    }

    .panel.right {
      width: 252px;
      border-left: 1px solid var(--tp-border);
    }

    .panel h3 {
      margin: 6px 0;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--tp-muted);
    }

    .palette-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
    }

    .palette-item,
    .snippet {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 7px 3px;
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 5px;
      cursor: grab;
      user-select: none;
      text-align: center;
    }

    .palette-item:hover,
    .snippet:hover {
      border-color: var(--tp-accent);
      background: var(--tp-accent-soft);
    }

    .palette-item .icon,
    .snippet .icon {
      font-size: 13px;
      color: var(--tp-muted);
    }

    .palette-item .label,
    .snippet .label {
      font-size: 9px;
      line-height: 1.15;
      color: var(--tp-muted);
    }

    .snippets {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .snippet {
      flex-direction: row;
      justify-content: flex-start;
      text-align: left;
      padding: 6px 7px;
      gap: 6px;
    }

    .snippet .label {
      font-size: 10px;
    }

    .stage {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .subtabs {
      display: flex;
      gap: 2px;
      padding: 6px 12px 0;
    }

    .subtab {
      font: inherit;
      font-size: 11px;
      padding: 4px 10px;
      border: 1px solid var(--tp-border);
      border-bottom: none;
      border-radius: 4px 4px 0 0;
      background: var(--tp-panel);
      color: var(--tp-muted);
      cursor: pointer;
    }

    .subtab.active {
      background: var(--tp-bg);
      color: var(--tp-accent);
      font-weight: 600;
    }

    .canvas-scroll,
    .preview-scroll {
      flex: 1 1 auto;
      overflow: auto;
      padding: 16px 24px 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .preview-scroll {
      gap: 22px;
    }

    .sheet-col {
      flex: 0 0 auto;
    }

    .ruler {
      position: relative;
      height: 15px;
      font-size: 8px;
      color: var(--tp-muted);
      overflow: hidden;
    }

    .ruler .tick {
      position: absolute;
      bottom: 3px;
      transform: translateX(-50%);
    }

    .ruler .tick::after {
      content: '';
      position: absolute;
      left: 50%;
      bottom: -3px;
      height: 3px;
      border-left: 1px solid #b8bfc9;
    }

    .sheet {
      position: relative;
      background: var(--tp-bg);
      box-shadow:
        0 1px 3px rgba(15, 23, 42, 0.16),
        0 10px 28px rgba(15, 23, 42, 0.09);
      border-radius: 2px;
    }

    .safe-area {
      position: absolute;
      border: 1px dashed #c7d2dd;
      pointer-events: none;
    }

    .bands {
      position: absolute;
    }

    .band {
      position: relative;
      box-sizing: border-box;
      border-bottom: 1px solid #e4e8ee;
    }

    .band.active {
      box-shadow: inset 2px 0 0 var(--tp-accent);
    }

    .band-tag {
      position: absolute;
      top: 0;
      left: 100%;
      margin-left: 9px;
      font-size: 9px;
      color: var(--tp-muted);
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    }

    .band-tag em {
      display: block;
      font-style: normal;
      opacity: 0.6;
      font-size: 8px;
    }

    .band-resize {
      position: absolute;
      left: 0;
      right: 0;
      bottom: -3px;
      height: 7px;
      cursor: ns-resize;
      z-index: 5;
    }

    .band-resize:hover {
      background: var(--tp-accent);
      opacity: 0.3;
    }

    .element {
      position: absolute;
      box-sizing: border-box;
      border: 1px solid transparent;
      cursor: move;
      user-select: none;
      display: flex;
      align-items: center;
    }

    .element:hover {
      border-color: #c7d2dd;
    }

    .element.selected {
      border-color: var(--tp-accent);
      box-shadow: 0 0 0 1px var(--tp-accent);
    }

    .element.locked {
      cursor: not-allowed;
      opacity: 0.7;
    }

    .element-label {
      padding: 0 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      font-size: inherit;
    }

    .type-line {
      border-top: 1px solid var(--tp-text);
      align-items: flex-start;
    }

    .type-region {
      border: 1px dashed #94a3b8;
      align-items: flex-start;
    }

    .region-tag {
      position: absolute;
      top: 0;
      left: 0;
      font-size: 8px;
      padding: 0 3px;
      background: #94a3b8;
      color: #fff;
      border-radius: 0 0 3px 0;
      pointer-events: none;
    }

    .type-barcode,
    .type-qrcode,
    .type-image,
    .type-subreport {
      background: repeating-linear-gradient(
        45deg,
        #f8fafc,
        #f8fafc 5px,
        #eef2f7 5px,
        #eef2f7 10px
      );
      border-color: #cbd5e1;
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
      z-index: 6;
    }

    .handle-nw { left: -4px; top: -4px; }
    .handle-n { left: 50%; top: -4px; margin-left: -3px; }
    .handle-ne { right: -4px; top: -4px; }
    .handle-e { right: -4px; top: 50%; margin-top: -3px; }
    .handle-se { right: -4px; bottom: -4px; }
    .handle-s { left: 50%; bottom: -4px; margin-left: -3px; }
    .handle-sw { left: -4px; bottom: -4px; }
    .handle-w { left: -4px; top: 50%; margin-top: -3px; }

    .guide {
      position: absolute;
      pointer-events: none;
      z-index: 7;
    }

    .guide.vertical {
      width: 0;
      border-left: 1px dashed var(--tp-guide);
    }

    .guide.horizontal {
      height: 0;
      border-top: 1px dashed var(--tp-guide);
    }

    .guide.page {
      border-color: #38bdf8;
    }

    .panel-tabs {
      display: flex;
      border-bottom: 1px solid var(--tp-border);
      flex: 0 0 auto;
    }

    .panel-tab {
      flex: 1;
      font: inherit;
      font-size: 11px;
      padding: 8px 4px;
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--tp-muted);
      cursor: pointer;
    }

    .panel-tab.active {
      color: var(--tp-accent);
      border-bottom-color: var(--tp-accent);
      font-weight: 600;
      background: var(--tp-bg);
    }

    .panel-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 10px;
    }

    .prop-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--tp-muted);
      margin-bottom: 7px;
    }

    .prop-title.spaced {
      margin-top: 12px;
    }

    .prop-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
      margin-bottom: 8px;
    }

    .num {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .num span {
      font-size: 10px;
      color: var(--tp-muted);
    }

    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }

    .row.stacked {
      flex-direction: column;
      align-items: stretch;
      gap: 3px;
    }

    .row > span {
      flex: 0 0 70px;
      font-size: 10px;
      color: var(--tp-muted);
    }

    .row.stacked > span {
      flex: none;
    }

    input,
    select,
    textarea {
      font: inherit;
      font-size: 11px;
      padding: 4px 5px;
      border: 1px solid var(--tp-border);
      border-radius: 4px;
      background: var(--tp-bg);
      color: inherit;
      min-width: 0;
      flex: 1;
      box-sizing: border-box;
      width: 100%;
    }

    textarea {
      resize: vertical;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    }

    .check {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--tp-muted);
      margin: 8px 0;
    }

    .check input {
      flex: none;
      width: auto;
    }

    button.wide {
      width: 100%;
      font: inherit;
      font-size: 11px;
      padding: 6px;
      margin-top: 4px;
      border: 1px solid var(--tp-border);
      border-radius: 4px;
      background: var(--tp-bg);
      cursor: pointer;
    }

    button.wide:hover {
      border-color: var(--tp-accent);
      color: var(--tp-accent);
    }

    .tip {
      font-size: 10px;
      color: var(--tp-muted);
      margin: 4px 0 8px;
      line-height: 1.45;
    }

    code {
      background: var(--tp-chrome);
      padding: 0 3px;
      border-radius: 3px;
      font-size: 10px;
    }

    .empty {
      font-size: 11px;
      color: #9ca3af;
      line-height: 1.5;
    }

    .empty.small {
      font-size: 10px;
      margin: 2px 0 6px 8px;
    }

    .layer-group-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--tp-muted);
      margin: 8px 0 3px;
    }

    .layer {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 3px 4px 3px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    }

    .layer:hover {
      background: var(--tp-chrome);
    }

    .layer.selected {
      background: var(--tp-accent-soft);
      color: var(--tp-accent);
    }

    .layer-icon {
      flex: 0 0 14px;
      color: var(--tp-muted);
      font-size: 10px;
    }

    .layer-name {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .layer-btn {
      flex: 0 0 auto;
      font: inherit;
      font-size: 9px;
      width: 17px;
      height: 17px;
      padding: 0;
      border: none;
      border-radius: 3px;
      background: transparent;
      cursor: pointer;
      opacity: 0.55;
    }

    .layer-btn:hover {
      opacity: 1;
      background: var(--tp-bg);
    }

    .fields {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .field {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 6px;
      background: var(--tp-bg);
      border: 1px solid var(--tp-border);
      border-radius: 4px;
      cursor: grab;
      user-select: none;
      font-size: 11px;
    }

    .field:hover {
      border-color: var(--tp-accent);
      background: var(--tp-accent-soft);
    }

    .field-icon {
      color: var(--tp-muted);
      font-size: 9px;
    }

    .field-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .field-up {
      font-size: 9px;
      color: var(--tp-accent);
    }

    .preview-page-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
    }

    .preview-number {
      font-size: 10px;
      color: var(--tp-muted);
    }

    .sheet.preview {
      overflow: hidden;
    }

    .preview-block {
      position: absolute;
    }

    .preview-element {
      position: absolute;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      overflow: hidden;
      white-space: nowrap;
    }
  `;
}

function typeIcon(type: ReportElement['type']): string {
  const icons: Record<string, string> = {
    label: 'T',
    field: '{}',
    line: '—',
    rect: '▭',
    image: '🖼',
    barcode: '|||',
    qrcode: '▣',
    subreport: '⊞',
    region: '⬚',
    table: '▦',
  };
  return icons[type] ?? '•';
}

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
      return `⊞ ${element.dataSourceNodeId || '(sem consulta)'}`;
    case 'region':
      return element.name ?? 'Região';
    case 'table':
      return 'Tabela';
    default:
      return '';
  }
}

/**
 * Texto aproximado no preview.
 *
 * Resolve campos simples e as variáveis de sistema; expressão composta fica
 * marcada com ⟨⟩ em vez de avaliada — replicar o motor aqui duplicaria código
 * e daria margem a divergência com o PDF real.
 */
function previewText(
  element: ReportElement,
  row: Record<string, unknown>,
  pageNumber: number,
  totalPages: number,
): string {
  if (element.type === 'field') {
    const value = row[element.fieldName];
    return value === undefined || value === null ? '' : String(value);
  }
  if (element.type !== 'label') return elementLabel(element);

  return element.content.replace(/\{\{([\s\S]*?)\}\}/g, (_m, raw: string) => {
    const expression = raw.trim();

    if (expression === 'sys.pageNumber') return String(pageNumber);
    if (expression === 'sys.totalPages') return String(totalPages);
    if (expression.startsWith('sys.now')) return new Date().toLocaleDateString('pt-BR');

    const direct = row[expression];
    if (direct !== undefined) return String(direct);

    const inner = /^FORMAT\(\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(expression);
    if (inner?.[1] && row[inner[1]] !== undefined) return String(row[inner[1]]);

    return `⟨${expression}⟩`;
  });
}

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
  if (style.borderWidth && (element.type === 'rect' || element.type === 'region')) {
    parts.push(`border:${style.borderWidth}px solid ${style.borderColor ?? '#333'}`);
  }
  return parts.join(';');
}

/** Achata a árvore de consultas para o `<select>` do painel de dados. */
function flattenExplorer(
  node: ExplorerNode,
  depth = 0,
): { node: ExplorerNode; depth: number }[] {
  return [
    { node, depth },
    ...node.children.flatMap((child) => flattenExplorer(child, depth + 1)),
  ];
}

/**
 * Captura o ponteiro para o arrasto continuar mesmo saindo do elemento.
 * Falha em ponteiro sintético (testes), e aí seguir sem captura é aceitável.
 */
function capturePointer(event: PointerEvent): void {
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    // sem captura: o arrasto ainda funciona enquanto o cursor estiver sobre a folha
  }
}

function snapTo(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : Math.round(value);
}

if (typeof customElements !== 'undefined' && !customElements.get('treeport-designer')) {
  customElements.define('treeport-designer', TreeportDesigner);
}
