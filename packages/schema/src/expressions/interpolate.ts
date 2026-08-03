import type { ExpressionNode } from './ast.js';
import { parseExpression } from './parser.js';
import {
  evaluateNode,
  ExpressionEvaluationError,
  type EvaluateOptions,
  type ExpressionScope,
} from './evaluate.js';
import { toText } from './functions.js';
import { ExpressionSyntaxError } from './tokenizer.js';

/**
 * Interpolação de `{{...}}` dentro do texto de um Label (seção 6 do brief).
 *
 * `"{{NOME}} - Total: {{VALOR_A + VALOR_B}}"` vira `"João - Total: 150"`.
 *
 * O texto é compilado uma vez e reaproveitado a cada linha — numa lista de
 * 5.000 registros a expressão é parseada 1 vez, não 5.000.
 */

/** Pedaço de um texto compilado: literal ou expressão. */
type Segment = { literal: string } | { node: ExpressionNode; source: string };

export interface CompiledTemplate {
  /** O texto original, guardado para mensagens de erro. */
  source: string;
  segments: Segment[];
  /** Se false, o texto não tem `{{}}` e pode ser usado direto. */
  hasExpressions: boolean;
}

/** Cache global de compilação, indexado pelo texto original. */
const cache = new Map<string, CompiledTemplate>();
/** Teto do cache, para um relatório gerado com muitos textos distintos
 *  não virar vazamento de memória num servidor de longa duração. */
const CACHE_LIMIT = 500;

/** Encontra `{{ ... }}`, permitindo espaços e quebras de linha dentro. */
const PLACEHOLDER = /\{\{([\s\S]*?)\}\}/g;

/** Compila um texto com placeholders, usando cache. */
export function compileTemplate(text: string): CompiledTemplate {
  const cached = cache.get(text);
  if (cached) return cached;

  const segments: Segment[] = [];
  let lastIndex = 0;
  let hasExpressions = false;

  PLACEHOLDER.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = PLACEHOLDER.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ literal: text.slice(lastIndex, match.index) });
    }

    const source = (match[1] ?? '').trim();
    if (source === '') {
      // `{{}}` vazio: trata como literal, não como erro
      segments.push({ literal: match[0] });
    } else {
      segments.push({ node: parseExpression(source), source });
      hasExpressions = true;
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ literal: text.slice(lastIndex) });
  }

  const compiled: CompiledTemplate = { source: text, segments, hasExpressions };

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, compiled);

  return compiled;
}

/**
 * Resolve um texto com `{{...}}` contra um escopo de dados.
 *
 * Quando o texto inteiro é uma única expressão (`"{{VALOR}}"`), o resultado
 * mantém o tipo original em vez de virar texto — é o que permite
 * `evaluateExpression` devolver número para quem precisa calcular.
 */
export function interpolate(
  text: string,
  scope: ExpressionScope,
  options: EvaluateOptions = {},
): string {
  const compiled = compileTemplate(text);
  if (!compiled.hasExpressions) return text;

  let out = '';
  for (const segment of compiled.segments) {
    if ('literal' in segment) {
      out += segment.literal;
      continue;
    }
    out += toText(evaluateWithContext(segment.node, segment.source, text, scope, options));
  }
  return out;
}

/**
 * Avalia uma expressão pura (sem `{{}}`) e devolve o valor tipado.
 * Usado por elementos que precisam do valor cru, como o Barcode (Fase 6).
 */
export function evaluateExpression(
  source: string,
  scope: ExpressionScope,
  options: EvaluateOptions = {},
): unknown {
  const trimmed = source.trim();

  // aceita tanto "CAMPO" quanto "{{CAMPO}}"
  const single = /^\{\{([\s\S]*)\}\}$/.exec(trimmed);
  const expression = single ? (single[1] ?? '').trim() : trimmed;

  if (expression === '') return '';

  // se sobrou algum {{ }} no meio, é texto misto: interpola como string
  if (!single && trimmed.includes('{{')) {
    return interpolate(source, scope, options);
  }

  const node = parseExpression(expression);
  return evaluateWithContext(node, expression, source, scope, options);
}

/** Enriquece o erro com o texto de origem, para o usuário achar o template. */
function evaluateWithContext(
  node: ExpressionNode,
  expressionSource: string,
  fullText: string,
  scope: ExpressionScope,
  options: EvaluateOptions,
): unknown {
  try {
    return evaluateNode(node, scope, options);
  } catch (err) {
    if (err instanceof ExpressionEvaluationError) {
      throw new ExpressionEvaluationError(
        `${err.message}\n  Expressão: {{${expressionSource}}}\n  Em: "${fullText}"`,
      );
    }
    throw err;
  }
}

/** Um texto contém `{{...}}`? */
export function hasPlaceholders(text: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}

/** Limpa o cache de compilação (usado nos testes). */
export function clearExpressionCache(): void {
  cache.clear();
}

export { ExpressionSyntaxError, ExpressionEvaluationError };
