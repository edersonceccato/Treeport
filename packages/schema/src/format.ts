/**
 * Formatação de valores para exibição (máscara `format` do FieldElement).
 *
 * Suporta dois grupos de máscara, escolhidos pelo formato do valor:
 * - **data**: `dd/MM/yyyy`, `dd/MM/yyyy HH:mm`, `yyyy-MM-dd`, etc.
 * - **número**: `#,##0.00`, `0.00`, `#,##0`, com sufixo/prefixo literal.
 *
 * A ideia é cobrir o que um relatório precisa no dia a dia sem puxar uma
 * dependência de i18n. Locale padrão: pt-BR (separador de milhar `.` e
 * decimal `,`), configurável.
 */

export interface FormatOptions {
  /** Separador de milhar. Default: '.' (pt-BR). */
  thousandSeparator?: string;
  /** Separador decimal. Default: ',' (pt-BR). */
  decimalSeparator?: string;
}

const DEFAULTS: Required<FormatOptions> = {
  thousandSeparator: '.',
  decimalSeparator: ',',
};

/** Tokens de data reconhecidos, do mais longo para o mais curto. */
const DATE_TOKENS = /yyyy|yy|MM|dd|HH|mm|ss/g;

/** Uma máscara é de data se contém algum token de data. */
function isDateMask(mask: string): boolean {
  return /yyyy|yy|MM|dd|HH|mm|ss/.test(mask);
}

/**
 * Converte um valor cru para texto, aplicando a máscara quando informada.
 * Valor nulo/indefinido vira string vazia — relatório não mostra "null".
 */
export function formatValue(
  value: unknown,
  mask?: string,
  options: FormatOptions = {},
): string {
  if (value === null || value === undefined) return '';

  if (!mask) {
    if (value instanceof Date) return formatDate(value, 'dd/MM/yyyy');
    if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
    return String(value);
  }

  if (isDateMask(mask)) {
    const date = toDate(value);
    return date ? formatDate(date, mask) : String(value);
  }

  const num = toNumber(value);
  return num === null ? String(value) : formatNumber(num, mask, options);
}

/** Aceita Date, string ISO ou timestamp numérico. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const pad = (n: number, size = 2): string => String(n).padStart(size, '0');

/** Aplica uma máscara de data. Usa a hora local, não UTC. */
export function formatDate(date: Date, mask: string): string {
  return mask.replace(DATE_TOKENS, (token) => {
    switch (token) {
      case 'yyyy':
        return String(date.getFullYear());
      case 'yy':
        return pad(date.getFullYear() % 100);
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'dd':
        return pad(date.getDate());
      case 'HH':
        return pad(date.getHours());
      case 'mm':
        return pad(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds());
      default:
        return token;
    }
  });
}

/**
 * Aplica uma máscara numérica no estilo `#,##0.00`.
 *
 * Na máscara, `.` sempre marca a posição decimal e `,` o agrupamento de
 * milhar (convenção herdada do Excel/Delphi); a saída usa os separadores de
 * `options`, que por padrão são os do pt-BR. Texto fora do padrão numérico é
 * mantido como literal (ex.: `"R$ #,##0.00"`).
 */
export function formatNumber(
  value: number,
  mask: string,
  options: FormatOptions = {},
): string {
  const { thousandSeparator, decimalSeparator } = { ...DEFAULTS, ...options };

  // isola o miolo numérico da máscara; o resto vira prefixo/sufixo literal
  const match = /[#0][#0,]*(\.[0]+)?/.exec(mask);
  if (!match) return String(value);

  const numericMask = match[0];
  const prefix = mask.slice(0, match.index);
  const suffix = mask.slice(match.index + numericMask.length);

  const dotIndex = numericMask.indexOf('.');
  const decimals = dotIndex === -1 ? 0 : numericMask.length - dotIndex - 1;
  const useGrouping = numericMask.includes(',');

  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPartRaw = '0', decPart = ''] = fixed.split('.');

  const intPart = useGrouping
    ? intPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator)
    : intPartRaw;

  const body = decimals > 0 ? `${intPart}${decimalSeparator}${decPart}` : intPart;
  return `${negative ? '-' : ''}${prefix}${body}${suffix}`;
}
