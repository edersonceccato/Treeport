import type { DataRow } from '../data-source.js';
import type { ExpressionNode } from './ast.js';
import {
  BUILTIN_FUNCTIONS,
  toBoolean,
  toNumber,
  toText,
  type ExpressionFunction,
} from './functions.js';

/**
 * Avaliação da árvore sintática contra um escopo de dados.
 *
 * O escopo é uma corrente: a linha atual (`current`) e, opcionalmente, o
 * escopo do pai (`parent`) — que por sua vez pode ter o dele. É isso que
 * permite, dentro de um subreport de taxas, referenciar um campo da oferta ou
 * até da proposta (seção 6 do brief).
 *
 * Resolução de um nome solto (`VALOR`), nesta ordem:
 *   1. campo da linha atual
 *   2. campo do escopo pai, subindo a corrente
 *   3. parâmetro do relatório
 *   4. erro (ou `null`, com `strict: false`)
 *
 * Buscar no pai automaticamente é intencional: no Report Builder de origem o
 * usuário escreve só o nome do campo e o motor acha. Quem quiser ser explícito
 * usa `parent.CAMPO`.
 */

/**
 * Um campo existe no objeto?
 *
 * Usa `hasOwn` em vez de `in` de propósito: `in` percorre a cadeia de
 * protótipos, então `constructor`, `toString` e `__proto__` "existiriam" em
 * qualquer linha e a expressão devolveria um objeto interno do JavaScript em
 * vez de um dado. Só propriedades próprias da linha contam como campo.
 */
export function hasField(source: Record<string, unknown>, name: string): boolean {
  return Object.hasOwn(source, name);
}

export interface ExpressionScope {
  /** A linha de dados corrente. */
  current: DataRow;
  /** Escopo do nó pai, quando dentro de um subreport. */
  parent?: ExpressionScope;
  /** Parâmetros do relatório, visíveis em qualquer nível. */
  parameters?: Record<string, unknown>;
  /**
   * Variáveis resolvidas pelo motor, não vindas da consulta:
   * `pageNumber`, `totalPages`, `now`. Ficam sob `sys.` para nunca colidirem
   * com um nome de coluna.
   */
  system?: Record<string, unknown>;
}

export interface EvaluateOptions {
  /** Funções extras, somadas às nativas. Nome case-insensitive. */
  functions?: Record<string, ExpressionFunction>;
  /**
   * Se true (default), referenciar um campo inexistente é erro. Com `false`,
   * vira `null` — útil para preview no Designer, onde o template pode estar
   * meio montado.
   */
  strict?: boolean;
}

/** Erro em tempo de avaliação (campo inexistente, função desconhecida...). */
export class ExpressionEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionEvaluationError';
  }
}

export function evaluateNode(
  node: ExpressionNode,
  scope: ExpressionScope,
  options: EvaluateOptions = {},
): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;

    case 'identifier':
      return resolveIdentifier(node.name, scope, options);

    case 'member':
      return evaluateMember(node.object, node.property, scope, options);

    case 'unary': {
      const value = evaluateNode(node.argument, scope, options);
      if (node.operator === '!') return !toBoolean(value);
      if (node.operator === '-') return -toNumber(value);
      return toNumber(value);
    }

    case 'binary':
      return evaluateBinary(node.operator, node.left, node.right, scope, options);

    case 'call':
      return evaluateCall(node.name, node.args, scope, options);
  }
}

/** Sobe a corrente de escopos procurando o campo. */
function resolveIdentifier(
  name: string,
  scope: ExpressionScope,
  options: EvaluateOptions,
): unknown {
  for (let s: ExpressionScope | undefined = scope; s; s = s.parent) {
    if (hasField(s.current, name)) return s.current[name];
  }

  // parâmetros do relatório ficam visíveis em qualquer nível
  const parameters = rootParameters(scope);
  if (parameters && hasField(parameters, name)) return parameters[name];

  if (options.strict === false) return null;

  throw new ExpressionEvaluationError(
    `Campo "${name}" não existe na linha atual nem nos escopos acima. ` +
      `Campos disponíveis: ${availableFields(scope).join(', ') || '(nenhum)'}.`,
  );
}

/** Os parâmetros declarados em qualquer nível da corrente. */
function rootParameters(scope: ExpressionScope): Record<string, unknown> | undefined {
  for (let s: ExpressionScope | undefined = scope; s; s = s.parent) {
    if (s.parameters) return s.parameters;
  }
  return undefined;
}

/** As variáveis de sistema declaradas em qualquer nível da corrente. */
function rootSystem(scope: ExpressionScope): Record<string, unknown> | undefined {
  for (let s: ExpressionScope | undefined = scope; s; s = s.parent) {
    if (s.system) return s.system;
  }
  return undefined;
}

function availableFields(scope: ExpressionScope): string[] {
  const names = new Set<string>();
  for (let s: ExpressionScope | undefined = scope; s; s = s.parent) {
    for (const key of Object.keys(s.current)) names.add(key);
  }
  return [...names];
}

/**
 * Acesso a membro. `current` e `parent` são palavras reservadas que devolvem
 * o escopo correspondente; qualquer outra coisa lê a propriedade do objeto.
 */
function evaluateMember(
  objectNode: ExpressionNode,
  property: string,
  scope: ExpressionScope,
  options: EvaluateOptions,
): unknown {
  // sys.pageNumber, sys.totalPages, sys.now
  if (objectNode.kind === 'identifier' && objectNode.name === 'sys') {
    const system = rootSystem(scope);
    if (system && hasField(system, property)) return system[property];
    if (options.strict === false) return null;
    throw new ExpressionEvaluationError(
      `Variável de sistema "sys.${property}" não existe. ` +
        `Disponíveis: ${Object.keys(system ?? {}).join(', ') || '(nenhuma)'}.`,
    );
  }

  const target = resolveScopeExpression(objectNode, scope);

  if (target) {
    if (hasField(target.current, property)) return target.current[property];

    const parameters = rootParameters(target);
    if (parameters && hasField(parameters, property)) return parameters[property];

    if (options.strict === false) return null;
    throw new ExpressionEvaluationError(
      `Campo "${property}" não existe nesse escopo. ` +
        `Campos disponíveis: ${Object.keys(target.current).join(', ') || '(nenhum)'}.`,
    );
  }

  // não é um escopo: lê a propriedade de um valor comum (ex.: uma coluna que
  // veio do banco como objeto JSON)
  const value = evaluateNode(objectNode, scope, options);
  if (value === null || value === undefined) {
    if (options.strict === false) return null;
    throw new ExpressionEvaluationError(
      `Não é possível ler "${property}" de um valor nulo.`,
    );
  }

  // só propriedade própria: sem isso, `X.constructor` daria acesso a objetos
  // internos do JavaScript a partir de um template salvo no banco
  if (typeof value === 'object' && hasField(value as Record<string, unknown>, property)) {
    return (value as Record<string, unknown>)[property];
  }

  if (options.strict === false) return null;
  throw new ExpressionEvaluationError(
    `"${property}" não existe nesse valor.`,
  );
}

/**
 * Resolve `current`, `parent`, `parent.parent`... para o escopo correspondente.
 * Devolve undefined quando a expressão não denota um escopo.
 */
function resolveScopeExpression(
  node: ExpressionNode,
  scope: ExpressionScope,
): ExpressionScope | undefined {
  if (node.kind === 'identifier') {
    if (node.name === 'sys') {
      // `sys` não é um escopo de linha: é resolvido em evaluateMember
      return undefined;
    }
    if (node.name === 'current') return scope;
    if (node.name === 'parent') {
      if (!scope.parent) {
        throw new ExpressionEvaluationError(
          'Não existe escopo pai aqui — "parent" só vale dentro de um subreport.',
        );
      }
      return scope.parent;
    }
    return undefined;
  }

  if (node.kind === 'member') {
    const base = resolveScopeExpression(node.object, scope);
    if (!base) return undefined;
    // parent.parent sobe mais um nível
    if (node.property === 'parent') {
      if (!base.parent) {
        throw new ExpressionEvaluationError('Não existe outro escopo pai acima deste.');
      }
      return base.parent;
    }
    if (node.property === 'current') return base;
    return undefined;
  }

  return undefined;
}

function evaluateBinary(
  operator: string,
  leftNode: ExpressionNode,
  rightNode: ExpressionNode,
  scope: ExpressionScope,
  options: EvaluateOptions,
): unknown {
  // && e || avaliam à direita só se necessário (curto-circuito)
  if (operator === '&&') {
    const left = evaluateNode(leftNode, scope, options);
    return toBoolean(left) ? toBoolean(evaluateNode(rightNode, scope, options)) : false;
  }
  if (operator === '||') {
    const left = evaluateNode(leftNode, scope, options);
    return toBoolean(left) ? true : toBoolean(evaluateNode(rightNode, scope, options));
  }

  const left = evaluateNode(leftNode, scope, options);
  const right = evaluateNode(rightNode, scope, options);

  switch (operator) {
    case '+':
      // se qualquer lado for texto não numérico, concatena (como no Delphi/JS)
      if (isTextual(left) || isTextual(right)) return toText(left) + toText(right);
      return toNumber(left) + toNumber(right);

    case '-':
      return toNumber(left) - toNumber(right);
    case '*':
      return toNumber(left) * toNumber(right);
    case '/': {
      const divisor = toNumber(right);
      // divisão por zero num relatório não deve derrubar a página
      return divisor === 0 ? 0 : toNumber(left) / divisor;
    }
    case '%': {
      const divisor = toNumber(right);
      return divisor === 0 ? 0 : toNumber(left) % divisor;
    }

    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);

    case '<':
      return compare(left, right) < 0;
    case '<=':
      return compare(left, right) <= 0;
    case '>':
      return compare(left, right) > 0;
    case '>=':
      return compare(left, right) >= 0;

    default:
      throw new ExpressionEvaluationError(`Operador desconhecido: ${operator}`);
  }
}

/** É texto que não representa um número? Então `+` deve concatenar. */
function isTextual(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.trim() === '') return true;
  return !Number.isFinite(Number(value));
}

/**
 * Igualdade tolerante: compara números como números, datas pelo instante e o
 * resto como texto. `null` só é igual a `null`/vazio.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  const aNull = a === null || a === undefined || a === '';
  const bNull = b === null || b === undefined || b === '';
  if (aNull || bNull) return aNull && bNull;

  if (a instanceof Date || b instanceof Date) {
    const da = a instanceof Date ? a.getTime() : new Date(String(a)).getTime();
    const db = b instanceof Date ? b.getTime() : new Date(String(b)).getTime();
    return da === db;
  }

  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return toBoolean(a) === toBoolean(b);
  }

  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;

  return toText(a) === toText(b);
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date || b instanceof Date) {
    const da = a instanceof Date ? a.getTime() : new Date(String(a)).getTime();
    const db = b instanceof Date ? b.getTime() : new Date(String(b)).getTime();
    return da - db;
  }

  const na = toNumber(a);
  const nb = toNumber(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;

  return toText(a).localeCompare(toText(b));
}

function evaluateCall(
  name: string,
  argNodes: ExpressionNode[],
  scope: ExpressionScope,
  options: EvaluateOptions,
): unknown {
  const custom = options.functions;
  const fn =
    findFunction(custom, name) ?? BUILTIN_FUNCTIONS[name] ?? findFunction(BUILTIN_FUNCTIONS, name);

  if (!fn) {
    throw new ExpressionEvaluationError(
      `Função "${name}" não existe. Disponíveis: ${[
        ...Object.keys(BUILTIN_FUNCTIONS),
        ...Object.keys(custom ?? {}),
      ]
        .sort()
        .join(', ')}.`,
    );
  }

  /**
   * Agregações aceitam `SUM(CONSULTA.campo)` sem aspas.
   *
   * Sem este tratamento, `CONSULTA.campo` seria avaliado como acesso a campo
   * ANTES de chegar na função — e falharia, porque "CONSULTA" não é uma
   * coluna da linha. Aqui a referência é passada como texto para a função de
   * agregação resolver contra a árvore de dados.
   */
  if (AGGREGATE_NAMES.has(name)) {
    const args = argNodes.map((arg) => {
      const qualified = qualifiedName(arg);
      return qualified ?? evaluateNode(arg, scope, options);
    });
    return fn(...args);
  }

  // IF precisa de avaliação preguiçosa: só o ramo escolhido é avaliado, senão
  // IF(ISNULL(x), 0, 10/x) explodiria no ramo que nem seria usado
  if (name === 'IF' && argNodes.length === 3) {
    const condition = evaluateNode(argNodes[0]!, scope, options);
    const branch = toBoolean(condition) ? argNodes[1]! : argNodes[2]!;
    return evaluateNode(branch, scope, options);
  }

  const args = argNodes.map((arg) => evaluateNode(arg, scope, options));
  return fn(...args);
}

/** Funções cujos argumentos são referências à árvore, não valores. */
const AGGREGATE_NAMES = new Set([
  'SUM',
  'COUNT',
  'AVG',
  'MINOF',
  'MAXOF',
  'COUNTDISTINCT',
  'SUMDISTINCT',
]);

/**
 * `CONSULTA` ou `CONSULTA.campo` escritos sem aspas, como texto.
 * Devolve undefined para qualquer outra coisa (número, literal, conta).
 */
function qualifiedName(node: ExpressionNode): string | undefined {
  if (node.kind === 'identifier') return node.name;

  if (node.kind === 'member' && node.object.kind === 'identifier') {
    return `${node.object.name}.${node.property}`;
  }
  return undefined;
}

/** Busca case-insensitive, para `upper()` funcionar igual a `UPPER()`. */
function findFunction(
  registry: Record<string, ExpressionFunction> | undefined,
  name: string,
): ExpressionFunction | undefined {
  if (!registry) return undefined;
  if (registry[name]) return registry[name];
  const key = Object.keys(registry).find((k) => k.toUpperCase() === name.toUpperCase());
  return key ? registry[key] : undefined;
}

export { toBoolean, toNumber, toText };
