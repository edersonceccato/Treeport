import type { DataSourceNode, DataSourceTree, ReportParameter } from '@treeport/schema';

/**
 * Explorador de campos (sub-fase 9.4 do brief).
 *
 * Mostra a árvore de fonte de dados como uma lista navegável de nós e campos,
 * para o usuário arrastar um campo direto para o canvas em vez de digitar o
 * nome à mão — é onde mora metade dos erros de digitação num relatório.
 *
 * Os campos de um nó vêm de três lugares, nesta ordem de confiança:
 *   1. `fields` declarado no nó (o backend informou);
 *   2. as colunas de uma linha de amostra (`sampleRow`);
 *   3. nomes extraídos da própria SQL, como último recurso.
 */

export interface ExplorerField {
  /** Nome da coluna, como usar em `fieldName` ou numa expressão. */
  name: string;
  /** Nó a que pertence. */
  nodeId: string;
  /**
   * Quantos níveis acima do nó atual este campo está.
   * 0 = linha corrente, 1 = pai, 2 = avô. Define o prefixo `parent.` a usar.
   */
  depth: number;
}

export interface ExplorerNode {
  id: string;
  name: string;
  fields: string[];
  children: ExplorerNode[];
}

/** Um nó da árvore com os campos que ele expõe. */
export function describeNode(node: DataSourceNode): ExplorerNode {
  return {
    id: node.id,
    name: node.name,
    fields: fieldsOf(node),
    children: (node.children ?? []).map(describeNode),
  };
}

/** A árvore inteira, pronta para exibir. */
export function describeTree(tree: DataSourceTree): ExplorerNode {
  return describeNode(tree.root);
}

/**
 * Campos de um nó.
 *
 * `fields` explícito ganha de tudo; depois a linha de amostra; e só então a
 * extração da SQL, que é heurística e pode errar.
 */
export function fieldsOf(node: DataSourceNode): string[] {
  if (node.fields?.length) return [...node.fields];
  if (node.sampleRow) return Object.keys(node.sampleRow);
  return extractFieldsFromSql(node.sql);
}

/**
 * Tenta descobrir os campos a partir do `SELECT`.
 *
 * É deliberadamente conservador: com `SELECT *` (o caso mais comum nos
 * exemplos) não há o que extrair, e devolver uma lista errada seria pior que
 * devolver vazia — o usuário confiaria num nome que não existe. Nesse caso o
 * explorador mostra o nó sem campos e o usuário digita.
 */
export function extractFieldsFromSql(sql: string): string[] {
  const match = /\bSELECT\b([\s\S]*?)\bFROM\b/i.exec(sql);
  if (!match) return [];

  const columns = splitTopLevel(match[1] ?? '');
  const fields: string[] = [];

  for (const raw of columns) {
    const column = raw.trim();
    if (column === '' || column === '*' || column.endsWith('.*')) continue;

    // "expressão AS apelido" -> apelido
    const alias = /\bAS\s+["'[]?([A-Za-z_][A-Za-z0-9_]*)["'\]]?\s*$/i.exec(column);
    if (alias?.[1]) {
      fields.push(alias[1]);
      continue;
    }

    // "tabela.coluna" ou "coluna" simples; qualquer coisa com parêntese ou
    // operador é expressão sem apelido, e aí não dá para saber o nome
    const simple = /^["'[]?([A-Za-z_][A-Za-z0-9_]*)["'\]]?(?:\s*\.\s*["'[]?([A-Za-z_][A-Za-z0-9_]*)["'\]]?)?$/.exec(
      column,
    );
    if (simple) fields.push(simple[2] ?? simple[1]!);
  }

  return fields;
}

/** Separa por vírgula respeitando parênteses e literais. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = '';

  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;

    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim() !== '') parts.push(current);
  return parts;
}

/** Caminho da raiz até o nó, ou undefined se não existir. */
export function pathToNode(root: ExplorerNode, nodeId: string): ExplorerNode[] | undefined {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const sub = pathToNode(child, nodeId);
    if (sub) return [root, ...sub];
  }
  return undefined;
}

/** Busca um nó pelo id, em qualquer profundidade. */
export function findNode(root: ExplorerNode, nodeId: string): ExplorerNode | undefined {
  return pathToNode(root, nodeId)?.at(-1);
}

/**
 * Todos os campos visíveis de dentro de um nó — os dele e os dos ancestrais.
 *
 * É exatamente o escopo que o motor de expressões enxerga (a corrente
 * `current`/`parent`), então o autocomplete não sugere o que não existe.
 */
export function fieldsInScope(root: ExplorerNode, nodeId: string): ExplorerField[] {
  const path = pathToNode(root, nodeId);
  if (!path) return [];

  const out: ExplorerField[] = [];
  // do nó atual para a raiz: depth 0, 1, 2...
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const node = path[i]!;
    const depth = path.length - 1 - i;
    for (const name of node.fields) {
      out.push({ name, nodeId: node.id, depth });
    }
  }
  return out;
}

/**
 * Como referenciar um campo numa expressão, a partir de um nó.
 *
 * Campo da linha atual sai sem prefixo; de um ancestral, com tantos `parent.`
 * quantos níveis acima ele estiver.
 */
export function fieldReference(field: ExplorerField): string {
  return field.depth === 0 ? field.name : `${'parent.'.repeat(field.depth)}${field.name}`;
}

/** O mesmo, já embrulhado em `{{ }}` para colar num Label. */
export function fieldExpression(field: ExplorerField): string {
  return `{{${fieldReference(field)}}}`;
}

/** Parâmetros do relatório, que ficam visíveis em qualquer nível. */
export function parameterFields(parameters: ReportParameter[]): ExplorerField[] {
  return parameters.map((p) => ({ name: p.name, nodeId: '(parâmetros)', depth: 0 }));
}
