import { describe, it, expect } from 'vitest';
import type { Template } from '@treeport/schema';
import {
  highlight,
  suggest,
  applySuggestion,
  insertPlaceholder,
  isInsideExpression,
  wordAtCursor,
  validateSyntax,
  TreeportApiClient,
  ApiError,
  exportTemplate,
  importTemplate,
  type ExplorerField,
} from '../src/index.js';

const fields: ExplorerField[] = [
  { name: 'amount', nodeId: 'FEE', depth: 0 },
  { name: 'name', nodeId: 'FEE', depth: 0 },
  { name: 'route', nodeId: 'OFFER', depth: 1 },
  { name: 'customer', nodeId: 'PROPOSAL', depth: 2 },
];

// --- editor de expressão (9.6) ---------------------------------------------

describe('highlight', () => {
  it('separa literal de expressão', () => {
    const segs = highlight('Total: {{valor}}');

    expect(segs.map((s) => s.type)).toEqual(['text', 'delimiter', 'expression', 'delimiter']);
    expect(segs[2]!.text).toBe('valor');
  });

  it('texto sem expressão vira um segmento só', () => {
    expect(highlight('só texto')).toEqual([{ text: 'só texto', type: 'text' }]);
  });

  it('lida com várias expressões', () => {
    const segs = highlight('{{a}} e {{b}}');
    expect(segs.filter((s) => s.type === 'expression').map((s) => s.text)).toEqual(['a', 'b']);
  });

  it('preserva o texto original', () => {
    const texto = 'Antes {{x}} depois';
    expect(highlight(texto).map((s) => s.text).join('')).toBe(texto);
  });
});

describe('isInsideExpression', () => {
  it('detecta o cursor dentro das chaves', () => {
    //            0123456789
    const texto = 'a {{campo}} b';
    expect(isInsideExpression(texto, 6)).toBe(true);
    expect(isInsideExpression(texto, 1)).toBe(false);
    expect(isInsideExpression(texto, 12)).toBe(false);
  });

  it('expressão ainda não fechada conta como dentro', () => {
    expect(isInsideExpression('total: {{val', 12)).toBe(true);
  });
});

describe('wordAtCursor', () => {
  it('pega a palavra sendo digitada', () => {
    expect(wordAtCursor('{{amo', 5)).toEqual({ word: 'amo', start: 2 });
  });

  it('inclui o prefixo parent.', () => {
    expect(wordAtCursor('{{parent.ro', 11).word).toBe('parent.ro');
  });

  it('para em espaço e operador', () => {
    expect(wordAtCursor('{{a + bc', 8).word).toBe('bc');
  });
});

describe('suggest', () => {
  it('sugere campos do escopo', () => {
    const s = suggest('{{am', 4, { fields });
    expect(s.map((x) => x.insert)).toContain('amount');
  });

  it('campos do pai vêm com o prefixo parent.', () => {
    const s = suggest('{{rou', 5, { fields });
    expect(s.map((x) => x.insert)).toContain('parent.route');
  });

  it('campos do avô levam parent.parent.', () => {
    const s = suggest('{{cust', 6, { fields });
    expect(s.map((x) => x.insert)).toContain('parent.parent.customer');
  });

  it('sugere funções nativas', () => {
    const s = suggest('{{FOR', 5, { fields });
    expect(s.map((x) => x.insert)).toContain('FORMAT(');
  });

  it('aceita funções customizadas do host', () => {
    const s = suggest('{{PES', 5, { customFunctions: ['PESO_CUBADO'] });
    expect(s.map((x) => x.insert)).toContain('PESO_CUBADO(');
  });

  it('não sugere no texto literal', () => {
    // fora das chaves o usuário escreve prosa; uma lista aparecendo atrapalha
    expect(suggest('Total: am', 9, { fields })).toEqual([]);
  });

  it('alwaysSuggest ignora as chaves', () => {
    const s = suggest('am', 2, { fields, alwaysSuggest: true });
    expect(s.length).toBeGreaterThan(0);
  });

  it('campos vêm antes de funções', () => {
    const s = suggest('{{a', 3, { fields });
    expect(s[0]!.kind).toBe('field');
  });

  it('respeita o limite', () => {
    expect(suggest('{{', 2, { fields, alwaysSuggest: true, limit: 3 })).toHaveLength(3);
  });

  it('não oferece parent. quando não há ancestral', () => {
    const soLocal: ExplorerField[] = [{ name: 'x', nodeId: 'N', depth: 0 }];
    const s = suggest('{{par', 5, { fields: soLocal });
    expect(s.map((x) => x.insert)).not.toContain('parent.');
  });
});

describe('applySuggestion', () => {
  it('substitui a palavra parcial', () => {
    const r = applySuggestion('{{am}}', 4, {
      insert: 'amount',
      label: 'amount',
      kind: 'field',
    });

    expect(r.text).toBe('{{amount}}');
    expect(r.cursor).toBe(8);
  });

  it('funciona no meio de uma expressão maior', () => {
    const r = applySuggestion('{{a + rou}}', 9, {
      insert: 'parent.route',
      label: 'parent.route',
      kind: 'field',
    });

    expect(r.text).toBe('{{a + parent.route}}');
  });
});

describe('insertPlaceholder', () => {
  it('insere as chaves e põe o cursor no meio', () => {
    const r = insertPlaceholder('Total: ', 7);
    expect(r.text).toBe('Total: {{}}');
    expect(r.cursor).toBe(9);
  });

  it('aceita conteúdo inicial', () => {
    expect(insertPlaceholder('', 0, 'valor').text).toBe('{{valor}}');
  });
});

describe('validateSyntax', () => {
  it('texto correto não acusa nada', () => {
    expect(validateSyntax("{{IF(a > 1, 'x', 'y')}}")).toEqual([]);
  });

  it('acusa chave não fechada', () => {
    expect(validateSyntax('{{valor')[0]).toMatch(/Falta fechar/);
  });

  it('acusa fechamento sem abertura', () => {
    expect(validateSyntax('valor}}')[0]).toMatch(/sem "\{\{"/);
  });

  it('acusa parênteses desbalanceados', () => {
    expect(validateSyntax('{{IF(a, 1, 2}}')[0]).toMatch(/Parênteses/);
  });

  it('acusa aspas não fechadas', () => {
    expect(validateSyntax("{{'texto}}")[0]).toMatch(/Aspas/);
  });

  it('acusa expressão vazia', () => {
    expect(validateSyntax('{{}}')[0]).toMatch(/vazia/);
  });

  it('texto sem expressão nenhuma é válido', () => {
    expect(validateSyntax('apenas texto')).toEqual([]);
  });
});

// --- cliente HTTP (9.7) -----------------------------------------------------

function template(): Template {
  return {
    id: 't1',
    name: 'T',
    boundDataSourceNodeId: 'N',
    pageSize: 'A4',
    bands: { details: { height: 20, elements: [] } },
  };
}

/** fetch falso que registra as chamadas. */
function fakeFetch(response: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];

  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
      text: async () => JSON.stringify(response),
      blob: async () => new Blob([JSON.stringify(response)]),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

describe('TreeportApiClient', () => {
  it('monta a URL do contrato', async () => {
    const { impl, calls } = fakeFetch([]);
    await new TreeportApiClient({ baseUrl: '/api', fetch: impl }).listDataSources();

    expect(calls[0]!.url).toBe('/api/report-data-sources');
  });

  it('remove a barra final da base', async () => {
    const { impl, calls } = fakeFetch([]);
    await new TreeportApiClient({ baseUrl: '/api/', fetch: impl }).listDataSources();

    expect(calls[0]!.url).toBe('/api/report-data-sources');
  });

  it('passa o dataSourceId como query', async () => {
    const { impl, calls } = fakeFetch([]);
    await new TreeportApiClient({ baseUrl: '/api', fetch: impl }).listTemplates('arvore 1');

    expect(calls[0]!.url).toContain('dataSourceId=arvore%201');
  });

  it('escapa o id na URL', async () => {
    const { impl, calls } = fakeFetch(template());
    await new TreeportApiClient({ baseUrl: '/api', fetch: impl }).getTemplate('a/b');

    expect(calls[0]!.url).toBe('/api/report-templates/a%2Fb');
  });

  it('cria com POST e atualiza com PUT', async () => {
    const { impl, calls } = fakeFetch(template());
    const client = new TreeportApiClient({ baseUrl: '/api', fetch: impl });

    await client.createTemplate(template());
    await client.updateTemplate(template());

    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[1]!.init.method).toBe('PUT');
    expect(calls[1]!.url).toBe('/api/report-templates/t1');
  });

  it('manda cabeçalhos fixos', async () => {
    const { impl, calls } = fakeFetch([]);
    await new TreeportApiClient({
      baseUrl: '/api',
      fetch: impl,
      headers: { Authorization: 'Bearer x' },
    }).listDataSources();

    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer x');
  });

  it('resolve cabeçalhos por função a cada chamada', async () => {
    // o token expira; congelar na inicialização quebraria depois de um tempo
    let token = 'primeiro';
    const { impl, calls } = fakeFetch([]);
    const client = new TreeportApiClient({
      baseUrl: '/api',
      fetch: impl,
      headers: () => ({ Authorization: token }),
    });

    await client.listDataSources();
    token = 'segundo';
    await client.listDataSources();

    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('primeiro');
    expect((calls[1]!.init.headers as Record<string, string>)['Authorization']).toBe('segundo');
  });

  it('erro HTTP vira ApiError com status e URL', async () => {
    const { impl } = fakeFetch({ error: 'não achei' }, 404);
    const client = new TreeportApiClient({ baseUrl: '/api', fetch: impl });

    await expect(client.getTemplate('x')).rejects.toBeInstanceOf(ApiError);
    await expect(client.getTemplate('x')).rejects.toThrow(/404/);
  });

  it('preview devolve um Blob', async () => {
    const { impl, calls } = fakeFetch('%PDF-1.7');
    const blob = await new TreeportApiClient({ baseUrl: '/api', fetch: impl }).preview('t1');

    expect(blob).toBeInstanceOf(Blob);
    expect(calls[0]!.url).toBe('/api/report-templates/t1/preview');
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('preview manda o template atual, para ver mudanças não salvas', async () => {
    const { impl, calls } = fakeFetch('%PDF-1.7');
    await new TreeportApiClient({ baseUrl: '/api', fetch: impl }).preview('t1', template());

    expect(JSON.parse(calls[0]!.init.body as string)).toHaveProperty('template.id', 't1');
  });
});

describe('importar e exportar', () => {
  it('ida e volta preserva o template', () => {
    const original = template();
    expect(importTemplate(exportTemplate(original))).toEqual(original);
  });

  it('exporta formatado, para versionar em Git', () => {
    expect(exportTemplate(template())).toContain('\n');
  });

  it('JSON inválido dá erro claro', () => {
    expect(() => importTemplate('{ nada')).toThrow(/não é um JSON válido/);
  });

  it('objeto sem bands é recusado', () => {
    expect(() => importTemplate('{"id":"x"}')).toThrow(/bands/);
  });

  it('sem a banda details é recusado', () => {
    expect(() => importTemplate('{"bands":{}}')).toThrow(/details/);
  });

  it('completa o que falta com defaults', () => {
    const t = importTemplate('{"bands":{"details":{"height":20,"elements":[]}}}');

    expect(t.pageSize).toBe('A4');
    expect(t.id).toBeTruthy();
  });
});
