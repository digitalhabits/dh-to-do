/**
 * A note's words, as paragraphs, for a peek at it (NotesChip): no
 * markup, no pictures. Parsed by DOMParser, which runs nothing; a block
 * or a line break ends a paragraph.
 */
export function notesParagraphs(html: string | null | undefined): string[] {
  if (!html || typeof DOMParser === "undefined") return [];
  const marked = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|h[1-6]|blockquote|pre)>/gi, "$&\n");
  const doc = new DOMParser().parseFromString(marked, "text/html");
  doc.querySelectorAll("figure, img, script, style").forEach((el) => el.remove());
  return (doc.body.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
