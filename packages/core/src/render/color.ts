import { rgb, type RGB } from 'pdf-lib';

/**
 * Conversão de cor hexadecimal ("#RRGGBB" ou "#RGB") para o RGB do pdf-lib,
 * que trabalha com componentes de 0 a 1.
 */

const BLACK = rgb(0, 0, 0);

export function parseColor(hex: string | undefined, fallback: RGB = BLACK): RGB {
  if (!hex) return fallback;

  let value = hex.trim().replace(/^#/, '');

  // forma curta: "abc" -> "aabbcc"
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }

  if (!/^[0-9a-fA-F]{6}$/.test(value)) return fallback;

  const int = Number.parseInt(value, 16);
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}
