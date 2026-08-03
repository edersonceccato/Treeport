import type { ResolvedRow, SubreportElement } from '@treeport/schema';
import { renderBand, measureBand } from './band.js';
import type { RenderElementContext } from './elements.js';

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

  if (bands.header) {
    y += await renderBand(bands.header, y, childContext(context, rows[0]!));
  }

  for (const row of rows) {
    y += await renderBand(bands.details, y, childContext(context, row));
  }

  if (bands.footer) {
    // o footer do subreport usa a última linha como contexto — é onde
    // normalmente aparece um "total" que ainda quer alcançar os campos do pai
    y += await renderBand(
      bands.footer,
      y,
      childContext(context, rows[rows.length - 1]!),
    );
  }

  const used = y - absoluteY;
  return Math.max(used, element.height);
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
): number {
  const rows = resolvedRow?.children[element.dataSourceNodeId] ?? [];
  if (rows.length === 0) return element.height;

  const bands = element.template;
  let total = 0;

  // `measureBand` mede recursivamente os subreports aninhados dentro de cada
  // banda, então a soma cobre a árvore inteira em qualquer profundidade
  if (bands.header) total += measureBand(bands.header, rows[0]!);
  for (const row of rows) total += measureBand(bands.details, row);
  if (bands.footer) total += measureBand(bands.footer, rows[rows.length - 1]!);

  return Math.max(total, element.height);
}
