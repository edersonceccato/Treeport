import type { DataSourceTree, Template } from '@treeport/schema';

/**
 * Cliente HTTP do Designer (sub-fase 9.7 / seção 7.5.3 do brief).
 *
 * O Designer NUNCA fala com o banco: ele só consome as rotas que o backend do
 * usuário expõe. Credencial de banco não pertence ao frontend, e a lib não
 * embute servidor nem assume Express/Fastify/Next.
 *
 * Contrato:
 *   GET    /report-data-sources
 *   GET    /report-data-sources/:id
 *   GET    /report-templates?dataSourceId=
 *   GET    /report-templates/:id
 *   POST   /report-templates
 *   PUT    /report-templates/:id
 *   POST   /report-templates/:id/preview   -> PDF
 */

export interface ApiClientOptions {
  /** Base das rotas, ex.: `/api` ou `https://app.exemplo.com/api`. */
  baseUrl: string;
  /**
   * Cabeçalhos extras (autenticação, tenant).
   * Pode ser função, para o token ser lido a cada chamada em vez de congelado
   * na inicialização — importante quando ele expira.
   */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** `fetch` alternativo, para testes ou para um wrapper com retry. */
  fetch?: typeof fetch;
  /** Envia cookies de sessão. Default: 'same-origin'. */
  credentials?: RequestCredentials;
}

/** Erro de uma chamada ao backend, com status e corpo. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`${status} em ${url}: ${body.slice(0, 200) || '(sem corpo)'}`);
    this.name = 'ApiError';
  }
}

/** Resumo de um template na listagem, sem o JSON completo. */
export interface TemplateSummary {
  id: string;
  name: string;
  description?: string;
  version?: number;
  updatedAt?: string;
}

export class TreeportApiClient {
  private readonly baseUrl: string;
  private readonly options: ApiClientOptions;

  constructor(options: ApiClientOptions) {
    // sem barra final, para não gerar `//` ao concatenar
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.options = options;
  }

  // --- fontes de dados ------------------------------------------------------

  listDataSources(): Promise<{ id: string; name: string }[]> {
    return this.get('/report-data-sources');
  }

  /** Uma árvore completa — é dela que sai o explorador de campos. */
  getDataSource(id: string): Promise<DataSourceTree> {
    return this.get(`/report-data-sources/${encodeURIComponent(id)}`);
  }

  // --- templates ------------------------------------------------------------

  listTemplates(dataSourceId?: string): Promise<TemplateSummary[]> {
    const query = dataSourceId
      ? `?dataSourceId=${encodeURIComponent(dataSourceId)}`
      : '';
    return this.get(`/report-templates${query}`);
  }

  getTemplate(id: string): Promise<Template> {
    return this.get(`/report-templates/${encodeURIComponent(id)}`);
  }

  createTemplate(template: Template): Promise<Template> {
    return this.send('POST', '/report-templates', template);
  }

  updateTemplate(template: Template): Promise<Template> {
    return this.send('PUT', `/report-templates/${encodeURIComponent(template.id)}`, template);
  }

  /** Cria ou atualiza, conforme o template já exista no servidor. */
  async saveTemplate(template: Template, isNew = false): Promise<Template> {
    return isNew ? this.createTemplate(template) : this.updateTemplate(template);
  }

  /**
   * Gera um PDF de amostra com os `testValue` dos parâmetros.
   *
   * Devolve um Blob para a UI mostrar num `<iframe>` — o browser já sabe
   * exibir PDF, não precisa de lib de renderização no frontend.
   */
  async preview(templateId: string, template?: Template): Promise<Blob> {
    const url = `${this.baseUrl}/report-templates/${encodeURIComponent(templateId)}/preview`;

    const response = await this.doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.resolveHeaders() },
      // manda o template atual junto: permite pré-visualizar mudanças que
      // ainda não foram salvas
      body: JSON.stringify(template ? { template } : {}),
    });

    if (!response.ok) {
      throw new ApiError(response.status, url, await safeText(response));
    }
    return response.blob();
  }

  /** URL de objeto para o preview, pronta para um `<iframe src>`. */
  async previewUrl(templateId: string, template?: Template): Promise<string> {
    return URL.createObjectURL(await this.preview(templateId, template));
  }

  // --- interno --------------------------------------------------------------

  private resolveHeaders(): Record<string, string> {
    const headers = this.options.headers;
    return typeof headers === 'function' ? headers() : (headers ?? {});
  }

  private doFetch(url: string, init: RequestInit): Promise<Response> {
    const impl = this.options.fetch ?? globalThis.fetch;
    return impl(url, { credentials: this.options.credentials ?? 'same-origin', ...init });
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.doFetch(url, { headers: this.resolveHeaders() });

    if (!response.ok) throw new ApiError(response.status, url, await safeText(response));
    return response.json() as Promise<T>;
  }

  private async send<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.doFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...this.resolveHeaders() },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new ApiError(response.status, url, await safeText(response));
    return response.json() as Promise<T>;
  }
}

/** Lê o corpo do erro sem deixar uma falha de leitura mascarar o erro real. */
async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

// --- import/export de arquivo (não passa pelo backend) ----------------------

/**
 * Serializa o template para download.
 *
 * Útil para versionar no Git ou mover entre ambientes sem depender do
 * servidor — espelha os botões "Importar/Exportar" do sistema de origem.
 */
export function exportTemplate(template: Template): string {
  return JSON.stringify(template, null, 2);
}

/**
 * Lê um template de um JSON, validando o mínimo.
 *
 * A validação é superficial de propósito: só o suficiente para o Designer não
 * quebrar ao abrir um arquivo errado. A validação completa é do backend.
 */
export function importTemplate(json: string): Template {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Arquivo não é um JSON válido: ${(err as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Arquivo não contém um template.');
  }

  const template = parsed as Partial<Template>;
  if (!template.bands || typeof template.bands !== 'object') {
    throw new Error('Template inválido: falta a seção "bands".');
  }
  if (!template.bands.details) {
    throw new Error('Template inválido: a banda "details" é obrigatória.');
  }

  return {
    id: template.id ?? `template-${Date.now()}`,
    name: template.name ?? 'Template importado',
    boundDataSourceNodeId: template.boundDataSourceNodeId ?? '',
    pageSize: template.pageSize ?? 'A4',
    ...template,
  } as Template;
}
