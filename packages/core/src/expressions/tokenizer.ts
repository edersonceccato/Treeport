/**
 * Tokenizer do motor de expressões (seção 6 do brief).
 *
 * Transforma o texto de uma expressão numa lista de tokens. É a primeira
 * metade do parser escrito à mão — a lib NUNCA usa `eval()` nem `new
 * Function()`, porque a expressão vem de um template que pode ter sido salvo
 * no banco por outro usuário da aplicação. Um `eval` ali seria execução
 * arbitrária de código no servidor.
 */

export type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'operator'
  | 'punctuation'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  /** Posição inicial no texto, usada nas mensagens de erro. */
  position: number;
}

/** Erro de sintaxe, com a posição do problema dentro da expressão. */
export class ExpressionSyntaxError extends Error {
  readonly position: number;
  readonly expression: string;

  constructor(message: string, expression: string, position: number) {
    super(`${message}\n  ${expression}\n  ${' '.repeat(Math.max(0, position))}^`);
    this.name = 'ExpressionSyntaxError';
    this.expression = expression;
    this.position = position;
  }
}

/** Operadores reconhecidos, dos mais longos para os mais curtos. */
const OPERATORS = [
  '<=',
  '>=',
  '==',
  '!=',
  '<>',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '!',
];

const PUNCTUATION = ['(', ')', ',', '.'];

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isIdentStart = (ch: string): boolean => /[A-Za-z_]/.test(ch);
const isIdentPart = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
const isSpace = (ch: string): boolean => /\s/.test(ch);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (isSpace(ch)) {
      i += 1;
      continue;
    }

    // número: 123, 1.5, .5
    if (isDigit(ch) || (ch === '.' && isDigit(input[i + 1] ?? ''))) {
      const start = i;
      while (i < input.length && isDigit(input[i]!)) i += 1;
      if (input[i] === '.' && isDigit(input[i + 1] ?? '')) {
        i += 1;
        while (i < input.length && isDigit(input[i]!)) i += 1;
      }
      tokens.push({ type: 'number', value: input.slice(start, i), position: start });
      continue;
    }

    // string entre aspas simples ou duplas, com '' / "" como escape
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i += 1;
      let value = '';
      let closed = false;

      while (i < input.length) {
        if (input[i] === quote) {
          if (input[i + 1] === quote) {
            value += quote;
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        value += input[i];
        i += 1;
      }

      if (!closed) {
        throw new ExpressionSyntaxError('String não fechada', input, start);
      }
      tokens.push({ type: 'string', value, position: start });
      continue;
    }

    // identificador: nome de campo, função, ou palavra-chave
    if (isIdentStart(ch)) {
      const start = i;
      while (i < input.length && isIdentPart(input[i]!)) i += 1;
      tokens.push({ type: 'identifier', value: input.slice(start, i), position: start });
      continue;
    }

    // operador (tenta os de 2 caracteres antes dos de 1)
    const twoChar = input.slice(i, i + 2);
    const operator = OPERATORS.includes(twoChar)
      ? twoChar
      : OPERATORS.includes(ch)
        ? ch
        : undefined;

    if (operator) {
      tokens.push({ type: 'operator', value: operator, position: i });
      i += operator.length;
      continue;
    }

    if (PUNCTUATION.includes(ch)) {
      tokens.push({ type: 'punctuation', value: ch, position: i });
      i += 1;
      continue;
    }

    throw new ExpressionSyntaxError(`Caractere inesperado "${ch}"`, input, i);
  }

  tokens.push({ type: 'eof', value: '', position: input.length });
  return tokens;
}
