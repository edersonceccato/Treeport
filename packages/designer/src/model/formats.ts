/**
 * Máscaras sugeridas por tipo de campo (item 20 do feedback).
 *
 * Ninguém decora `#,##0.00`. O designer adivinha o tipo pelo nome da coluna e
 * oferece as máscaras que fazem sentido — mas o campo continua livre para
 * digitar, porque a lista nunca cobre tudo (um "R$ " antes do valor, por
 * exemplo).
 */

export type FieldKind = 'number' | 'currency' | 'date' | 'datetime' | 'text' | 'boolean';

export interface FormatSuggestion {
  /** A máscara em si. */
  mask: string;
  /** Como fica, para o usuário reconhecer sem testar. */
  example: string;
  label: string;
}

/**
 * Adivinha o tipo pelo nome do campo e por um valor de amostra.
 *
 * O valor manda quando existe: um campo chamado `codigo` que traz `1500`
 * ainda é texto, mas um que traz `Date` é data. Sem valor, o nome decide.
 */
export function guessFieldKind(fieldName: string, sample?: unknown): FieldKind {
  if (sample instanceof Date) return 'date';
  if (typeof sample === 'boolean') return 'boolean';

  const name = fieldName.toLowerCase();

  if (/(valor|preco|price|total|amount|vlr|custo|receita|saldo)/.test(name)) return 'currency';
  if (/(data|date|emiss|venc|nasc|cadastro|_at$|_em$)/.test(name)) {
    return /(hora|time|_at$)/.test(name) ? 'datetime' : 'date';
  }
  if (/(qtd|quant|qty|peso|altura|largura|volume|percent|taxa|aliq)/.test(name)) {
    return 'number';
  }
  if (/^(ativo|inativo|is_|tem_|flag)/.test(name)) return 'boolean';

  if (typeof sample === 'number') return 'number';

  return 'text';
}

const SUGGESTIONS: Record<FieldKind, FormatSuggestion[]> = {
  currency: [
    { mask: '#,##0.00', example: '1.234,56', label: 'Decimal' },
    { mask: 'R$ #,##0.00', example: 'R$ 1.234,56', label: 'Real' },
    { mask: 'US$ #,##0.00', example: 'US$ 1.234,56', label: 'Dólar' },
    { mask: '#,##0', example: '1.235', label: 'Sem centavos' },
  ],
  number: [
    { mask: '#,##0', example: '1.235', label: 'Inteiro' },
    { mask: '#,##0.00', example: '1.234,56', label: '2 casas' },
    { mask: '#,##0.000', example: '1.234,560', label: '3 casas' },
    { mask: '#,##0.00 kg', example: '1.234,56 kg', label: 'Com unidade' },
    { mask: '0', example: '1235', label: 'Sem separador' },
  ],
  date: [
    { mask: 'dd/MM/yyyy', example: '03/08/2026', label: 'Brasileiro' },
    { mask: 'dd/MM/yy', example: '03/08/26', label: 'Ano curto' },
    { mask: 'yyyy-MM-dd', example: '2026-08-03', label: 'ISO' },
    { mask: 'dd/MM', example: '03/08', label: 'Sem ano' },
  ],
  datetime: [
    { mask: 'dd/MM/yyyy HH:mm', example: '03/08/2026 14:05', label: 'Data e hora' },
    { mask: 'dd/MM/yyyy HH:mm:ss', example: '03/08/2026 14:05:09', label: 'Com segundos' },
    { mask: 'HH:mm', example: '14:05', label: 'Só a hora' },
  ],
  boolean: [],
  text: [],
};

/** Máscaras sugeridas para um campo. */
export function suggestFormats(fieldName: string, sample?: unknown): FormatSuggestion[] {
  return SUGGESTIONS[guessFieldKind(fieldName, sample)];
}

/** Todas as máscaras conhecidas, agrupadas — para um seletor completo. */
export function allFormatGroups(): { kind: FieldKind; label: string; formats: FormatSuggestion[] }[] {
  return [
    { kind: 'currency', label: 'Moeda', formats: SUGGESTIONS.currency },
    { kind: 'number', label: 'Número', formats: SUGGESTIONS.number },
    { kind: 'date', label: 'Data', formats: SUGGESTIONS.date },
    { kind: 'datetime', label: 'Data e hora', formats: SUGGESTIONS.datetime },
  ];
}

/** Rótulo amigável do tipo, para exibir ao lado do campo. */
export const KIND_LABEL: Record<FieldKind, string> = {
  currency: 'moeda',
  number: 'número',
  date: 'data',
  datetime: 'data/hora',
  boolean: 'sim/não',
  text: 'texto',
};
