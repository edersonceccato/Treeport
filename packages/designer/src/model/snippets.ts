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
];

export function findSnippet(snippetId: string): Snippet | undefined {
  return SNIPPETS.find((s) => s.id === snippetId);
}
