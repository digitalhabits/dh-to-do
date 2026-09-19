/** Client-safe helpers for to-do people avatars and labels. */

const AVATAR_COLOURS = [
  "#0d9488", // teal
  "#1e293b", // slate
  "#2563eb", // blue
  "#b45309", // amber
  "#7c3aed", // violet
  "#be123c", // rose
  "#0f766e", // dark teal
  "#334155", // gray
];

/** Titles that shouldn't become the "first name" in short labels (Dr L., Prof S.). */
const NAME_HONORIFICS = new Set([
  "dr",
  "dr.",
  "mr",
  "mr.",
  "mrs",
  "mrs.",
  "ms",
  "ms.",
  "miss",
  "prof",
  "prof.",
  "professor",
  "sir",
  "dame",
  "rev",
  "rev.",
  "revd",
  "revd.",
]);

function nameParts(name: string): string[] {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_HONORIFICS.has(parts[0].toLowerCase())) {
    parts.shift();
  }
  return parts;
}

export function initialsOf(name: string): string {
  const parts = nameParts(name);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  return `${first}${last}`.toUpperCase();
}

/** "Anton Asmund" → "Anton A."; "Dr Vera Holm" → "Vera H." */
export function shortPersonName(name: string): string {
  const parts = nameParts(name);
  if (parts.length === 0) return name.trim();
  if (parts.length < 2) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0]?.toUpperCase() ?? ""}.`;
}

/**
 * Key for matching two spellings of one person: honorifics dropped, accents
 * folded, punctuation and spacing ignored. "Dr Vera Holm" and "vera  holm"
 * give the same key.
 */
export function personNameKey(name: string): string {
  return nameParts(name)
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function colourForPerson(name: string, explicit?: string | null): string {
  if (explicit && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(explicit)) {
    return explicit;
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}
