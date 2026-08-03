import type { ReportParameter, ParameterType } from '@treeport/schema';

/** Erro de validação de parâmetro, com a lista completa de problemas. */
export class ParameterValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Parâmetros inválidos:\n- ${issues.join('\n- ')}`);
    this.name = 'ParameterValidationError';
    this.issues = issues;
  }
}

/**
 * Valida e converte os valores informados contra a declaração de parâmetros
 * (seção 4.2, passo 1 do brief).
 *
 * Regras:
 * - valor ausente cai para `defaultValue`; se também não houver, cai para
 *   `null` quando `nullable`, senão é erro;
 * - o valor é coagido para o tipo declarado (string "10" vira 10 num `int`),
 *   porque parâmetro vindo de query string HTTP chega sempre como texto;
 * - parâmetro informado mas não declarado é erro (evita typo silencioso).
 */
export function validateParameters(
  declared: ReportParameter[],
  provided: Record<string, unknown> = {},
): Record<string, unknown> {
  const issues: string[] = [];
  const result: Record<string, unknown> = {};
  const declaredNames = new Set(declared.map((p) => p.name));

  for (const name of Object.keys(provided)) {
    if (!declaredNames.has(name)) {
      issues.push(`"${name}" não está declarado nos parâmetros do relatório.`);
    }
  }

  for (const param of declared) {
    const hasValue = param.name in provided && provided[param.name] !== undefined;
    let raw = hasValue ? provided[param.name] : param.defaultValue;

    if (raw === undefined) raw = null;

    if (raw === null || raw === '') {
      if (param.nullable) {
        result[param.name] = null;
        continue;
      }
      issues.push(`"${param.name}" é obrigatório e não foi informado.`);
      continue;
    }

    const converted = coerce(raw, param.type);
    if (converted.ok) {
      if (
        param.type === 'string' &&
        param.size !== undefined &&
        String(converted.value).length > param.size
      ) {
        issues.push(
          `"${param.name}" excede o tamanho máximo de ${param.size} caracteres.`,
        );
        continue;
      }
      result[param.name] = converted.value;
    } else {
      issues.push(
        `"${param.name}" deveria ser do tipo ${param.type}, mas recebeu ${describe(raw)}.`,
      );
    }
  }

  if (issues.length > 0) throw new ParameterValidationError(issues);
  return result;
}

type CoerceResult = { ok: true; value: unknown } | { ok: false };

/** Converte um valor cru para o tipo declarado, sem ser permissivo demais. */
function coerce(raw: unknown, type: ParameterType): CoerceResult {
  switch (type) {
    case 'string':
      if (typeof raw === 'string') return { ok: true, value: raw };
      if (typeof raw === 'number' || typeof raw === 'boolean') {
        return { ok: true, value: String(raw) };
      }
      if (raw instanceof Date) return { ok: true, value: raw.toISOString() };
      return { ok: false };

    case 'int': {
      const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
      if (typeof raw === 'boolean') return { ok: false };
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false };
      return { ok: true, value: n };
    }

    case 'decimal': {
      if (typeof raw === 'boolean') return { ok: false };
      const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
      if (!Number.isFinite(n)) return { ok: false };
      return { ok: true, value: n };
    }

    case 'date': {
      if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? { ok: false } : { ok: true, value: raw };
      }
      if (typeof raw === 'string' || typeof raw === 'number') {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d };
      }
      return { ok: false };
    }

    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (typeof raw === 'number') {
        if (raw === 0 || raw === 1) return { ok: true, value: raw === 1 };
        return { ok: false };
      }
      if (typeof raw === 'string') {
        const v = raw.trim().toLowerCase();
        if (['true', '1', 'sim', 's', 'yes', 'y'].includes(v)) return { ok: true, value: true };
        if (['false', '0', 'nao', 'não', 'n', 'no'].includes(v)) return { ok: true, value: false };
      }
      return { ok: false };
    }

    default:
      // tipo não reconhecido (só acontece se vier de JSON não validado)
      return { ok: false };
  }
}

/** Descrição legível do valor recebido, para a mensagem de erro. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return 'Date inválida';
  if (typeof value === 'object') return 'objeto';
  return `${typeof value} (${JSON.stringify(value)})`;
}
