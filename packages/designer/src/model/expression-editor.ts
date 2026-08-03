import type { ExplorerField } from './field-explorer.js';
import { fieldReference } from './field-explorer.js';

/**
 * Apoio ao editor de expressão (sub-fase 9.6 do brief).
 *
 * O brief é explícito: um `<textarea>` com destaque por regex basta, sem
 * puxar um editor de código pesado tipo Monaco — que infla o bundle sem
 * necessidade num campo onde se escreve uma linha.
 *
 * Aqui mora só a lógica: onde está o cursor, o que sugerir, como inserir.
 * A UI é um textarea comum.
 */

/** Funções nativas do motor de expressões, para o autocomplete. */
export const BUILTIN_FUNCTION_NAMES = [
  'IF',
  'COALESCE',
  'ISNULL',
  'CONCAT',
  'UPPER',
  'LOWER',
  'TRIM',
  'LEN',
  'SUBSTR',
  'REPLACE',
  'PAD',
  'ROUND',
  'FLOOR',
  'CEIL',
  'ABS',
  'MIN',
  'MAX',
  'FORMAT',
  'NUMBER',
  'TEXT',
  'TODAY',
  'NOW',
  'YEAR',
  'MONTH',
  'DAY',
] as const;

export type SuggestionKind = 'field' | 'function' | 'scope';

export interface Suggestion {
  /** O que é inserido no texto. */
  insert: string;
  /** O que aparece na lista. */
  label: string;
  kind: SuggestionKind;
  /** Explicação curta, mostrada ao lado. */
  detail?: string;
}

/** Segmentos para o destaque de sintaxe. */
export interface HighlightSegment {
  text: string;
  /** `expression` é o miolo de `{{...}}`; `text` é o literal em volta. */
  type: 'text' | 'expression' | 'delimiter';
}

/**
 * Quebra o texto em literais e expressões, para colorir.
 *
 * Os delimitadores saem separados do miolo, de modo que a UI possa pintá-los
 * de forma diferente e o usuário enxergue onde a expressão começa e termina.
 */
export function highlight(text: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const pattern = /\{\{([\s\S]*?)\}\}/g;

  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), type: 'text' });
    }
    segments.push({ text: '{{', type: 'delimiter' });
    segments.push({ text: match[1] ?? '', type: 'expression' });
    segments.push({ text: '}}', type: 'delimiter' });
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    segments.push({ text: text.slice(last), type: 'text' });
  }

  return segments;
}

/** O cursor está dentro de um `{{ }}`? */
export function isInsideExpression(text: string, cursor: number): boolean {
  const before = text.slice(0, cursor);
  const open = before.lastIndexOf('{{');
  if (open === -1) return false;

  const close = before.lastIndexOf('}}');
  return close < open;
}

/**
 * A palavra sendo digitada na posição do cursor.
 *
 * Considera `parent.` como parte da palavra, senão o autocomplete perderia o
 * contexto logo depois do ponto.
 */
export function wordAtCursor(text: string, cursor: number): { word: string; start: number } {
  let start = cursor;
  while (start > 0 && /[A-Za-z0-9_.]/.test(text[start - 1] ?? '')) start -= 1;

  return { word: text.slice(start, cursor), start };
}

export interface SuggestOptions {
  /** Campos visíveis no escopo do nó atual. */
  fields?: ExplorerField[];
  /** Nomes de funções extras registradas pelo host. */
  customFunctions?: string[];
  /** Sugerir mesmo fora de `{{ }}` (para um campo que é só expressão). */
  alwaysSuggest?: boolean;
  /** Teto de sugestões. Default: 12. */
  limit?: number;
}

/**
 * Sugestões para a posição do cursor.
 *
 * Só sugere dentro de `{{ }}` (ou com `alwaysSuggest`), porque no texto
 * literal o usuário está escrevendo prosa e uma lista aparecendo seria
 * atrapalho.
 */
export function suggest(
  text: string,
  cursor: number,
  options: SuggestOptions = {},
): Suggestion[] {
  if (!options.alwaysSuggest && !isInsideExpression(text, cursor)) return [];

  const { word } = wordAtCursor(text, cursor);
  const needle = word.toLowerCase();
  const out: Suggestion[] = [];

  for (const field of options.fields ?? []) {
    const insert = fieldReference(field);
    if (!insert.toLowerCase().includes(needle)) continue;

    out.push({
      insert,
      label: insert,
      kind: 'field',
      detail: field.depth === 0 ? field.nodeId : `${field.nodeId} (${field.depth} nível acima)`,
    });
  }

  // `parent.` só faz sentido quando existe algum campo de nível acima
  const hasAncestors = (options.fields ?? []).some((f) => f.depth > 0);
  if (hasAncestors && 'parent.'.includes(needle) && needle !== '') {
    out.push({
      insert: 'parent.',
      label: 'parent.',
      kind: 'scope',
      detail: 'campo do nó pai',
    });
  }

  const functions = [...BUILTIN_FUNCTION_NAMES, ...(options.customFunctions ?? [])];
  for (const name of functions) {
    if (!name.toLowerCase().includes(needle)) continue;
    out.push({
      insert: `${name}(`,
      label: `${name}()`,
      kind: 'function',
      detail: 'função',
    });
  }

  // campos primeiro: é o que se digita com mais frequência
  out.sort((a, b) => {
    const byKind = kindRank(a.kind) - kindRank(b.kind);
    if (byKind !== 0) return byKind;

    // prefixo exato antes de correspondência no meio
    const aStarts = a.label.toLowerCase().startsWith(needle) ? 0 : 1;
    const bStarts = b.label.toLowerCase().startsWith(needle) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;

    return a.label.localeCompare(b.label);
  });

  return out.slice(0, options.limit ?? 12);
}

function kindRank(kind: SuggestionKind): number {
  return kind === 'field' ? 0 : kind === 'scope' ? 1 : 2;
}

export interface ApplyResult {
  text: string;
  /** Onde deixar o cursor depois de inserir. */
  cursor: number;
}

/** Substitui a palavra sob o cursor pela sugestão escolhida. */
export function applySuggestion(
  text: string,
  cursor: number,
  suggestion: Suggestion,
): ApplyResult {
  const { start } = wordAtCursor(text, cursor);
  const next = text.slice(0, start) + suggestion.insert + text.slice(cursor);

  return { text: next, cursor: start + suggestion.insert.length };
}

/**
 * Insere `{{ }}` e deixa o cursor no meio.
 * É o atalho para quem clica em "inserir expressão".
 */
export function insertPlaceholder(text: string, cursor: number, content = ''): ApplyResult {
  const next = `${text.slice(0, cursor)}{{${content}}}${text.slice(cursor)}`;
  return { text: next, cursor: cursor + 2 + content.length };
}

/**
 * Erros óbvios de sintaxe, para avisar antes de salvar.
 *
 * Não é o parser completo — só o que dá para checar sem ele, para dar
 * retorno imediato enquanto se digita. O parser de verdade roda no backend
 * na hora de gerar.
 */
export function validateSyntax(text: string): string[] {
  const problems: string[] = [];

  const opens = (text.match(/\{\{/g) ?? []).length;
  const closes = (text.match(/\}\}/g) ?? []).length;
  if (opens !== closes) {
    problems.push(
      opens > closes ? 'Falta fechar uma expressão com "}}"' : 'Há um "}}" sem "{{" correspondente',
    );
  }

  for (const match of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const inner = match[1] ?? '';

    if (inner.trim() === '') {
      problems.push('Expressão vazia: {{}}');
      continue;
    }

    let depth = 0;
    for (const char of inner) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth < 0) break;
    }
    if (depth !== 0) {
      problems.push(`Parênteses desbalanceados em "{{${inner.trim()}}}"`);
    }

    const quotes = (inner.match(/'/g) ?? []).length;
    if (quotes % 2 !== 0) {
      problems.push(`Aspas não fechadas em "{{${inner.trim()}}}"`);
    }
  }

  return problems;
}
