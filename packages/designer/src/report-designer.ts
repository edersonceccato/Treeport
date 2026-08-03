import { LitElement, html, css, type PropertyValues, type TemplateResult } from 'lit';
import type {
  BarcodeElement,
  DataSourceTree,
  QrCodeElement,
  ReportElement,
  ShapeKind,
  Template,
} from '@treeport/schema';
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
import { snippetGroups } from './model/snippets.js';
import { renderCode, peekCode, codeKey, isCodeError } from './model/code-preview.js';
import { suggestFormats, guessFieldKind, KIND_LABEL } from './model/formats.js';

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
    editingId: { state: true },
    codeVersion: { state: true },
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
  /** Elemento em edição inline de texto (duplo clique). */
  declare editingId: string;
  /** Sobe quando um código é gerado, para forçar o redesenho. */
  declare codeVersion: number;

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
    this.editingId = '';
    this.codeVersion = 0;
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

    const finished = this.drag;
    this.drag = undefined;
    this.guides = [];

    // arrastar para dentro/fora de uma região reparenta o elemento (item 11)
    if (finished?.handle === 'move' && finished.origins.size === 1) {
      this.reparentAfterDrag(finished.band, [...finished.origins.keys()][0]!);
    }

    this.editor.endBatch();
  }

  /** Move o elemento para dentro da região sob ele, ou o tira dela. */
  private reparentAfterDrag(band: BandName, elementId: string): void {
    const element = this.editor.element(elementId);
    if (!element || element.type === 'region') return;

    const at = this.editor.locate(elementId);
    const parentId = at?.parentRegionId;

    if (parentId) {
      // já está numa região: saiu dos limites dela?
      const region = this.editor.element(parentId);
      if (!region) return;

      const dentro =
        element.x >= 0 &&
        element.y >= 0 &&
        element.x <= region.width &&
        element.y <= region.height;

      if (!dentro) this.editor.ungroupFromRegion(elementId);
      return;
    }

    const region = this.regionAt(band, element.x, element.y);
    if (region) this.editor.groupIntoRegion([elementId], region.id);
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

  /**
   * Insere um componente no centro da banda ativa (item 4 do feedback).
   * O drag-and-drop continua valendo; isto é o atalho de um clique só.
   */
  private insertAtActiveBand(create: (x: number, y: number) => ReportElement): void {
    const band = this.editor.band(this.activeBand);
    if (!band) return;

    const element = create(0, 0);
    // centraliza na largura e põe num terço da altura da banda
    const x = snapTo(Math.max(0, (this.contentWidth - element.width) / 2), this.gridSize);
    const y = snapTo(Math.max(0, Math.min(band.height / 3, band.height - element.height)), this.gridSize);

    this.addAndSelect(this.activeBand, { ...element, x, y } as ReportElement);
  }

  private addAndSelect(band: BandName, element: ReportElement): void {
    const id = this.editor.addElement(band, element);
    this.activeBand = band;

    // se caiu sobre uma região, entra nela (item 11)
    const region = this.regionAt(band, element.x, element.y, id);
    if (region) this.editor.groupIntoRegion([id], region.id);

    this.selectedIds = [id];
    this.emitSelection();
  }

  /**
   * A região que contém aquele ponto, se houver.
   *
   * Usada ao soltar um elemento e ao terminar um arrasto: cair sobre uma
   * região significa entrar nela, que é o que se espera de um agrupamento.
   */
  private regionAt(
    band: BandName,
    x: number,
    y: number,
    ignoreId?: string,
  ): ReportElement | undefined {
    const elements = this.editor.band(band)?.elements ?? [];

    // do topo para baixo: a última desenhada é a que está por cima
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      const element = elements[i]!;
      if (element.type !== 'region' || element.id === ignoreId || element.locked) continue;

      if (
        x >= element.x &&
        x <= element.x + element.width &&
        y >= element.y &&
        y <= element.y + element.height
      ) {
        return element;
      }
    }
    return undefined;
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

  /** Ctrl/Cmd + scroll dá zoom, como em qualquer editor gráfico. */
  private onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;

    event.preventDefault();
    const step = event.deltaY > 0 ? -0.1 : 0.1;
    this.zoom = Math.min(3, Math.max(0.25, Math.round((this.zoom + step) * 100) / 100));
  }

  // --- render ---------------------------------------------------------------

  override render(): TemplateResult {
    return html`
      <div class="app" @keydown=${this.onKeyDown} @wheel=${this.onWheel} tabindex="0">
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
                <button data-tip="Desfazer (Ctrl+Z)" @click=${() => this.undo()}>↶</button>
                <button data-tip="Refazer (Ctrl+Shift+Z)" @click=${() => this.redo()}>↷</button>
              </div>

              <div class="toolgroup">
                <select
                  class="font-family"
                  data-tip="Fonte"
                  ?disabled=${!active}
                  @change=${(e: Event) =>
                    this.applyStyle({ fontFamily: (e.target as HTMLSelectElement).value })}
                >
                  ${[
                    ['helvetica', 'Helvetica'],
                    ['times', 'Times'],
                    ['courier', 'Courier'],
                  ].map(
                    ([value, label]) => html`<option
                      value=${value}
                      ?selected=${value === (style.fontFamily ?? 'helvetica')}
                    >
                      ${label}
                    </option>`,
                  )}
                </select>
                <!-- input com datalist: escolhe da lista OU digita o número -->
                <input
                  class="font-size"
                  type="number"
                  min="4"
                  max="200"
                  list="tp-font-sizes"
                  data-tip="Tamanho da fonte"
                  .value=${String(style.fontSize ?? 10)}
                  ?disabled=${!active}
                  @change=${(e: Event) => {
                    const size = Number((e.target as HTMLInputElement).value);
                    if (size > 0) this.applyStyle({ fontSize: size });
                  }}
                />
                <datalist id="tp-font-sizes">
                  ${[6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 48].map(
                    (size) => html`<option value=${size}></option>`,
                  )}
                </datalist>
                <button
                  class="toggle ${style.bold ? 'on' : ''}"
                  data-tip="Negrito"
                  ?disabled=${!active}
                  @click=${() => this.applyStyle({ bold: !style.bold })}
                >
                  <b>B</b>
                </button>
                <button
                  class="toggle ${style.italic ? 'on' : ''}"
                  data-tip="Itálico"
                  ?disabled=${!active}
                  @click=${() => this.applyStyle({ italic: !style.italic })}
                >
                  <i>I</i>
                </button>
                <label class="color" data-tip="Cor do texto">
                  <input
                    type="color"
                    .value=${style.color ?? '#000000'}
                    ?disabled=${!active}
                    @input=${(e: Event) =>
                      this.applyStyle({ color: (e.target as HTMLInputElement).value })}
                  />
                  <span>A</span>
                </label>
                <label class="color" data-tip="Cor de fundo">
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
                      data-tip=${`Alinhar texto à ${align === 'left' ? 'esquerda' : align === 'center' ? 'ao centro' : 'direita'}`}
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
                    ['left', '⇤', 'Alinhar bordas à esquerda'],
                    ['center', '⇹', 'Centralizar entre si (horizontal)'],
                    ['right', '⇥', 'Alinhar bordas à direita'],
                    ['top', '⇧', 'Alinhar bordas ao topo'],
                    ['middle', '⇕', 'Centralizar entre si (vertical)'],
                    ['bottom', '⇩', 'Alinhar bordas à base'],
                  ] as [AlignMode, string, string][]
                ).map(
                  ([mode, icon, title]) => html`
                    <button
                      data-tip=${title}
                      ?disabled=${selection.length < 2}
                      @click=${() => this.align(mode)}
                    >
                      ${icon}
                    </button>
                  `,
                )}
                <button
                  data-tip="Distribuir espaçamento na horizontal"
                  ?disabled=${selection.length < 3}
                  @click=${() => this.distribute('horizontal')}
                >
                  ⇿
                </button>
              </div>

              <div class="toolgroup">
                <button
                  data-tip="Agrupar numa região (Ctrl+G)"
                  ?disabled=${selection.length < 2}
                  @click=${() => this.groupSelection()}
                >
                  ⬚
                </button>
                <button
                  data-tip="Duplicar (Ctrl+D)"
                  ?disabled=${!active}
                  @click=${() => this.duplicateSelection()}
                >
                  ⧉
                </button>
                <button data-tip="Excluir (Delete)" ?disabled=${!active} @click=${() =>
                  this.deleteSelection()}>
                  🗑
                </button>
              </div>

              <div class="toolgroup right">
                <label class="mini" data-tip="Ímã de alinhamento com os vizinhos">
                  <input
                    type="checkbox"
                    .checked=${this.smartGuides}
                    @change=${(e: Event) =>
                      (this.smartGuides = (e.target as HTMLInputElement).checked)}
                  />
                  Guias
                </label>
                <select
                  data-tip="Tamanho da grade"
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
        data-tip="Zoom (Ctrl + scroll)"
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
        <p class="panel-hint">Clique para inserir ou arraste para a folha</p>
        <div class="palette-grid">
          ${PALETTE.map(
            (item) => html`
              <div
                class="palette-item"
                draggable="true"
                data-tip=${item.hint}
                @dragstart=${(e: DragEvent) =>
                  this.onDragStart(e, item.type, 'text/treeport-element')}
                @click=${() => this.insertAtActiveBand((x, y) => createElement(item.type, x, y))}
              >
                <span class="icon">${item.icon}</span>
                <span class="label">${item.label}</span>
              </div>
            `,
          )}
        </div>

        ${snippetGroups().map(
          (group) => html`
            <h3>${group.label}</h3>
            <div class="snippets">
              ${group.items.map(
                (snippet) => html`
                  <div
                    class="snippet"
                    draggable="true"
                    data-tip=${snippet.hint}
                    @dragstart=${(e: DragEvent) =>
                      this.onDragStart(e, snippet.id, 'text/treeport-snippet')}
                    @click=${() =>
                      this.insertAtActiveBand((x, y) =>
                        snippet.create(x, y, this.contentWidth),
                      )}
                  >
                    <span class="icon">${snippet.icon}</span>
                    <span class="label">${snippet.label}</span>
                  </div>
                `,
              )}
            </div>
          `,
        )}
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
        ${tabs.map((tab) => {
          const active = samePath(tab.path, this.designPath);
          const element =
            tab.path.length > 0 ? this.editor.element(tab.path[tab.path.length - 1]!) : undefined;

          // nome dado pelo usuário, senão o nó de dados, senão o id
          const nome = element?.name || tab.dataSourceNodeId || tab.label;
          const completo = element?.name
            ? `${element.name}${tab.dataSourceNodeId ? ` · ${tab.dataSourceNodeId}` : ''}`
            : nome;

          return html`
            <button
              class="subtab ${active ? 'active' : ''}"
              data-tip=${completo}
              @click=${() => this.openDesign(tab.path)}
              @dblclick=${() => {
                // duplo clique na aba renomeia (item 2)
                if (!element) return;
                const novo = prompt('Nome do subrelatório', element.name ?? '');
                if (novo !== null) this.patch(element.id, { name: novo.trim() || undefined });
              }}
            >
              ${tab.depth > 0 ? '↳ ' : ''}${shortLabel(nome)}
            </button>
          `;
        })}
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
        class="band ${name} ${name === this.activeBand ? 'active' : ''}"
        style="height:${height * z}px; ${this.gridStyle()}"
        @dragover=${this.onBandDragOver}
        @drop=${(e: DragEvent) => this.onBandDrop(e, name)}
        @pointerdown=${() => (this.activeBand = name)}
      >
        <span class="band-tag">
          <span class="dot ${name}"></span>${label}<em
            >${Math.round(height)}pt${name === 'details' ? ' · repete por linha' : ''}</em
          >
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
        @dblclick=${(e: MouseEvent) => {
          e.stopPropagation();
          if (element.type === 'subreport') {
            this.openDesign([...this.designPath, element.id]);
          } else if (element.type === 'label') {
            // duplo clique num texto entra em edição direto no canvas
            this.editingId = element.id;
          }
        }}
      >
        ${this.renderElementBody(element, band, x, y)}
        ${selected && !element.locked ? this.renderHandles(element, band) : ''}
      </div>
    `;
  }

  /** Conteúdo interno do elemento, por tipo. */
  private renderElementBody(
    element: ReportElement,
    band: BandName,
    x: number,
    y: number,
  ): TemplateResult {
    if (element.type === 'region') {
      return html`
        <span class="region-tag">${element.name ?? 'Região'}</span>
        ${element.elements.map((child) => this.renderElement(child, band, x, y))}
      `;
    }

    if (element.type === 'shape') {
      return html`${this.renderShapeSvg(element.shape, element)}`;
    }

    if (element.type === 'barcode' || element.type === 'qrcode') {
      return this.renderCodeImage(element);
    }

    // edição inline: um textarea por cima do elemento (item 6)
    if (element.type === 'label' && this.editingId === element.id) {
      return html`
        <textarea
          class="inline-edit"
          .value=${element.content}
          @pointerdown=${(e: Event) => e.stopPropagation()}
          @blur=${(e: Event) => {
            this.patch(element.id, { content: (e.target as HTMLTextAreaElement).value });
            this.editingId = '';
          }}
          @keydown=${(e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === 'Escape') this.editingId = '';
            // Enter salva; Shift+Enter quebra linha
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          @focus=${(e: Event) => (e.target as HTMLTextAreaElement).select()}
          autofocus
        ></textarea>
      `;
    }

    return html`<span class="element-label">${elementLabel(element)}</span>`;
  }

  /** Desenha a forma como SVG, espelhando o que o pdf-lib vai fazer. */
  private renderShapeSvg(shape: ShapeKind, element: ReportElement): TemplateResult {
    const style = element.style ?? {};
    const fill = style.backgroundColor ?? 'transparent';
    const stroke = style.borderColor ?? 'transparent';
    const strokeWidth = style.borderWidth ?? 0;
    const dash =
      style.borderStyle === 'dashed' ? '6 4' : style.borderStyle === 'dotted' ? '2 3' : '';

    const common = `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"
      ${dash ? `stroke-dasharray="${dash}"` : ''} vector-effect="non-scaling-stroke"`;

    const body =
      shape === 'ellipse'
        ? `<ellipse cx="50" cy="50" rx="49" ry="49" ${common} />`
        : shape === 'rectangle'
          ? `<rect x="1" y="1" width="98" height="98" rx="${style.borderRadius ?? 0}" ${common} />`
          : `<polygon points="${shapePoints(shape, (element as { points?: number }).points)}" ${common} />`;

    return html`
      <svg
        class="shape-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        .innerHTML=${body}
      ></svg>
    `;
  }

  /**
   * Imagem real do código de barras/QR (itens 15-17).
   *
   * A geração é assíncrona; enquanto não termina mostra um aviso, e quando
   * fica pronta força um redesenho. O cache evita regerar a cada movimento.
   */
  private renderCodeImage(element: BarcodeElement | QrCodeElement): TemplateResult {
    const value = this.resolveCodeValue(element);
    const key = codeKey(element, value);
    const cached = peekCode(key);

    if (!cached) {
      void renderCode(element, value).then(() => {
        this.codeVersion += 1;
      });
      return html`<span class="code-status">gerando…</span>`;
    }

    if (isCodeError(cached)) {
      return html`<span class="code-status error" title=${cached.message}>
        ⚠ ${cached.message}
      </span>`;
    }

    return html`<img class="code-img" src=${cached.dataUrl} alt="" draggable="false" />`;
  }

  /**
   * Valor a codificar.
   *
   * No designer não há dados reais, então uma expressão vira um exemplo
   * legível — senão o código sairia com as chaves literais e pareceria quebrado.
   */
  private resolveCodeValue(element: BarcodeElement | QrCodeElement): string {
    const raw = element.valueExpression ?? '';
    if (raw.trim() === '') return '';

    if (!raw.includes('{{')) return raw;

    const rows = sampleRows(
      this.availableFields.filter((f) => f.depth === 0).map((f) => f.name),
      1,
    );
    const row = rows[0] ?? {};

    return raw.replace(/\{\{([\s\S]*?)\}\}/g, (_m, expr: string) => {
      const name = expr.trim();
      const value = row[name];
      return value === undefined ? 'EXEMPLO' : String(value);
    });
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

      case 'field': {
        const kind = el.fieldName ? guessFieldKind(el.fieldName) : undefined;
        const sugestoes = el.fieldName ? suggestFormats(el.fieldName) : [];

        return html`
          <label class="row">
            <span>Campo</span>
            <select
              @change=${(e: Event) =>
                this.patch(el.id, { fieldName: (e.target as HTMLSelectElement).value })}
            >
              <option value="" ?selected=${!el.fieldName}>(escolha)</option>
              ${this.availableFields.map(
                (f) => html`<option value=${f.name} ?selected=${f.name === el.fieldName}>
                  ${f.name}
                </option>`,
              )}
            </select>
          </label>

          ${kind ? html`<p class="tip">Detectado como <strong>${KIND_LABEL[kind]}</strong>.</p>` : ''}

          <label class="row">
            <span>Formato</span>
            <input
              list="tp-formats-${el.id}"
              placeholder=${sugestoes[0]?.mask ?? 'sem formato'}
              .value=${el.format ?? ''}
              @change=${(e: Event) =>
                this.patch(el.id, { format: (e.target as HTMLInputElement).value })}
            />
          </label>
          <datalist id="tp-formats-${el.id}">
            ${sugestoes.map((f) => html`<option value=${f.mask}>${f.example}</option>`)}
          </datalist>

          ${sugestoes.length > 0
            ? html`
                <div class="chips">
                  ${sugestoes.map(
                    (f) => html`
                      <button
                        class="chip ${el.format === f.mask ? 'on' : ''}"
                        data-tip=${f.mask}
                        @click=${() => this.patch(el.id, { format: f.mask })}
                      >
                        ${f.example}
                      </button>
                    `,
                  )}
                </div>
                <p class="tip">
                  Ou digite a máscara. Texto ao redor vira literal:
                  <code>R$ #,##0.00</code>
                </p>
              `
            : ''}
        `;
      }

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
        return html`
          <label class="row">
            <span>Conteúdo</span>
            <select
              @change=${(e: Event) =>
                this.patch(el.id, { contentKind: (e.target as HTMLSelectElement).value })}
            >
              ${(
                [
                  ['text', 'Texto'],
                  ['url', 'Site / URL'],
                  ['email', 'E-mail'],
                  ['phone', 'Telefone'],
                  ['sms', 'SMS'],
                  ['wifi', 'Wi-Fi'],
                  ['vcard', 'Contato (vCard)'],
                  ['geo', 'Localização'],
                ] as const
              ).map(
                ([value, label]) => html`<option
                  value=${value}
                  ?selected=${value === (el.contentKind ?? 'text')}
                >
                  ${label}
                </option>`,
              )}
            </select>
          </label>

          ${this.textRow('Valor', el.valueExpression, (v) =>
            this.patch(el.id, { valueExpression: v }),
          )}

          <label class="row">
            <span>Correção</span>
            <select
              @change=${(e: Event) =>
                this.patch(el.id, {
                  errorCorrection: (e.target as HTMLSelectElement).value,
                })}
            >
              ${(
                [
                  ['L', 'Baixa (7%)'],
                  ['M', 'Média (15%)'],
                  ['Q', 'Alta (25%)'],
                  ['H', 'Máxima (30%)'],
                ] as const
              ).map(
                ([value, label]) => html`<option
                  value=${value}
                  ?selected=${value === (el.errorCorrection ?? 'M')}
                >
                  ${label}
                </option>`,
              )}
            </select>
          </label>

          <div class="prop-grid">
            ${this.colorField('Cor', el.foregroundColor ?? '#000000', (v) =>
              this.patch(el.id, { foregroundColor: v }),
            )}
            ${this.colorField('Fundo', el.backgroundColor ?? '#ffffff', (v) =>
              this.patch(el.id, { backgroundColor: v }),
            )}
          </div>
          <p class="tip">Fundo claro e contraste alto: é o que o leitor precisa.</p>
        `;

      case 'image':
        return html`
          ${this.textRow('URL ou data URI', el.source, (v) => this.patch(el.id, { source: v }))}
          <button class="wide" @click=${() => this.pickImageFile(el.id)}>
            Escolher arquivo do computador…
          </button>
          <p class="tip">
            O arquivo é embutido no template como data URI. URL só é baixada se o
            backend permitir.
          </p>
          <label class="row">
            <span>Encaixe</span>
            <select
              @change=${(e: Event) =>
                this.patch(el.id, { fit: (e.target as HTMLSelectElement).value })}
            >
              ${(
                [
                  ['contain', 'Caber inteira'],
                  ['cover', 'Preencher cortando'],
                  ['fill', 'Esticar'],
                ] as const
              ).map(
                ([value, label]) => html`<option
                  value=${value}
                  ?selected=${value === (el.fit ?? 'contain')}
                >
                  ${label}
                </option>`,
              )}
            </select>
          </label>
        `;

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

      case 'shape':
        return html`
          <label class="row">
            <span>Forma</span>
            <select
              @change=${(e: Event) =>
                this.patch(el.id, { shape: (e.target as HTMLSelectElement).value })}
            >
              ${(
                [
                  ['rectangle', 'Retângulo'],
                  ['ellipse', 'Círculo / elipse'],
                  ['triangle', 'Triângulo'],
                  ['diamond', 'Losango'],
                  ['star', 'Estrela'],
                  ['pentagon', 'Pentágono'],
                  ['hexagon', 'Hexágono'],
                  ['arrow', 'Seta'],
                ] as const
              ).map(
                ([value, label]) => html`<option value=${value} ?selected=${value === el.shape}>
                  ${label}
                </option>`,
              )}
            </select>
          </label>

          ${el.shape === 'star'
            ? html`
                <label class="row">
                  <span>Pontas</span>
                  <input
                    type="number"
                    min="3"
                    max="20"
                    .value=${String(el.points ?? 5)}
                    @change=${(e: Event) =>
                      this.patch(el.id, { points: Number((e.target as HTMLInputElement).value) })}
                  />
                </label>
              `
            : ''}
          ${el.shape === 'rectangle'
            ? html`
                <label class="row">
                  <span>Cantos</span>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    .value=${String(el.style?.borderRadius ?? 0)}
                    @change=${(e: Event) =>
                      this.applyStyleTo(el.id, {
                        borderRadius: Number((e.target as HTMLInputElement).value),
                      })}
                  />
                </label>
              `
            : ''}

          <label class="row">
            <span>Rotação</span>
            <input
              type="number"
              min="-180"
              max="180"
              .value=${String(el.rotation ?? 0)}
              @change=${(e: Event) =>
                this.patch(el.id, { rotation: Number((e.target as HTMLInputElement).value) })}
            />
          </label>

          ${this.borderProps(el)}
        `;

      case 'aggregate':
        return html`
          <label class="row">
            <span>Operação</span>
            <select
              @change=${(e: Event) =>
                this.patch(el.id, { fn: (e.target as HTMLSelectElement).value })}
            >
              ${(
                [
                  ['sum', 'Soma'],
                  ['count', 'Contagem'],
                  ['avg', 'Média'],
                  ['min', 'Menor'],
                  ['max', 'Maior'],
                ] as const
              ).map(
                ([value, label]) => html`<option value=${value} ?selected=${value === el.fn}>
                  ${label}
                </option>`,
              )}
            </select>
          </label>

          <label class="row">
            <span>Consulta</span>
            <select
              @change=${(e: Event) =>
                this.patch(el.id, {
                  dataSourceNodeId: (e.target as HTMLSelectElement).value,
                })}
            >
              <option value="" ?selected=${!el.dataSourceNodeId}>(esta)</option>
              ${this.allNodeOptions(el.dataSourceNodeId)}
            </select>
          </label>

          ${el.fn === 'count'
            ? ''
            : html`
                <label class="row">
                  <span>Campo</span>
                  <select
                    @change=${(e: Event) =>
                      this.patch(el.id, { fieldName: (e.target as HTMLSelectElement).value })}
                  >
                    <option value="" ?selected=${!el.fieldName}>(escolha)</option>
                    ${this.fieldsOfNode(el.dataSourceNodeId).map(
                      (name) => html`<option value=${name} ?selected=${name === el.fieldName}>
                        ${name}
                      </option>`,
                    )}
                  </select>
                </label>
              `}

          ${this.textRow('Antes', el.prefix ?? '', (v) => this.patch(el.id, { prefix: v }))}
          ${this.textRow('Depois', el.suffix ?? '', (v) => this.patch(el.id, { suffix: v }))}
          ${this.textRow('Formato', el.format ?? '', (v) => this.patch(el.id, { format: v }))}

          <details class="advanced">
            <summary>Cálculo entre consultas</summary>
            <p class="tip">
              Combine consultas diferentes numa conta só. Ex.:
              <code>{{SUM('ITEM','valor') / COUNT('PEDIDO')}}</code>
            </p>
            <textarea
              rows="2"
              placeholder="deixe vazio para usar a operação acima"
              .value=${el.expression ?? ''}
              @change=${(e: Event) =>
                this.patch(el.id, { expression: (e.target as HTMLTextAreaElement).value })}
            ></textarea>
          </details>
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
      <label class="row stacked">
        <span>Consulta de origem</span>
        <select
          @change=${(e: Event) => (this.explorerNodeId = (e.target as HTMLSelectElement).value)}
        >
          <option value="" ?selected=${this.explorerNodeId === ''}>
            Selecione uma consulta…
          </option>
          ${nodes.map(
            ({ node, depth }) => html`
              <option value=${node.id} ?selected=${node.id === this.explorerNodeId}>
                ${'— '.repeat(depth)}${node.name}${depth === 0 ? ' (principal)' : ''}
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
        ${this.explorerNodeId === ''
          ? html`<p class="empty">Escolha uma consulta acima para ver os campos dela.</p>`
          : fields.length === 0
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
          : element.type === 'shape'
            ? this.renderShapeSvg(element.shape, element)
            : element.type === 'barcode' || element.type === 'qrcode'
              ? this.renderCodeImage(element)
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

  /** Campo de cor com o valor em hex ao lado. */
  private colorField(
    label: string,
    value: string,
    onChange: (value: string) => void,
  ): TemplateResult {
    return html`
      <label class="num">
        <span>${label}</span>
        <input
          type="color"
          class="color-input"
          .value=${value}
          @input=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
        />
      </label>
    `;
  }

  /** Aplica um patch de estilo a um elemento específico. */
  private applyStyleTo(elementId: string, patch: Record<string, unknown>): void {
    this.editor.updateStyle(elementId, patch);
    this.requestUpdate();
  }

  /** Controles de borda, compartilhados por forma e região (item 14). */
  private borderProps(el: ReportElement): TemplateResult {
    const style = el.style ?? {};

    return html`
      <div class="prop-title spaced">Borda e preenchimento</div>
      <div class="prop-grid">
        ${this.colorField('Preenchimento', style.backgroundColor ?? '#ffffff', (v) =>
          this.applyStyleTo(el.id, { backgroundColor: v }),
        )}
        ${this.colorField('Cor da borda', style.borderColor ?? '#334155', (v) =>
          this.applyStyleTo(el.id, { borderColor: v }),
        )}
      </div>

      <label class="row">
        <span>Espessura</span>
        <input
          type="number"
          min="0"
          max="20"
          step="0.5"
          .value=${String(style.borderWidth ?? 1)}
          @change=${(e: Event) =>
            this.applyStyleTo(el.id, {
              borderWidth: Number((e.target as HTMLInputElement).value),
            })}
        />
      </label>

      <label class="row">
        <span>Traço</span>
        <select
          @change=${(e: Event) =>
            this.applyStyleTo(el.id, { borderStyle: (e.target as HTMLSelectElement).value })}
        >
          ${(
            [
              ['solid', 'Contínuo'],
              ['dashed', 'Tracejado'],
              ['dotted', 'Pontilhado'],
            ] as const
          ).map(
            ([value, label]) => html`<option
              value=${value}
              ?selected=${value === (style.borderStyle ?? 'solid')}
            >
              ${label}
            </option>`,
          )}
        </select>
      </label>

      <button
        class="wide"
        @click=${() => this.applyStyleTo(el.id, { backgroundColor: undefined })}
      >
        Sem preenchimento
      </button>
    `;
  }

  /** Todas as consultas da árvore, para o seletor do totalizador. */
  private allNodeOptions(selected?: string): TemplateResult[] {
    if (!this.dataSource) return [];

    return flattenExplorer(describeTree(this.dataSource)).map(
      ({ node, depth }) => html`<option value=${node.id} ?selected=${node.id === selected}>
        ${'— '.repeat(depth)}${node.name}
      </option>`,
    );
  }

  /** Campos de um nó específico (ou do atual, quando não informado). */
  private fieldsOfNode(nodeId?: string): string[] {
    if (!this.dataSource) return [];

    const target = nodeId || this.currentNodeId();
    if (!target) return [];

    return findNode(describeTree(this.dataSource), target)?.fields ?? [];
  }

  /** Escolhe um arquivo de imagem e embute como data URI (item 18). */
  private pickImageFile(elementId: string): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => this.patch(elementId, { source: String(reader.result) });
      reader.readAsDataURL(file);
    };

    input.click();
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

    /* tooltip proprio: o title nativo demora ~1s e some rapido demais */
    [data-tip] {
      position: relative;
    }

    [data-tip]:hover::after {
      content: attr(data-tip);
      position: absolute;
      top: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: #f8fafc;
      font-size: 11px;
      font-weight: 400;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 100;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25);
    }

    [data-tip]:hover::before {
      content: '';
      position: absolute;
      top: calc(100% + 2px);
      left: 50%;
      transform: translateX(-50%);
      border: 4px solid transparent;
      border-bottom-color: #1e293b;
      pointer-events: none;
      z-index: 100;
    }

    .topbar .font-size {
      width: 52px;
      height: 26px;
      flex: none;
      text-align: center;
    }

    .topbar .font-family {
      width: 92px;
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
      color: var(--tp-accent);
    }

    .topbar button:active:not(:disabled) {
      transform: translateY(1px);
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

    .panel-hint {
      margin: 0 0 6px;
      font-size: 9px;
      color: var(--tp-muted);
      opacity: 0.85;
      line-height: 1.3;
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

    /* cada banda tem sua cor, para achar a divisão de longe (item 8) */
    .band {
      position: relative;
      box-sizing: border-box;
      border-bottom: 2px solid transparent;
    }

    .band.header {
      border-bottom-color: #bfdbfe;
      box-shadow: inset 3px 0 0 #3b82f6;
    }

    .band.details {
      border-bottom-color: #bbf7d0;
      box-shadow: inset 3px 0 0 #22c55e;
    }

    .band.footer {
      border-bottom-color: #fed7aa;
      box-shadow: inset 3px 0 0 #f97316;
    }

    .band.active {
      background-color: rgba(37, 99, 235, 0.025);
    }

    .band.header.active { box-shadow: inset 4px 0 0 #2563eb; }
    .band.details.active { box-shadow: inset 4px 0 0 #16a34a; }
    .band.footer.active { box-shadow: inset 4px 0 0 #ea580c; }

    .band-tag .dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }

    .band-tag .dot.header { background: #3b82f6; }
    .band-tag .dot.details { background: #22c55e; }
    .band-tag .dot.footer { background: #f97316; }

    .shape-svg {
      width: 100%;
      height: 100%;
      display: block;
      pointer-events: none;
    }

    .code-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      pointer-events: none;
      background: #fff;
    }

    .code-status {
      font-size: 9px;
      color: var(--tp-muted);
      padding: 0 4px;
      pointer-events: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .code-status.error {
      color: #b91c1c;
    }

    .inline-edit {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: none;
      padding: 0 2px;
      margin: 0;
      resize: none;
      background: #fff;
      outline: 2px solid var(--tp-accent);
      font: inherit;
      font-family: inherit;
      color: inherit;
      z-index: 8;
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

    .type-aggregate {
      background: rgba(37, 99, 235, 0.06);
      border-color: #bfdbfe;
      font-size: 10px;
      color: #1d4ed8;
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

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      margin-bottom: 6px;
    }

    .chip {
      font: inherit;
      font-size: 10px;
      padding: 3px 7px;
      border: 1px solid var(--tp-border);
      border-radius: 10px;
      background: var(--tp-bg);
      color: var(--tp-muted);
      cursor: pointer;
    }

    .chip:hover {
      border-color: var(--tp-accent);
      color: var(--tp-accent);
    }

    .chip.on {
      background: var(--tp-accent-soft);
      border-color: var(--tp-accent);
      color: var(--tp-accent);
      font-weight: 600;
    }

    .color-input {
      height: 24px;
      padding: 1px 2px;
      cursor: pointer;
    }

    .advanced {
      margin-top: 8px;
      border-top: 1px solid var(--tp-border);
      padding-top: 6px;
    }

    .advanced summary {
      font-size: 10px;
      color: var(--tp-muted);
      cursor: pointer;
      user-select: none;
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
    case 'shape':
      return '';
    case 'aggregate': {
      // mostra a fórmula, para dar para conferir sem abrir as propriedades
      const alvo = element.dataSourceNodeId ? `${element.dataSourceNodeId}.` : '';
      const corpo = element.expression
        ? element.expression
        : `${element.fn.toUpperCase()}(${alvo}${element.fieldName ?? '*'})`;
      return `${element.prefix ?? ''}${corpo}${element.suffix ?? ''}`;
    }
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
  if (element.type === 'aggregate') {
    // sem dados reais no preview, mostra a fórmula em vez de um número falso
    return `${element.prefix ?? ''}⟨${element.fn}⟩${element.suffix ?? ''}`;
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

/**
 * Pontos do polígono normalizados em 0..100, para o SVG do canvas.
 * Espelha o `shapePath` do core — se divergirem, o designer mostra uma forma
 * e o PDF sai com outra.
 */
function shapePoints(shape: ShapeKind, points = 5): string {
  const polygon = (sides: number, innerRatio?: number): string => {
    const total = innerRatio === undefined ? sides : sides * 2;
    const out: string[] = [];

    for (let i = 0; i < total; i += 1) {
      const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
      const scale = innerRatio === undefined || i % 2 === 0 ? 1 : innerRatio;
      out.push(
        `${(50 + Math.cos(angle) * 49 * scale).toFixed(1)},${(50 + Math.sin(angle) * 49 * scale).toFixed(1)}`,
      );
    }
    return out.join(' ');
  };

  switch (shape) {
    case 'triangle':
      return '50,1 99,99 1,99';
    case 'diamond':
      return '50,1 99,50 50,99 1,50';
    case 'arrow':
      return '1,35 60,35 60,5 99,50 60,95 60,65 1,65';
    case 'star':
      return polygon(Math.max(3, points), 0.382);
    case 'pentagon':
      return polygon(5);
    case 'hexagon':
      return polygon(6);
    default:
      return '1,1 99,1 99,99 1,99';
  }
}

/** Encurta um rótulo longo, mantendo o começo, que é o que identifica. */
function shortLabel(text: string, max = 18): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function snapTo(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : Math.round(value);
}

if (typeof customElements !== 'undefined' && !customElements.get('treeport-designer')) {
  customElements.define('treeport-designer', TreeportDesigner);
}
