import { describe, it, expect, vi } from 'vitest';
import type { DataSourceTree, Template } from '@treeport/schema';
import {
  generate,
  readControlFields,
  stripControlFields,
  MemoryExecutor,
  ReportBlockedError,
  TemplateRegistry,
  TemplateNotFoundError,
  resolveTemplate,
} from '../src/index.js';
import { inspectPdf } from './helpers/pdf-inspect.js';

/**
 * Fase 7 — campos de controle (Anexo A) e tags de contexto (Anexo B).
 */

const SQL = 'SELECT * FROM doc WHERE id = :docId';

function tree(): DataSourceTree {
  return {
    id: 'doc-tree',
    name: 'Documento',
    parameters: [{ name: 'docId', type: 'int', nullable: false, testValue: 1 }],
    root: { id: 'DOC', name: 'Documento', sql: SQL },
  };
}

/** Template mínimo, identificável pelo texto que imprime. */
function template(id: string, marca: string): Template {
  return {
    id,
    name: id,
    boundDataSourceNodeId: 'DOC',
    pageSize: 'A4',
    bands: {
      details: {
        height: 20,
        elements: [
          { id: 'l', type: 'label', x: 0, y: 0, width: 400, height: 14, content: marca },
        ],
      },
    },
  };
}

const executorWith = (row: Record<string, unknown>): MemoryExecutor =>
  new MemoryExecutor().on(SQL, [row]);

describe('readControlFields', () => {
  it('separa os campos de controle dos de negócio', () => {
    const control = readControlFields({
      cliente: 'Acme',
      __templateId: 'compacto',
      __arquivo: 'nota-123.pdf',
    });

    expect(control.templateId).toBe('compacto');
    expect(control.all).toEqual({ templateId: 'compacto', arquivo: 'nota-123.pdf' });
  });

  it('linha sem campos de controle não bloqueia nada', () => {
    const control = readControlFields({ cliente: 'Acme' });

    expect(control.blocked).toBe(false);
    expect(control.templateId).toBeUndefined();
    expect(control.all).toEqual({});
  });

  it('entende booleano do jeito que cada banco devolve', () => {
    expect(readControlFields({ __block: true }).blocked).toBe(true);
    expect(readControlFields({ __block: 1 }).blocked).toBe(true);
    expect(readControlFields({ __block: 'S' }).blocked).toBe(true);
    expect(readControlFields({ __block: 'sim' }).blocked).toBe(true);

    expect(readControlFields({ __block: false }).blocked).toBe(false);
    expect(readControlFields({ __block: 0 }).blocked).toBe(false);
    expect(readControlFields({ __block: 'N' }).blocked).toBe(false);
    expect(readControlFields({ __block: null }).blocked).toBe(false);
  });

  it('aceita prefixo customizado', () => {
    const control = readControlFields({ 'ctl$templateId': 'x' }, 'ctl$');
    expect(control.templateId).toBe('x');
  });

  it('__templateId vazio é o mesmo que ausente', () => {
    expect(readControlFields({ __templateId: '' }).templateId).toBeUndefined();
    expect(readControlFields({ __templateId: null }).templateId).toBeUndefined();
  });

  it('linha indefinida não quebra', () => {
    expect(readControlFields(undefined).blocked).toBe(false);
  });
});

describe('stripControlFields', () => {
  it('remove só o que tem o prefixo', () => {
    expect(stripControlFields({ a: 1, __b: 2, c: 3 })).toEqual({ a: 1, c: 3 });
  });
});

describe('__block: bloqueio da geração', () => {
  it('interrompe com a mensagem da query', async () => {
    const executor = executorWith({
      id: 1,
      __block: true,
      __blockMessage: 'Informe o Incoterm antes de emitir a proposta.',
    });

    await expect(
      generate(tree(), [template('t', 'x')], executor, { parameters: { docId: 1 } }),
    ).rejects.toThrow('Informe o Incoterm antes de emitir a proposta.');
  });

  it('lança ReportBlockedError com a linha que causou', async () => {
    const executor = executorWith({ id: 1, cliente: 'Acme', __block: 1, __blockMessage: 'Falta anexo' });

    try {
      await generate(tree(), [template('t', 'x')], executor, { parameters: { docId: 1 } });
      expect.unreachable('deveria ter bloqueado');
    } catch (err) {
      expect(err).toBeInstanceOf(ReportBlockedError);
      expect((err as ReportBlockedError).row['cliente']).toBe('Acme');
    }
  });

  it('bloqueio sem mensagem ainda dá um erro compreensível', async () => {
    const executor = executorWith({ id: 1, __block: true });

    await expect(
      generate(tree(), [template('t', 'x')], executor, { parameters: { docId: 1 } }),
    ).rejects.toThrow(/bloqueada pela consulta/);
  });

  it('não chama onGenerated quando bloqueia', async () => {
    const onGenerated = vi.fn();
    const executor = executorWith({ id: 1, __block: true, __blockMessage: 'não' });

    await expect(
      generate(tree(), [template('t', 'x')], executor, {
        parameters: { docId: 1 },
        onGenerated,
      }),
    ).rejects.toBeInstanceOf(ReportBlockedError);

    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('__block false gera normalmente', async () => {
    const executor = executorWith({ id: 1, __block: false });

    const result = await generate(tree(), [template('t', 'OK')], executor, {
      parameters: { docId: 1 },
    });

    expect((await inspectPdf(result.pdf)).text).toContain('OK');
  });
});

describe('__templateId: escolha do template pela query', () => {
  const templates = [template('completo', 'LAYOUT COMPLETO'), template('compacto', 'LAYOUT COMPACTO')];

  it('usa o template calculado pela query', async () => {
    const executor = executorWith({ id: 1, __templateId: 'compacto' });

    const result = await generate(tree(), templates, executor, { parameters: { docId: 1 } });

    expect(result.template.id).toBe('compacto');
    expect((await inspectPdf(result.pdf)).text).toContain('LAYOUT COMPACTO');
  });

  it('o templateId explícito tem prioridade sobre o calculado', async () => {
    const executor = executorWith({ id: 1, __templateId: 'compacto' });

    const result = await generate(tree(), templates, executor, {
      parameters: { docId: 1 },
      templateId: 'completo',
    });

    expect(result.template.id).toBe('completo');
    expect((await inspectPdf(result.pdf)).text).toContain('LAYOUT COMPLETO');
  });

  it('com um template só, nem precisa informar', async () => {
    const executor = executorWith({ id: 1 });

    const result = await generate(tree(), [template('unico', 'UNICO')], executor, {
      parameters: { docId: 1 },
    });

    expect(result.template.id).toBe('unico');
  });

  it('template calculado inexistente diz que veio da query', async () => {
    const executor = executorWith({ id: 1, __templateId: 'nao-existe' });

    await expect(
      generate(tree(), templates, executor, { parameters: { docId: 1 } }),
    ).rejects.toThrow(/__templateId/);
  });

  it('vários templates sem escolha é erro claro', async () => {
    const executor = executorWith({ id: 1 });

    await expect(
      generate(tree(), templates, executor, { parameters: { docId: 1 } }),
    ).rejects.toThrow(/mais de um template/);
  });
});

describe('onGenerated', () => {
  it('recebe a linha inteira e o PDF', async () => {
    const executor = executorWith({
      id: 1,
      cliente: 'Acme',
      __arquivo: 'proposta-1.pdf',
      __destino: 'anexos',
    });

    let capturada: Record<string, unknown> | undefined;
    let bytes = 0;

    await generate(tree(), [template('t', 'x')], executor, {
      parameters: { docId: 1 },
      onGenerated: (row, pdf) => {
        capturada = row;
        bytes = pdf.byteLength;
      },
    });

    // a linha chega COM os campos de controle: é assim que a aplicação
    // hospedeira decide o nome do arquivo e onde anexar
    expect(capturada?.['cliente']).toBe('Acme');
    expect(capturada?.['__arquivo']).toBe('proposta-1.pdf');
    expect(capturada?.['__destino']).toBe('anexos');
    expect(bytes).toBeGreaterThan(500);
  });

  it('espera o hook assíncrono terminar', async () => {
    const executor = executorWith({ id: 1 });
    let terminou = false;

    await generate(tree(), [template('t', 'x')], executor, {
      parameters: { docId: 1 },
      onGenerated: async () => {
        await new Promise((r) => setTimeout(r, 10));
        terminou = true;
      },
    });

    expect(terminou).toBe(true);
  });

  it('erro no hook sobe para o chamador', async () => {
    const executor = executorWith({ id: 1 });

    await expect(
      generate(tree(), [template('t', 'x')], executor, {
        parameters: { docId: 1 },
        onGenerated: () => {
          throw new Error('falha ao anexar');
        },
      }),
    ).rejects.toThrow('falha ao anexar');
  });

  it('sem linhas no master, o hook não é chamado', async () => {
    const onGenerated = vi.fn();
    const executor = new MemoryExecutor().on(SQL, []);

    await generate(tree(), [template('t', 'x')], executor, {
      parameters: { docId: 1 },
      onGenerated,
    });

    expect(onGenerated).not.toHaveBeenCalled();
  });
});

describe('TemplateRegistry e contextos', () => {
  function comContexto(id: string, tags: string[]): Template {
    return {
      ...template(id, id),
      dataSourceId: 'doc-tree',
      contexts: tags.map((contextTag) => ({ contextTag })),
    };
  }

  it('filtra templates por tag de contexto', () => {
    const registry = new TemplateRegistry([
      comContexto('a', ['proposta.imprimir']),
      comContexto('b', ['proposta.imprimir', 'proposta.email']),
      comContexto('c', ['pedido.imprimir']),
    ]);

    expect(registry.listForContext('proposta.imprimir').map((t) => t.id)).toEqual(['a', 'b']);
    expect(registry.listForContext('pedido.imprimir').map((t) => t.id)).toEqual(['c']);
    expect(registry.listForContext('inexistente')).toEqual([]);
  });

  it('lista os templates de uma árvore de dados (aba Modelos)', () => {
    const registry = new TemplateRegistry([
      comContexto('a', []),
      { ...template('outro', 'x'), dataSourceId: 'outra-arvore' },
    ]);

    expect(registry.listForDataSource('doc-tree').map((t) => t.id)).toEqual(['a']);
  });

  it('devolve os defaults de parâmetro daquele contexto', () => {
    const registry = new TemplateRegistry([
      {
        ...template('a', 'x'),
        contexts: [
          { contextTag: 'proposta.imprimir', parameterDefaults: { via: 'cliente' } },
          { contextTag: 'proposta.email', parameterDefaults: { via: 'email' } },
        ],
      },
    ]);

    expect(registry.parameterDefaultsFor('a', 'proposta.imprimir')).toEqual({ via: 'cliente' });
    expect(registry.parameterDefaultsFor('a', 'proposta.email')).toEqual({ via: 'email' });
    expect(registry.parameterDefaultsFor('a', 'outro')).toBeUndefined();
  });

  it('lista todas as tags distintas', () => {
    const registry = new TemplateRegistry([
      comContexto('a', ['x', 'y']),
      comContexto('b', ['y', 'z']),
    ]);

    expect(registry.listContextTags()).toEqual(['x', 'y', 'z']);
  });

  it('add substitui um template do mesmo id', () => {
    const registry = new TemplateRegistry([template('a', 'velho')]);
    registry.add(template('a', 'novo'));

    expect(registry.size).toBe(1);
    expect(registry.get('a')?.bands.details.elements).toHaveLength(1);
  });

  it('remove tira do registro', () => {
    const registry = new TemplateRegistry([template('a', 'x')]);
    expect(registry.remove('a')).toBe(true);
    expect(registry.has('a')).toBe(false);
  });
});

describe('resolveTemplate', () => {
  const registry = new TemplateRegistry([template('a', 'A'), template('b', 'B')]);

  it('explícito ganha do calculado', () => {
    expect(resolveTemplate(registry, { explicitId: 'a', calculatedId: 'b' }).id).toBe('a');
  });

  it('usa o calculado quando não há explícito', () => {
    expect(resolveTemplate(registry, { calculatedId: 'b' }).id).toBe('b');
  });

  it('registro vazio é erro claro', () => {
    expect(() => resolveTemplate(new TemplateRegistry(), {})).toThrow(TemplateNotFoundError);
  });

  it('o erro lista os templates disponíveis', () => {
    expect(() => resolveTemplate(registry, { explicitId: 'zzz' })).toThrow(/a, b/);
  });
});
