import { describe, it, expect } from 'vitest';
import type { RegionElement, Template } from '@treeport/schema';
import {
  TemplateEditor,
  createEmptyTemplate,
  createElement,
  snapToGuides,
  paginate,
  sampleRows,
  SNIPPETS,
  findSnippet,
  suggestFormats,
  guessFieldKind,
  type Box,
} from '../src/index.js';

/**
 * Cobre o que entrou na reformulação: regiões, guias de alinhamento,
 * paginação do preview e os componentes prontos.
 */

const box = (x: number, y: number, width = 100, height = 20): Box => ({ x, y, width, height });

// --- regiões ----------------------------------------------------------------

describe('regiões', () => {
  function editorComElementos(): TemplateEditor {
    const editor = new TemplateEditor(createEmptyTemplate());
    editor.addElement('details', {
      id: 'a',
      type: 'label',
      x: 100,
      y: 20,
      width: 80,
      height: 16,
      content: 'A',
    });
    editor.addElement('details', {
      id: 'b',
      type: 'label',
      x: 200,
      y: 50,
      width: 80,
      height: 16,
      content: 'B',
    });
    return editor;
  }

  it('agrupa convertendo as coordenadas para relativas', () => {
    const editor = editorComElementos();
    const regionId = editor.addElement(
      'details',
      createElement('region', 100, 20, { width: 200, height: 60 } as never),
    );

    expect(editor.groupIntoRegion(['a', 'b'], regionId)).toBe(true);

    const region = editor.element(regionId) as RegionElement;
    expect(region.elements).toHaveLength(2);
    // a estava em (100,20) e a região começa em (100,20) -> vira (0,0)
    expect(region.elements[0]).toMatchObject({ id: 'a', x: 0, y: 0 });
    expect(region.elements[1]).toMatchObject({ id: 'b', x: 100, y: 30 });
  });

  it('os elementos saem da banda ao entrar na região', () => {
    const editor = editorComElementos();
    const regionId = editor.addElement(
      'details',
      createElement('region', 0, 0, { width: 300, height: 80 } as never),
    );
    editor.groupIntoRegion(['a', 'b'], regionId);

    // só a região fica solta na banda
    expect(editor.band('details')!.elements).toHaveLength(1);
    expect(editor.band('details')!.elements[0]!.type).toBe('region');
  });

  it('mover a região não mexe nas coordenadas dos filhos', () => {
    // é o ponto de usar coordenada relativa: os filhos vão junto de graça
    const editor = editorComElementos();
    const regionId = editor.addElement(
      'details',
      createElement('region', 100, 20, { width: 200, height: 60 } as never),
    );
    editor.groupIntoRegion(['a', 'b'], regionId);

    const antes = (editor.element(regionId) as RegionElement).elements.map((e) => [e.x, e.y]);
    editor.moveElement(regionId, 300, 100);
    const depois = (editor.element(regionId) as RegionElement).elements.map((e) => [e.x, e.y]);

    expect(depois).toEqual(antes);
  });

  it('encontra e edita elementos dentro da região', () => {
    const editor = editorComElementos();
    const regionId = editor.addElement(
      'details',
      createElement('region', 0, 0, { width: 300, height: 80 } as never),
    );
    editor.groupIntoRegion(['a'], regionId);

    expect(editor.element('a')).toBeDefined();
    expect(editor.locate('a')?.parentRegionId).toBe(regionId);

    editor.moveElement('a', 15, 25);
    expect(editor.element('a')).toMatchObject({ x: 15, y: 25 });
  });

  it('tirar da região devolve coordenada absoluta', () => {
    const editor = editorComElementos();
    const regionId = editor.addElement(
      'details',
      createElement('region', 100, 20, { width: 200, height: 60 } as never),
    );
    editor.groupIntoRegion(['a'], regionId);

    expect(editor.ungroupFromRegion('a')).toBe(true);

    // relativo (0,0) + origem da região (100,20) = absoluto de novo
    expect(editor.element('a')).toMatchObject({ x: 100, y: 20 });
    expect(editor.locate('a')?.parentRegionId).toBeUndefined();
  });

  it('agrupar é um único passo de desfazer', () => {
    const editor = editorComElementos();
    const regionId = editor.addElement(
      'details',
      createElement('region', 0, 0, { width: 300, height: 80 } as never),
    );

    editor.groupIntoRegion(['a', 'b'], regionId);
    editor.undo();

    expect(editor.band('details')!.elements.filter((e) => e.type !== 'region')).toHaveLength(2);
  });
});

// --- layers -----------------------------------------------------------------

describe('camadas', () => {
  function editor(): TemplateEditor {
    const e = new TemplateEditor(createEmptyTemplate());
    e.addElement('details', {
      id: 'a',
      type: 'label',
      x: 0,
      y: 0,
      width: 80,
      height: 16,
      content: 'A',
    });
    return e;
  }

  it('trava e destrava', () => {
    const e = editor();
    e.setLocked('a', true);
    expect(e.element('a')!.locked).toBe(true);

    e.setLocked('a', false);
    expect(e.element('a')!.locked).toBe(false);
  });

  it('oculta e mostra', () => {
    const e = editor();
    e.setHidden('a', true);
    expect(e.element('a')!.hidden).toBe(true);
  });

  it('duplica com id novo e deslocado', () => {
    const e = editor();
    const id = e.duplicateElement('a');

    expect(id).toBeDefined();
    expect(id).not.toBe('a');
    expect(e.element(id!)).toMatchObject({ x: 10, y: 10 });
    expect(e.band('details')!.elements).toHaveLength(2);
  });

  it('duplicar uma região leva os filhos junto', () => {
    const e = editor();
    const regionId = e.addElement(
      'details',
      createElement('region', 0, 0, { width: 200, height: 60 } as never),
    );
    e.groupIntoRegion(['a'], regionId);

    const copyId = e.duplicateElement(regionId)!;
    const copy = e.element(copyId) as RegionElement;

    expect(copy.elements).toHaveLength(1);
    // o filho da cópia tem id próprio? não — a cópia é profunda mas os ids
    // internos repetem; o que importa é o conteúdo ter vindo junto
    expect(copy.elements[0]!.type).toBe('label');
  });
});

// --- guias de alinhamento ---------------------------------------------------

describe('guias inteligentes', () => {
  it('gruda quando as bordas esquerdas quase coincidem', () => {
    const moving = box(98, 50);
    const other = box(100, 200);

    const { box: snapped, guides } = snapToGuides(moving, [other]);

    expect(snapped.x).toBe(100);
    expect(guides.some((g) => g.orientation === 'vertical')).toBe(true);
  });

  it('não gruda quando está longe', () => {
    const { box: snapped, guides } = snapToGuides(box(50, 50), [box(300, 200)]);

    expect(snapped.x).toBe(50);
    expect(guides).toHaveLength(0);
  });

  it('alinha pelo centro', () => {
    // moving: centro em 100+50=150; other: centro em 148+50=198... ajusta
    const moving = box(100, 0, 100, 20);
    const other = box(102, 200, 100, 20);

    const { box: snapped } = snapToGuides(moving, [other]);
    expect(snapped.x).toBe(102);
  });

  it('alinha a borda direita com a do vizinho', () => {
    const moving = box(0, 0, 100, 20); // direita em 100
    const other = box(2, 200, 100, 20); // direita em 102

    const { box: snapped } = snapToGuides(moving, [other]);
    expect(snapped.x + snapped.width).toBe(102);
  });

  it('alinha ao centro da página', () => {
    const contentWidth = 500;
    // largura 100, centro em 250 => x = 200
    const moving = box(197, 10, 100, 20);

    const { box: snapped, guides } = snapToGuides(moving, [], { pageWidth: contentWidth });

    expect(snapped.x).toBe(200);
    expect(guides.some((g) => g.kind === 'page')).toBe(true);
  });

  it('alinha na vertical também', () => {
    const { box: snapped } = snapToGuides(box(0, 48), [box(300, 50)]);
    expect(snapped.y).toBe(50);
  });

  it('respeita o limiar configurado', () => {
    // 8 de distância: fora do limiar padrão (5), dentro de um limiar 10
    expect(snapToGuides(box(92, 0), [box(100, 200)]).box.x).toBe(92);
    expect(snapToGuides(box(92, 0), [box(100, 200)], { threshold: 10 }).box.x).toBe(100);
  });

  it('desligado, não mexe em nada', () => {
    const moving = box(98, 50);
    const { box: snapped, guides } = snapToGuides(moving, [box(100, 200)], { enabled: false });

    expect(snapped).toEqual(moving);
    expect(guides).toEqual([]);
  });

  it('escolhe o alinhamento mais próximo quando há vários candidatos', () => {
    // borda esquerda em 98: o candidato 96 está a 2 e o 101 a 3, então 96 vence
    const { box: snapped } = snapToGuides(box(98, 0), [box(101, 200), box(96, 300)]);
    expect(snapped.x).toBe(96);
  });
});

// --- preview ----------------------------------------------------------------

describe('paginação do preview', () => {
  function template(overrides: Partial<Template> = {}): Template {
    return {
      id: 't',
      name: 'T',
      boundDataSourceNodeId: 'N',
      pageSize: 'A4',
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      bands: {
        header: { height: 60, elements: [] },
        details: { height: 20, elements: [] },
        footer: { height: 30, elements: [] },
      },
      ...overrides,
    };
  }

  it('gera uma página para poucas linhas', () => {
    const result = paginate(template(), { rows: [{}, {}, {}] });
    expect(result.pages).toHaveLength(1);
  });

  it('quebra quando as linhas não cabem', () => {
    // A4 = 841.89; menos margens (80), header (60) e footer (30) = ~672
    // com detalhe de 20pt, cabem ~33 por página
    const rows = Array.from({ length: 80 }, () => ({}));
    const result = paginate(template(), { rows });

    expect(result.pages.length).toBeGreaterThan(1);
  });

  it('cada página repete header e footer', () => {
    const rows = Array.from({ length: 80 }, () => ({}));
    const result = paginate(template(), { rows });

    for (const page of result.pages) {
      expect(page.blocks.some((b) => b.band === 'header')).toBe(true);
      expect(page.blocks.some((b) => b.band === 'footer')).toBe(true);
    }
  });

  it('o rodapé fica ancorado na base, não logo após o conteúdo', () => {
    const result = paginate(template(), { rows: [{}] });
    const footer = result.pages[0]!.blocks.find((b) => b.band === 'footer')!;

    // 841.89 - 40 (margem) - 30 (altura) = 771.89
    expect(footer.y).toBeCloseTo(771.89, 1);
  });

  it('nenhum detalhe invade a área do rodapé', () => {
    const rows = Array.from({ length: 80 }, () => ({}));
    const result = paginate(template(), { rows });
    const limite = 841.89 - 40 - 30;

    for (const page of result.pages) {
      for (const block of page.blocks.filter((b) => b.band === 'details')) {
        expect(block.y + block.height).toBeLessThanOrEqual(limite + 0.01);
      }
    }
  });

  it('respeita o teto de páginas', () => {
    const rows = Array.from({ length: 5000 }, () => ({}));
    const result = paginate(template(), { rows, maxPages: 3 });

    expect(result.pages.length).toBeLessThanOrEqual(3);
    expect(result.truncated).toBe(true);
  });

  it('landscape inverte as dimensões', () => {
    const result = paginate(template({ orientation: 'landscape' }), { rows: [{}] });

    expect(result.pageWidth).toBeCloseTo(841.89, 1);
    expect(result.pageHeight).toBeCloseTo(595.28, 1);
  });

  it('sem linhas ainda mostra uma página com o timbrado', () => {
    const result = paginate(template(), { rows: [] });
    expect(result.pages).toHaveLength(1);
  });
});

describe('dados de amostra', () => {
  it('gera valores plausíveis pelo nome do campo', () => {
    const [row] = sampleRows(['cliente', 'valor_total', 'data_emissao', 'numero'], 1);

    expect(typeof row!['cliente']).toBe('string');
    expect(typeof row!['valor_total']).toBe('number');
    expect(String(row!['data_emissao'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(row!['numero'])).toMatch(/-\d{4}$/);
  });

  it('gera a quantidade pedida', () => {
    expect(sampleRows(['x'], 7)).toHaveLength(7);
  });

  it('as linhas variam entre si', () => {
    const rows = sampleRows(['cliente'], 4);
    expect(new Set(rows.map((r) => r['cliente'])).size).toBeGreaterThan(1);
  });
});

// --- componentes prontos ----------------------------------------------------

describe('componentes prontos', () => {
  it('a numeração usa as variáveis de sistema', () => {
    const snippet = findSnippet('page-number')!;
    const element = snippet.create(0, 0, 515);

    expect(element.type).toBe('label');
    expect((element as { content: string }).content).toContain('{{sys.pageNumber}}');
    expect((element as { content: string }).content).toContain('{{sys.totalPages}}');
  });

  it('o bloco de título vem como região com filhos', () => {
    const element = findSnippet('title-block')!.create(0, 0, 515) as RegionElement;

    expect(element.type).toBe('region');
    expect(element.elements.length).toBeGreaterThan(1);
  });

  it('todo snippet gera um elemento válido', () => {
    for (const snippet of SNIPPETS) {
      const element = snippet.create(10, 20, 515);

      expect(element.id).toBeTruthy();
      expect(element.type).toBeTruthy();
      expect(element.width).toBeGreaterThan(0);
    }
  });

  it('cada criação tem id próprio', () => {
    const snippet = findSnippet('page-number')!;
    const ids = new Set(Array.from({ length: 10 }, () => snippet.create(0, 0, 515).id));

    expect(ids.size).toBeGreaterThan(8);
  });
});

// --- formatos sugeridos (item 20) -------------------------------------------

describe('formatos sugeridos por tipo de campo', () => {
  it('campo de valor sugere máscaras de moeda', () => {
    const formatos = suggestFormats('valor_total');

    expect(guessFieldKind('valor_total')).toBe('currency');
    expect(formatos.map((f) => f.mask)).toContain('#,##0.00');
    expect(formatos.some((f) => f.mask.includes('R$'))).toBe(true);
  });

  it('campo de data sugere máscaras de data', () => {
    expect(guessFieldKind('data_emissao')).toBe('date');
    expect(suggestFormats('data_emissao').map((f) => f.mask)).toContain('dd/MM/yyyy');
  });

  it('campo com hora sugere data e hora', () => {
    expect(guessFieldKind('created_at')).toBe('datetime');
  });

  it('quantidade é número, não moeda', () => {
    expect(guessFieldKind('quantidade')).toBe('number');
  });

  it('nome de cliente é texto e não sugere máscara', () => {
    expect(guessFieldKind('cliente')).toBe('text');
    expect(suggestFormats('cliente')).toEqual([]);
  });

  it('o valor de amostra manda sobre o nome', () => {
    // um campo chamado "codigo" que traz Date é data
    expect(guessFieldKind('codigo', new Date())).toBe('date');
  });

  it('toda sugestão traz um exemplo do resultado', () => {
    for (const f of suggestFormats('valor')) {
      expect(f.example).toBeTruthy();
      expect(f.label).toBeTruthy();
    }
  });
});

// --- ajustes da terceira rodada de feedback -------------------------------

describe('mover entre bandas', () => {
  function editor(): TemplateEditor {
    const e = new TemplateEditor(createEmptyTemplate());
    e.addElement('header', {
      id: 'a',
      type: 'label',
      x: 10,
      y: 20,
      width: 80,
      height: 16,
      content: 'A',
    });
    return e;
  }

  it('move o elemento para outra banda preservando x/y', () => {
    const e = editor();

    expect(e.moveToBand('a', 'footer')).toBe(true);
    expect(e.locate('a')?.band).toBe('footer');
    expect(e.element('a')).toMatchObject({ x: 10, y: 20 });
  });

  it('mover para a mesma banda não faz nada', () => {
    expect(editor().moveToBand('a', 'header')).toBe(false);
  });

  it('sair de uma região devolve a coordenada absoluta', () => {
    const e = new TemplateEditor(createEmptyTemplate());
    e.addElement('details', {
      id: 'x',
      type: 'label',
      x: 100,
      y: 50,
      width: 80,
      height: 16,
      content: 'X',
    });
    const regionId = e.addElement(
      'details',
      createElement('region', 100, 50, { width: 200, height: 60 } as never),
    );
    e.groupIntoRegion(['x'], regionId);

    // dentro da região o x virou 0 (relativo)
    expect(e.element('x')!.x).toBe(0);

    e.moveToBand('x', 'footer');

    // ao sair, volta a ser absoluto
    expect(e.element('x')).toMatchObject({ x: 100, y: 50 });
    expect(e.locate('x')?.parentRegionId).toBeUndefined();
  });
});

describe('reordenar elementos', () => {
  it('muda a posição na lista', () => {
    const e = new TemplateEditor(createEmptyTemplate());
    for (const id of ['a', 'b', 'c']) {
      e.addElement('details', {
        id,
        type: 'label',
        x: 0,
        y: 0,
        width: 50,
        height: 12,
        content: id,
      });
    }

    e.reorderElement('c', 0);
    expect(e.band('details')!.elements.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

// --- quarta rodada de feedback --------------------------------------------

describe('nomes automáticos e slug', () => {
  it('numera por tipo', () => {
    const e = new TemplateEditor(createEmptyTemplate());

    const a = e.addElement('details', createElement('region', 0, 0));
    const b = e.addElement('details', createElement('region', 0, 0));

    expect(e.element(a)!.name).toBe('Região 1');
    expect(e.element(b)!.name).toBe('Região 2');
  });

  it('a forma usa o nome da geometria, não "Forma"', () => {
    const e = new TemplateEditor(createEmptyTemplate());
    const id = e.addElement(
      'details',
      createElement('shape', 0, 0, { shape: 'star' } as never),
    );

    expect(e.element(id)!.name).toBe('Estrela 1');
  });

  it('gera um slug estável a partir do nome', () => {
    const e = new TemplateEditor(createEmptyTemplate());
    const id = e.addElement('details', createElement('region', 0, 0));

    const slug = e.element(id)!.slug;
    expect(slug).toBe('REGIAO_1');

    // renomear NÃO muda o slug: é o que permite usá-lo em fórmulas
    e.updateElement(id, { name: 'Outro nome' });
    expect(e.element(id)!.slug).toBe(slug);
  });
});

describe('regrupar mantém a posição (bug 8)', () => {
  it('elemento que já estava numa região não é deslocado', () => {
    const e = new TemplateEditor(createEmptyTemplate());

    e.addElement('details', {
      id: 'x',
      type: 'label',
      x: 120,
      y: 140,
      width: 50,
      height: 12,
      content: 'X',
    });
    const r1 = e.addElement(
      'details',
      createElement('region', 100, 100, { width: 200, height: 100 } as never),
    );

    e.groupIntoRegion(['x'], r1);
    // 120-100 = 20, 140-100 = 40
    expect(e.element('x')).toMatchObject({ x: 20, y: 40 });

    // mover a região não mexe no filho
    e.moveElement(r1, 50, 50);
    expect(e.element('x')).toMatchObject({ x: 20, y: 40 });
  });
});
