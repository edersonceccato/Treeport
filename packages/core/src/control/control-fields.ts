import type { DataRow } from '@treeport/schema';

/**
 * Campos de controle na linha de dados (Anexo A do brief).
 *
 * A query do usuário pode devolver, além dos campos de negócio, campos que
 * dizem ao motor COMO se comportar — não para aparecer no PDF. Eles usam um
 * prefixo (padrão `__`) para o motor reconhecê-los sem configuração extra.
 *
 * O motor trata apenas dois casos de forma especial:
 *
 *   __templateId    qual template usar, calculado pela própria query
 *   __block         interrompe a geração antes de desenhar qualquer coisa
 *   __blockMessage  o motivo do bloqueio
 *
 * Qualquer OUTRO campo de controle é repassado intacto ao hook `onGenerated`.
 * O `core` não sabe (nem deve saber) o que significa "nome do arquivo
 * sugerido" ou "classe de destino" no sistema de quem usa a lib — isso mantém
 * a lib agnóstica de qualquer ERP específico.
 */

/** Prefixo padrão dos campos de controle. */
export const DEFAULT_CONTROL_PREFIX = '__';

/** Nomes de controle que o motor interpreta, sem o prefixo. */
const TEMPLATE_ID = 'templateId';
const BLOCK = 'block';
const BLOCK_MESSAGE = 'blockMessage';

/**
 * Erro lançado quando a query pede o bloqueio da geração.
 *
 * Isso replica a validação de campos obrigatórios do Report Builder de origem
 * (ex.: bloquear a emissão se faltar Incoterm ou anexo obrigatório), mas sem a
 * lib saber o que está sendo validado — a regra mora 100% na query escrita
 * pelo usuário.
 */
export class ReportBlockedError extends Error {
  /** A linha que trouxe o bloqueio, com os campos de controle. */
  readonly row: DataRow;

  constructor(message: string, row: DataRow) {
    super(message);
    this.name = 'ReportBlockedError';
    this.row = row;
  }
}

export interface ControlFields {
  /** Template calculado pela query, quando presente. */
  templateId?: string;
  /** A geração deve ser interrompida? */
  blocked: boolean;
  /** Motivo do bloqueio, quando `blocked`. */
  blockMessage?: string;
  /** Todos os campos de controle da linha, já sem o prefixo. */
  all: Record<string, unknown>;
}

/** Lê os campos de controle de uma linha. */
export function readControlFields(
  row: DataRow | undefined,
  prefix: string = DEFAULT_CONTROL_PREFIX,
): ControlFields {
  const all: Record<string, unknown> = {};

  if (row) {
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith(prefix)) all[key.slice(prefix.length)] = value;
    }
  }

  const result: ControlFields = {
    blocked: toBoolean(all[BLOCK]),
    all,
  };

  const templateId = all[TEMPLATE_ID];
  if (templateId !== null && templateId !== undefined && templateId !== '') {
    result.templateId = String(templateId);
  }

  const message = all[BLOCK_MESSAGE];
  if (message !== null && message !== undefined && message !== '') {
    result.blockMessage = String(message);
  }

  return result;
}

/**
 * Interrompe a geração se a linha pedir bloqueio.
 *
 * Chamado ANTES de desenhar qualquer coisa: o brief é explícito que o
 * bloqueio não deve produzir um PDF pela metade.
 */
export function assertNotBlocked(control: ControlFields, row: DataRow | undefined): void {
  if (!control.blocked) return;

  throw new ReportBlockedError(
    control.blockMessage ??
      'A geração do relatório foi bloqueada pela consulta de dados, sem mensagem informada.',
    row ?? {},
  );
}

/**
 * Remove os campos de controle de uma linha.
 *
 * Útil para quem quer inspecionar só os dados de negócio. O motor NÃO usa isso
 * na renderização: um `__campo` continua acessível por expressão, caso o
 * usuário queira mesmo imprimi-lo.
 */
export function stripControlFields(
  row: DataRow,
  prefix: string = DEFAULT_CONTROL_PREFIX,
): DataRow {
  const out: DataRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith(prefix)) out[key] = value;
  }
  return out;
}

/** Regra de veracidade tolerante: o banco devolve boolean como 0/1, 'S'/'N'... */
function toBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return ['true', '1', 's', 'sim', 'y', 'yes', 't'].includes(v);
  }
  return false;
}
