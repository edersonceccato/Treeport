/**
 * Conversão de unidades.
 *
 * O template guarda tudo em **pontos PDF** (1pt = 1/72"), que é o que o motor
 * de renderização usa. O designer exibe em milímetros, porque é assim que
 * quem desenha relatório pensa ("a margem tem 2cm").
 *
 * A conversão fica isolada aqui para o resto do designer nunca ter dúvida
 * sobre qual unidade está manipulando: o modelo é sempre pt, a régua é mm.
 */

/** Pontos por milímetro. */
export const PT_PER_MM = 72 / 25.4; // ≈ 2.8346

/** Pontos por polegada. */
export const PT_PER_INCH = 72;

export type RulerUnit = 'mm' | 'in';

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

export function inToPt(inches: number): number {
  return inches * PT_PER_INCH;
}

export function ptToIn(pt: number): number {
  return pt / PT_PER_INCH;
}

/** Converte pontos para a unidade da régua. */
export function ptToUnit(pt: number, unit: RulerUnit): number {
  return unit === 'mm' ? ptToMm(pt) : ptToIn(pt);
}

/** Converte da unidade da régua para pontos. */
export function unitToPt(value: number, unit: RulerUnit): number {
  return unit === 'mm' ? mmToPt(value) : inToPt(value);
}

/**
 * Arredonda para o múltiplo mais próximo do grid.
 * Com `size <= 0` o snap fica desligado e o valor passa intacto.
 */
export function snap(value: number, size: number): number {
  if (size <= 0) return value;
  return Math.round(value / size) * size;
}

/** Formata um valor em pontos para exibição na unidade escolhida. */
export function formatUnit(pt: number, unit: RulerUnit, decimals = 1): string {
  return `${ptToUnit(pt, unit).toFixed(decimals)} ${unit}`;
}
