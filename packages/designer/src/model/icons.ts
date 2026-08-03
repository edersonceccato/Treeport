/**
 * Ícones do designer (item 11 do feedback).
 *
 * São os traçados do [Lucide](https://lucide.dev), embutidos como SVG em vez
 * de instalados como dependência: usamos ~30 ícones, e o pacote inteiro
 * traria mais de mil. Assim o bundle não paga por ícone que ninguém usa, e o
 * traço fica consistente com o resto da interface.
 *
 * Todos usam `currentColor`, então herdam a cor de quem os contém.
 */

const svg = (paths: string, size = 14): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const icons = {
  // --- tipos de elemento ---
  text: svg('<path d="M17 6.1H3M21 12.1H3M15.1 18H3"/>'),
  field: svg('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'),
  line: svg('<path d="M5 12h14"/>'),
  shape: svg('<path d="M12 2 2 19h20L12 2Z"/>'),
  image: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'),
  barcode: svg('<path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14"/>'),
  qrcode: svg('<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1"/>'),
  region: svg('<rect width="18" height="18" x="3" y="3" rx="2" stroke-dasharray="4 3"/>'),
  subreport: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/>'),
  aggregate: svg('<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 5.7a1 1 0 0 1 0 1.2L6.1 17.2a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/>'),
  table: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),

  // --- ações ---
  pencil: svg('<path d="M21.2 5.5 18.5 2.8a2 2 0 0 0-2.8 0L3 15.5V21h5.5L21.2 8.3a2 2 0 0 0 0-2.8Z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M10.7 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a13.2 13.2 0 0 1-2.2 3M6.6 6.6A13.5 13.5 0 0 0 2 12s3.6 7 10 7a10.7 10.7 0 0 0 5.4-1.4M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  lock: svg('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  unlock: svg('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'),
  copy: svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  trash: svg('<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  move: svg('<path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>'),
  group: svg('<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect width="7" height="7" x="8.5" y="8.5" rx="1"/>'),
  ungroup: svg('<rect width="8" height="8" x="3" y="3" rx="1"/><rect width="8" height="8" x="13" y="13" rx="1"/>'),
  bringFront: svg('<path d="m12 2 8 4-8 4-8-4 8-4Z"/><path d="m4 14 8 4 8-4M4 10l8 4 8-4"/>'),
  sendBack: svg('<path d="m12 22-8-4 8-4 8 4-8 4Z"/><path d="m4 10 8-4 8 4M4 14l8-4 8 4"/>'),
  undo: svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
  redo: svg('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>'),
  bold: svg('<path d="M6 12h8a4 4 0 0 0 0-8H6v8ZM6 12h9a4 4 0 0 1 0 8H6v-8Z"/>'),
  italic: svg('<path d="M19 4h-9M14 20H5M15 4 9 20"/>'),
  alignLeft: svg('<path d="M15 12H3M17 18H3M21 6H3"/>'),
  alignCenter: svg('<path d="M17 12H7M19 18H5M21 6H3"/>'),
  alignRight: svg('<path d="M21 12H9M21 18H7M21 6H3"/>'),
  palette: svg('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4H17a5 5 0 0 0 5-5 10 10 0 0 0-10-8Z"/>'),
  plus: svg('<path d="M5 12h14M12 5v14"/>'),
  chevronUp: svg('<path d="m18 15-6-6-6 6"/>', 12),
  chevronDown: svg('<path d="m6 9 6 6 6-6"/>', 12),
  designer: svg('<path d="M12 19l7-7 3 3-7 7-3-3Z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5Z"/><path d="m2 2 7.6 7.6"/><circle cx="11" cy="11" r="2"/>'),
  preview: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/>'),
  rules: svg('<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0H5a2 2 0 0 1-2-2V9m6 12h10a2 2 0 0 0 2-2V9"/>'),
  ruler: svg('<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>'),
} as const;

export type IconName = keyof typeof icons;

/** Ícone do tipo de elemento, para as camadas e a paleta. */
export function iconForType(type: string): string {
  const map: Record<string, IconName> = {
    label: 'text',
    field: 'field',
    line: 'line',
    rect: 'shape',
    shape: 'shape',
    image: 'image',
    barcode: 'barcode',
    qrcode: 'qrcode',
    region: 'region',
    subreport: 'subreport',
    aggregate: 'aggregate',
    table: 'table',
  };
  return icons[map[type] ?? 'text'];
}
