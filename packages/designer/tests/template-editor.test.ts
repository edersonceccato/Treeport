import { describe, it, expect, vi } from 'vitest';
import type { LabelElement, Template } from '@treeport/schema';
import {
  TemplateEditor,
  createEmptyTemplate,
  createElement,
  PALETTE,
  paletteItem,
} from '../src/index.js';

/**
 * A lógica de edição é testada SEM DOM — é o ponto de manter o modelo
 * separado da UI (sub-fase 9.2 do brief).
 */

const label = (id: string, x = 0, y = 0): LabelElement => ({
  id,
  type: 'label',
  x,
  y,
  width: 100,
  height: 16,
  content: 'Texto',
});

function editorWith(...elements: LabelElement[]): TemplateEditor {
  const editor = new TemplateEditor(createEmptyTemplate());
  for (const element of elements) editor.addElement('details', element);
  return editor;
}

describe('createEmptyTemplate', () => {
  it('nasce com as três bandas', () => {
    const t = createEmptyTemplate();
    expect(t.bands.header).toBeDefined();
    expect(t.bands.details).toBeDefined();
    expect(t.bands.footer).toBeDefined();
  });

  it('aceita sobrescrever propriedades', () => {
    const t = createEmptyTemplate({ name: 'Meu relatório', pageSize: 'Letter' });
    expect(t.name).toBe('Meu relatório');
    expect(t.pageSize).toBe('Letter');
  });
});

describe('adicionar e remover', () => {
  it('adiciona um elemento à banda', () => {
    const editor = new TemplateEditor(createEmptyTemplate());
    editor.addElement('details', label('a'));

    expect(editor.band('details')!.elements).toHaveLength(1);
    expect(editor.element('a')).toBeDefined();
  });

  it('gera id único quando colide', () => {
    const editor = editorWith(label('titulo'));
    const id = editor.addElement('details', label('titulo'));

    expect(id).toBe('titulo-2');
    expect(editor.band('details')!.elements).toHaveLength(2);
  });

  it('remove pelo id', () => {
    const editor = editorWith(label('a'), label('b'));

    expect(editor.removeElement('a')).toBe(true);
    expect(editor.element('a')).toBeUndefined();
    expect(editor.element('b')).toBeDefined();
  });

  it('remover inexistente devolve false', () => {
    expect(editorWith().removeElement('fantasma')).toBe(false);
  });

  it('acha elemento em qualquer banda', () => {
    const editor = new TemplateEditor(createEmptyTemplate());
    editor.addElement('header', label('h'));
    editor.addElement('footer', label('f'));

    expect(editor.locate('h')?.band).toBe('header');
    expect(editor.locate('f')?.band).toBe('footer');
  });
});

describe('mover e redimensionar', () => {
  it('move para posição absoluta', () => {
    const editor = editorWith(label('a'));
    editor.moveElement('a', 50, 30);

    expect(editor.element('a')).toMatchObject({ x: 50, y: 30 });
  });

  it('redimensiona', () => {
    const editor = editorWith(label('a'));
    editor.resizeElement('a', 200, 40);

    expect(editor.element('a')).toMatchObject({ width: 200, height: 40 });
  });

  it('não deixa o elemento sumir com tamanho zero ou negativo', () => {
    const editor = editorWith(label('a'));
    editor.resizeElement('a', -10, 0);

    const element = editor.element('a')!;
    expect(element.width).toBeGreaterThan(0);
    expect(element.height).toBeGreaterThan(0);
  });
});

describe('atualizar propriedades', () => {
  it('aplica patch parcial', () => {
    const editor = editorWith(label('a'));
    editor.updateElement('a', { content: 'Novo' } as Partial<LabelElement>);

    expect((editor.element('a') as LabelElement).content).toBe('Novo');
    // o resto continua intacto
    expect(editor.element('a')!.width).toBe(100);
  });

  it('não deixa trocar o tipo por patch', () => {
    // trocar o tipo exige recriar o elemento; senão sobrariam campos do
    // tipo antigo misturados com os do novo
    const editor = editorWith(label('a'));
    editor.updateElement('a', { type: 'rect' } as never);

    expect(editor.element('a')!.type).toBe('label');
  });

  it('estilo é mesclado, não substituído', () => {
    const editor = editorWith(label('a'));
    editor.updateStyle('a', { fontSize: 14 });
    editor.updateStyle('a', { bold: true });

    expect(editor.element('a')!.style).toMatchObject({ fontSize: 14, bold: true });
  });
});

describe('bandas', () => {
  it('muda a altura', () => {
    const editor = new TemplateEditor(createEmptyTemplate());
    editor.setBandHeight('details', 80);

    expect(editor.band('details')!.height).toBe(80);
  });

  it('cria e remove header/footer', () => {
    const editor = new TemplateEditor(createEmptyTemplate());

    editor.toggleBand('header', false);
    expect(editor.band('header')).toBeUndefined();

    editor.toggleBand('header', true);
    expect(editor.band('header')).toBeDefined();
  });

  it('lista as bandas na ordem de desenho', () => {
    const editor = new TemplateEditor(createEmptyTemplate());
    expect(editor.bands().map((b) => b.name)).toEqual(['header', 'details', 'footer']);
  });
});

describe('undo / redo', () => {
  it('desfaz a última ação', () => {
    const editor = editorWith(label('a'));
    editor.moveElement('a', 99, 99);

    expect(editor.undo()).toBe(true);
    expect(editor.element('a')).toMatchObject({ x: 0, y: 0 });
  });

  it('refaz depois de desfazer', () => {
    const editor = editorWith(label('a'));
    editor.moveElement('a', 99, 99);
    editor.undo();

    expect(editor.redo()).toBe(true);
    expect(editor.element('a')).toMatchObject({ x: 99, y: 99 });
  });

  it('desfaz várias ações em sequência', () => {
    const editor = editorWith(label('a'));
    editor.moveElement('a', 10, 10);
    editor.moveElement('a', 20, 20);
    editor.moveElement('a', 30, 30);

    editor.undo();
    expect(editor.element('a')).toMatchObject({ x: 20, y: 20 });
    editor.undo();
    expect(editor.element('a')).toMatchObject({ x: 10, y: 10 });
  });

  it('desfaz a criação de um elemento', () => {
    const editor = editorWith();
    editor.addElement('details', label('novo'));

    editor.undo();
    expect(editor.element('novo')).toBeUndefined();
  });

  it('uma ação nova descarta o caminho de redo', () => {
    const editor = editorWith(label('a'));
    editor.moveElement('a', 10, 10);
    editor.undo();

    editor.moveElement('a', 50, 50);

    expect(editor.canRedo).toBe(false);
  });

  it('um arrasto inteiro é UM passo de desfazer', () => {
    // sem agrupamento, arrastar 40px viraria 40 undos e desfazer devolveria
    // o elemento um pixel por vez
    const editor = editorWith(label('a'));

    editor.beginBatch();
    for (const x of [5, 10, 15, 20, 25]) editor.moveElement('a', x, 0);
    editor.endBatch();

    editor.undo();
    expect(editor.element('a')).toMatchObject({ x: 0 });
  });

  it('cada arrasto novo é um passo separado', () => {
    const editor = editorWith(label('a'));

    editor.beginBatch();
    editor.moveElement('a', 10, 0);
    editor.moveElement('a', 20, 0);
    editor.endBatch();

    editor.beginBatch();
    editor.moveElement('a', 50, 0);
    editor.endBatch();

    editor.undo();
    expect(editor.element('a')).toMatchObject({ x: 20 });
    editor.undo();
    expect(editor.element('a')).toMatchObject({ x: 0 });
  });

  it('undo sem histórico devolve false', () => {
    expect(new TemplateEditor(createEmptyTemplate()).undo()).toBe(false);
  });

  it('respeita o limite de histórico', () => {
    const editor = new TemplateEditor(createEmptyTemplate(), { historyLimit: 3 });
    editor.addElement('details', label('a'));

    for (let i = 0; i < 10; i += 1) editor.moveElement('a', i, i);

    let desfeitas = 0;
    while (editor.undo()) desfeitas += 1;

    expect(desfeitas).toBe(3);
  });

  it('avisa a UI a cada mudança', () => {
    const onChange = vi.fn();
    const editor = new TemplateEditor(createEmptyTemplate(), { onChange });

    editor.addElement('details', label('a'));
    editor.moveElement('a', 5, 5);

    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('isolamento do estado', () => {
  it('mutar o template devolvido não afeta o editor', () => {
    const editor = editorWith(label('a'));

    const copia = editor.template;
    copia.bands.details.elements[0]!.x = 999;

    expect(editor.element('a')!.x).toBe(0);
  });

  it('mutar o template original não afeta o editor', () => {
    const original: Template = createEmptyTemplate();
    const editor = new TemplateEditor(original);

    original.name = 'ALTERADO';

    expect(editor.template.name).toBe('Novo relatório');
  });
});

describe('ordem de desenho (z-order)', () => {
  it('traz para a frente', () => {
    const editor = editorWith(label('a'), label('b'), label('c'));
    editor.bringToFront('a');

    expect(editor.band('details')!.elements.map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('envia para trás', () => {
    const editor = editorWith(label('a'), label('b'), label('c'));
    editor.sendToBack('c');

    expect(editor.band('details')!.elements.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('alinhamento', () => {
  it('alinha à esquerda pelo mais à esquerda', () => {
    const editor = editorWith(label('a', 10), label('b', 50), label('c', 30));
    editor.align(['a', 'b', 'c'], 'left');

    expect([editor.element('a')!.x, editor.element('b')!.x, editor.element('c')!.x]).toEqual([
      10, 10, 10,
    ]);
  });

  it('alinha à direita pela borda direita mais extrema', () => {
    const editor = editorWith(label('a', 10), label('b', 50));
    editor.align(['a', 'b'], 'right');

    // ambos terminam em 150 (50 + 100 de largura)
    expect(editor.element('a')!.x + editor.element('a')!.width).toBe(150);
    expect(editor.element('b')!.x + editor.element('b')!.width).toBe(150);
  });

  it('alinha ao topo', () => {
    const editor = editorWith(label('a', 0, 20), label('b', 0, 60));
    editor.align(['a', 'b'], 'top');

    expect(editor.element('a')!.y).toBe(20);
    expect(editor.element('b')!.y).toBe(20);
  });

  it('centraliza horizontalmente entre si', () => {
    const editor = editorWith(label('a', 0), label('b', 100));
    editor.align(['a', 'b'], 'center');

    const centroA = editor.element('a')!.x + editor.element('a')!.width / 2;
    const centroB = editor.element('b')!.x + editor.element('b')!.width / 2;
    expect(centroA).toBeCloseTo(centroB, 5);
  });

  it('precisa de pelo menos dois elementos', () => {
    const editor = editorWith(label('a'));
    expect(editor.align(['a'], 'left')).toBe(false);
  });
});

describe('distribuição', () => {
  it('espaça igualmente na horizontal', () => {
    const editor = editorWith(label('a', 0), label('b', 30), label('c', 300));
    editor.distribute(['a', 'b', 'c'], 'horizontal');

    // o do meio vai para o ponto médio entre os extremos
    expect(editor.element('b')!.x).toBe(150);
  });

  it('mantém os extremos no lugar', () => {
    const editor = editorWith(label('a', 0), label('b', 30), label('c', 300));
    editor.distribute(['a', 'b', 'c'], 'horizontal');

    expect(editor.element('a')!.x).toBe(0);
    expect(editor.element('c')!.x).toBe(300);
  });

  it('precisa de pelo menos três elementos', () => {
    const editor = editorWith(label('a'), label('b'));
    expect(editor.distribute(['a', 'b'], 'horizontal')).toBe(false);
  });
});

describe('exportar', () => {
  it('gera JSON legível', () => {
    const editor = editorWith(label('a'));
    const json = editor.toJSON();

    expect(JSON.parse(json).bands.details.elements[0].id).toBe('a');
    expect(json).toContain('\n'); // formatado, não minificado
  });
});

describe('paleta', () => {
  it('tem um item por tipo desenhável', () => {
    expect(PALETTE.map((p) => p.type)).toContain('label');
    expect(PALETTE.map((p) => p.type)).toContain('barcode');
    expect(PALETTE.map((p) => p.type)).toContain('subreport');
  });

  it('cria elemento com os campos obrigatórios do tipo', () => {
    const barcode = createElement('barcode', 10, 20);

    expect(barcode).toMatchObject({ type: 'barcode', x: 10, y: 20, format: 'code128' });
    expect(barcode).toHaveProperty('valueExpression');
  });

  it('usa o tamanho padrão do tipo', () => {
    const qr = createElement('qrcode', 0, 0);
    const item = paletteItem('qrcode')!;

    expect(qr.width).toBe(item.defaultWidth);
    // QR precisa ser quadrado para não ficar ilegível
    expect(qr.width).toBe(qr.height);
  });

  it('linha nasce com altura zero e orientação', () => {
    const linha = createElement('line', 0, 0);
    expect(linha).toMatchObject({ type: 'line', height: 0, orientation: 'horizontal' });
  });

  it('subreport nasce com bandas próprias e canGrow', () => {
    const sub = createElement('subreport', 0, 0);

    expect(sub).toMatchObject({ type: 'subreport', canGrow: true });
    expect(sub).toHaveProperty('template.details');
  });

  it('aceita sobrescrever na criação', () => {
    const l = createElement('label', 0, 0, { content: 'Título' } as never);
    expect((l as LabelElement).content).toBe('Título');
  });

  it('cada elemento criado tem id diferente', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createElement('label', 0, 0).id));
    expect(ids.size).toBeGreaterThan(15);
  });
});
