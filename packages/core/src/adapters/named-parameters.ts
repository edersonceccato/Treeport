/**
 * Tradução de parâmetros nomeados (`:nome`) para o dialeto de cada driver.
 *
 * Existe porque o contrato do `Executor` é sempre `:nome` (o usuário escreve a
 * query dele assim, uma vez só), mas cada driver quer uma coisa diferente:
 * `$1` no pg, `@nome` no mssql, `?` posicional no SQLite/MySQL.
 *
 * O scanner abaixo respeita o que NÃO é parâmetro:
 * - literais de string (`'texto com : dentro'`, incluindo `''` escapado)
 * - identificadores entre aspas duplas e colchetes (`"col:x"`, `[col:x]`)
 * - comentários (`-- linha` e `/* bloco *​/`)
 * - o cast do Postgres (`valor::int`) e o operador `:=`
 */

export interface NormalizedQuery {
  /** SQL com os placeholders já no dialeto do driver. */
  sql: string;
  /** Nomes dos parâmetros na ordem em que aparecem (para drivers posicionais). */
  order: string[];
}

/** Como cada dialeto quer receber o placeholder. */
export type PlaceholderStyle =
  /** `$1`, `$2`… (PostgreSQL) — reusa o mesmo índice para nome repetido. */
  | 'numbered'
  /** `?` posicional (SQLite, MySQL) — repete o valor a cada ocorrência. */
  | 'positional'
  /** `@nome` (SQL Server). */
  | 'at-named'
  /** `:nome` — mantém como está (Oracle, node-firebird com suporte nomeado). */
  | 'colon-named';

/** Caracteres válidos num nome de parâmetro. */
function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

/**
 * Varre a SQL e substitui as ocorrências de `:nome` que estão realmente em
 * posição de parâmetro.
 */
export function normalizeNamedParameters(
  sql: string,
  style: PlaceholderStyle,
): NormalizedQuery {
  let out = '';
  const order: string[] = [];
  /** nome -> índice 1-based já atribuído (só usado no estilo `numbered`). */
  const assigned = new Map<string, number>();

  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    // -- comentário de linha
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // /* comentário de bloco */
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // literal de string: 'texto', com '' como escape do apóstrofo
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // identificador entre aspas duplas: "coluna"
    if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // identificador entre colchetes (T-SQL): [coluna]
    if (ch === '[') {
      const end = sql.indexOf(']', i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === ':') {
      // `::` é cast do Postgres, não parâmetro — copia os dois e segue
      if (next === ':') {
        out += '::';
        i += 2;
        continue;
      }
      // `:=` é atribuição, não parâmetro
      if (next === '=') {
        out += ':=';
        i += 2;
        continue;
      }
      // `:nome`
      if (next !== undefined && isNameChar(next)) {
        let j = i + 1;
        while (j < sql.length && isNameChar(sql[j]!)) j += 1;
        const name = sql.slice(i + 1, j);

        switch (style) {
          case 'numbered': {
            let idx = assigned.get(name);
            if (idx === undefined) {
              order.push(name);
              idx = order.length;
              assigned.set(name, idx);
            }
            out += `$${idx}`;
            break;
          }
          case 'positional':
            order.push(name);
            out += '?';
            break;
          case 'at-named':
            if (!assigned.has(name)) {
              order.push(name);
              assigned.set(name, order.length);
            }
            out += `@${name}`;
            break;
          case 'colon-named':
            if (!assigned.has(name)) {
              order.push(name);
              assigned.set(name, order.length);
            }
            out += `:${name}`;
            break;
        }
        i = j;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return { sql: out, order };
}

/** Monta o array de valores posicionais na ordem devolvida por `normalizeNamedParameters`. */
export function buildPositionalValues(
  order: string[],
  params: Record<string, unknown>,
): unknown[] {
  return order.map((name) => {
    if (!(name in params)) {
      throw new Error(
        `Parâmetro ":${name}" usado na query mas não informado. Parâmetros disponíveis: ${
          Object.keys(params).join(', ') || '(nenhum)'
        }.`,
      );
    }
    return params[name];
  });
}
