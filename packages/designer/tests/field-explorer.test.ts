import { describe, it, expect } from 'vitest';
import type { DataSourceTree, Template } from '@treeport/schema';
import {
  describeTree,
  extractFieldsFromSql,
  fieldsInScope,
  fieldReference,
  fieldExpression,
  findNode,
  listDesignTabs,
  resolveDesign,
  resolveSubreportElement,
  nearestValidPath,
  samePath,
  DesignPathError,
  TemplateEditor,
  createEmptyTemplate,
  createElement,
} from '../src/index.js';

/** Árvore do Anexo D: Proposta > Oferta > (Taxas | Embalagens). */
function tree(): DataSourceTree {
  return {
    id: 'proposal',
    name: 'Proposta',
    parameters: [{ name: 'proposalId', type: 'int', nullable: false }],
    root: {
      id: 'PROPOSAL',
      name: 'Proposta',
      sql: 'SELECT * FROM proposal',
      fields: ['id', 'customer', 'number'],
      children: [
        {
          id: 'OFFER',
          name: 'Oferta',
          sql: 'SELECT * FROM offer',
          fields: ['id', 'route', 'modal'],
          linkFields: { parentField: 'id', childField: 'proposalId' },
          children: [
            {
              id: 'OFFER_FEE',
              name: 'Taxas',
              sql: 'SELECT * FROM fee',
              fields: ['id', 'name', 'amount'],
              linkFields: { parentField: 'id', childField: 'offerId' },
            },
          ],
        },
      ],
    },
  };
}

describe('describeTree', () => {
  it('espelha a hierarquia', () => {
    const root = describeTree(tree());

    expect(root.id).toBe('PROPOSAL');
    expect(root.children[0]!.id).toBe('OFFER');
    expect(root.children[0]!.children[0]!.id).toBe('OFFER_FEE');
  });

  it('usa os campos declarados no nó', () => {
    expect(describeTree(tree()).fields).toEqual(['id', 'customer', 'number']);
  });

  it('cai para a linha de amostra quando não há fields', () => {
    const t = tree();
    delete t.root.fields;
    t.root.sampleRow = { id: 1, cliente: 'Acme', total: 10 };

    expect(describeTree(t).fields).toEqual(['id', 'cliente', 'total']);
  });
});

describe('extractFieldsFromSql', () => {
  it('lê colunas listadas', () => {
    expect(extractFieldsFromSql('SELECT id, nome, valor FROM t')).toEqual([
      'id',
      'nome',
      'valor',
    ]);
  });

  it('usa o apelido do AS', () => {
    expect(extractFieldsFromSql('SELECT a.x AS codigo, b.y AS nome FROM t')).toEqual([
      'codigo',
      'nome',
    ]);
  });

  it('tira o prefixo da tabela', () => {
    expect(extractFieldsFromSql('SELECT p.numero, p.cliente FROM pedido p')).toEqual([
      'numero',
      'cliente',
    ]);
  });

  it('não inventa nada com SELECT *', () => {
    // devolver uma lista errada seria pior que vazia: o usuário confiaria
    // num nome que não existe
    expect(extractFieldsFromSql('SELECT * FROM t')).toEqual([]);
  });

  it('ignora expressão sem apelido, mas mantém as com', () => {
    const fields = extractFieldsFromSql(
      "SELECT id, SUM(valor), COALESCE(x, 0) AS total FROM t",
    );
    expect(fields).toEqual(['id', 'total']);
  });

  it('não se perde com vírgula dentro de função', () => {
    expect(extractFieldsFromSql("SELECT COALESCE(a, b) AS x, y FROM t")).toEqual(['x', 'y']);
  });

  it('não se perde com vírgula dentro de literal', () => {
    expect(extractFieldsFromSql("SELECT 'a, b' AS texto, id FROM t")).toEqual(['texto', 'id']);
  });

  it('devolve vazio quando não há SELECT', () => {
    expect(extractFieldsFromSql('EXEC minha_procedure')).toEqual([]);
  });
});

describe('fieldsInScope', () => {
  it('inclui os campos do nó e dos ancestrais', () => {
    const root = describeTree(tree());
    const scope = fieldsInScope(root, 'OFFER_FEE');

    expect(scope.filter((f) => f.depth === 0).map((f) => f.name)).toContain('amount');
    expect(scope.filter((f) => f.depth === 1).map((f) => f.name)).toContain('route');
    expect(scope.filter((f) => f.depth === 2).map((f) => f.name)).toContain('customer');
  });

  it('a raiz só enxerga os próprios campos', () => {
    const scope = fieldsInScope(describeTree(tree()), 'PROPOSAL');
    expect(scope.every((f) => f.depth === 0)).toBe(true);
  });

  it('nó inexistente devolve vazio', () => {
    expect(fieldsInScope(describeTree(tree()), 'NAO_EXISTE')).toEqual([]);
  });
});

describe('fieldReference', () => {
  it('campo da linha atual vai sem prefixo', () => {
    expect(fieldReference({ name: 'amount', nodeId: 'F', depth: 0 })).toBe('amount');
  });

  it('campo do pai leva parent.', () => {
    expect(fieldReference({ name: 'route', nodeId: 'O', depth: 1 })).toBe('parent.route');
  });

  it('campo do avô leva parent.parent.', () => {
    expect(fieldReference({ name: 'customer', nodeId: 'P', depth: 2 })).toBe(
      'parent.parent.customer',
    );
  });

  it('a versão para Label já vem com as chaves', () => {
    expect(fieldExpression({ name: 'x', nodeId: 'N', depth: 1 })).toBe('{{parent.x}}');
  });
});

describe('findNode', () => {
  it('acha em qualquer profundidade', () => {
    const root = describeTree(tree());
    expect(findNode(root, 'OFFER_FEE')?.name).toBe('Taxas');
    expect(findNode(root, 'INEXISTENTE')).toBeUndefined();
  });
});

// --- abas de subreport (9.5) ------------------------------------------------

/** Template com subreport de 2 níveis. */
function nestedTemplate(): Template {
  return {
    id: 't',
    name: 'T',
    boundDataSourceNodeId: 'PROPOSAL',
    pageSize: 'A4',
    bands: {
      details: {
        height: 100,
        elements: [
          {
            id: 'sub-offer',
            type: 'subreport',
            x: 0,
            y: 0,
            width: 400,
            height: 60,
            dataSourceNodeId: 'OFFER',
            template: {
              details: {
                height: 40,
                elements: [
                  {
                    id: 'sub-fee',
                    type: 'subreport',
                    x: 0,
                    y: 0,
                    width: 380,
                    height: 20,
                    dataSourceNodeId: 'OFFER_FEE',
                    template: { details: { height: 14, elements: [] } },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  };
}

describe('navegação entre designs', () => {
  it('caminho vazio é o design principal', () => {
    const bands = resolveDesign(nestedTemplate(), []);
    expect(bands.details.elements[0]!.id).toBe('sub-offer');
  });

  it('desce um nível', () => {
    const bands = resolveDesign(nestedTemplate(), ['sub-offer']);
    expect(bands.details.elements[0]!.id).toBe('sub-fee');
  });

  it('desce dois níveis', () => {
    const bands = resolveDesign(nestedTemplate(), ['sub-offer', 'sub-fee']);
    expect(bands.details.height).toBe(14);
  });

  it('caminho inválido dá erro explicando qual', () => {
    expect(() => resolveDesign(nestedTemplate(), ['nao-existe'])).toThrow(DesignPathError);
    expect(() => resolveDesign(nestedTemplate(), ['nao-existe'])).toThrow(/nao-existe/);
  });

  it('devolve o elemento de subreport do caminho', () => {
    const el = resolveSubreportElement(nestedTemplate(), ['sub-offer']);
    expect(el?.dataSourceNodeId).toBe('OFFER');
  });

  it('lista uma aba por design, em pré-ordem', () => {
    const tabs = listDesignTabs(nestedTemplate());

    expect(tabs.map((t) => t.label)).toEqual(['Principal', 'OFFER', 'OFFER_FEE']);
    expect(tabs.map((t) => t.depth)).toEqual([0, 1, 2]);
  });

  it('samePath compara caminhos', () => {
    expect(samePath(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(samePath(['a'], ['a', 'b'])).toBe(false);
  });

  it('nearestValidPath sobe até um caminho que ainda existe', () => {
    const template = nestedTemplate();
    // o design do neto some se o pai for removido
    template.bands.details.elements = [];

    expect(nearestValidPath(template, ['sub-offer', 'sub-fee'])).toEqual([]);
  });
});

describe('editar dentro de um subreport', () => {
  it('as operações valem no design aberto', () => {
    const editor = new TemplateEditor(nestedTemplate());
    editor.openDesign(['sub-offer']);

    editor.addElement('details', createElement('label', 10, 10));

    // entrou no design da oferta, não no principal
    expect(editor.band('details')!.elements).toHaveLength(2);
    expect(editor.template.bands.details.elements).toHaveLength(1);
  });

  it('voltar para a raiz mostra o design principal', () => {
    const editor = new TemplateEditor(nestedTemplate());

    editor.openDesign(['sub-offer']);
    expect(editor.band('details')!.height).toBe(40);

    editor.openDesign([]);
    expect(editor.band('details')!.height).toBe(100);
  });

  it('undo funciona dentro do subreport', () => {
    const editor = new TemplateEditor(nestedTemplate());
    editor.openDesign(['sub-offer', 'sub-fee']);

    editor.setBandHeight('details', 30);
    expect(editor.band('details')!.height).toBe(30);

    editor.undo();
    expect(editor.band('details')!.height).toBe(14);
  });

  it('abrir um caminho inválido não muda o design ativo', () => {
    const editor = new TemplateEditor(nestedTemplate());

    expect(() => editor.openDesign(['fantasma'])).toThrow(DesignPathError);
    expect(editor.designPath).toEqual([]);
  });

  it('apagar o subreport fecha a aba dele', () => {
    const editor = new TemplateEditor(nestedTemplate());
    editor.openDesign(['sub-offer']);

    editor.openDesign([]);
    editor.removeElement('sub-offer');

    expect(editor.designPath).toEqual([]);
  });

  it('criar um subreport cria uma aba nova', () => {
    const editor = new TemplateEditor(createEmptyTemplate());
    const id = editor.addElement(
      'details',
      createElement('subreport', 0, 0, { dataSourceNodeId: 'ITEM' } as never),
    );

    const tabs = listDesignTabs(editor.template);
    expect(tabs).toHaveLength(2);
    expect(tabs[1]!.path).toEqual([id]);
  });
});
