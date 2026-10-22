/**
 * Between a task note and an issue body.
 *
 * A note is Trix HTML (see basecamp-richtext.ts for the subset: div, h1,
 * br, strong, em, del or strike, a, pre, ul, ol, li, blockquote, and
 * pictures). An issue body is GitHub markdown. This file turns each into
 * the other, for that subset only. It runs on the server, where there is
 * no DOMParser, so it reads HTML with a small tokenizer. It only ever reads
 * HTML that Trix or this file wrote.
 *
 * The two directions do not have to undo each other exactly. The sync
 * keeps a base copy of each side (github-sync.ts), so a note that comes
 * back from GitHub a little different is never read as an edit.
 *
 * The body also carries the subtasks: the task list at the end of the body
 * is the task's subtasks, one checkbox each. splitIssueBody and
 * joinIssueBody take that part off and put it back.
 *
 * Pictures: one on GitHub (an issue body's `<img>` tag, as GitHub's own
 * editor writes it, or `![alt](address)`) is a picture in the note, as a
 * plain `<img>` with its GitHub address, and goes back the way it came. A
 * picture added here does not go to GitHub: GitHub has no API to upload
 * one to an issue. It stays in the local note.
 */

// ---------------------------------------------------------------------------
// Subtasks in the body.

export type BodySubtask = { text: string; done: boolean };

const TASK_LINE = /^\s{0,3}[-*+] \[( |x|X)\] ?(.*)$/;

/** Line ends and the spaces at the end, as GitHub's web editor varies them. */
export function normalizeMarkdown(body: string | null | undefined): string {
  return (body ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/**
 * The note part and the subtasks of a body. The subtasks are the run of
 * task-list lines at the very end; a task list higher up is part of the
 * note.
 */
export function splitIssueBody(body: string | null | undefined): {
  notes: string;
  subtasks: BodySubtask[];
} {
  const lines = normalizeMarkdown(body).split("\n");
  const subtasks: BodySubtask[] = [];
  let end = lines.length;
  while (end > 0) {
    const match = lines[end - 1].match(TASK_LINE);
    if (!match) break;
    subtasks.unshift({ text: match[2].trim(), done: match[1] !== " " });
    end -= 1;
  }
  return {
    notes: normalizeMarkdown(lines.slice(0, end).join("\n")),
    subtasks: subtasks.filter((s) => s.text),
  };
}

export function joinIssueBody(notes: string, subtasks: BodySubtask[]): string {
  const list = subtasks
    .map((s) => `- [${s.done ? "x" : " "}] ${s.text.replace(/\s*\n\s*/g, " ")}`)
    .join("\n");
  return normalizeMarkdown([normalizeMarkdown(notes), list].filter(Boolean).join("\n\n"));
}

// ---------------------------------------------------------------------------
// HTML to markdown.

type Node =
  | { kind: "text"; text: string }
  | { kind: "el"; tag: string; attrs: Record<string, string>; children: Node[] };

const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "source", "wbr"]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** A forgiving parse into a tree: unknown tags kept, stray closers dropped. */
function parseHtml(html: string): Node[] {
  const root: Node = { kind: "el", tag: "#root", attrs: {}, children: [] };
  const stack: Extract<Node, { kind: "el" }>[] = [root as Extract<Node, { kind: "el" }>];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|[^<]+|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const token = m[0];
    const top = stack[stack.length - 1];
    if (token.startsWith("<!--")) continue;
    if (!m[1]) {
      top.children.push({ kind: "text", text: decodeEntities(token) });
      continue;
    }
    const tag = m[1].toLowerCase();
    if (token[1] === "/") {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const el: Extract<Node, { kind: "el" }> = {
      kind: "el",
      tag,
      attrs: parseAttrs(m[2]),
      children: [],
    };
    top.children.push(el);
    if (!VOID.has(tag) && !m[2].trimEnd().endsWith("/")) stack.push(el);
  }
  return (root as Extract<Node, { kind: "el" }>).children;
}

/**
 * A picture as GitHub writes it: its own `<img>` tag when it has a size
 * (GitHub's editor always gives one), else plain markdown. Only an http(s)
 * address; anything else is no picture.
 */
function imageMarkdown(attrs: Record<string, string>): string {
  const src = attrs.src;
  if (!src || !/^https?:/i.test(src)) return "";
  const alt = attrs.alt ?? "";
  if (attrs.width || attrs.height) {
    const q = (v: string) => v.replace(/"/g, "&quot;");
    const size = [
      attrs.width ? `width="${q(attrs.width)}"` : "",
      attrs.height ? `height="${q(attrs.height)}"` : "",
    ].filter(Boolean).join(" ");
    return `<img ${size} alt="${q(alt)}" src="${q(src)}" />`;
  }
  return `![${escapeInline(alt)}](${src.replace(/[()\s]/g, encodeURIComponent)})`;
}

/** Characters that would start markdown, escaped so the text stays text. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]<~])/g, "\\$1");
}

/** And the ones that only matter at the start of a line. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)([#>+-])(?=\s|$)/, "$1\\$2")
    .replace(/^(\s*\d+)\.(?=\s)/, "$1\\.");
}

function textOf(node: Node): string {
  if (node.kind === "text") return node.text;
  if (node.tag === "br") return "\n";
  return node.children.map(textOf).join("");
}

function wrap(mark: string, inner: string): string {
  // Markdown emphasis cannot start or end on a space.
  const lead = inner.match(/^\s*/)![0];
  const trail = inner.match(/\s*$/)![0];
  const core = inner.trim();
  return core ? `${lead}${mark}${core}${mark}${trail}` : inner;
}

function inline(nodes: Node[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += escapeInline(node.text.replace(/\s+/g, " "));
      continue;
    }
    const inner = () => inline(node.children);
    switch (node.tag) {
      case "br":
        out += "\n";
        break;
      case "strong":
      case "b":
        out += wrap("**", inner());
        break;
      case "em":
      case "i":
        out += wrap("*", inner());
        break;
      case "del":
      case "strike":
      case "s":
        out += wrap("~~", inner());
        break;
      case "code":
        out += "`" + textOf(node).replace(/`/g, "ˋ") + "`";
        break;
      case "a": {
        const href = node.attrs.href;
        const label = inner();
        out += href && /^(https?:|mailto:)/i.test(href)
          ? `[${label || escapeInline(href)}](${href.replace(/[()\s]/g, encodeURIComponent)})`
          : label;
        break;
      }
      case "img": {
        out += imageMarkdown(node.attrs);
        break;
      }
      // Pictures and their captions stay in the local note (see the top).
      case "figure":
      case "figcaption":
      case "bc-attachment":
        break;
      default:
        out += inner();
    }
  }
  return out;
}

const BLOCK = new Set([
  "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "ul", "ol", "li",
  "blockquote", "figure", "hr",
]);

function isBlock(node: Node): boolean {
  return node.kind === "el" && BLOCK.has(node.tag);
}

/** Inline text of a block, one markdown line per line, starts escaped. */
function paragraph(nodes: Node[]): string {
  return inline(nodes)
    .split("\n")
    .map((line) => escapeLineStart(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function indent(text: string, by: string): string {
  return text
    .split("\n")
    .map((line) => (line ? by + line : line))
    .join("\n");
}

function blocks(nodes: Node[]): string[] {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    const text = paragraph(run);
    if (text) out.push(text);
    run = [];
  };
  for (const node of nodes) {
    if (!isBlock(node)) {
      run.push(node);
      continue;
    }
    flush();
    const el = node as Extract<Node, { kind: "el" }>;
    switch (el.tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const text = inline(el.children).replace(/\s+/g, " ").trim();
        if (text) out.push(`${"#".repeat(Number(el.tag[1]))} ${text}`);
        break;
      }
      case "pre": {
        const code = textOf(el).replace(/\n$/, "");
        const fence = code.includes("```") ? "~~~" : "```";
        out.push(`${fence}\n${code}\n${fence}`);
        break;
      }
      case "blockquote": {
        const inner = blocks(el.children).join("\n\n");
        if (inner) {
          out.push(inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
        }
        break;
      }
      case "ul":
      case "ol": {
        const items = el.children.filter(
          (c): c is Extract<Node, { kind: "el" }> => c.kind === "el" && c.tag === "li"
        );
        const lines = items.map((item, i) => {
          const marker = el.tag === "ol" ? `${i + 1}. ` : "- ";
          const body = blocks(item.children).join("\n") || "";
          const [first, ...rest] = body.split("\n");
          return [marker + (first ?? ""), indent(rest.join("\n"), " ".repeat(marker.length))]
            .filter(Boolean)
            .join("\n");
        });
        if (lines.length) out.push(lines.join("\n"));
        break;
      }
      case "hr":
        out.push("---");
        break;
      case "figure":
        break;
      default:
        // div, p, li: Trix puts paragraphs in a div, split by <br><br>.
        out.push(...blocks(el.children));
    }
  }
  flush();
  return out;
}

/** A task note as an issue body's markdown. */
export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return "";
  return normalizeMarkdown(blocks(parseHtml(html)).join("\n\n"));
}

// ---------------------------------------------------------------------------
// Markdown to HTML.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

/** A picture from GitHub as a note's plain <img>: an http(s) address only. */
function pictureHtml(attrs: Record<string, string>): string | null {
  const src = attrs.src;
  if (!src || !/^https?:/i.test(src)) return null;
  const size = (v: string | undefined) => (v && /^\d{1,5}$/.test(v) ? v : null);
  const parts = [`src="${escapeHtml(src)}"`, `alt="${escapeHtml(attrs.alt ?? "")}"`];
  const width = size(attrs.width);
  const height = size(attrs.height);
  if (width) parts.push(`width="${width}"`);
  if (height) parts.push(`height="${height}"`);
  return `<img ${parts.join(" ")}>`;
}

/** Inline markdown to Trix's inline HTML. */
function inlineHtml(text: string): string {
  // Code spans and escapes first, held out of the way of the other rules.
  const held: string[] = [];
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`;
  let s = text
    .replace(/`([^`]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/\\([\\`*_{}[\]()#+\-.!<>~|])/g, (_, ch: string) => hold(escapeHtml(ch)));
  // A picture: GitHub's own <img> tag, or markdown's ![alt](address).
  s = s.replace(/<img\b[^>]*>/gi, (whole) => {
    const html = pictureHtml(parseAttrs(whole.slice(4).replace(/\/?>$/, "")));
    return html ? hold(html) : whole;
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, alt: string, url: string) => {
    const html = pictureHtml({ src: url, alt });
    return html ? hold(html) : whole;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, label: string, url: string) => {
    const href = safeHref(url);
    return href ? hold(`<a href="${escapeHtml(href)}">${inlineHtml(label)}</a>`) : whole;
  });
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, url: string) =>
    hold(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`)
  );
  s = escapeHtml(s)
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>")
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => held[Number(i)]);
}

type ListItem = { lines: string[] };

/** One block's lines to HTML, recursing into quotes and list items. */
function blocksHtml(lines: string[]): string {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(para.map(inlineHtml).join("<br>"));
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s{0,3}(```+|~~~+)/);
    if (fence) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`\u0001<pre>${escapeHtml(code.join("\n"))}</pre>`);
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      out.push(`\u0001<h1>${inlineHtml(heading[1])}</h1>`);
      i += 1;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s{0,3}> ?/, ""));
        i += 1;
      }
      out.push(`\u0001<blockquote>${blocksHtml(quoted)}</blockquote>`);
      continue;
    }
    const bullet = line.match(/^(\s{0,3})([-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      flush();
      const ordered = /\d/.test(bullet[2]);
      const depth = bullet[1].length;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s{0,3})([-*+]|\d+[.)])\s+(.*)$/);
        if (m && m[1].length <= depth + 1 && /\d/.test(m[2]) === ordered) {
          items.push({ lines: [m[3]] });
          i += 1;
          continue;
        }
        // An indented line belongs to the item above it.
        if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1].lines.push(lines[i].replace(/^\s{2,4}/, ""));
          i += 1;
          continue;
        }
        break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(
        `\u0001<${tag}>${items
          .map((item) => `<li>${blocksHtml(item.lines).replace(/^<div>([\s\S]*?)<\/div>/, "$1")}</li>`)
          .join("")}</${tag}>`
      );
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      i += 1;
      continue;
    }
    if (!line.trim()) {
      flush();
      // A blank line between paragraphs: Trix keeps it as <br><br>.
      if (out.length && !out[out.length - 1].startsWith("\u0001")) out.push("\u0002");
      i += 1;
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flush();

  // Runs of paragraphs share one div, split by <br><br>, as Trix writes.
  let html = "";
  let run: string[] = [];
  const close = () => {
    while (run[run.length - 1] === "\u0002") run.pop();
    if (run.length) {
      // A marker is the empty line between two: p<br><br>p.
      html += `<div>${run.map((p) => (p === "\u0002" ? "" : p)).join("<br>")}</div>`;
    }
    run = [];
  };
  for (const part of out) {
    if (part.startsWith("\u0001")) {
      close();
      html += part.slice(1);
    } else {
      run.push(part);
    }
  }
  close();
  return html;
}

/** An issue body's note part as a task note, in Trix's HTML. */
export function markdownToHtml(markdown: string | null | undefined): string {
  const text = normalizeMarkdown(markdown);
  if (!text) return "";
  return blocksHtml(text.split("\n"));
}

/**
 * The pictures of a local note, kept when a note comes from GitHub. GitHub
 * never had them (see the top), so a body edited there would otherwise
 * take them out of the note.
 */
export function notePictures(html: string | null | undefined): string {
  if (!html) return "";
  return (html.match(/<figure\b[\s\S]*?<\/figure>|<bc-attachment\b[\s\S]*?<\/bc-attachment>/gi) ?? []).join("");
}

/** Two notes are the same note when they say the same in markdown. */
export function sameNote(a: string | null | undefined, b: string | null | undefined): boolean {
  return htmlToMarkdown(a) === htmlToMarkdown(b);
}
