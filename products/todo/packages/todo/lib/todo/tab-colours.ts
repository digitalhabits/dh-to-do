/**
 * The colours of a list's tab and of a group's.
 *
 * No React in here, so a test can read it.
 */

/* Colour handling ported from redd-do app.js. Swatch display colours follow
   the redd-do modal markup; stored named colours resolve via TAB_COLOR_HEX. */
export const TAB_COLOR_HEX: Record<string, string> = {
  red: "#FF9E9E",
  orange: "#FFC09F",
  yellow: "#FFEE93",
  green: "#ADF7B6",
  blue: "#81B1D1",
  purple: "#B19CD9",
  pink: "#FFD1DC",
  gray: "#A0CED9",
};

export const COLOR_SWATCHES: { key: string; title: string; display: string }[] = [
  { key: "blue", title: "Sky", display: "#7da9c8" },
  { key: "gray", title: "Ice", display: "#8eb5b0" },
  { key: "green", title: "Mint", display: "#8cb89c" },
  { key: "yellow", title: "Buttercup", display: "#d4ba6a" },
  { key: "pink", title: "Blush", display: "#d4a5a8" },
  { key: "orange", title: "Apricot", display: "#d99a6c" },
  { key: "red", title: "Sunset", display: "#d4605a" },
  { key: "purple", title: "Lavender", display: "#a896c0" },
];

export function normalizeHexColor(color: string): string | null {
  if (!color.startsWith("#")) return null;
  let hex = color.slice(1).trim();
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toLowerCase()}`;
}

export function resolveTabColorHex(color: string | null): string | null {
  if (!color) return null;
  if (color.startsWith("#")) return normalizeHexColor(color);
  return TAB_COLOR_HEX[color] || null;
}

export function hexToRgba(hex: string, alpha: number): string | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const raw = normalized.slice(1);
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

