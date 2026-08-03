import type {
  Band,
  BandSet,
  ElementStyle,
  ReportElement,
  Template,
} from '@treeport/schema';
import { resolveDesign, nearestValidPath, type DesignPath } from './subreport-tabs.js';

/**
 * Edição do template, sem tocar em DOM.
 *
 * Toda mutação do designer passa por aqui: criar, mover, redimensionar,
 * alterar propriedade, remover. Manter isso separado da UI significa que a
 * lógica de edição é testável sem browser — que é exatamente o que a sub-fase
 * 9.2 do brief pede.
 *
 * O histórico guarda snapshots do JSON inteiro. Para um schema deste tamanho
 * isso é mais simples e mais seguro que diffs, e o custo é irrelevante: um
 * template com 200 elementos dá poucas dezenas de KB por snapshot.
 */

export type BandName = 'header' | 'details' | 'footer';

/** Onde um elemento vive: em qual banda, e em que posição da lista. */
export interface ElementLocation {
  band: BandName;
  index: number;
  /** Quando presente, o elemento vive dentro desta região. */
  parentRegionId?: string;
}

/** Acha um elemento pelo id dentro de um BandSet (usado sobre o draft). */
function findElementIn(bands: BandSet, elementId: string): ReportElement | undefined {
  const walk = (elements: ReportElement[]): ReportElement | undefined => {
    for (const element of elements) {
      if (element.id === elementId) return element;
      if (element.type === 'region') {
        const found = walk(element.elements);
        if (found) return found;
      }
    }
    return undefined;
  };

  for (const name of ['header', 'details', 'footer'] as BandName[]) {
    const band = bands[name];
    if (!band) continue;
    const found = walk(band.elements);
    if (found) return found;
  }
  return undefined;
}

/**
 * Remove de uma vez todos os elementos cujos ids estão no conjunto e devolve
 * os removidos. Fazer isso num passo só evita o problema clássico de índices
 * invalidados por remoções anteriores.
 */
function removeElementsIn(bands: BandSet, ids: Set<string>): ReportElement[] {
  const removed: ReportElement[] = [];

  const walk = (elements: ReportElement[]): void => {
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      const element = elements[i]!;
      if (ids.has(element.id)) {
        removed.unshift(...elements.splice(i, 1));
        continue;
      }
      if (element.type === 'region') walk(element.elements);
    }
  };

  for (const name of ['header', 'details', 'footer'] as BandName[]) {
    const band = bands[name];
    if (band) walk(band.elements);
  }
  return removed;
}

/** Busca recursiva por id, entrando nas regiões. */
function locateIn(
  elements: ReportElement[],
  elementId: string,
  parentRegionId?: string,
): { index: number; parentRegionId?: string } | undefined {
  const index = elements.findIndex((e) => e.id === elementId);
  if (index >= 0) {
    return parentRegionId === undefined ? { index } : { index, parentRegionId };
  }

  for (const element of elements) {
    if (element.type !== 'region') continue;
    const found = locateIn(element.elements, elementId, element.id);
    if (found) return found;
  }
  return undefined;
}

export interface TemplateEditorOptions {
  /** Passos de histórico guardados. Default: 50. */
  historyLimit?: number;
  /** Chamado a cada mudança, para a UI se redesenhar. */
  onChange?: (template: Template) => void;
}

/** Um template novo, vazio, com as três bandas. */
export function createEmptyTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: `template-${Date.now()}`,
    name: 'Novo relatório',
    boundDataSourceNodeId: '',
    pageSize: 'A4',
    margins: { top: 40, right: 40, bottom: 40, left: 40 },
    bands: {
      header: { height: 60, elements: [] },
      details: { height: 40, elements: [] },
      footer: { height: 30, elements: [] },
    },
    ...overrides,
  };
}

export class TemplateEditor {
  private current: Template;
  private readonly past: Template[] = [];
  private readonly future: Template[] = [];
  private readonly historyLimit: number;
  private readonly onChange: ((template: Template) => void) | undefined;
  /**
   * Design sendo editado: vazio é o template principal, senão o caminho de
   * subreports até o design aberto (sub-fase 9.5).
   */
  private path: DesignPath = [];
  /** Profundidade de agrupamento de histórico (arrasto em curso). */
  private batchDepth = 0;
  /** O passo do lote já foi registrado no histórico? */
  private batchStarted = false;

  constructor(template: Template, options: TemplateEditorOptions = {}) {
    this.current = clone(template);
    this.historyLimit = options.historyLimit ?? 50;
    this.onChange = options.onChange;
  }

  /** O template atual. É uma cópia: mutá-lo não afeta o editor. */
  get template(): Template {
    return clone(this.current);
  }

  /** Acesso somente-leitura, sem clonar (para render, que não muta). */
  peek(): Readonly<Template> {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  // --- histórico ------------------------------------------------------------

  /**
   * Aplica uma mudança, registrando o estado anterior no histórico.
   * Toda mutação pública passa por aqui — é o que garante que tudo é undoável.
   */
  private commit(mutate: (draft: Template) => void): void {
    const before = clone(this.current);
    const draft = clone(this.current);

    mutate(draft);

    // durante uma interação contínua (arrastar), só o PRIMEIRO passo entra no
    // histórico: senão um arrasto de 40 pixels viraria 40 undos, e desfazer
    // devolveria o elemento um pixel por vez
    if (this.batchDepth === 0 || !this.batchStarted) {
      this.past.push(before);
      if (this.past.length > this.historyLimit) this.past.shift();
      if (this.batchDepth > 0) this.batchStarted = true;
    }

    // qualquer ação nova invalida o caminho de redo
    this.future.length = 0;

    this.current = draft;
    this.onChange?.(this.template);
  }

  /**
   * Agrupa várias mutações num único passo de histórico.
   *
   * O designer chama `beginBatch` no `pointerdown` e `endBatch` no `pointerup`,
   * de modo que o arrasto inteiro seja um só undo.
   */
  beginBatch(): void {
    this.batchDepth += 1;
  }

  endBatch(): void {
    this.batchDepth = Math.max(0, this.batchDepth - 1);
    if (this.batchDepth === 0) this.batchStarted = false;
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;

    this.future.push(clone(this.current));
    this.current = previous;
    this.onChange?.(this.template);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;

    this.past.push(clone(this.current));
    this.current = next;
    this.onChange?.(this.template);
    return true;
  }

  // --- design ativo (abas de subreport) -------------------------------------

  /** Caminho do design sendo editado. Vazio = template principal. */
  get designPath(): DesignPath {
    return [...this.path];
  }

  /**
   * Abre outro design para edição (uma aba de subreport).
   * Trocar de aba não entra no histórico: é navegação, não edição.
   */
  openDesign(path: DesignPath): void {
    // valida antes de trocar, para não deixar o editor num caminho quebrado
    resolveDesign(this.current, path);
    this.path = [...path];
  }

  /** As bandas do design ativo. */
  private designBands(template: Template = this.current): BandSet {
    return resolveDesign(template, this.path);
  }

  /** Substitui o template inteiro (abrir arquivo, carregar do servidor). */
  replace(template: Template): void {
    this.commit((draft) => {
      // limpa as chaves antigas: `Object.assign` sozinho deixaria resíduo de
      // um template anterior que tivesse campos que o novo não tem
      const bag = draft as unknown as Record<string, unknown>;
      for (const key of Object.keys(bag)) delete bag[key];
      Object.assign(draft, clone(template));
    });
    // o design aberto pode ter deixado de existir no template novo
    this.path = nearestValidPath(this.current, this.path);
  }

  // --- consulta -------------------------------------------------------------

  /** A banda pedida, ou undefined se o template não a tem. */
  band(name: BandName): Band | undefined {
    return this.designBands()[name];
  }

  /** Todas as bandas existentes, na ordem de desenho. */
  bands(): { name: BandName; band: Band }[] {
    const order: BandName[] = ['header', 'details', 'footer'];
    const out: { name: BandName; band: Band }[] = [];
    const bands = this.designBands();
    for (const name of order) {
      const band = bands[name];
      if (band) out.push({ name, band });
    }
    return out;
  }

  /**
   * Localiza um elemento pelo id, em qualquer banda.
   * `parentRegionId` indica quando o elemento vive dentro de uma região.
   */
  locate(elementId: string): ElementLocation | undefined {
    for (const { name, band } of this.bands()) {
      const found = locateIn(band.elements, elementId);
      if (found) return { band: name, ...found };
    }
    return undefined;
  }

  /** O elemento com aquele id, se existir (inclusive dentro de regiões). */
  element(elementId: string): ReportElement | undefined {
    const at = this.locate(elementId);
    if (!at) return undefined;
    return this.containerOf(this.designBands(), at)[at.index];
  }

  /** A lista onde o elemento vive: a banda, ou os filhos de uma região. */
  private containerOf(bands: BandSet, at: ElementLocation): ReportElement[] {
    const band = bands[at.band]!;
    if (!at.parentRegionId) return band.elements;

    const region = locateIn(band.elements, at.parentRegionId);
    if (!region) return band.elements;

    const found = region.parentRegionId
      ? this.containerOf(bands, { band: at.band, ...region })[region.index]
      : band.elements[region.index];

    return found && found.type === 'region' ? found.elements : band.elements;
  }

  // --- regiões --------------------------------------------------------------

  /**
   * Move elementos para dentro de uma região, convertendo as coordenadas para
   * relativas — é o que faz arrastar a região levar tudo junto.
   */
  groupIntoRegion(elementIds: string[], regionId: string): boolean {
    const region = this.element(regionId);
    if (!region || region.type !== 'region') return false;

    const targets = elementIds
      .filter((id) => id !== regionId)
      .map((id) => this.element(id))
      .filter((e): e is ReportElement => e !== undefined);

    if (targets.length === 0) return false;

    const ids = targets.map((t) => t.id);

    this.commit((draft) => {
      const bands = this.designBands(draft);

      // a região DENTRO do draft: é nela que os filhos entram
      const regionInDraft = findElementIn(bands, regionId);
      if (!regionInDraft || regionInDraft.type !== 'region') return;

      // Remove tudo de uma vez e só então insere. Localizar por índice a cada
      // passo não funcionaria: o primeiro splice invalida os índices seguintes.
      const removed = removeElementsIn(bands, new Set(ids));

      for (const element of removed) {
        // absoluto -> relativo à região
        element.x -= regionInDraft.x;
        element.y -= regionInDraft.y;
        regionInDraft.elements.push(element);
      }
    });

    return true;
  }

  /** Tira um elemento da região, devolvendo-o à banda em coordenada absoluta. */
  ungroupFromRegion(elementId: string): boolean {
    const at = this.locate(elementId);
    if (!at?.parentRegionId) return false;

    const region = this.element(at.parentRegionId);
    if (!region || region.type !== 'region') return false;

    this.commit((draft) => {
      const bands = this.designBands(draft);
      const [removed] = removeElementsIn(bands, new Set([elementId]));
      if (!removed) return;

      // relativo -> absoluto
      removed.x += region.x;
      removed.y += region.y;
      bands[at.band]!.elements.push(removed);
    });

    return true;
  }

  /** Move um elemento para outra posição na mesma lista (reordenar abas). */
  reorderElement(elementId: string, targetIndex: number): boolean {
    const at = this.locate(elementId);
    if (!at) return false;

    this.commit((draft) => {
      const container = this.containerOf(this.designBands(draft), at);
      const [element] = container.splice(at.index, 1);
      if (!element) return;

      const clamped = Math.max(0, Math.min(targetIndex, container.length));
      container.splice(clamped, 0, element);
    });

    return true;
  }

  /** Duplica um elemento, deslocado alguns pontos para não ficar por cima. */
  duplicateElement(elementId: string, offset = 10): string | undefined {
    const element = this.element(elementId);
    if (!element) return undefined;

    const at = this.locate(elementId)!;
    const copy = JSON.parse(JSON.stringify(element)) as ReportElement;
    copy.id = this.uniqueId(`${element.id}-copia`);
    copy.x += offset;
    copy.y += offset;

    this.commit((draft) => {
      this.containerOf(this.designBands(draft), at).push(copy);
    });

    return copy.id;
  }

  /**
   * Move um elemento para outra banda, preservando x/y (item 14).
   *
   * Sai de dentro de qualquer região antes, para não ficar com coordenada
   * relativa a uma região que está noutra banda.
   */
  moveToBand(elementId: string, target: BandName): boolean {
    const at = this.locate(elementId);
    if (!at || at.band === target) return false;

    const element = this.element(elementId);
    if (!element) return false;

    // se estava numa região, a coordenada precisa voltar a ser absoluta
    const region = at.parentRegionId ? this.element(at.parentRegionId) : undefined;
    const offsetX = region?.x ?? 0;
    const offsetY = region?.y ?? 0;

    this.commit((draft) => {
      const bands = this.designBands(draft);
      const [removed] = removeElementsIn(bands, new Set([elementId]));
      if (!removed) return;

      removed.x += offsetX;
      removed.y += offsetY;

      ensureBand(bands, target);
      bands[target]!.elements.push(removed);
    });

    return true;
  }

  /** Trava/destrava (o travado não é selecionável no canvas). */
  setLocked(elementId: string, locked: boolean): boolean {
    return this.updateElement(elementId, { locked } as Partial<ReportElement>);
  }

  /** Mostra/oculta — o oculto some do designer E do PDF. */
  setHidden(elementId: string, hidden: boolean): boolean {
    return this.updateElement(elementId, { hidden } as Partial<ReportElement>);
  }

  // --- mutações -------------------------------------------------------------

  /**
   * Adiciona um elemento a uma banda.
   * Se o id colidir com um existente, um sufixo é acrescentado — dois
   * elementos com o mesmo id quebrariam a seleção e o `locate`.
   */
  addElement(band: BandName, element: ReportElement): string {
    const id = this.uniqueId(element.id);

    this.commit((draft) => {
      const bands = this.designBands(draft);
      ensureBand(bands, band);
      bands[band]!.elements.push({ ...element, id } as ReportElement);
    });

    return id;
  }

  removeElement(elementId: string): boolean {
    const at = this.locate(elementId);
    if (!at) return false;

    this.commit((draft) => {
      this.containerOf(this.designBands(draft), at).splice(at.index, 1);
    });
    // apagar um subreport fecha a aba dele, se estava aberta
    this.path = nearestValidPath(this.current, this.path);
    return true;
  }

  /** Aplica um patch parcial ao elemento (posição, tamanho, conteúdo...). */
  updateElement(elementId: string, patch: Partial<ReportElement>): boolean {
    const at = this.locate(elementId);
    if (!at) return false;

    this.commit((draft) => {
      const target = this.containerOf(this.designBands(draft), at)[at.index]!;
      // `type` e `id` não mudam por patch: trocar o tipo exige recriar o
      // elemento, senão sobrariam campos do tipo antigo
      const { type: _type, id: _id, ...rest } = patch as Record<string, unknown>;
      Object.assign(target, rest);
    });
    return true;
  }

  /** Move um elemento para uma posição absoluta dentro da banda. */
  moveElement(elementId: string, x: number, y: number): boolean {
    return this.updateElement(elementId, { x, y } as Partial<ReportElement>);
  }

  /** Redimensiona, respeitando um mínimo para o elemento não sumir. */
  resizeElement(elementId: string, width: number, height: number): boolean {
    return this.updateElement(elementId, {
      width: Math.max(MIN_SIZE, width),
      height: Math.max(MIN_SIZE, height),
    } as Partial<ReportElement>);
  }

  /** Altera o estilo, mesclando com o que já existe. */
  updateStyle(elementId: string, patch: ElementStyle): boolean {
    const element = this.element(elementId);
    if (!element) return false;

    return this.updateElement(elementId, {
      style: { ...element.style, ...patch },
    } as Partial<ReportElement>);
  }

  /** Muda a altura de uma banda. */
  setBandHeight(band: BandName, height: number): void {
    this.commit((draft) => {
      const bands = this.designBands(draft);
      ensureBand(bands, band);
      bands[band]!.height = Math.max(MIN_SIZE, height);
    });
  }

  /** Cria ou remove uma banda opcional (header/footer). */
  toggleBand(band: 'header' | 'footer', enabled: boolean): void {
    this.commit((draft) => {
      const bands = this.designBands(draft);
      if (enabled) {
        bands[band] ??= { height: band === 'header' ? 60 : 30, elements: [] };
      } else {
        delete bands[band];
      }
    });
  }

  /** Altera propriedades do template (nome, página, margens). */
  updateTemplate(patch: Partial<Omit<Template, 'bands'>>): void {
    this.commit((draft) => {
      Object.assign(draft, patch);
    });
  }

  // --- ordenação (z-order) --------------------------------------------------

  /**
   * Traz o elemento para a frente.
   *
   * A ordem no array É a ordem de desenho: o motor renderiza na sequência, e
   * o que vem depois fica por cima.
   */
  bringToFront(elementId: string): boolean {
    return this.reorder(elementId, (elements, index) => {
      const [element] = elements.splice(index, 1);
      elements.push(element!);
    });
  }

  sendToBack(elementId: string): boolean {
    return this.reorder(elementId, (elements, index) => {
      const [element] = elements.splice(index, 1);
      elements.unshift(element!);
    });
  }

  private reorder(
    elementId: string,
    apply: (elements: ReportElement[], index: number) => void,
  ): boolean {
    const at = this.locate(elementId);
    if (!at) return false;

    this.commit((draft) => {
      apply(this.containerOf(this.designBands(draft), at), at.index);
    });
    return true;
  }

  // --- alinhamento de múltiplos elementos -----------------------------------

  /**
   * Alinha vários elementos entre si.
   *
   * A referência é o elemento mais extremo na direção pedida — que é o
   * comportamento que todo editor gráfico tem e o usuário espera.
   */
  align(elementIds: string[], mode: AlignMode): boolean {
    const targets = elementIds
      .map((id) => ({ id, element: this.element(id) }))
      .filter((t): t is { id: string; element: ReportElement } => t.element !== undefined);

    if (targets.length < 2) return false;

    const boxes = targets.map((t) => t.element);
    const left = Math.min(...boxes.map((e) => e.x));
    const right = Math.max(...boxes.map((e) => e.x + e.width));
    const top = Math.min(...boxes.map((e) => e.y));
    const bottom = Math.max(...boxes.map((e) => e.y + e.height));

    this.commit((draft) => {
      for (const { id } of targets) {
        const at = this.locate(id)!;
        const target = this.containerOf(this.designBands(draft), at)[at.index]!;

        switch (mode) {
          case 'left':
            target.x = left;
            break;
          case 'right':
            target.x = right - target.width;
            break;
          case 'center':
            target.x = (left + right) / 2 - target.width / 2;
            break;
          case 'top':
            target.y = top;
            break;
          case 'bottom':
            target.y = bottom - target.height;
            break;
          case 'middle':
            target.y = (top + bottom) / 2 - target.height / 2;
            break;
        }
      }
    });

    return true;
  }

  /** Distribui os elementos com espaçamento igual entre eles. */
  distribute(elementIds: string[], axis: 'horizontal' | 'vertical'): boolean {
    const targets = elementIds
      .map((id) => this.element(id))
      .filter((e): e is ReportElement => e !== undefined);

    if (targets.length < 3) return false;

    const key = axis === 'horizontal' ? 'x' : 'y';
    const sorted = [...targets].sort((a, b) => a[key] - b[key]);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;

    const span = last[key] - first[key];
    const step = span / (sorted.length - 1);

    this.commit((draft) => {
      sorted.forEach((element, i) => {
        if (i === 0 || i === sorted.length - 1) return;
        const at = this.locate(element.id)!;
        this.containerOf(this.designBands(draft), at)[at.index]![key] = first[key] + step * i;
      });
    });

    return true;
  }

  // --- utilidades -----------------------------------------------------------

  /** Gera um id livre a partir de uma base. */
  private uniqueId(base: string): string {
    const candidate = base || 'element';
    if (!this.element(candidate)) return candidate;

    let n = 2;
    while (this.element(`${candidate}-${n}`)) n += 1;
    return `${candidate}-${n}`;
  }

  /** Exporta o template como JSON formatado, para download. */
  toJSON(): string {
    return JSON.stringify(this.current, null, 2);
  }
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Tamanho mínimo de um elemento/banda, para não sumir do canvas. */
export const MIN_SIZE = 4;

function ensureBand(bands: BandSet, name: BandName): void {
  if (name === 'details') {
    bands.details ??= { height: 40, elements: [] };
    return;
  }
  bands[name] ??= { height: name === 'header' ? 60 : 30, elements: [] };
}

/** Cópia profunda via JSON: o template é dado puro, sem funções nem datas. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
