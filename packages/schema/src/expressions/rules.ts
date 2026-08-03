import type { ElementRule, ElementStyle, ReportElement } from '../template.js';
import { evaluateExpression } from './interpolate.js';
import { toBoolean } from './functions.js';
import type { EvaluateOptions, ExpressionScope } from './evaluate.js';

/**
 * Regras condicionais (item 19 do feedback).
 *
 * Permitem esconder um elemento, trocar o conteúdo ou o estilo conforme os
 * dados da linha — sem código na aplicação hospedeira:
 *
 *   quando `total < 0`            → esconder
 *   quando `total < 0`            → conteúdo "0,00"
 *   quando `situacao == 'ATRASADO'` → cor vermelha
 *
 * As regras são avaliadas na ordem declarada e **a primeira que casar vence**.
 * Isso é previsível de explicar ("a de cima manda") e evita a confusão de
 * várias regras se sobrepondo parcialmente.
 */

export interface AppliedRules {
  /** O elemento deve sumir? */
  hidden: boolean;
  /** Conteúdo substituto, quando a regra define um. */
  content?: string;
  /** Estilo mesclado ao do elemento. */
  style?: ElementStyle;
  /** A regra que venceu, útil para depurar no Designer. */
  matched?: ElementRule;
}

/**
 * Avalia as regras de um elemento contra o escopo de dados.
 *
 * Uma condição que não compila (o usuário está no meio da digitação, ou o
 * campo mudou de nome) é **ignorada** em vez de derrubar o relatório — uma
 * regra quebrada não deve impedir a emissão do documento inteiro.
 */
export function applyRules(
  element: ReportElement,
  scope: ExpressionScope,
  options: EvaluateOptions = {},
): AppliedRules {
  const rules = element.rules;
  if (!rules?.length) return { hidden: element.hidden ?? false };

  for (const rule of rules) {
    if (!rule.when?.trim()) continue;

    let matched = false;
    try {
      matched = toBoolean(evaluateExpression(rule.when, scope, { ...options, strict: false }));
    } catch {
      // condição inválida: segue para a próxima em vez de quebrar
      continue;
    }

    if (!matched) continue;

    return {
      hidden: rule.hide ?? element.hidden ?? false,
      ...(rule.content !== undefined ? { content: rule.content } : {}),
      ...(rule.style ? { style: { ...element.style, ...rule.style } } : {}),
      matched: rule,
    };
  }

  return { hidden: element.hidden ?? false };
}

/** O elemento tem alguma regra configurada? */
export function hasRules(element: ReportElement): boolean {
  return (element.rules?.length ?? 0) > 0;
}
