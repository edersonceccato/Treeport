import type { DataRow, DataSourceTree, Template } from '@treeport/schema';
import type { Executor } from '../adapters/executor.js';
import { resolveDataSourceTree, type ResolveOptions } from '../data-source/resolver.js';
import { testValuesOf } from '../data-source/parameters.js';
import { renderReport, type RenderOptions } from '../render/renderer.js';
import {
  assertNotBlocked,
  readControlFields,
  DEFAULT_CONTROL_PREFIX,
  type ControlFields,
} from './control-fields.js';
import { resolveTemplate, TemplateRegistry } from './template-registry.js';

/**
 * Geração com metadados de controle (Anexo A do brief).
 *
 * É a função que a aplicação hospedeira chama em produção, quando o relatório
 * tem mais de um layout ou quando a query decide coisas sobre a geração.
 * Para o caso simples (uma árvore, um template), `generateReport` continua
 * sendo o caminho mais direto.
 */

export interface GenerateOptions extends ResolveOptions, RenderOptions {
  /** Template explícito; tem prioridade sobre o `__templateId` da query. */
  templateId?: string;
  /** Prefixo dos campos de controle. Default: `__`. */
  controlFieldPrefix?: string;
  /**
   * Chamado depois do PDF pronto, com a linha do master inteira (incluindo os
   * campos de controle) e os bytes gerados.
   *
   * É por aqui que a aplicação faz o que o `core` não deve saber fazer: anexar
   * o PDF a um registro, nomear o arquivo conforme uma regra do sistema dela,
   * disparar um e-mail. Se lançar, o erro sobe — a aplicação decide se um
   * pós-processamento falho invalida a geração.
   */
  onGenerated?: (rootRow: DataRow, pdf: Uint8Array) => void | Promise<void>;
}

export interface GenerateResult {
  /** Os bytes do PDF. */
  pdf: Uint8Array;
  /** O template efetivamente usado. */
  template: Template;
  /** A primeira linha do master, com os campos de controle. */
  rootRow: DataRow | undefined;
  /** Os campos de controle lidos daquela linha. */
  control: ControlFields;
}

/**
 * Resolve os dados, aplica os campos de controle e gera o PDF.
 *
 * A ordem importa: o bloqueio (`__block`) é verificado ANTES de desenhar
 * qualquer coisa, para não devolver um PDF pela metade.
 */
export async function generate(
  tree: DataSourceTree,
  templates: TemplateRegistry | Template[],
  executor: Executor,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const registry =
    templates instanceof TemplateRegistry ? templates : new TemplateRegistry(templates);

  const dataSet = await resolveDataSourceTree(tree, executor, options);
  const rootRow = dataSet.rows[0]?.data;

  const control = readControlFields(rootRow, options.controlFieldPrefix ?? DEFAULT_CONTROL_PREFIX);

  // antes de desenhar qualquer coisa
  assertNotBlocked(control, rootRow);

  const template = resolveTemplate(registry, {
    explicitId: options.templateId,
    calculatedId: control.templateId,
  });

  const parameters =
    options.parameters ?? (options.useTestValues ? testValuesOf(tree.parameters) : undefined);

  const pdf = await renderReport(template, dataSet, {
    ...options,
    ...(parameters ? { parameters } : {}),
  });

  if (options.onGenerated && rootRow) {
    await options.onGenerated(rootRow, pdf);
  }

  return { pdf, template, rootRow, control };
}
