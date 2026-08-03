import type { ExpressionNode } from './ast.js';
import { tokenize, ExpressionSyntaxError, type Token } from './tokenizer.js';

/**
 * Parser descendente recursivo.
 *
 * Precedência (da mais fraca para a mais forte), no mesmo espírito de SQL:
 *
 *   1. ||  (ou)
 *   2. &&  (e)
 *   3. ==  !=  <>  <  <=  >  >=
 *   4. +   -
 *   5. *   /   %
 *   6. unário -  +  !
 *   7. chamada de função, acesso a membro, parênteses, literais
 *
 * `=` é aceito como sinônimo de `==` porque quem vem de SQL/Delphi escreve
 * assim por reflexo, e o custo de aceitar é zero.
 */
export function parseExpression(input: string): ExpressionNode {
  const parser = new Parser(input);
  const node = parser.parseOr();
  parser.expectEnd();
  return node;
}

class Parser {
  private readonly tokens: Token[];
  private readonly input: string;
  private index = 0;

  constructor(input: string) {
    this.input = input;
    this.tokens = tokenize(input);
  }

  private get current(): Token {
    return this.tokens[this.index]!;
  }

  private advance(): Token {
    const token = this.current;
    if (token.type !== 'eof') this.index += 1;
    return token;
  }

  private matchOperator(...values: string[]): boolean {
    return this.current.type === 'operator' && values.includes(this.current.value);
  }

  private matchPunctuation(value: string): boolean {
    return this.current.type === 'punctuation' && this.current.value === value;
  }

  private error(message: string, token = this.current): never {
    throw new ExpressionSyntaxError(message, this.input, token.position);
  }

  expectEnd(): void {
    if (this.current.type !== 'eof') {
      this.error(`Esperava o fim da expressão, encontrou "${this.current.value}"`);
    }
  }

  // --- níveis de precedência ------------------------------------------------

  parseOr(): ExpressionNode {
    let left = this.parseAnd();
    while (this.matchOperator('||')) {
      this.advance();
      left = { kind: 'binary', operator: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): ExpressionNode {
    let left = this.parseComparison();
    while (this.matchOperator('&&')) {
      this.advance();
      left = { kind: 'binary', operator: '&&', left, right: this.parseComparison() };
    }
    return left;
  }

  private parseComparison(): ExpressionNode {
    let left = this.parseAdditive();
    while (this.matchOperator('==', '=', '!=', '<>', '<', '<=', '>', '>=')) {
      const operator = this.advance().value;
      // normaliza os sinônimos vindos do SQL
      const normalized = operator === '=' ? '==' : operator === '<>' ? '!=' : operator;
      left = { kind: 'binary', operator: normalized, left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): ExpressionNode {
    let left = this.parseMultiplicative();
    while (this.matchOperator('+', '-')) {
      const operator = this.advance().value;
      left = { kind: 'binary', operator, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): ExpressionNode {
    let left = this.parseUnary();
    while (this.matchOperator('*', '/', '%')) {
      const operator = this.advance().value;
      left = { kind: 'binary', operator, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): ExpressionNode {
    if (this.matchOperator('-', '+', '!')) {
      const operator = this.advance().value as '-' | '+' | '!';
      return { kind: 'unary', operator, argument: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  /** Acesso a membro depois de um primário: `parent.NOME.SUB`. */
  private parsePostfix(): ExpressionNode {
    let node = this.parsePrimary();

    while (this.matchPunctuation('.')) {
      this.advance();
      const property = this.current;
      if (property.type !== 'identifier') {
        this.error('Esperava um nome de campo depois do ponto');
      }
      this.advance();
      node = { kind: 'member', object: node, property: property.value };
    }

    return node;
  }

  private parsePrimary(): ExpressionNode {
    const token = this.current;

    if (token.type === 'number') {
      this.advance();
      return { kind: 'literal', value: Number(token.value) };
    }

    if (token.type === 'string') {
      this.advance();
      return { kind: 'literal', value: token.value };
    }

    if (token.type === 'identifier') {
      this.advance();

      // chamada de função: NOME(
      if (this.matchPunctuation('(')) {
        this.advance();
        const args: ExpressionNode[] = [];

        if (!this.matchPunctuation(')')) {
          args.push(this.parseOr());
          while (this.matchPunctuation(',')) {
            this.advance();
            args.push(this.parseOr());
          }
        }

        if (!this.matchPunctuation(')')) {
          this.error(`Esperava ")" para fechar a chamada de ${token.value}`);
        }
        this.advance();

        return { kind: 'call', name: token.value.toUpperCase(), args };
      }

      // literais escritos como palavra
      const upper = token.value.toUpperCase();
      if (upper === 'TRUE') return { kind: 'literal', value: true };
      if (upper === 'FALSE') return { kind: 'literal', value: false };
      if (upper === 'NULL') return { kind: 'literal', value: null };

      return { kind: 'identifier', name: token.value };
    }

    if (this.matchPunctuation('(')) {
      this.advance();
      const node = this.parseOr();
      if (!this.matchPunctuation(')')) {
        this.error('Esperava ")" para fechar o parêntese');
      }
      this.advance();
      return node;
    }

    if (token.type === 'eof') {
      this.error('Expressão incompleta');
    }

    this.error(`Token inesperado "${token.value}"`);
  }
}
