/**
 * Modelo da árvore de fonte de dados (seção 4 do brief).
 *
 * A ideia central: um relatório tem uma query "master" e, penduradas nela,
 * queries "detail" recursivas. Cada nó filho declara qual campo do pai
 * (`parentField`) casa com qual campo dele (`childField`) — o equivalente a um
 * JOIN feito em tempo de execução pelo motor, não pelo SQL.
 */

/** Tipos suportados para parâmetros de relatório. */
export type ParameterType = 'string' | 'int' | 'decimal' | 'date' | 'boolean';

/**
 * Um parâmetro tipado do relatório, usado para filtrar as queries em runtime.
 * Espelha a aba de parâmetros do Report Builder de origem, mas como objeto TS
 * simples (nada de XML — ver Anexo A do brief).
 */
export interface ReportParameter {
  name: string;
  type: ParameterType;
  /** Tamanho máximo (só faz sentido para `string`); usado apenas como metadado. */
  size?: number;
  defaultValue?: unknown;
  nullable: boolean;
  /** Valor usado ao rodar o relatório isoladamente (preview do Designer). */
  testValue?: unknown;
}

/** Ligação master→detail: qual campo do pai alimenta qual campo do filho. */
export interface LinkFields {
  /** Campo da linha do pai que fornece o valor (ex.: "id"). */
  parentField: string;
  /** Campo deste nó que corresponde ao do pai (ex.: "proposalId"). */
  childField: string;
}

/**
 * Um nó da árvore de fonte de dados. O nó raiz não tem `linkFields`;
 * todo nó filho obrigatoriamente tem.
 */
export interface DataSourceNode {
  /** Identificador único do nó dentro da árvore (ex.: "OFFER_FEE"). */
  id: string;
  /** Nome de exibição, mostrado no explorador de campos do Designer. */
  name: string;
  /**
   * Query SQL crua escrita pelo usuário da lib. Pode conter:
   * - parâmetros do relatório: `:paramName`
   * - o valor vindo do pai: `:parentValue` (preenchido pelo motor)
   */
  sql: string;
  /** Ausente apenas no nó raiz (master). */
  linkFields?: LinkFields;
  /** Ordenação aplicada em memória depois da query, no formato "campo" ou "campo DESC". */
  orderBy?: string;
  /**
   * Se true e a query não retorna linhas, o nó é simplesmente pulado em vez de
   * quebrar o relatório. Default: true (comportamento mais tolerante).
   */
  skipWhenNoRecords?: boolean;
  /** Details deste nó (recursivo, profundidade arbitrária). */
  children?: DataSourceNode[];
  /**
   * Nomes das colunas que a query devolve.
   *
   * Opcional e ignorado pelo motor de renderização — serve ao explorador de
   * campos do Designer, que precisa listar o que existe sem executar a query.
   * O backend costuma preencher a partir do schema do banco.
   */
  fields?: string[];
  /**
   * Uma linha de amostra, usada pelo Designer quando `fields` não foi
   * informado. As chaves viram a lista de campos.
   */
  sampleRow?: DataRow;
}

/** Tag de contexto de uso (Anexo B): em quais telas o relatório aparece. */
export interface ReportContext {
  /** Ex.: "proposta.imprimir". O core não interpreta o significado. */
  contextTag: string;
  /** Defaults de parâmetro específicos deste contexto. */
  parameterDefaults?: Record<string, unknown>;
}

/** A árvore inteira: o master mais a declaração de parâmetros. */
export interface DataSourceTree {
  id: string;
  name: string;
  /** O nó master. */
  root: DataSourceNode;
  parameters: ReportParameter[];
  contexts?: ReportContext[];
}

/** Uma linha crua vinda do banco. */
export type DataRow = Record<string, unknown>;

/**
 * Resultado da resolução de um nó: a linha em si mais, para cada nó filho,
 * o array de linhas-filhas já resolvidas (recursivamente).
 */
export interface ResolvedRow {
  /** Os dados da linha, exatamente como vieram da query. */
  data: DataRow;
  /**
   * Filhos resolvidos, indexados pelo `id` do nó filho.
   * Um nó filho sem linhas aparece aqui como array vazio.
   */
  children: Record<string, ResolvedRow[]>;
}

/** Resultado da resolução da árvore inteira, a partir do master. */
export interface ResolvedDataSet {
  /** O id do nó raiz, para conferência. */
  nodeId: string;
  /** As linhas do master, cada uma com seus filhos aninhados. */
  rows: ResolvedRow[];
}
