import type { Band } from '@treeport/schema';
import type { PageContext } from './page-context.js';
import { renderElement, type RenderElementContext } from './elements.js';

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
): Promise<number> {
  // ordena por Y de origem para o offset acumulado fazer sentido
  const ordered = [...band.elements].sort((a, b) => a.y - b.y);

  let offset = 0;
  let maxBottom = band.height;

  for (const element of ordered) {
    const elementY = absoluteY + element.y + offset;
    const used = await renderElement(element, elementY, context);

    if (element.canGrow && used > element.height) {
      offset += used - element.height;
    }

    const bottom = element.y + offset + used;
    if (bottom > maxBottom) maxBottom = bottom;
  }

  return maxBottom;
}

/**
 * Altura que a banda vai ocupar, sem desenhar nada.
 *
 * Usado para decidir a quebra de página ANTES de começar a desenhar — sem
 * isso, metade de uma banda ficaria numa página e metade na outra.
 * Nesta fase é a altura nominal; a Fase 5 refina para considerar o
 * crescimento real dos elementos.
 */
export function measureBand(band: Band): number {
  return band.height;
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
