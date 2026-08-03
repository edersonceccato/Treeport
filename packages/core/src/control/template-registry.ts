import type { Template } from '@treeport/schema';

/**
 * Registro de templates e tags de contexto (Anexo B do brief).
 *
 * Um mesmo relatório (a mesma árvore de dados) costuma ter vários layouts —
 * é a aba "Modelos" do Report Builder de origem. E cada layout pode declarar
 * em quais telas do sistema ele aparece, via `contextTag`.
 *
 * O `core` NÃO interpreta o significado da tag: para ele "proposta.imprimir" é
 * só uma string. Ele guarda, filtra e devolve — quem monta o menu "Imprimir
 * como..." é a aplicação hospedeira, que é quem sabe o que aquela tela
 * significa.
 */

export interface TemplateRegistryEntry {
  template: Template;
  /** Árvore de dados a que este template pertence. */
  dataSourceId?: string;
}

export class TemplateRegistry {
  private readonly templates = new Map<string, Template>();

  constructor(templates: Template[] = []) {
    for (const template of templates) this.add(template);
  }

  /** Registra (ou substitui) um template. */
  add(template: Template): this {
    this.templates.set(template.id, template);
    return this;
  }

  /** Remove um template do registro. */
  remove(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  get(templateId: string): Template | undefined {
    return this.templates.get(templateId);
  }

  has(templateId: string): boolean {
    return this.templates.has(templateId);
  }

  /** Todos os templates registrados. */
  list(): Template[] {
    return [...this.templates.values()];
  }

  /** Templates de uma árvore de dados específica (a aba "Modelos"). */
  listForDataSource(dataSourceId: string): Template[] {
    return this.list().filter((t) => t.dataSourceId === dataSourceId);
  }

  /**
   * Templates disponíveis num contexto de uso.
   *
   * A aplicação hospedeira usa isso para montar, por exemplo, um menu
   * "Imprimir como..." mostrando só o que faz sentido na tela atual.
   */
  listForContext(contextTag: string): Template[] {
    return this.list().filter((t) =>
      (t.contexts ?? []).some((c) => c.contextTag === contextTag),
    );
  }

  /**
   * Valores default de parâmetro que aquele contexto define para o template.
   *
   * Permite a mesma tela abrir o relatório já com filtros preenchidos, sem a
   * aplicação repetir essa configuração em código.
   */
  parameterDefaultsFor(
    templateId: string,
    contextTag: string,
  ): Record<string, unknown> | undefined {
    const context = this.get(templateId)?.contexts?.find((c) => c.contextTag === contextTag);
    return context?.parameterDefaults;
  }

  /** Todas as tags de contexto distintas, para a aplicação descobrir o que existe. */
  listContextTags(): string[] {
    const tags = new Set<string>();
    for (const template of this.list()) {
      for (const context of template.contexts ?? []) tags.add(context.contextTag);
    }
    return [...tags].sort();
  }

  get size(): number {
    return this.templates.size;
  }
}

/**
 * Escolhe qual template usar, na ordem de prioridade do Anexo A:
 *
 *   1. o `templateId` explícito passado na chamada da API
 *   2. o `__templateId` calculado pela query
 *   3. o template único, quando só há um candidato
 *
 * O explícito ganhar do calculado é intencional: quem chama a API sabe o que
 * quer, e a query é um default inteligente, não uma imposição.
 */
export function resolveTemplate(
  registry: TemplateRegistry,
  options: { explicitId?: string | undefined; calculatedId?: string | undefined },
): Template {
  const { explicitId, calculatedId } = options;

  if (explicitId) {
    const template = registry.get(explicitId);
    if (!template) {
      throw new TemplateNotFoundError(explicitId, registry.list().map((t) => t.id), 'explícito');
    }
    return template;
  }

  if (calculatedId) {
    const template = registry.get(calculatedId);
    if (!template) {
      throw new TemplateNotFoundError(
        calculatedId,
        registry.list().map((t) => t.id),
        'calculado pela query em __templateId',
      );
    }
    return template;
  }

  const all = registry.list();
  if (all.length === 1) return all[0]!;

  if (all.length === 0) {
    throw new TemplateNotFoundError('(nenhum)', [], 'registro vazio');
  }

  throw new TemplateNotFoundError(
    '(não informado)',
    all.map((t) => t.id),
    'há mais de um template registrado, informe qual usar',
  );
}

/** Template pedido não existe no registro. */
export class TemplateNotFoundError extends Error {
  constructor(
    readonly templateId: string,
    readonly available: string[],
    reason: string,
  ) {
    super(
      `Template "${templateId}" não encontrado (${reason}). ` +
        `Disponíveis: ${available.join(', ') || '(nenhum)'}.`,
    );
    this.name = 'TemplateNotFoundError';
  }
}
