import { formatValue } from '../render/format.js';

/**
 * Funções disponíveis dentro das expressões.
 *
 * O conjunto é deliberadamente pequeno e voltado a relatório: condicional,
 * texto, número e data. Quem precisa de mais registra as próprias funções via
 * `functions` nas opções de avaliação — a lib não tenta adivinhar todo caso.
 */

export type ExpressionFunction = (...args: unknown[]) => unknown;

/** Converte para número do jeito mais tolerante possível (dados vêm do banco). */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Converte para texto; nulo vira string vazia, nunca "null". */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatValue(value);
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return String(value);
}

/** Regra de veracidade: 0, '', null e false são falsos. */
export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '' || v === 'false' || v === '0' || v === 'não' || v === 'nao') return false;
    return true;
  }
  return true;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export const BUILTIN_FUNCTIONS: Record<string, ExpressionFunction> = {
  // --- condicional ---------------------------------------------------------
  /** IF(condição, seVerdadeiro, seFalso) */
  IF: (condition, whenTrue, whenFalse) => (toBoolean(condition) ? whenTrue : whenFalse),

  /** COALESCE(a, b, ...) — primeiro valor não nulo/vazio */
  COALESCE: (...args) =>
    args.find((a) => a !== null && a !== undefined && a !== '') ?? null,

  /** ISNULL(valor) */
  ISNULL: (value) => value === null || value === undefined || value === '',

  // --- texto ---------------------------------------------------------------
  CONCAT: (...args) => args.map(toText).join(''),
  UPPER: (value) => toText(value).toUpperCase(),
  LOWER: (value) => toText(value).toLowerCase(),
  TRIM: (value) => toText(value).trim(),
  LEN: (value) => toText(value).length,

  /** SUBSTR(texto, início, tamanho) — início é 1-based, como em SQL */
  SUBSTR: (value, start, length) => {
    const text = toText(value);
    const from = Math.max(0, toNumber(start) - 1);
    return length === undefined
      ? text.slice(from)
      : text.slice(from, from + toNumber(length));
  },

  REPLACE: (value, search, replacement) =>
    toText(value).split(toText(search)).join(toText(replacement)),

  /** PAD(texto, tamanho, caractere) — completa à esquerda */
  PAD: (value, size, char) =>
    toText(value).padStart(toNumber(size), toText(char ?? ' ') || ' '),

  // --- número --------------------------------------------------------------
  ROUND: (value, decimals) => {
    const factor = 10 ** toNumber(decimals ?? 0);
    return Math.round(toNumber(value) * factor) / factor;
  },
  FLOOR: (value) => Math.floor(toNumber(value)),
  CEIL: (value) => Math.ceil(toNumber(value)),
  ABS: (value) => Math.abs(toNumber(value)),
  MIN: (...args) => Math.min(...args.map(toNumber)),
  MAX: (...args) => Math.max(...args.map(toNumber)),

  // --- conversão e formatação ---------------------------------------------
  /** FORMAT(valor, máscara) — as mesmas máscaras do FieldElement */
  FORMAT: (value, mask) => formatValue(value, mask === undefined ? undefined : toText(mask)),
  NUMBER: (value) => toNumber(value),
  TEXT: (value) => toText(value),

  // --- data ----------------------------------------------------------------
  /** TODAY() — data de hoje, sem hora */
  TODAY: () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  },
  NOW: () => new Date(),
  YEAR: (value) => toDate(value)?.getFullYear() ?? null,
  MONTH: (value) => {
    const d = toDate(value);
    return d ? d.getMonth() + 1 : null;
  },
  DAY: (value) => toDate(value)?.getDate() ?? null,
};
