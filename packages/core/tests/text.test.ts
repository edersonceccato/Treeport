import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import { wrapText, measure, lineHeight, loadFonts } from '../src/index.js';

let font: PDFFont;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  font = (await loadFonts(doc)).regular;
});

describe('wrapText', () => {
  it('texto curto cabe numa linha só', () => {
    expect(wrapText('Frete', font, 10, 200)).toEqual(['Frete']);
  });

  it('quebra em várias linhas quando não cabe', () => {
    const lines = wrapText(
      'Armazenagem de carga no terminal portuário de Santos',
      font,
      10,
      100,
    );

    expect(lines.length).toBeGreaterThan(1);
    // nenhuma linha pode ultrapassar a largura pedida
    for (const line of lines) {
      expect(measure(line, font, 10)).toBeLessThanOrEqual(100);
    }
    // nenhuma palavra pode ter sumido
    expect(lines.join(' ')).toBe('Armazenagem de carga no terminal portuário de Santos');
  });

  it('respeita quebras de linha explícitas', () => {
    expect(wrapText('Linha 1\nLinha 2', font, 10, 500)).toEqual(['Linha 1', 'Linha 2']);
  });

  it('preserva linha em branco entre parágrafos', () => {
    expect(wrapText('A\n\nB', font, 10, 500)).toEqual(['A', '', 'B']);
  });

  it('quebra palavra única maior que a largura', () => {
    const lines = wrapText('Supercalifragilisticexpialidocious', font, 10, 40);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measure(line, font, 10)).toBeLessThanOrEqual(40);
    }
    expect(lines.join('')).toBe('Supercalifragilisticexpialidocious');
  });

  it('string vazia devolve uma linha vazia', () => {
    expect(wrapText('', font, 10, 100)).toEqual(['']);
  });

  it('fonte maior gera mais linhas para o mesmo texto', () => {
    const texto = 'Armazenagem de carga no terminal';
    const pequena = wrapText(texto, font, 8, 100);
    const grande = wrapText(texto, font, 16, 100);

    expect(grande.length).toBeGreaterThan(pequena.length);
  });
});

describe('measure', () => {
  it('texto mais longo mede mais', () => {
    expect(measure('AAAA', font, 10)).toBeGreaterThan(measure('A', font, 10));
  });

  it('não lança com caractere fora da fonte padrão', () => {
    // sem o fallback defensivo isso jogaria uma exceção do pdf-lib
    expect(() => measure('🚢', font, 10)).not.toThrow();
    expect(measure('🚢', font, 10)).toBeGreaterThan(0);
  });
});

describe('lineHeight', () => {
  it('é proporcional ao corpo da fonte', () => {
    expect(lineHeight(10)).toBeCloseTo(12);
    expect(lineHeight(20)).toBeCloseTo(24);
  });
});
