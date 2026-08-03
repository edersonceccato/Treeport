/**
 * Nós da árvore sintática das expressões.
 *
 * A expressão é compilada para esta árvore uma vez e avaliada N vezes (uma por
 * linha de dados) — por isso vale separar parse de avaliação: numa lista de
 * 5.000 linhas, a expressão é parseada 1 vez, não 5.000.
 */

export type ExpressionNode =
  | LiteralNode
  | IdentifierNode
  | MemberNode
  | UnaryNode
  | BinaryNode
  | CallNode;

/** Número, string ou booleano escrito direto na expressão. */
export interface LiteralNode {
  kind: 'literal';
  value: string | number | boolean | null;
}

/** Referência a um campo da linha atual: `VALOR_A`. */
export interface IdentifierNode {
  kind: 'identifier';
  name: string;
}

/** Acesso a escopo: `parent.NOME`, `current.VALOR`, `parent.parent.X`. */
export interface MemberNode {
  kind: 'member';
  object: ExpressionNode;
  property: string;
}

/** Operador unário: `-x`, `!x`. */
export interface UnaryNode {
  kind: 'unary';
  operator: '-' | '+' | '!';
  argument: ExpressionNode;
}

/** Operador binário: `a + b`, `a == b`, `a && b`. */
export interface BinaryNode {
  kind: 'binary';
  operator: string;
  left: ExpressionNode;
  right: ExpressionNode;
}

/** Chamada de função: `IF(cond, a, b)`, `UPPER(nome)`. */
export interface CallNode {
  kind: 'call';
  name: string;
  args: ExpressionNode[];
}
