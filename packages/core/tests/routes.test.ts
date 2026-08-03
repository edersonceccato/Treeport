import { describe, it, expect } from 'vitest';
import type { DataSourceTree, Template } from '@treeport/schema';
import {
  createRouteHandlers,
  MemoryExecutor,
  type TemplateStore,
  type TemplateSummary,
} from '../src/index.js';

/**
 * Os handlers são framework-neutros: recebem `{ params, query, body }` e
 * devolvem `{ status, body }`. Testá-los não exige Express nem servidor.
 */

const SQL = 'SELECT * FROM doc WHERE id = :docId';

function tree(): DataSourceTree {
  return {
    id: 'ds1',
    name: 'Documentos',
    parameters: [{ name: 'docId', type: 'int', nullable: false, testValue: 1 }],
    root: { id: 'DOC', name: 'Doc', sql: SQL },
  };
}

function template(id = 't1'): Template {
  return {
    id,
    name: 'Modelo',
    dataSourceId: 'ds1',
    boundDataSourceNodeId: 'DOC',
    pageSize: 'A4',
    bands: {
      details: {
        height: 20,
        elements: [
          { id: 'l', type: 'label', x: 0, y: 0, width: 300, height: 14, content: '{{titulo}}' },
        ],
      },
    },
  };
}

/** Store em memória, no lugar do banco do host. */
function memoryStore(): TemplateStore & { saved: Template[] } {
  const templates = new Map<string, Template>([['t1', template()]]);
  const saved: Template[] = [];

  return {
    saved,
    async listDataSources() {
      return [{ id: 'ds1', name: 'Documentos' }];
    },
    async getDataSource(id) {
      return id === 'ds1' ? tree() : undefined;
    },
    async listTemplates(dataSourceId?: string): Promise<TemplateSummary[]> {
      return [...templates.values()]
        .filter((t) => !dataSourceId || t.dataSourceId === dataSourceId)
        .map((t) => ({ id: t.id, name: t.name }));
    },
    async getTemplate(id) {
      return templates.get(id);
    },
    async saveTemplate(t) {
      saved.push(t);
      templates.set(t.id, t);
      return t;
    },
  };
}

const executor = new MemoryExecutor().on(SQL, [{ id: 1, titulo: 'Documento de teste' }]);

function handlers(store = memoryStore()) {
  return { h: createRouteHandlers({ store, executor }), store };
}

describe('fontes de dados', () => {
  it('lista', async () => {
    const { h } = handlers();
    const r = await h.listDataSources({});

    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ id: 'ds1', name: 'Documentos' }]);
  });

  it('devolve a árvore completa, para o explorador de campos', async () => {
    const { h } = handlers();
    const r = await h.getDataSource({ params: { id: 'ds1' } });

    expect(r.status).toBe(200);
    expect((r.body as DataSourceTree).root.id).toBe('DOC');
  });

  it('404 quando não existe', async () => {
    const { h } = handlers();
    const r = await h.getDataSource({ params: { id: 'zzz' } });

    expect(r.status).toBe(404);
  });

  it('400 sem o parâmetro de rota', async () => {
    const { h } = handlers();
    expect((await h.getDataSource({})).status).toBe(400);
  });
});

describe('templates', () => {
  it('lista os de uma árvore (aba Modelos)', async () => {
    const { h } = handlers();
    const r = await h.listTemplates({ query: { dataSourceId: 'ds1' } });

    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it('filtra por árvore', async () => {
    const { h } = handlers();
    const r = await h.listTemplates({ query: { dataSourceId: 'outra' } });

    expect(r.body).toHaveLength(0);
  });

  it('busca um pelo id', async () => {
    const { h } = handlers();
    const r = await h.getTemplate({ params: { id: 't1' } });

    expect(r.status).toBe(200);
    expect((r.body as Template).id).toBe('t1');
  });

  it('cria devolvendo 201', async () => {
    const { h, store } = handlers();
    const r = await h.createTemplate({ body: template('novo') });

    expect(r.status).toBe(201);
    expect(store.saved.map((t) => t.id)).toContain('novo');
  });

  it('atualiza devolvendo 200', async () => {
    const { h } = handlers();
    const r = await h.updateTemplate({ params: { id: 't1' }, body: template('t1') });

    expect(r.status).toBe(200);
  });

  it('o id da URL manda sobre o do corpo', async () => {
    // evita que um corpo adulterado grave em outro registro
    const { h, store } = handlers();
    await h.updateTemplate({ params: { id: 't1' }, body: template('outro-id') });

    expect(store.saved[0]!.id).toBe('t1');
  });

  it('recusa corpo que não é template', async () => {
    const { h } = handlers();

    expect((await h.createTemplate({ body: { qualquer: 1 } })).status).toBe(400);
    expect((await h.createTemplate({ body: 'texto' })).status).toBe(400);
  });

  it('recusa template sem a banda details', async () => {
    const { h } = handlers();
    const r = await h.createTemplate({ body: { id: 'x', bands: {} } });

    expect(r.status).toBe(400);
    expect(String((r.body as { error: string }).error)).toMatch(/details/);
  });
});

describe('preview', () => {
  it('gera o PDF com os valores de teste', async () => {
    const { h } = handlers();
    const r = await h.previewTemplate({ params: { id: 't1' } });

    expect(r.status).toBe(200);
    expect(r.contentType).toBe('application/pdf');

    const pdf = r.body as Uint8Array;
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
  });

  it('aceita o template do corpo, para ver mudanças não salvas', async () => {
    const { h } = handlers();
    const modificado = template();
    modificado.bands.details.elements[0] = {
      id: 'l',
      type: 'label',
      x: 0,
      y: 0,
      width: 300,
      height: 14,
      content: 'AINDA NAO SALVO',
    };

    const r = await h.previewTemplate({
      params: { id: 't1' },
      body: { template: modificado },
    });

    expect(r.status).toBe(200);
  });

  it('404 quando o template não existe', async () => {
    const { h } = handlers();
    expect((await h.previewTemplate({ params: { id: 'zzz' } })).status).toBe(404);
  });

  it('400 quando o template não declara dataSourceId', async () => {
    const { h } = handlers();
    const semArvore = template();
    delete semArvore.dataSourceId;

    const r = await h.previewTemplate({
      params: { id: 't1' },
      body: { template: semArvore },
    });

    expect(r.status).toBe(400);
    expect(String((r.body as { error: string }).error)).toMatch(/dataSourceId/);
  });

  it('não quebra com campo inexistente: no preview o template pode estar incompleto', async () => {
    const { h } = handlers();
    const incompleto = template();
    incompleto.bands.details.elements[0] = {
      id: 'l',
      type: 'label',
      x: 0,
      y: 0,
      width: 300,
      height: 14,
      content: '{{CAMPO_QUE_AINDA_NAO_EXISTE}}',
    };

    const r = await h.previewTemplate({
      params: { id: 't1' },
      body: { template: incompleto },
    });

    expect(r.status).toBe(200);
  });
});

describe('tratamento de erro', () => {
  it('erro de parâmetro vira 400 com a lista de problemas', async () => {
    const semTestValue: DataSourceTree = {
      ...tree(),
      parameters: [{ name: 'docId', type: 'int', nullable: false }],
    };

    const store: TemplateStore = {
      ...memoryStore(),
      async getDataSource() {
        return semTestValue;
      },
    };

    const h = createRouteHandlers({ store, executor });
    const r = await h.previewTemplate({ params: { id: 't1' } });

    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty('issues');
  });

  it('aceita executor resolvido por fonte de dados', async () => {
    // permite conexões diferentes por tenant
    const vistos: string[] = [];
    const h = createRouteHandlers({
      store: memoryStore(),
      executor: (dataSourceId) => {
        vistos.push(dataSourceId);
        return executor;
      },
    });

    await h.previewTemplate({ params: { id: 't1' } });
    expect(vistos).toEqual(['ds1']);
  });
});
