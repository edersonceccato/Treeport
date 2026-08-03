import { snap } from './units.js';
import { MIN_SIZE } from './template-editor.js';

/**
 * Geometria de arrastar e redimensionar.
 *
 * A matemática fica separada dos eventos de ponteiro por dois motivos: dá para
 * testar sem browser, e o mesmo cálculo serve para o teclado (setas movem o
 * elemento) sem duplicação.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** As 8 alças de redimensionamento, mais o corpo (mover). */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

export interface DragOptions {
  /** Tamanho do grid; 0 desliga o snap. */
  gridSize?: number;
  /** Limita o elemento à área da banda. */
  bounds?: { width: number; height: number };
}

/**
 * Nova posição ao arrastar o corpo do elemento.
 *
 * O snap é aplicado à posição FINAL, não ao deslocamento: senão o elemento
 * nunca alinharia ao grid se tivesse começado fora dele.
 */
export function dragBox(
  origin: Box,
  deltaX: number,
  deltaY: number,
  options: DragOptions = {},
): Box {
  const grid = options.gridSize ?? 0;

  let x = snap(origin.x + deltaX, grid);
  let y = snap(origin.y + deltaY, grid);

  if (options.bounds) {
    x = clamp(x, 0, Math.max(0, options.bounds.width - origin.width));
    y = clamp(y, 0, Math.max(0, options.bounds.height - origin.height));
  }

  return { ...origin, x, y };
}

/**
 * Nova caixa ao arrastar uma alça de redimensionamento.
 *
 * Alças do topo e da esquerda movem a origem além de mudar o tamanho — é o que
 * dá a sensação de "puxar aquele lado".
 */
export function resizeBox(
  origin: Box,
  handle: Handle,
  deltaX: number,
  deltaY: number,
  options: DragOptions = {},
): Box {
  if (handle === 'move') return dragBox(origin, deltaX, deltaY, options);

  const grid = options.gridSize ?? 0;
  let { x, y, width, height } = origin;

  if (handle.includes('e')) {
    width = snap(origin.width + deltaX, grid);
  }
  if (handle.includes('s')) {
    height = snap(origin.height + deltaY, grid);
  }
  if (handle.includes('w')) {
    const right = origin.x + origin.width;
    x = snap(origin.x + deltaX, grid);
    width = right - x;
  }
  if (handle.includes('n')) {
    const bottom = origin.y + origin.height;
    y = snap(origin.y + deltaY, grid);
    height = bottom - y;
  }

  // largura/altura mínimas: sem isso, arrastar demais inverteria a caixa
  if (width < MIN_SIZE) {
    if (handle.includes('w')) x = origin.x + origin.width - MIN_SIZE;
    width = MIN_SIZE;
  }
  if (height < MIN_SIZE) {
    if (handle.includes('n')) y = origin.y + origin.height - MIN_SIZE;
    height = MIN_SIZE;
  }

  if (x < 0) {
    width += x;
    x = 0;
  }
  if (y < 0) {
    height += y;
    y = 0;
  }

  if (options.bounds) {
    width = Math.min(width, options.bounds.width - x);
    height = Math.min(height, options.bounds.height - y);
  }

  return { x, y, width: Math.max(MIN_SIZE, width), height: Math.max(MIN_SIZE, height) };
}

/** O cursor CSS de cada alça. */
export function handleCursor(handle: Handle): string {
  switch (handle) {
    case 'move':
      return 'move';
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
  }
}

/** As caixas se sobrepõem? Usado para a seleção por retângulo. */
export function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
