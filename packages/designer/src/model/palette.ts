import type { ReportElement } from '@treeport/schema';

/**
 * Paleta: os tipos de elemento que o usuário pode arrastar para o canvas, com
 * tamanho e conteúdo padrão de cada um.
 *
 * Os defaults importam para a experiência: um Label criado com 10x10 seria
 * inútil, e um Barcode com proporção errada nasce ilegível. Os valores aqui
 * são os que fazem o elemento já aparecer utilizável no drop.
 */

export type PaletteItemType = ReportElement['type'];

export interface PaletteItem {
  type: PaletteItemType;
  /** Rótulo mostrado na paleta. */
  label: string;
  /** Ícone em texto — evita puxar uma dependência de ícones. */
  icon: string;
  /** Dica exibida no hover. */
  hint: string;
  defaultWidth: number;
  defaultHeight: number;
}

export const PALETTE: PaletteItem[] = [
  {
    type: 'label',
    label: 'Texto',
    icon: 'T',
    hint: 'Texto fixo ou expressão {{campo}}',
    defaultWidth: 120,
    defaultHeight: 16,
  },
  {
    type: 'field',
    label: 'Campo',
    icon: '{}',
    hint: 'Valor de uma coluna da consulta',
    defaultWidth: 120,
    defaultHeight: 16,
  },
  {
    type: 'line',
    label: 'Linha',
    icon: '—',
    hint: 'Traço horizontal ou vertical',
    defaultWidth: 200,
    defaultHeight: 0,
  },
  {
    type: 'image',
    label: 'Imagem',
    icon: '🖼',
    hint: 'Logo ou foto (data URI)',
    defaultWidth: 100,
    defaultHeight: 60,
  },
  {
    type: 'barcode',
    label: 'Cód. barras',
    icon: '|||',
    hint: 'Code 128, EAN-13 ou Code 39',
    // proporção larga: um barcode quadrado fica ilegível
    defaultWidth: 160,
    defaultHeight: 44,
  },
  {
    type: 'qrcode',
    label: 'QR Code',
    icon: '▣',
    hint: 'QR Code — use uma caixa quadrada',
    defaultWidth: 80,
    defaultHeight: 80,
  },
  {
    type: 'shape',
    label: 'Forma',
    icon: '◆',
    hint: 'Retângulo, círculo, triângulo, estrela e outras',
    defaultWidth: 120,
    defaultHeight: 80,
  },
  {
    type: 'aggregate',
    label: 'Totalizador',
    icon: '∑',
    hint: 'Soma, contagem ou média de uma consulta',
    defaultWidth: 140,
    defaultHeight: 18,
  },
  {
    type: 'region',
    label: 'Região',
    icon: '⬚',
    hint: 'Agrupa elementos: mover a região move tudo junto',
    defaultWidth: 240,
    defaultHeight: 80,
  },
  {
    type: 'subreport',
    label: 'Subrelatório',
    icon: '⊞',
    hint: 'Design de um nó filho da árvore de dados',
    defaultWidth: 400,
    defaultHeight: 40,
  },
];

/**
 * Rótulo base de cada tipo, para o nome automático (item 14).
 * A forma usa o nome da geometria, não "Forma".
 */
export const TYPE_LABELS: Record<string, string> = {
  label: 'Texto',
  field: 'Campo',
  line: 'Linha',
  rect: 'Retângulo',
  image: 'Imagem',
  barcode: 'Código de barras',
  qrcode: 'QR Code',
  region: 'Região',
  subreport: 'Subrelatório',
  aggregate: 'Totalizador',
  table: 'Tabela',
};

/** Nome de cada forma, para o rótulo automático refletir a geometria. */
export const SHAPE_LABELS: Record<string, string> = {
  rectangle: 'Retângulo',
  ellipse: 'Círculo',
  triangle: 'Triângulo',
  diamond: 'Losango',
  star: 'Estrela',
  pentagon: 'Pentágono',
  hexagon: 'Hexágono',
  arrow: 'Seta',
};

/** Rótulo base de um elemento: usa a forma quando for `shape`. */
export function baseLabelFor(element: { type: string; shape?: string }): string {
  if (element.type === 'shape') {
    return SHAPE_LABELS[element.shape ?? 'rectangle'] ?? 'Forma';
  }
  return TYPE_LABELS[element.type] ?? 'Elemento';
}

export function paletteItem(type: PaletteItemType): PaletteItem | undefined {
  return PALETTE.find((item) => item.type === type);
}

/**
 * Cria um elemento novo daquele tipo, na posição informada.
 *
 * O id é provisório: o `TemplateEditor` garante unicidade ao adicionar.
 */
export function createElement(
  type: PaletteItemType,
  x: number,
  y: number,
  overrides: Partial<ReportElement> = {},
): ReportElement {
  const item = paletteItem(type);
  const base = {
    id: `${type}-${Math.random().toString(36).slice(2, 7)}`,
    x,
    y,
    width: item?.defaultWidth ?? 100,
    height: item?.defaultHeight ?? 20,
  };

  const element = withTypeDefaults(type, base);
  return { ...element, ...overrides } as ReportElement;
}

/** Campos obrigatórios de cada tipo, com valores que já funcionam. */
function withTypeDefaults(
  type: PaletteItemType,
  base: { id: string; x: number; y: number; width: number; height: number },
): ReportElement {
  switch (type) {
    case 'label':
      return { ...base, type, content: 'Texto', style: { fontSize: 10 } };

    case 'field':
      return { ...base, type, fieldName: '', style: { fontSize: 10 } };

    case 'line':
      return {
        ...base,
        type,
        height: 0,
        orientation: 'horizontal',
        style: { borderColor: '#333333', borderWidth: 1 },
      };

    case 'rect':
      return { ...base, type, style: { borderColor: '#333333', borderWidth: 1 } };

    case 'image':
      return { ...base, type, source: '', fit: 'contain' };

    case 'barcode':
      return { ...base, type, format: 'code128', valueExpression: '' };

    case 'qrcode':
      return { ...base, type, valueExpression: '' };

    case 'subreport':
      return {
        ...base,
        type,
        dataSourceNodeId: '',
        canGrow: true,
        template: { details: { height: 16, elements: [] } },
      };

    case 'table':
      return { ...base, type, columns: [], rowHeight: 16 };

    case 'region':
      return {
        ...base,
        type,
        elements: [],
        canGrow: true,
        autoHeight: true,
        style: { backgroundColor: '#f8fafc', borderColor: '#94a3b8', borderWidth: 1 },
      };

    case 'shape':
      return {
        ...base,
        type,
        shape: 'rectangle',
        style: { backgroundColor: '#e2e8f0', borderColor: '#334155', borderWidth: 1 },
      };

    case 'aggregate':
      return {
        ...base,
        type,
        fn: 'sum',
        format: '#,##0.00',
        style: { fontSize: 11, bold: true, align: 'right' },
      };
  }
}
