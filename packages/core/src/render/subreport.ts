import type { ResolvedRow, SubreportElement } from '@treeport/schema';
import { renderBand } from './band.js';
import type { FontSet, RenderElementContext } from './elements.js';
import { measureBandContent, type MeasureContext } from './measure.js';
import type { FormatOptions } from './format.js';
import type { EvaluateOptions, ExpressionScope } from '../expressions/evaluate.js';

/**
 * Renderização de subreports (Fase 4 / Anexo C do brief).
 *
 * Um subreport é "o design de um nó filho", embutido dentro de uma banda do nó
 * pai — não é uma banda separada. Ele tem o próprio conjunto Header/Details/
 * Footer, escopado a ele:
 *
 *   Header  → 1x, no início do design daquele nó
 *   Details → 1x por linha de dados daquele nó
 *   Footer  → 1x, no fim do design daquele nó
 *
 * E pode aninhar em qualquer profundidade: dentro do subreport de Oferta pode
 * haver um de Taxas e outro de Embalagens, cada um sendo o design de um neto
 * na árvore.
 *
 * Devolve a altura realmente ocupada — que é variável, já que depende de
 * quantas linhas o nó devolveu. É esse retorno que alimenta o auto-grow em
 * cascata (Fase 5).
 */
export async function renderSubreport(
  element: SubreportElement,
  absoluteY: number,
  context: RenderElementContext,
): Promise<number> {
  const rows = subreportRows(element, context);

  // sem linhas: o subreport não ocupa nada além da altura nominal declarada.
  // Quem quiser que ele suma de vez usa height: 0 no elemento.
  if (rows.length === 0) return element.height;

  const bands = element.template;
  let y = absoluteY;

  // as bandas do subreport encolhem para o conteúdo: a altura nominal delas é
  // o espaço de design, não um espaçamento fixo a ser preservado. Sem isso, um
  // nó com poucas linhas deixa um buraco até a altura declarada.
  const shrink = { shrinkToContent: true };

  if (bands.header) {
    y += await renderBand(bands.header, y, childContext(context, rows[0]!), shrink);
  }

  for (const row of rows) {
    y += await renderBand(bands.details, y, childContext(context, row), shrink);
  }

  if (bands.footer) {
    // o footer do subreport usa a última linha como contexto — é onde
    // normalmente aparece um "total" que ainda quer alcançar os campos do pai
    y += await renderBand(
      bands.footer,
      y,
      childContext(context, rows[rows.length - 1]!),
      shrink,
    );
  }

  // ocupa exatamente o que o conteúdo pediu — tem que casar com
  // `measureSubreport`, senão a quebra de página erra o cálculo
  return y - absoluteY;
}

/**
 * As linhas que alimentam o subreport.
 *
 * Normalmente vêm de `resolvedRow.children[dataSourceNodeId]`. Quando o
 * subreport aponta para o próprio nó em que já está (ou o nó não foi
 * resolvido), devolve vazio em vez de quebrar — um template pode referenciar
 * um nó que a árvore de dados daquele relatório não tem.
 */
function subreportRows(
  element: SubreportElement,
  context: RenderElementContext,
): ResolvedRow[] {
  return context.resolvedRow?.children[element.dataSourceNodeId] ?? [];
}

/**
 * Contexto para desenhar uma linha do subreport.
 *
 * O ponto central: o escopo de expressões do pai vira o `parent` do filho.
 * É isso que faz `{{parent.CLIENTE}}` funcionar dentro da banda de taxas, e
 * que permite um nome solto subir a corrente até achar o campo (Fase 3).
 */
function childContext(
  context: RenderElementContext,
  row: ResolvedRow,
): RenderElementContext {
  const parentScope = context.scope ?? { current: context.row };

  return {
    ...context,
    row: row.data,
    resolvedRow: row,
    scope: {
      current: row.data,
      parent: parentScope,
      ...(parentScope.parameters ? { parameters: parentScope.parameters } : {}),
    },
  };
}

/**
 * Altura estimada de um subreport, sem desenhar.
 *
 * Usada para decidir a quebra de página antes de começar (a Fase 5 refina isso
 * para o reflow completo). Como o número de linhas é conhecido depois da
 * resolução dos dados, dá para estimar com precisão: header + N x details +
 * footer, somando recursivamente os subreports aninhados.
 */
export function measureSubreport(
  element: SubreportElement,
  resolvedRow: ResolvedRow | undefined,
  context?: SubreportMeasureContext,
): number {
  const rows = resolvedRow?.children[element.dataSourceNodeId] ?? [];
  if (rows.length === 0) return element.height;

  const bands = element.template;
  let total = 0;

  // mede cada banda com o mesmo caminho da renderização (texto que quebra,
  // subreports aninhados, cascata), recursivamente em qualquer profundidade
  const measure = (band: Parameters<typeof measureBandContent>[0], row: ResolvedRow): number =>
    measureBandContent(band, subContext(context, row), { shrinkToContent: true });

  if (bands.header) total += measure(bands.header, rows[0]!);
  for (const row of rows) total += measure(bands.details, row);
  if (bands.footer) total += measure(bands.footer, rows[rows.length - 1]!);

  // o subreport ocupa o que o conteúdo pede; a `height` do elemento é só o
  // espaço reservado no design quando não há linhas
  return total;
}

/** O que `measureSubreport` precisa para medir texto (fontes, escopo). */
export interface SubreportMeasureContext {
  /** Ausente quando só a geometria importa (sem medir quebra de texto). */
  fonts?: FontSet | undefined;
  scope?: ExpressionScope;
  formatOptions?: FormatOptions;
  expressionOptions?: EvaluateOptions;
}

/**
 * Contexto de medição para uma linha do subreport, encadeando o escopo do pai
 * — igual ao `childContext` da renderização, para as duas medirem o mesmo.
 *
 * Sem `context` (chamada sem fontes), mede só a geometria: subreports
 * aninhados e alturas nominais, sem quebra de texto.
 */
function subContext(
  context: SubreportMeasureContext | undefined,
  row: ResolvedRow,
): MeasureContext {
  const parentScope = context?.scope;
  return {
    ...(context?.fonts ? { fonts: context.fonts } : {}),
    row: row.data,
    resolvedRow: row,
    scope: {
      current: row.data,
      ...(parentScope ? { parent: parentScope } : {}),
      ...(parentScope?.parameters ? { parameters: parentScope.parameters } : {}),
    },
    ...(context?.formatOptions ? { formatOptions: context.formatOptions } : {}),
    ...(context?.expressionOptions ? { expressionOptions: context.expressionOptions } : {}),
  };
}
