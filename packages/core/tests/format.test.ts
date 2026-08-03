import { describe, it, expect } from 'vitest';
import { formatValue, formatNumber, formatDate } from '../src/index.js';

describe('formatNumber', () => {
  it('aplica separadores pt-BR por padrão', () => {
    expect(formatNumber(1500, '#,##0.00')).toBe('1.500,00');
    expect(formatNumber(1234567.891, '#,##0.00')).toBe('1.234.567,89');
  });

  it('sem agrupamento quando a máscara não pede', () => {
    expect(formatNumber(1500, '0.00')).toBe('1500,00');
  });

  it('sem casas decimais', () => {
    expect(formatNumber(1500.7, '#,##0')).toBe('1.501');
  });

  it('arredonda em vez de truncar', () => {
    expect(formatNumber(2.345, '0.00')).toBe('2,35');
    expect(formatNumber(2.344, '0.00')).toBe('2,34');
  });

  it('trata negativo pondo o sinal antes do prefixo', () => {
    expect(formatNumber(-1500, 'R$ #,##0.00')).toBe('-R$ 1.500,00');
  });

  it('mantém prefixo e sufixo literais', () => {
    expect(formatNumber(1500, 'R$ #,##0.00')).toBe('R$ 1.500,00');
    expect(formatNumber(15, '#,##0.00 kg')).toBe('15,00 kg');
  });

  it('aceita separadores customizados (en-US)', () => {
    expect(
      formatNumber(1500.5, '#,##0.00', { thousandSeparator: ',', decimalSeparator: '.' }),
    ).toBe('1,500.50');
  });

  it('zero continua zero', () => {
    expect(formatNumber(0, '#,##0.00')).toBe('0,00');
  });
});

describe('formatDate', () => {
  const date = new Date(2026, 7, 3, 14, 5, 9); // 03/08/2026 14:05:09 local

  it('formata no padrão brasileiro', () => {
    expect(formatDate(date, 'dd/MM/yyyy')).toBe('03/08/2026');
  });

  it('formata com hora', () => {
    expect(formatDate(date, 'dd/MM/yyyy HH:mm')).toBe('03/08/2026 14:05');
    expect(formatDate(date, 'HH:mm:ss')).toBe('14:05:09');
  });

  it('formata no padrão ISO', () => {
    expect(formatDate(date, 'yyyy-MM-dd')).toBe('2026-08-03');
  });

  it('ano com 2 dígitos', () => {
    expect(formatDate(date, 'dd/MM/yy')).toBe('03/08/26');
  });
});

describe('formatValue', () => {
  it('nulo e indefinido viram string vazia', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue(undefined)).toBe('');
    expect(formatValue(null, '#,##0.00')).toBe('');
    expect(formatValue(null, 'dd/MM/yyyy')).toBe('');
  });

  it('escolhe a máscara pelo tipo de token', () => {
    expect(formatValue(1500, '#,##0.00')).toBe('1.500,00');
    expect(formatValue('2026-08-03T12:00:00Z', 'yyyy-MM-dd')).toMatch(/2026-08-0[23]/);
  });

  it('converte string numérica vinda do banco', () => {
    // drivers costumam devolver DECIMAL como string
    expect(formatValue('1500.5', '#,##0.00')).toBe('1.500,50');
  });

  it('sem máscara, Date sai no padrão brasileiro', () => {
    expect(formatValue(new Date(2026, 7, 3))).toBe('03/08/2026');
  });

  it('sem máscara, booleano vira Sim/Não', () => {
    expect(formatValue(true)).toBe('Sim');
    expect(formatValue(false)).toBe('Não');
  });

  it('valor não numérico com máscara de número fica como está', () => {
    expect(formatValue('N/A', '#,##0.00')).toBe('N/A');
  });

  it('valor não convertível com máscara de data fica como está', () => {
    expect(formatValue('sem data', 'dd/MM/yyyy')).toBe('sem data');
  });

  it('zero não vira string vazia', () => {
    // erro clássico: usar falsy em vez de null-check
    expect(formatValue(0, '#,##0.00')).toBe('0,00');
    expect(formatValue(0)).toBe('0');
  });
});
