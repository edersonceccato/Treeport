import type { QrContentKind } from '@treeport/schema';

/**
 * Formatação do conteúdo de um QR Code (item 16 do feedback).
 *
 * O QR em si não tem "tipos" — ele codifica texto e pronto. O que faz o
 * celular abrir o discador, o e-mail ou a rede wifi é a **sintaxe** do texto
 * codificado, que segue convenções conhecidas.
 *
 * Ou seja: não é preciso um elemento diferente para cada tipo. Um só, com o
 * `contentKind` dizendo como montar o texto, resolve todos.
 */

export interface QrContentParts {
  /** O valor principal (a URL, o telefone, o texto). */
  value: string;
  /** Campos extras, conforme o tipo. */
  extras?: Record<string, string>;
}

/**
 * Monta o texto a codificar conforme o tipo.
 *
 * Quando o valor já vem na sintaxe certa (`mailto:`, `https://`), é
 * respeitado como está — o usuário pode ter colado de algum lugar.
 */
export function formatQrContent(
  kind: QrContentKind | undefined,
  parts: QrContentParts,
): string {
  const value = parts.value.trim();
  const extras = parts.extras ?? {};

  if (value === '') return '';

  switch (kind) {
    case 'url':
      // sem protocolo o leitor trata como texto e não abre o navegador
      return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;

    case 'email': {
      if (value.toLowerCase().startsWith('mailto:')) return value;
      const query = buildQuery({ subject: extras['subject'], body: extras['body'] });
      return `mailto:${value}${query}`;
    }

    case 'phone':
      return value.toLowerCase().startsWith('tel:') ? value : `tel:${cleanPhone(value)}`;

    case 'sms': {
      if (value.toLowerCase().startsWith('smsto:')) return value;
      const message = extras['message'];
      return message
        ? `SMSTO:${cleanPhone(value)}:${message}`
        : `SMSTO:${cleanPhone(value)}`;
    }

    case 'wifi': {
      // WIFI:T:WPA;S:rede;P:senha;H:false;;
      const security = extras['security'] ?? 'WPA';
      const password = extras['password'] ?? '';
      const hidden = extras['hidden'] === 'true' ? 'H:true;' : '';
      return `WIFI:T:${security};S:${escapeWifi(value)};P:${escapeWifi(password)};${hidden};`;
    }

    case 'geo': {
      // geo:latitude,longitude
      const longitude = extras['longitude'] ?? '';
      return `geo:${value},${longitude}`;
    }

    case 'vcard': {
      // vCard 3.0: o formato que praticamente todo celular entende
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${value}`,
        extras['org'] ? `ORG:${extras['org']}` : '',
        extras['title'] ? `TITLE:${extras['title']}` : '',
        extras['phone'] ? `TEL:${extras['phone']}` : '',
        extras['email'] ? `EMAIL:${extras['email']}` : '',
        extras['url'] ? `URL:${extras['url']}` : '',
        extras['address'] ? `ADR:;;${extras['address']}` : '',
        'END:VCARD',
      ];
      return lines.filter((line) => line !== '').join('\n');
    }

    case 'text':
    default:
      return value;
  }
}

/** Campos extras que cada tipo aceita, para o Designer montar o formulário. */
export const QR_CONTENT_FIELDS: Record<QrContentKind, { key: string; label: string }[]> = {
  text: [],
  url: [],
  email: [
    { key: 'subject', label: 'Assunto' },
    { key: 'body', label: 'Mensagem' },
  ],
  phone: [],
  sms: [{ key: 'message', label: 'Mensagem' }],
  wifi: [
    { key: 'password', label: 'Senha' },
    { key: 'security', label: 'Segurança (WPA/WEP/nopass)' },
  ],
  vcard: [
    { key: 'org', label: 'Empresa' },
    { key: 'title', label: 'Cargo' },
    { key: 'phone', label: 'Telefone' },
    { key: 'email', label: 'E-mail' },
    { key: 'url', label: 'Site' },
    { key: 'address', label: 'Endereço' },
  ],
  geo: [{ key: 'longitude', label: 'Longitude' }],
};

/** Rótulo do campo principal, que muda conforme o tipo. */
export const QR_VALUE_LABEL: Record<QrContentKind, string> = {
  text: 'Texto',
  url: 'Endereço',
  email: 'E-mail',
  phone: 'Telefone',
  sms: 'Telefone',
  wifi: 'Nome da rede',
  vcard: 'Nome',
  geo: 'Latitude',
};

function buildQuery(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`);

  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** Tira o que não é dígito nem `+`, que o leitor não entende num `tel:`. */
function cleanPhone(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

/** `;`, `,`, `:` e `\` têm significado na sintaxe de wifi. */
function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}
