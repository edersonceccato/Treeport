import type { Band, ReportElement, ResolvedRow } from '@treeport/schema';
import type { FontSet } from './elements.js';
import { pickFont } from './elements.js';
import { measureSubreport } from './subreport.js';
import { formatValue, type FormatOptions } from './format.js';
import { lineHeight, wrapText } from './text.js';
import { interpolate, evaluateExpression } from '../expressions/interpolate.js';
import { hasField, type EvaluateOptions, type ExpressionScope } from '../expressions/evaluate.js';

/**
 * Medição de altura sem desenhar (Fase 5).
 *
 * Existe porque a decisão de quebrar a página precisa acontecer ANTES de
 * qualquer traço no PDF — não dá para desenhar meia banda, descobrir que não
 * coube e desfazer. Então o motor mede primeiro, decide, e só aí desenha.
 *
 * A medição espelha exatamente a lógica de `renderBand`/`renderElement`: mesmo
 * cálculo de quebra de linha, mesmo offset em cascata. Se as duas divergirem,
 * o layout sai errado — por isso as duas compartilham `wrapText`, `pickFont` e
 * `measureSubreport` em vez de reimplementar cada uma a sua.
 */

const DEFAULT_FONT_SIZE = 10;

export interface MeasureContext {
  /**
   * Fontes usadas para medir quebra de texto. Ausente quando só a geometria
   * importa (subreports e alturas nominais) — aí o texto não é medido.
   */
  fonts?: FontSet | undefined;
  row: Record<string, unknown>;
  scope?: ExpressionScope;
  formatOptions?: FormatOptions;
  expressionOptions?: EvaluateOptions;
  /** Linha resolvida, necessária para medir subreports. */
  resolvedRow?: ResolvedRow;
}

/**
 * Altura que um elemento vai ocupar de verdade.
 *
 * Sem `canGrow`, é sempre a altura nominal — o elemento é recortado no
 * desenho, então não adianta medir mais que isso.
 */
export function measureElement(element: ReportElement, context: MeasureContext): number {
  if (element.type === 'subreport') {
    // repassa fontes/escopo para o subreport medir o texto dele também
    return measureSubreport(element, context.resolvedRow, {
      ...(context.fonts ? { fonts: context.fonts } : {}),
      ...(context.scope ? { scope: context.scope } : {}),
      ...(context.formatOptions ? { formatOptions: context.formatOptions } : {}),
      ...(context.expressionOptions ? { expressionOptions: context.expressionOptions } : {}),
    });
  }

  if (!element.canGrow) return element.height;

  // sem fontes não dá para saber onde o texto quebra; fica na altura nominal
  if ((element.type === 'label' || element.type === 'field') && context.fonts) {
    const text = resolveText(element, context);
    const fontSize = element.style?.fontSize ?? DEFAULT_FONT_SIZE;
    const font = pickFont(context.fonts, element.style);
    const lines = wrapText(text, font, fontSize, element.width);
    return Math.max(element.height, lines.length * lineHeight(fontSize));
  }

  return element.height;
}

/**
 * Texto final de um Label/Field, do mesmo jeito que a renderização resolve.
 *
 * Duplicar essa resolução é o preço de medir antes de desenhar; se divergir de
 * `elements.ts`, a altura medida não bate com a desenhada.
 */
function resolveText(
  element: Extract<ReportElement, { type: 'label' | 'field' }>,
  context: MeasureContext,
): string {
  const scope = context.scope ?? { current: context.row };
  const expressionOptions = context.expressionOptions ?? {};

  if (element.type === 'label') {
    if (element.isExpression && !element.content.includes('{{')) {
      return formatValue(evaluateExpression(element.content, scope, expressionOptions));
    }
    return interpolate(element.content, scope, expressionOptions);
  }

  const raw = element.fieldName.includes('{{')
    ? evaluateExpression(element.fieldName, scope, expressionOptions)
    : lookupField(element.fieldName, context, scope);

  return formatValue(raw, element.format, context.formatOptions ?? {});
}

/** Mesma busca em corrente de escopos que a renderização faz. */
function lookupField(
  fieldName: string,
  context: MeasureContext,
  scope: ExpressionScope,
): unknown {
  if (hasField(context.row, fieldName)) return context.row[fieldName];
  for (let s: ExpressionScope | undefined = scope; s; s = s.parent) {
    if (hasField(s.current, fieldName)) return s.current[fieldName];
  }
  return undefined;
}

/**
 * Altura real de uma banda, com o deslocamento em cascata aplicado.
 *
 * Percorre os elementos ordenados por `y`, acumulando o quanto os que cresceram
 * empurram os seguintes para baixo, e devolve a base do elemento mais baixo.
 *
 * `shrinkToContent` permite a banda ficar MENOR que `band.height` quando o
 * conteúdo não a preenche — é o que elimina o espaço morto depois de um
 * subreport com poucas linhas.
 */
export function measureBandContent(
  band: Band,
  context: MeasureContext,
  options: { shrinkToContent?: boolean } = {},
): number {
  const ordered = [...band.elements].sort((a, b) => a.y - b.y);

  let offset = 0;
  /**
   * Sem `shrinkToContent`, `band.height` é piso: a banda reserva o espaço de
   * design mesmo que o conteúdo termine antes (é assim que uma banda de
   * detalhe serve de espaçamento fixo entre registros).
   *
   * Com `shrinkToContent`, a banda vale o que o conteúdo pediu. Numa banda sem
   * nenhum elemento que cresce, os dois dão no mesmo; a diferença aparece
   * quando há subreport de tamanho variável dentro.
   */
  let maxBottom = options.shrinkToContent ? 0 : band.height;
  const hasGrowingElement = ordered.some((e) => e.canGrow);

  for (const element of ordered) {
    const used = measureElement(element, context);

    const bottom = element.y + offset + used;
    if (bottom > maxBottom) maxBottom = bottom;

    // `canGrow` desloca o que vem depois — para baixo quando o elemento cresce
    // e, com `shrinkToContent`, para cima quando ele ocupa menos que reservou
    if (element.canGrow) {
      const delta = used - element.height;
      if (delta > 0 || options.shrinkToContent) offset += delta;
    }
  }

  // uma banda sem elemento variável mantém a altura de design mesmo em modo
  // encolhível — senão viraria zero e os registros colariam uns nos outros
  if (options.shrinkToContent && !hasGrowingElement) {
    return Math.max(maxBottom, band.height);
  }

  return maxBottom;
}
