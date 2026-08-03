import type { Band, ReportElement, ResolvedRow } from '@treeport/schema';
import type { PageContext } from './page-context.js';
import { renderElement, type RenderElementContext } from './elements.js';
import { measureSubreport } from './subreport.js';

/**
 * Renderização de uma banda.
 *
 * A banda é desenhada a partir de um Y absoluto de página; os elementos têm
 * coordenadas relativas ao topo dela. Devolve a altura realmente ocupada, que
 * pode ser maior que `band.height` quando algum elemento cresce.
 *
 * O deslocamento em cascata (Anexo C) já está implementado aqui: os elementos
 * são ordenados por `y` e um `offset` acumulado empurra para baixo todos os
 * que vêm depois de um elemento que cresceu. A Fase 5 só vai estender isso
 * para o caso dos subreports.
 */
export async function renderBand(
  band: Band,
  absoluteY: number,
  context: RenderElementContext,
  options: BandRenderOptions = {},
): Promise<number> {
  // ordena por Y de origem para o offset acumulado fazer sentido
  const ordered = [...band.elements].sort((a, b) => a.y - b.y);

  let offset = 0;
  // sem shrinkToContent, `band.height` é piso (a banda serve de espaçamento
  // fixo entre registros); com ele, a banda vale o que o conteúdo pediu
  let maxBottom = options.shrinkToContent ? 0 : band.height;
  const hasGrowingElement = ordered.some((e) => e.canGrow);

  // altura que cada elemento realmente ocupou, para o posicionamento relativo
  const used_: Record<string, number> = {};
  const drawnY: Record<string, number> = {};
  /** Sobre qual base cada elemento foi empilhado, para o próximo ir abaixo. */
  const stackedOn: Record<string, string> = {};

  for (const element of ordered) {
    // posição relativa: quando o elemento de referência não desenhou nada,
    // este sobe e ocupa o lugar dele em vez de deixar um buraco (item 18)
    const relative = resolveRelativeY(element, used_, drawnY, stackedOn);
    const baseY = relative ?? element.y;
    if (element.relativeTo) stackedOn[element.id] = element.relativeTo.elementId;

    const elementY = absoluteY + baseY + offset;
    const used = await renderElement(element, elementY, context);

    used_[element.id] = used;
    drawnY[element.id] = baseY;

    // a base deste elemento usa o offset com que ele foi DESENHADO; o
    // crescimento dele entra no offset só depois, para os elementos seguintes
    const bottom = baseY + offset + used;
    if (bottom > maxBottom) maxBottom = bottom;

    if (element.canGrow) {
      const delta = used - element.height;
      if (delta > 0 || options.shrinkToContent) offset += delta;
    }
  }

  // banda sem elemento variável mantém a altura de design mesmo em modo
  // encolhível — senão viraria zero e os registros colariam
  if (options.shrinkToContent && !hasGrowingElement) {
    return Math.max(maxBottom, band.height);
  }

  return maxBottom;
}

/**
 * Altura que a banda vai ocupar, sem desenhar nada.
 *
 * Usado para decidir a quebra de página ANTES de começar a desenhar — sem
 * isso, metade de uma banda ficaria numa página e metade na outra.
 *
 * Com `row`, mede também os subreports dentro da banda, cuja altura depende de
 * quantas linhas aquele nó devolveu para aquela linha específica do pai.
 * A Fase 5 estende isso para o texto que cresce.
 */
export function measureBand(band: Band, row?: ResolvedRow): number {
  if (!row) return band.height;

  let maxBottom = band.height;
  let offset = 0;

  for (const element of [...band.elements].sort((a, b) => a.y - b.y)) {
    if (element.type !== 'subreport') continue;

    const used = measureSubreport(element, row);

    // o offset acumulado desloca ESTE elemento (por causa dos anteriores que
    // cresceram); o crescimento dele só entra no offset depois, para os
    // seguintes — somar antes contaria o mesmo crescimento duas vezes
    const bottom = element.y + offset + used;
    if (bottom > maxBottom) maxBottom = bottom;

    if (element.canGrow && used > element.height) offset += used - element.height;
  }

  return maxBottom;
}

/**
 * Y de um elemento posicionado em relação a outro.
 *
 * Devolve undefined quando não há `relativeTo` ou a referência ainda não foi
 * desenhada — aí vale a posição declarada.
 */
function resolveRelativeY(
  element: ReportElement,
  usedHeights: Record<string, number>,
  drawnY: Record<string, number>,
  stackedOn: Record<string, string>,
): number | undefined {
  const relative = element.relativeTo;
  if (!relative) return undefined;

  const refY = drawnY[relative.elementId];
  const refHeight = usedHeights[relative.elementId];
  if (refY === undefined || refHeight === undefined) return undefined;

  // colocação à direita não muda o Y; só a de baixo interessa aqui
  if (relative.placement === 'right') return refY;

  /**
   * Empilha DEPOIS do último já colocado sobre a mesma base (bug 4).
   *
   * Sem isso, dois elementos relativos ao mesmo bloco cairiam ambos logo
   * abaixo dele e ficariam sobrepostos.
   */
  const base = Math.max(
    refY + refHeight,
    ...Object.entries(drawnY)
      .filter(([id]) => stackedOn[id] === relative.elementId)
      .map(([id, y]) => y + (usedHeights[id] ?? 0)),
  );

  return base + (relative.gap ?? 0);
}

/** Opções de renderização de uma banda. */
export interface BandRenderOptions {
  /**
   * Permite a banda ocupar MENOS que `band.height` quando o conteúdo não a
   * preenche. Default: false, para não mudar o layout de quem já depende da
   * altura fixa como espaçamento.
   */
  shrinkToContent?: boolean;
}

/** Espaço vertical fixo que header e footer reservam em toda página. */
export interface PageFurniture {
  headerHeight: number;
  footerHeight: number;
}

/** Y de topo da área de conteúdo, logo abaixo do header de página. */
export function contentTop(ctx: PageContext, furniture: PageFurniture): number {
  return ctx.margins.top + furniture.headerHeight;
}
