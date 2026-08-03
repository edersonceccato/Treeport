import type { DataSourceTree, Template } from '@treeport/schema';
import type { Executor } from '../adapters/executor.js';
import { generateReport } from '../render/generate.js';
import { ReportBlockedError } from '../control/control-fields.js';
import { ParameterValidationError } from '../data-source/parameters.js';
import { DataSourceTreeError } from '../data-source/resolver.js';

/**
 * Handlers das rotas do contrato Designer↔backend (seção 7.5.3 do brief).
 *
 * São **framework-neutros** de propósito: recebem `{ params, query, body }` e
 * devolvem `{ status, body }`. Quem usa cola isso no Express, Fastify, Next
 * API route ou controller do Nest com poucas linhas, sem reimplementar a
 * lógica.
 *
 * O que NÃO está aqui, por decisão de escopo (seção 7.5.5):
 * - autenticação e autorização: o host envolve os handlers com o middleware
 *   dele e só chama quando a requisição já está autorizada;
 * - persistência: o host implementa `TemplateStore`, porque é ele quem sabe
 *   qual é o banco e o ORM dele.
 */

/** Requisição, no mínimo que os handlers precisam. */
export interface RouteRequest {
  params?: Record<string, string | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** Resposta, para o host traduzir ao formato do framework dele. */
export interface RouteResponse {
  status: number;
  body: unknown;
  /** Presente quando o corpo é binário (o PDF do preview). */
  contentType?: string;
}

export type RouteHandler = (request: RouteRequest) => Promise<RouteResponse>;

/**
 * Persistência, implementada pelo host.
 *
 * O `core` não escolhe banco nem ORM — ver `docs/storage.md` para o schema
 * sugerido e um exemplo de implementação.
 */
export interface TemplateStore {
  listDataSources(): Promise<{ id: string; name: string }[]>;
  getDataSource(id: string): Promise<DataSourceTree | undefined>;

  listTemplates(dataSourceId?: string): Promise<TemplateSummary[]>;
  getTemplate(id: string): Promise<Template | undefined>;
  /** Cria uma versão nova; não sobrescreve (ver seção 9.1 do brief). */
  saveTemplate(template: Template): Promise<Template>;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description?: string;
  version?: number;
  updatedAt?: string;
}

export interface RouteHandlersOptions {
  store: TemplateStore;
  /**
   * Executor para o preview. Recebe o id da fonte de dados, porque a
   * aplicação pode ter conexões diferentes por tenant ou por base.
   */
  executor: Executor | ((dataSourceId: string) => Executor | Promise<Executor>);
}

export interface RouteHandlers {
  listDataSources: RouteHandler;
  getDataSource: RouteHandler;
  listTemplates: RouteHandler;
  getTemplate: RouteHandler;
  createTemplate: RouteHandler;
  updateTemplate: RouteHandler;
  previewTemplate: RouteHandler;
}

/**
 * Cria os handlers prontos.
 *
 * ```ts
 * const handlers = createRouteHandlers({ store, executor });
 *
 * app.get('/report-templates/:id', async (req, res) => {
 *   const r = await handlers.getTemplate({ params: req.params });
 *   res.status(r.status).json(r.body);
 * });
 * ```
 */
export function createRouteHandlers(options: RouteHandlersOptions): RouteHandlers {
  const { store } = options;

  const executorFor = async (dataSourceId: string): Promise<Executor> =>
    typeof options.executor === 'function'
      ? options.executor(dataSourceId)
      : options.executor;

  return {
    listDataSources: wrap(async () => ({
      status: 200,
      body: await store.listDataSources(),
    })),

    getDataSource: wrap(async (request) => {
      const id = requireParam(request, 'id');
      const tree = await store.getDataSource(id);

      if (!tree) return notFound(`Fonte de dados "${id}" não encontrada.`);
      return { status: 200, body: tree };
    }),

    listTemplates: wrap(async (request) => {
      const dataSourceId = firstQuery(request, 'dataSourceId');
      return { status: 200, body: await store.listTemplates(dataSourceId) };
    }),

    getTemplate: wrap(async (request) => {
      const id = requireParam(request, 'id');
      const template = await store.getTemplate(id);

      if (!template) return notFound(`Template "${id}" não encontrado.`);
      return { status: 200, body: template };
    }),

    createTemplate: wrap(async (request) => {
      const template = requireTemplate(request.body);
      return { status: 201, body: await store.saveTemplate(template) };
    }),

    updateTemplate: wrap(async (request) => {
      const id = requireParam(request, 'id');
      const template = requireTemplate(request.body);

      // o id da URL manda: evita um corpo adulterado gravar em outro registro
      return { status: 200, body: await store.saveTemplate({ ...template, id }) };
    }),

    previewTemplate: wrap(async (request) => {
      const id = requireParam(request, 'id');
      const body = (request.body ?? {}) as { template?: Template };

      // aceita o template do corpo para pré-visualizar mudanças não salvas
      const template = body.template ?? (await store.getTemplate(id));
      if (!template) return notFound(`Template "${id}" não encontrado.`);

      const dataSourceId = template.dataSourceId;
      if (!dataSourceId) {
        return {
          status: 400,
          body: { error: 'O template não declara "dataSourceId"; sem ele não há o que consultar.' },
        };
      }

      const tree = await store.getDataSource(dataSourceId);
      if (!tree) return notFound(`Fonte de dados "${dataSourceId}" não encontrada.`);

      const pdf = await generateReport(tree, template, await executorFor(dataSourceId), {
        // o preview roda com os valores de teste dos parâmetros
        useTestValues: true,
        // no preview o template pode estar meio montado; um campo ainda não
        // preenchido não deve impedir a visualização
        expressionOptions: { strict: false },
      });

      return { status: 200, body: pdf, contentType: 'application/pdf' };
    }),
  };
}

/** Converte os erros conhecidos em status HTTP adequados. */
function wrap(handler: RouteHandler): RouteHandler {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpishError) {
        return { status: err.status, body: { error: err.message } };
      }
      if (err instanceof ParameterValidationError) {
        return { status: 400, body: { error: err.message, issues: err.issues } };
      }
      if (err instanceof DataSourceTreeError) {
        return { status: 400, body: { error: err.message } };
      }
      if (err instanceof ReportBlockedError) {
        // 422: a requisição está correta, mas a regra de negócio da query
        // bloqueou a emissão
        return { status: 422, body: { error: err.message, blocked: true } };
      }
      throw err;
    }
  };
}

class HttpishError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpishError';
  }
}

function notFound(message: string): RouteResponse {
  return { status: 404, body: { error: message } };
}

function requireParam(request: RouteRequest, name: string): string {
  const value = request.params?.[name];
  if (!value) throw new HttpishError(400, `Parâmetro de rota "${name}" é obrigatório.`);
  return value;
}

function firstQuery(request: RouteRequest, name: string): string | undefined {
  const value = request.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function requireTemplate(body: unknown): Template {
  if (typeof body !== 'object' || body === null) {
    throw new HttpishError(400, 'O corpo da requisição deve ser um template.');
  }

  const template = body as Partial<Template>;
  if (!template.bands?.details) {
    throw new HttpishError(400, 'Template inválido: a banda "details" é obrigatória.');
  }
  if (!template.id) {
    throw new HttpishError(400, 'Template inválido: "id" é obrigatório.');
  }

  return template as Template;
}
