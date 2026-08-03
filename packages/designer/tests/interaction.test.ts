import { describe, it, expect } from 'vitest';
import {
  dragBox,
  resizeBox,
  handleCursor,
  intersects,
  snap,
  mmToPt,
  ptToMm,
  ptToUnit,
  unitToPt,
  formatUnit,
  MIN_SIZE,
  type Box,
} from '../src/index.js';

const box = (x = 100, y = 50, width = 80, height = 20): Box => ({ x, y, width, height });

describe('snap', () => {
  it('arredonda para o múltiplo mais próximo', () => {
    expect(snap(12, 5)).toBe(10);
    expect(snap(13, 5)).toBe(15);
    expect(snap(0, 5)).toBe(0);
  });

  it('grid zero ou negativo desliga o snap', () => {
    expect(snap(12.7, 0)).toBe(12.7);
    expect(snap(12.7, -1)).toBe(12.7);
  });
});

describe('conversão de unidades', () => {
  it('mm <-> pt ida e volta', () => {
    expect(ptToMm(mmToPt(10))).toBeCloseTo(10, 10);
  });

  it('1 polegada são 72 pontos', () => {
    expect(unitToPt(1, 'in')).toBe(72);
    expect(ptToUnit(72, 'in')).toBe(1);
  });

  it('A4 tem ~210mm de largura', () => {
    expect(ptToMm(595.28)).toBeCloseTo(210, 0);
  });

  it('formata com a unidade', () => {
    expect(formatUnit(mmToPt(25), 'mm')).toBe('25.0 mm');
  });
});

describe('dragBox', () => {
  it('desloca pela diferença', () => {
    expect(dragBox(box(), 20, 10)).toMatchObject({ x: 120, y: 60 });
  });

  it('mantém o tamanho', () => {
    const result = dragBox(box(), 20, 10);
    expect(result.width).toBe(80);
    expect(result.height).toBe(20);
  });

  it('aplica snap à posição final, não ao deslocamento', () => {
    // partindo de x=3 e arrastando 4, o resultado precisa cair no grid (5),
    // senão o elemento nunca alinharia se tivesse começado fora dele
    const result = dragBox(box(3, 0), 4, 0, { gridSize: 5 });
    expect(result.x).toBe(5);
  });

  it('não deixa sair pela esquerda nem pelo topo', () => {
    const result = dragBox(box(10, 10), -100, -100, { bounds: { width: 500, height: 200 } });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('não deixa sair pela direita nem por baixo', () => {
    const result = dragBox(box(0, 0, 80, 20), 1000, 1000, {
      bounds: { width: 500, height: 200 },
    });
    expect(result.x).toBe(420); // 500 - 80
    expect(result.y).toBe(180); // 200 - 20
  });

  it('sem bounds, pode ir para qualquer lugar', () => {
    expect(dragBox(box(), 10000, 0).x).toBe(10100);
  });
});

describe('resizeBox', () => {
  it('a alça leste aumenta a largura sem mover a origem', () => {
    const result = resizeBox(box(), 'e', 30, 0);
    expect(result).toMatchObject({ x: 100, width: 110 });
  });

  it('a alça sul aumenta a altura', () => {
    expect(resizeBox(box(), 's', 0, 15)).toMatchObject({ y: 50, height: 35 });
  });

  it('a alça oeste move a origem e ajusta a largura', () => {
    // puxar a borda esquerda para a esquerda aumenta o elemento
    const result = resizeBox(box(100, 50, 80, 20), 'w', -20, 0);
    expect(result.x).toBe(80);
    expect(result.width).toBe(100);
  });

  it('a alça norte move o topo e ajusta a altura', () => {
    const result = resizeBox(box(100, 50, 80, 20), 'n', 0, -10);
    expect(result.y).toBe(40);
    expect(result.height).toBe(30);
  });

  it('a alça sudeste mexe nos dois eixos', () => {
    const result = resizeBox(box(), 'se', 20, 10);
    expect(result).toMatchObject({ width: 100, height: 30 });
  });

  it('a borda direita fica parada ao arrastar a oeste', () => {
    const original = box(100, 50, 80, 20);
    const result = resizeBox(original, 'w', 30, 0);

    expect(result.x + result.width).toBe(original.x + original.width);
  });

  it('não deixa a caixa inverter ao arrastar demais', () => {
    const result = resizeBox(box(100, 50, 80, 20), 'e', -500, 0);
    expect(result.width).toBeGreaterThanOrEqual(MIN_SIZE);
  });

  it('ao inverter pela alça oeste, a origem para na borda direita', () => {
    const result = resizeBox(box(100, 50, 80, 20), 'w', 500, 0);
    expect(result.width).toBe(MIN_SIZE);
    expect(result.x).toBe(100 + 80 - MIN_SIZE);
  });

  it('aplica snap ao redimensionar', () => {
    const result = resizeBox(box(0, 0, 83, 20), 'e', 0, 0, { gridSize: 5 });
    expect(result.width % 5).toBe(0);
  });

  it('não deixa a caixa sair pela esquerda', () => {
    const result = resizeBox(box(10, 0, 80, 20), 'w', -50, 0);
    expect(result.x).toBe(0);
  });

  it('handle "move" se comporta como arrastar', () => {
    expect(resizeBox(box(), 'move', 10, 5)).toMatchObject({ x: 110, y: 55 });
  });
});

describe('handleCursor', () => {
  it('cada alça tem o cursor esperado', () => {
    expect(handleCursor('move')).toBe('move');
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('e')).toBe('ew-resize');
    expect(handleCursor('nw')).toBe('nwse-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
  });
});

describe('intersects', () => {
  it('detecta sobreposição', () => {
    expect(intersects(box(0, 0, 100, 100), box(50, 50, 100, 100))).toBe(true);
  });

  it('caixas separadas não se cruzam', () => {
    expect(intersects(box(0, 0, 50, 50), box(100, 100, 50, 50))).toBe(false);
  });

  it('encostar não é sobrepor', () => {
    expect(intersects(box(0, 0, 50, 50), box(50, 0, 50, 50))).toBe(false);
  });
});
