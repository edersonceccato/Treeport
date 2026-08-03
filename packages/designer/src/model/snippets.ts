import type { ReportElement } from '@treeport/schema';

/**
 * Componentes prontos (item 10 do feedback).
 *
 * Coisas que todo relatório precisa e que ninguém deveria montar do zero:
 * numeração de página, data de emissão, cabeçalho de colunas. Cada um é um
 * elemento (ou uma região com vários) já configurado.
 */

export interface Snippet {
  id: string;
  label: string;
  icon: string;
  hint: string;
  /** Categoria na paleta. */
  group: string;
  /** Banda onde faz mais sentido; a UI sugere, mas o usuário decide. */
  suggestedBand: 'header' | 'details' | 'footer';
  /** Cria o elemento na posição do drop. */
  create: (x: number, y: number, contentWidth: number) => ReportElement;
}

const id = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 7)}`;

export const SNIPPETS: Snippet[] = [
  {
    id: 'page-number',
    label: 'Página X de Y',
    icon: '#',
    group: 'Página',
    hint: 'Numeração automática, resolvida na geração',
    suggestedBand: 'footer',
    create: (x, y, width) => ({
      id: id('paginacao'),
      type: 'label',
      x,
      y,
      width: Math.min(200, width),
      height: 12,
      content: 'Página {{sys.pageNumber}} de {{sys.totalPages}}',
      style: { fontSize: 9, align: 'center', color: '#666666' },
    }),
  },
  {
    id: 'page-number-simple',
    label: 'Nº da página',
    icon: '№',
    group: 'Página',
    hint: 'Só o número da página atual',
    suggestedBand: 'footer',
    create: (x, y) => ({
      id: id('pagina'),
      type: 'label',
      x,
      y,
      width: 60,
      height: 12,
      content: '{{sys.pageNumber}}',
      style: { fontSize: 9, align: 'right', color: '#666666' },
    }),
  },
  {
    id: 'printed-at',
    label: 'Data de emissão',
    icon: '📅',
    group: 'Página',
    hint: 'Data e hora em que o PDF foi gerado',
    suggestedBand: 'footer',
    create: (x, y) => ({
      id: id('emissao'),
      type: 'label',
      x,
      y,
      width: 180,
      height: 12,
      content: "Emitido em {{FORMAT(sys.now, 'dd/MM/yyyy HH:mm')}}",
      style: { fontSize: 8, color: '#666666' },
    }),
  },
  {
    id: 'title-block',
    label: 'Bloco de título',
    icon: '▤',
    group: 'Blocos',
    hint: 'Título, subtítulo e régua — numa região',
    suggestedBand: 'header',
    create: (x, y, width) => ({
      id: id('titulo'),
      type: 'region',
      x,
      y,
      width,
      height: 52,
      autoHeight: true,
      elements: [
        {
          id: id('titulo-texto'),
          type: 'label',
          x: 0,
          y: 0,
          width,
          height: 22,
          content: 'Título do relatório',
          style: { fontSize: 16, bold: true },
        },
        {
          id: id('subtitulo'),
          type: 'label',
          x: 0,
          y: 24,
          width,
          height: 12,
          content: 'Subtítulo',
          style: { fontSize: 9, color: '#666666' },
        },
        {
          id: id('regua'),
          type: 'line',
          x: 0,
          y: 44,
          width,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: '#555555', borderWidth: 1 },
        },
      ],
    }),
  },
  {
    id: 'total-box',
    label: 'Caixa de total',
    icon: '∑',
    group: 'Blocos',
    hint: 'Região com fundo, para destacar um total',
    suggestedBand: 'footer',
    create: (x, y) => ({
      id: id('total'),
      type: 'region',
      x,
      y,
      width: 220,
      height: 40,
      autoHeight: true,
      style: { backgroundColor: '#f1f5f9', borderColor: '#94a3b8', borderWidth: 1 },
      elements: [
        {
          id: id('total-rotulo'),
          type: 'label',
          x: 8,
          y: 8,
          width: 100,
          height: 14,
          content: 'TOTAL',
          style: { fontSize: 10, bold: true },
        },
        {
          id: id('total-valor'),
          type: 'label',
          x: 110,
          y: 8,
          width: 100,
          height: 14,
          content: "{{FORMAT(total, '#,##0.00')}}",
          style: { fontSize: 12, bold: true, align: 'right' },
        },
      ],
    }),
  },
  {
    id: 'items-table',
    label: 'Tabela de itens',
    icon: '▦',
    group: 'Blocos',
    hint: 'Subrelatório com cabeçalho de colunas e linhas repetidas',
    suggestedBand: 'details',
    create: (x, y, width) => {
      const col = (width - 20) / 4;

      return {
        id: id('itens'),
        type: 'subreport',
        name: 'Itens',
        x,
        y,
        width,
        height: 40,
        canGrow: true,
        dataSourceNodeId: '',
        template: {
          // o cabeçalho aparece UMA vez, acima de todas as linhas
          header: {
            height: 18,
            elements: [
              headerCell('Descrição', 0, col * 2),
              headerCell('Qtd', col * 2 + 10, col / 2, 'right'),
              headerCell('Unitário', col * 2.5 + 10, col / 2, 'right'),
              headerCell('Total', col * 3 + 20, col, 'right'),
              {
                id: id('linha-cab'),
                type: 'line',
                x: 0,
                y: 15,
                width,
                height: 0,
                orientation: 'horizontal',
                style: { borderColor: '#94a3b8', borderWidth: 0.75 },
              },
            ],
          },
          // o corpo repete por linha de dados
          details: {
            height: 14,
            elements: [
              bodyCell('descricao', 0, col * 2),
              bodyCell('quantidade', col * 2 + 10, col / 2, 'right'),
              bodyCell('valor_unitario', col * 2.5 + 10, col / 2, 'right', '#,##0.00'),
              bodyCell('valor_total', col * 3 + 20, col, 'right', '#,##0.00'),
            ],
          },
          // o rodapé fecha a lista, uma vez só
          footer: {
            height: 20,
            elements: [
              {
                id: id('linha-tot'),
                type: 'line',
                x: 0,
                y: 2,
                width,
                height: 0,
                orientation: 'horizontal',
                style: { borderColor: '#94a3b8', borderWidth: 0.75 },
              },
              {
                id: id('rot-total'),
                type: 'label',
                x: col * 2,
                y: 5,
                width: col,
                height: 12,
                content: 'Total',
                style: { fontSize: 9, bold: true, align: 'right' },
              },
              {
                id: id('agg-total'),
                type: 'aggregate',
                x: col * 3 + 20,
                y: 5,
                width: col,
                height: 12,
                fn: 'sum',
                fieldName: 'valor_total',
                format: '#,##0.00',
                style: { fontSize: 9, bold: true, align: 'right' },
              },
            ],
          },
        },
      };
    },
  },
  {
    id: 'column-headers',
    label: 'Cabeçalho de colunas',
    icon: '☰',
    group: 'Blocos',
    hint: 'Faixa com títulos de coluna e régua',
    suggestedBand: 'header',
    create: (x, y, width) => {
      const col = width / 3;

      return {
        id: id('colunas'),
        type: 'region',
        x,
        y,
        width,
        height: 20,
        elements: [
          headerCell('Coluna 1', 0, col),
          headerCell('Coluna 2', col, col),
          headerCell('Coluna 3', col * 2, col, 'right'),
          {
            id: id('regua-col'),
            type: 'line',
            x: 0,
            y: 16,
            width,
            height: 0,
            orientation: 'horizontal',
            style: { borderColor: '#94a3b8', borderWidth: 0.75 },
          },
        ],
      };
    },
  },
  {
    id: 'sum-total',
    label: 'Soma de campo',
    icon: 'Σ',
    group: 'Totais',
    hint: 'Totalizador de um campo da consulta',
    suggestedBand: 'footer',
    create: (x, y) => ({
      id: id('soma'),
      type: 'aggregate',
      x,
      y,
      width: 160,
      height: 16,
      fn: 'sum',
      format: '#,##0.00',
      prefix: 'Total: ',
      style: { fontSize: 10, bold: true, align: 'right' },
    }),
  },
  {
    id: 'count-total',
    label: 'Contagem',
    icon: '№',
    group: 'Totais',
    hint: 'Quantas linhas a consulta devolveu',
    suggestedBand: 'footer',
    create: (x, y) => ({
      id: id('contagem'),
      type: 'aggregate',
      x,
      y,
      width: 160,
      height: 16,
      fn: 'count',
      format: '#,##0',
      prefix: 'Registros: ',
      style: { fontSize: 10, align: 'right' },
    }),
  },
  {
    id: 'average',
    label: 'Média',
    icon: 'x̄',
    group: 'Totais',
    hint: 'Média de um campo numérico',
    suggestedBand: 'footer',
    create: (x, y) => ({
      id: id('media'),
      type: 'aggregate',
      x,
      y,
      width: 160,
      height: 16,
      fn: 'avg',
      format: '#,##0.00',
      prefix: 'Média: ',
      style: { fontSize: 10, align: 'right' },
    }),
  },
  {
    id: 'signature-line',
    label: 'Linha de assinatura',
    icon: '✍',
    group: 'Blocos',
    hint: 'Traço com nome embaixo, para assinar',
    suggestedBand: 'footer',
    create: (x, y) => ({
      id: id('assinatura'),
      type: 'region',
      name: 'Assinatura',
      x,
      y,
      width: 220,
      height: 34,
      elements: [
        // o traço fica no topo da região e o rótulo logo abaixo, ambos
        // dentro dos limites dela (bug 5)
        {
          id: id('traco'),
          type: 'line',
          x: 0,
          y: 18,
          width: 220,
          height: 0,
          orientation: 'horizontal',
          style: { borderColor: '#333333', borderWidth: 0.75 },
        },
        {
          id: id('nome-ass'),
          type: 'label',
          x: 0,
          y: 20,
          width: 220,
          height: 12,
          content: 'Responsável',
          style: { fontSize: 8, align: 'center', color: '#666666' },
        },
      ],
    }),
  },
  {
    id: 'qr-doc',
    label: 'QR do documento',
    icon: '▣',
    group: 'Códigos',
    hint: 'QR com uma URL de consulta do documento',
    suggestedBand: 'header',
    create: (x, y) => ({
      id: id('qr'),
      type: 'qrcode',
      x,
      y,
      width: 70,
      height: 70,
      contentKind: 'url',
      valueExpression: 'https://exemplo.com/doc/{{numero}}',
      errorCorrection: 'M',
    }),
  },
  {
    id: 'barcode-code128',
    label: 'Código de barras',
    icon: '|||',
    group: 'Códigos',
    hint: 'Code 128 com os dígitos legíveis',
    suggestedBand: 'details',
    create: (x, y) => ({
      id: id('barras'),
      type: 'barcode',
      x,
      y,
      width: 160,
      height: 44,
      format: 'code128',
      valueExpression: '',
      includeText: true,
    }),
  },
];

/** Célula de cabeçalho de coluna. */
function headerCell(
  text: string,
  x: number,
  width: number,
  align: 'left' | 'right' = 'left',
): ReportElement {
  return {
    id: id('th'),
    type: 'label',
    x,
    y: 2,
    width,
    height: 11,
    content: text,
    style: { fontSize: 8, bold: true, color: '#475569', align },
  };
}

/** Célula de corpo, ligada a um campo. */
function bodyCell(
  fieldName: string,
  x: number,
  width: number,
  align: 'left' | 'right' = 'left',
  format?: string,
): ReportElement {
  return {
    id: id('td'),
    type: 'field',
    x,
    y: 1,
    width,
    height: 11,
    fieldName,
    ...(format ? { format } : {}),
    style: { fontSize: 9, align },
  };
}

export function findSnippet(snippetId: string): Snippet | undefined {
  return SNIPPETS.find((s) => s.id === snippetId);
}

/** Agrupa os prontos por categoria, para a paleta não virar uma lista longa. */
export function snippetGroups(): { label: string; items: Snippet[] }[] {
  const groups = new Map<string, Snippet[]>();

  for (const snippet of SNIPPETS) {
    const list = groups.get(snippet.group) ?? [];
    list.push(snippet);
    groups.set(snippet.group, list);
  }

  return [...groups].map(([label, items]) => ({ label, items }));
}
