import type { Box } from './interaction.js';

/**
 * Guias de alinhamento inteligentes (item 6 do feedback).
 *
 * Enquanto se arrasta um elemento, comparamos as bordas e o centro dele com os
 * dos vizinhos. Quando ficam a poucos pixels de distância, o elemento "gruda"
 * na posição alinhada e uma linha aparece — é o comportamento do Photoshop,
 * Figma e afins, e é o que faz um layout ficar alinhado sem ninguém digitar
 * coordenada.
 *
 * Isto aqui é só a matemática; desenhar as linhas é com a UI.
 */

/** Uma linha-guia a desenhar. */
export interface Guide {
  orientation: 'vertical' | 'horizontal';
  /** Posição da linha, em coordenadas da banda. */
  position: number;
  /** Extensão da linha, para ela cobrir os dois elementos envolvidos. */
  start: number;
  end: number;
  /** Que tipo de alinhamento gerou a guia (para colorir diferente). */
  kind: 'edge' | 'center' | 'page';
}

export interface SnapResult {
  /** A caixa já ajustada ao alinhamento. */
  box: Box;
  /** Guias a exibir. */
  guides: Guide[];
}

export interface SmartSnapOptions {
  /** Distância em pontos para o ímã atuar. Default: 5. */
  threshold?: number;
  /** Largura da área útil, para alinhar ao centro e às bordas da página. */
  pageWidth?: number;
  /** Altura da banda, idem. */
  bandHeight?: number;
  /** Desliga as guias (o usuário pode preferir posicionamento livre). */
  enabled?: boolean;
}

/** As posições notáveis de uma caixa num eixo. */
interface Anchors {
  start: number;
  center: number;
  end: number;
}

function anchorsX(box: Box): Anchors {
  return { start: box.x, center: box.x + box.width / 2, end: box.x + box.width };
}

function anchorsY(box: Box): Anchors {
  return { start: box.y, center: box.y + box.height / 2, end: box.y + box.height };
}

/**
 * Ajusta a caixa arrastada ao alinhamento mais próximo.
 *
 * Considera, em cada eixo: borda inicial, centro e borda final — tanto dos
 * vizinhos quanto da própria página/banda. O ajuste mais próximo dentro do
 * limiar vence; nenhum candidato dentro do limiar significa posição livre.
 */
export function snapToGuides(
  moving: Box,
  others: Box[],
  options: SmartSnapOptions = {},
): SnapResult {
  if (options.enabled === false) return { box: moving, guides: [] };

  const threshold = options.threshold ?? 5;
  const guides: Guide[] = [];
  const box = { ...moving };

  // --- eixo X ---
  const movingX = anchorsX(moving);
  let bestX: { delta: number; guide: Guide } | undefined;

  for (const other of others) {
    const otherX = anchorsX(other);

    for (const [movingKey, movingValue] of Object.entries(movingX)) {
      for (const [otherKey, otherValue] of Object.entries(otherX)) {
        const delta = otherValue - movingValue;
        if (Math.abs(delta) > threshold) continue;
        if (bestX && Math.abs(delta) >= Math.abs(bestX.delta)) continue;

        bestX = {
          delta,
          guide: {
            orientation: 'vertical',
            position: otherValue,
            start: Math.min(moving.y, other.y),
            end: Math.max(moving.y + moving.height, other.y + other.height),
            kind: movingKey === 'center' && otherKey === 'center' ? 'center' : 'edge',
          },
        };
      }
    }
  }

  // bordas e centro da página valem como referência mesmo sem vizinhos
  if (options.pageWidth !== undefined) {
    for (const [kind, value] of [
      ['page', 0],
      ['page', options.pageWidth / 2],
      ['page', options.pageWidth],
    ] as const) {
      for (const movingValue of Object.values(movingX)) {
        const delta = value - movingValue;
        if (Math.abs(delta) > threshold) continue;
        if (bestX && Math.abs(delta) >= Math.abs(bestX.delta)) continue;

        bestX = {
          delta,
          guide: {
            orientation: 'vertical',
            position: value,
            start: 0,
            end: options.bandHeight ?? moving.y + moving.height,
            kind,
          },
        };
      }
    }
  }

  if (bestX) {
    box.x = moving.x + bestX.delta;
    guides.push(bestX.guide);
  }

  // --- eixo Y ---
  const movingY = anchorsY(moving);
  let bestY: { delta: number; guide: Guide } | undefined;

  for (const other of others) {
    const otherY = anchorsY(other);

    for (const [movingKey, movingValue] of Object.entries(movingY)) {
      for (const [otherKey, otherValue] of Object.entries(otherY)) {
        const delta = otherValue - movingValue;
        if (Math.abs(delta) > threshold) continue;
        if (bestY && Math.abs(delta) >= Math.abs(bestY.delta)) continue;

        bestY = {
          delta,
          guide: {
            orientation: 'horizontal',
            position: otherValue,
            start: Math.min(moving.x, other.x),
            end: Math.max(moving.x + moving.width, other.x + other.width),
            kind: movingKey === 'center' && otherKey === 'center' ? 'center' : 'edge',
          },
        };
      }
    }
  }

  if (options.bandHeight !== undefined) {
    for (const value of [0, options.bandHeight / 2, options.bandHeight]) {
      for (const movingValue of Object.values(movingY)) {
        const delta = value - movingValue;
        if (Math.abs(delta) > threshold) continue;
        if (bestY && Math.abs(delta) >= Math.abs(bestY.delta)) continue;

        bestY = {
          delta,
          guide: {
            orientation: 'horizontal',
            position: value,
            start: 0,
            end: options.pageWidth ?? moving.x + moving.width,
            kind: 'page',
          },
        };
      }
    }
  }

  if (bestY) {
    box.y = moving.y + bestY.delta;
    guides.push(bestY.guide);
  }

  return { box, guides };
}

/**
 * Distância igual entre elementos, mostrada durante o arrasto.
 *
 * Detecta quando o espaço entre o elemento arrastado e um vizinho é o mesmo
 * que entre dois outros — o "espaçamento consistente" que os editores mostram
 * com setinhas.
 */
export function equalSpacingHints(moving: Box, others: Box[], threshold = 2): number[] {
  const gaps: number[] = [];
  const sorted = [...others].sort((a, b) => a.x - b.x);

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const gap = sorted[i + 1]!.x - (sorted[i]!.x + sorted[i]!.width);
    if (gap <= 0) continue;

    for (const other of sorted) {
      const before = moving.x - (other.x + other.width);
      const after = other.x - (moving.x + moving.width);

      if (Math.abs(before - gap) <= threshold || Math.abs(after - gap) <= threshold) {
        gaps.push(gap);
      }
    }
  }

  return [...new Set(gaps)];
}
