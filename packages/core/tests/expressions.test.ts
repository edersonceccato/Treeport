import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  interpolate,
  parseExpression,
  ExpressionSyntaxError,
  ExpressionEvaluationError,
  type ExpressionScope,
} from '../src/index.js';

/** Atalho: avalia uma expressão contra uma linha simples. */
const ev = (source: string, row: Record<string, unknown> = {}): unknown =>
  evaluateExpression(source, { current: row });

describe('aritmética', () => {
  it('soma, subtração, multiplicação e divisão', () => {
    expect(ev('2 + 3')).toBe(5);
    expect(ev('10 - 4')).toBe(6);
    expect(ev('6 * 7')).toBe(42);
    expect(ev('10 / 4')).toBe(2.5);
    expect(ev('10 % 3')).toBe(1);
  });

  it('respeita a precedência dos operadores', () => {
    expect(ev('2 + 3 * 4')).toBe(14);
    expect(ev('(2 + 3) * 4')).toBe(20);
    expect(ev('10 - 2 - 3')).toBe(5); // associa à esquerda
    expect(ev('100 / 10 / 2')).toBe(5);
  });

  it('operador unário de negação', () => {
    expect(ev('-5')).toBe(-5);
    expect(ev('10 + -3')).toBe(7);
    expect(ev('-(2 + 3)')).toBe(-5);
  });

  it('soma campos da linha', () => {
    expect(ev('VALOR_A + VALOR_B', { VALOR_A: 100, VALOR_B: 50 })).toBe(150);
  });

  it('converte string numérica vinda do banco', () => {
    // drivers devolvem DECIMAL como string; somar tem que funcionar
    expect(ev('A + B', { A: '100.50', B: '49.50' })).toBe(150);
  });

  it('divisão por zero devolve 0 em vez de Infinity', () => {
    // num relatório, Infinity impresso é pior que 0
    expect(ev('10 / 0')).toBe(0);
    expect(ev('10 % 0')).toBe(0);
  });

  it('campo nulo conta como zero na aritmética', () => {
    expect(ev('VALOR + 10', { VALOR: null })).toBe(10);
  });
});

describe('texto', () => {
  it('concatena com +', () => {
    expect(ev("'Olá ' + 'mundo'")).toBe('Olá mundo');
  });

  it('concatena campo com literal', () => {
    expect(ev("NOME + ' - OK'", { NOME: 'Frete' })).toBe('Frete - OK');
  });

  it('aceita aspas simples e duplas', () => {
    expect(ev('"texto"')).toBe('texto');
    expect(ev("'texto'")).toBe('texto');
  });

  it('aspas duplicadas viram uma aspa literal', () => {
    expect(ev("'it''s'")).toBe("it's");
  });

  it('número + texto vira concatenação', () => {
    expect(ev("10 + ' unidades'")).toBe('10 unidades');
  });

  it('texto numérico ainda soma como número', () => {
    // "100" + "50" tem que dar 150, não "10050"
    expect(ev("'100' + '50'")).toBe(150);
  });
});

describe('comparação e lógica', () => {
  it('compara números', () => {
    expect(ev('10 > 5')).toBe(true);
    expect(ev('10 < 5')).toBe(false);
    expect(ev('10 >= 10')).toBe(true);
    expect(ev('10 <= 9')).toBe(false);
  });

  it('igualdade e diferença', () => {
    expect(ev('10 == 10')).toBe(true);
    expect(ev('10 != 5')).toBe(true);
    expect(ev("'a' == 'a'")).toBe(true);
  });

  it('aceita = e <> como sinônimos vindos do SQL', () => {
    expect(ev('10 = 10')).toBe(true);
    expect(ev('10 <> 5')).toBe(true);
  });

  it('compara número com string numérica', () => {
    expect(ev("VALOR == 100", { VALOR: '100' })).toBe(true);
  });

  it('e / ou lógicos', () => {
    expect(ev('true && true')).toBe(true);
    expect(ev('true && false')).toBe(false);
    expect(ev('false || true')).toBe(true);
    expect(ev('false || false')).toBe(false);
  });

  it('negação', () => {
    expect(ev('!false')).toBe(true);
    expect(ev('!(10 > 5)')).toBe(false);
  });

  it('null só é igual a null', () => {
    expect(ev('VALOR == null', { VALOR: null })).toBe(true);
    expect(ev('VALOR == null', { VALOR: 0 })).toBe(false);
  });
});

describe('funções', () => {
  it('IF devolve o ramo certo', () => {
    expect(ev("IF(10 > 5, 'maior', 'menor')")).toBe('maior');
    expect(ev("IF(1 > 5, 'maior', 'menor')")).toBe('menor');
  });

  it('IF só avalia o ramo escolhido', () => {
    // se avaliasse os dois, o ramo do else tentaria dividir por VALOR ausente
    expect(ev('IF(ISNULL(VALOR), 0, 100 / VALOR)', { VALOR: null })).toBe(0);
  });

  it('IF aninhado', () => {
    const source = "IF(V > 100, 'alto', IF(V > 50, 'medio', 'baixo'))";
    expect(ev(source, { V: 150 })).toBe('alto');
    expect(ev(source, { V: 75 })).toBe('medio');
    expect(ev(source, { V: 10 })).toBe('baixo');
  });

  it('funções de texto', () => {
    expect(ev("UPPER('frete')")).toBe('FRETE');
    expect(ev("LOWER('FRETE')")).toBe('frete');
    expect(ev("TRIM('  x  ')")).toBe('x');
    expect(ev("LEN('abc')")).toBe(3);
    expect(ev("CONCAT('a', 'b', 'c')")).toBe('abc');
    expect(ev("REPLACE('a-b', '-', '/')")).toBe('a/b');
  });

  it('SUBSTR é 1-based, como em SQL', () => {
    expect(ev("SUBSTR('ABCDEF', 1, 3)")).toBe('ABC');
    expect(ev("SUBSTR('ABCDEF', 4)")).toBe('DEF');
  });

  it('PAD completa à esquerda', () => {
    expect(ev("PAD('7', 3, '0')")).toBe('007');
  });

  it('funções numéricas', () => {
    expect(ev('ROUND(2.567, 2)')).toBe(2.57);
    expect(ev('ROUND(2.5)')).toBe(3);
    expect(ev('FLOOR(2.9)')).toBe(2);
    expect(ev('CEIL(2.1)')).toBe(3);
    expect(ev('ABS(-5)')).toBe(5);
    expect(ev('MIN(3, 1, 2)')).toBe(1);
    expect(ev('MAX(3, 1, 2)')).toBe(3);
  });

  it('COALESCE pega o primeiro não vazio', () => {
    expect(ev('COALESCE(A, B, 0)', { A: null, B: 5 })).toBe(5);
    expect(ev("COALESCE(A, 'padrão')", { A: '' })).toBe('padrão');
  });

  it('ISNULL detecta nulo e vazio', () => {
    expect(ev('ISNULL(A)', { A: null })).toBe(true);
    expect(ev('ISNULL(A)', { A: '' })).toBe(true);
    expect(ev('ISNULL(A)', { A: 0 })).toBe(false);
  });

  it('FORMAT usa as mesmas máscaras do Field', () => {
    expect(ev("FORMAT(1500.5, '#,##0.00')")).toBe('1.500,50');
    expect(ev("FORMAT(D, 'dd/MM/yyyy')", { D: new Date(2026, 7, 3) })).toBe('03/08/2026');
  });

  it('funções de data', () => {
    const row = { D: new Date(2026, 7, 3) };
    expect(ev('YEAR(D)', row)).toBe(2026);
    expect(ev('MONTH(D)', row)).toBe(8);
    expect(ev('DAY(D)', row)).toBe(3);
  });

  it('nome de função é case-insensitive', () => {
    expect(ev("upper('x')")).toBe('X');
    expect(ev("Upper('x')")).toBe('X');
  });

  it('aceita funções customizadas', () => {
    const result = evaluateExpression(
      'DOBRO(21)',
      { current: {} },
      { functions: { DOBRO: (v) => Number(v) * 2 } },
    );
    expect(result).toBe(42);
  });
});

describe('escopo current / parent', () => {
  const scope: ExpressionScope = {
    current: { NOME: 'Taxa', VALOR: 100 },
    parent: {
      current: { NOME: 'Oferta', ROTA: 'Santos' },
      parent: { current: { CLIENTE: 'Acme' } },
    },
  };

  it('campo solto vem da linha atual', () => {
    expect(evaluateExpression('NOME', scope)).toBe('Taxa');
  });

  it('current.CAMPO é explícito sobre a linha atual', () => {
    expect(evaluateExpression('current.NOME', scope)).toBe('Taxa');
  });

  it('parent.CAMPO lê o nó pai', () => {
    expect(evaluateExpression('parent.NOME', scope)).toBe('Oferta');
    expect(evaluateExpression('parent.ROTA', scope)).toBe('Santos');
  });

  it('parent.parent sobe dois níveis', () => {
    expect(evaluateExpression('parent.parent.CLIENTE', scope)).toBe('Acme');
  });

  it('campo não encontrado na linha atual sobe a corrente sozinho', () => {
    // ROTA só existe no pai; o motor acha sem precisar de "parent."
    expect(evaluateExpression('ROTA', scope)).toBe('Santos');
    expect(evaluateExpression('CLIENTE', scope)).toBe('Acme');
  });

  it('a linha atual tem prioridade sobre o pai no nome repetido', () => {
    expect(evaluateExpression('NOME', scope)).toBe('Taxa');
  });

  it('mistura escopos numa conta', () => {
    expect(evaluateExpression("parent.ROTA + ': ' + VALOR", scope)).toBe('Santos: 100');
  });

  it('parent sem pai é erro claro', () => {
    expect(() => evaluateExpression('parent.X', { current: {} })).toThrow(
      /só vale dentro de um subreport/,
    );
  });

  it('parâmetros ficam visíveis pelo nome', () => {
    const withParams: ExpressionScope = {
      current: { A: 1 },
      parameters: { proposalId: 42 },
    };
    expect(evaluateExpression('proposalId', withParams)).toBe(42);
  });
});

describe('interpolação {{...}}', () => {
  const row = { NOME: 'João', VALOR_A: 100, VALOR_B: 50 };

  it('substitui um campo', () => {
    expect(interpolate('{{NOME}}', { current: row })).toBe('João');
  });

  it('mistura texto e expressão', () => {
    expect(interpolate('{{NOME}} - Total: {{VALOR_A + VALOR_B}}', { current: row })).toBe(
      'João - Total: 150',
    );
  });

  it('texto sem placeholder passa intacto', () => {
    expect(interpolate('Texto fixo', { current: row })).toBe('Texto fixo');
  });

  it('vários placeholders no mesmo texto', () => {
    expect(interpolate('{{VALOR_A}} + {{VALOR_B}} = {{VALOR_A + VALOR_B}}', { current: row })).toBe(
      '100 + 50 = 150',
    );
  });

  it('tolera espaços dentro das chaves', () => {
    expect(interpolate('{{  NOME  }}', { current: row })).toBe('João');
  });

  it('campo nulo vira string vazia, nunca "null"', () => {
    expect(interpolate('[{{X}}]', { current: { X: null } })).toBe('[]');
  });

  it('{{}} vazio fica literal', () => {
    expect(interpolate('{{}}', { current: row })).toBe('{{}}');
  });

  it('booleano sai como Sim/Não', () => {
    expect(interpolate('{{ATIVO}}', { current: { ATIVO: true } })).toBe('Sim');
  });

  it('evaluateExpression preserva o tipo do resultado', () => {
    // interpolate devolve texto; evaluateExpression devolve o valor cru
    expect(evaluateExpression('{{VALOR_A + VALOR_B}}', { current: row })).toBe(150);
    expect(interpolate('{{VALOR_A + VALOR_B}}', { current: row })).toBe('150');
  });

  it('evaluateExpression aceita expressão sem as chaves', () => {
    expect(evaluateExpression('VALOR_A + VALOR_B', { current: row })).toBe(150);
  });
});

describe('erros', () => {
  it('erro de sintaxe aponta a posição', () => {
    expect(() => parseExpression('2 +')).toThrow(ExpressionSyntaxError);
    expect(() => parseExpression('(2 + 3')).toThrow(/Esperava "\)"/);
    expect(() => parseExpression("'sem fim")).toThrow(/String não fechada/);
  });

  it('campo inexistente lista os campos disponíveis', () => {
    expect(() => ev('INEXISTENTE', { NOME: 'x', VALOR: 1 })).toThrow(
      ExpressionEvaluationError,
    );
    expect(() => ev('INEXISTENTE', { NOME: 'x', VALOR: 1 })).toThrow(/NOME, VALOR/);
  });

  it('modo não estrito devolve null em vez de erro', () => {
    const result = evaluateExpression('INEXISTENTE', { current: {} }, { strict: false });
    expect(result).toBeNull();
  });

  it('função desconhecida lista as disponíveis', () => {
    expect(() => ev('NAOEXISTE(1)')).toThrow(/não existe/);
    expect(() => ev('NAOEXISTE(1)')).toThrow(/UPPER/);
  });

  it('erro de campo diz em qual texto do template aconteceu', () => {
    expect(() => interpolate('Olá {{FALTANDO}}', { current: {} })).toThrow(
      /Olá \{\{FALTANDO\}\}/,
    );
  });

  it('NUNCA executa código arbitrário', () => {
    // a garantia central: sem eval, essas coisas são erro de campo/função,
    // não execução. O template pode vir do banco, escrito por outro usuário.
    expect(() => ev('process.exit(1)')).toThrow();
    expect(() => ev("require('fs')")).toThrow();
    expect(() => ev('globalThis')).toThrow();
  });

  it('não vaza propriedades do protótipo como se fossem campos', () => {
    // `in` percorreria o protótipo e devolveria funções internas do JS;
    // por isso a busca usa hasOwn
    expect(() => ev('constructor')).toThrow();
    expect(() => ev('toString')).toThrow();
    expect(() => ev('__proto__')).toThrow();
    expect(() => ev('valueOf', { NOME: 'x' })).toThrow();
  });

  it('não alcança internos por acesso a membro', () => {
    expect(() => ev('X.constructor', { X: { a: 1 } })).toThrow();
    expect(() => ev('X.__proto__', { X: { a: 1 } })).toThrow();
    // propriedade própria de verdade continua funcionando
    expect(ev('X.a', { X: { a: 1 } })).toBe(1);
  });

  it('um campo chamado "constructor" na linha continua acessível', () => {
    // se o banco tiver mesmo uma coluna com esse nome, ela é um dado legítimo
    expect(ev('constructor', { constructor: 'valor real' })).toBe('valor real');
  });
});

describe('cache de compilação', () => {
  it('o mesmo texto compilado duas vezes dá o mesmo resultado', () => {
    const text = '{{A}} + {{B}}';
    expect(interpolate(text, { current: { A: 1, B: 2 } })).toBe('1 + 2');
    expect(interpolate(text, { current: { A: 3, B: 4 } })).toBe('3 + 4');
  });
});
