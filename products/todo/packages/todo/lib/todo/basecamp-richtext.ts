/**
 * Between the HTML Basecamp keeps and the HTML Trix writes.
 *
 * A task note on a linked list is one replica of a Basecamp rich text
 * field, so `notes_html` is stored in Basecamp's own shape and the sync
 * pushes and pulls it untranslated. The editor is the only place that
 * converts, on the way in and on the way out.
 *
 * The two shapes are nearly the same, which is the reason for using Trix at
 * all. Basecamp keeps `div, h1, br, strong, em, strike, a[href], pre, ol,
 * ul, li, blockquote` and `bc-attachment`, and removes everything else.
 * Trix writes all of those, in the same nesting, with two differences:
 *
 *   - Strikethrough. Trix writes `<del>` and reads `<del>`. Basecamp keeps
 *     `<strike>` and does not know `<del>`. Neither side recognises the
 *     other's tag, so struck text disappears in both directions without
 *     this — checked, not assumed.
 *   - Attachments. Basecamp writes `<bc-attachment sgid>`, Trix writes
 *     `<figure data-trix-attachment='{json}'>`. Trix drops an unknown
 *     element on load, so a colleague's image would vanish the first time
 *     anybody here opened the note.
 *
 * Trix keeps unknown keys inside `data-trix-attachment`, so the sgid rides
 * inside the document and needs no table of its own.
 *
 * Runs in the browser: the editor is the only caller and this uses
 * `DOMParser` rather than hand-parsing HTML somebody else's server wrote.
 */

import { NOTE_MEDIA_ATTR } from "./media-store";

/** Basecamp's name for the tag; Trix has no idea what it is. */
const BC_ATTACHMENT = "bc-attachment";

/**
 * Which blob a picture is, kept on our side of the tag.
 *
 * Basecamp writes a `<bc-attachment>` fat with `url`, `href`, `width` and
 * the rest, but it only wants the sgid back — so a note saved here holds
 * the sgid alone, and reopening it before the next sync found nothing to
 * draw from. The picture went missing from under the writer seconds after
 * they added it.
 *
 * The blob id is what the read route needs, so it is written alongside.
 * Basecamp discards attributes it does not know, which is the right
 * outcome: it fills its own in, and the next pull replaces this with
 * theirs.
 */
const DH_BLOB = "data-dh-blob";

function parseBody(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html"
  );
  return doc.body;
}

/** Swap one element for another, keeping its children and its place. */
function rename(el: Element, tagName: string): Element {
  const next = el.ownerDocument.createElement(tagName);
  while (el.firstChild) next.appendChild(el.firstChild);
  el.replaceWith(next);
  return next;
}

function numberOrNull(value: string | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** What Basecamp hands back on an attachment, once it has processed it. */
type AttachmentData = {
  sgid?: string;
  caption?: string;
  contentType?: string;
  filename?: string;
  filesize?: number;
  url?: string;
  href?: string;
  width?: number;
  height?: number;
  /** Trix's own: several in a row are drawn as one gallery. */
  presentation?: string;
  /**
   * Trix draws an `<img>` when this is true or when the type looks like a
   * picture. An image with no `url` becomes `src="undefined"` — a request
   * for `/undefined`. Set false when there is nothing to draw from.
   */
  previewable?: boolean;
  /** Ours. See DH_BLOB below. */
  blobId?: string | null;
  /**
   * Ours: the picture in the app's own store, for a note Basecamp does
   * not hold (see media-store.ts). Stays on the tag after the sync has
   * given the picture to Basecamp, so the local copy draws until a pull
   * brings Basecamp's address. Basecamp strips the attribute.
   */
  mediaId?: string | null;
  /**
   * Ours, and only on a picture Basecamp wrote as a plain `<img>`.
   *
   * Basecamp's own address for it, kept while the app draws the picture
   * through its own route instead. The address names an account and a
   * preview path this app never builds, so giving Basecamp back what it
   * wrote means having kept it. Trix preserves keys it does not know —
   * measured, in a Trix of its own — which is how it survives the editor.
   */
  basecampSrc?: string;
};

function usableSrc(value: string | null | undefined): string | null {
  if (!value || value === "undefined") return null;
  return value;
}

/**
 * The blob a Basecamp attachment URL points at.
 *
 * Both addresses Basecamp gives carry it — the preview and the download —
 * as the segment after `/blobs/`. It is the only part of either that is
 * worth keeping: the hosts they name serve nobody holding an API token
 * (403 without one, 404 with one), because they answer to the web session
 * instead. The same blob on `3.basecampapi.com` does answer to the token,
 * so the id is what a caller needs and the rest is theirs to build.
 */
export function basecampBlobId(
  address: string | null | undefined
): string | null {
  if (!address) return null;
  const match = /\/blobs\/([^/?#]+)/.exec(address);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Where the picture should be read from, for whichever app is asking.
 *
 * The planner has a server and proxies it; the standalone app has Rust and
 * a scheme of its own. Neither belongs in here, so each passes its own.
 */
export type ImageSrcResolver = (attachment: {
  blobId: string | null;
  sgid?: string;
  contentType?: string;
  /** The picture in the app's own store, when it is there. */
  mediaId?: string | null;
}) => string | null;

/**
 * Basecamp's HTML, ready for `editor.loadHTML`.
 *
 * An attachment with no `url` yet — Basecamp has taken the file but not
 * finished with it — still becomes a figure, so the note keeps its place in
 * the text and the sgid survives the next save.
 */
export function basecampToTrix(
  html: string | null | undefined,
  resolveImageSrc?: ImageSrcResolver
): string {
  if (!html) return "";
  const body = parseBody(html);

  body.querySelectorAll("strike").forEach((el) => rename(el, "del"));

  body.querySelectorAll(BC_ATTACHMENT).forEach((el) => {
    const data: AttachmentData = {};
    const sgid = el.getAttribute("sgid");
    const caption = el.getAttribute("caption");
    const contentType = el.getAttribute("content-type");
    const filename = el.getAttribute("filename");
    const url = el.getAttribute("url");
    const href = el.getAttribute("href");
    const presentation = el.getAttribute("presentation");
    const filesize = numberOrNull(el.getAttribute("filesize"));
    const width = numberOrNull(el.getAttribute("width"));
    const height = numberOrNull(el.getAttribute("height"));
    if (sgid) data.sgid = sgid;
    if (caption) data.caption = caption;
    if (contentType) data.contentType = contentType;
    if (filename) data.filename = filename;
    if (filesize !== null) data.filesize = filesize;
    if (width !== null) data.width = width;
    if (height !== null) data.height = height;
    if (presentation) data.presentation = presentation;

    /*
      The address Trix will draw from.

      Basecamp's own two are no use to this app — they are served to a
      browser holding a Basecamp session, and this one holds an API token.
      The caller turns the blob into something it can serve. Where it
      cannot, no url is written: Trix then treats the file as a name,
      not as an image whose src is the word "undefined".
    */
    const blobId =
      el.getAttribute(DH_BLOB) ?? basecampBlobId(url ?? href);
    if (blobId) data.blobId = blobId;
    const mediaId = el.getAttribute(NOTE_MEDIA_ATTR);
    if (mediaId) data.mediaId = mediaId;
    const resolved = resolveImageSrc?.({
      blobId,
      sgid: sgid ?? undefined,
      contentType: contentType ?? undefined,
      mediaId,
    });
    /*
      Only an address this app can read.

      Basecamp's own two reject the API token (403 / 404). Falling back to
      them looks like a picture and then draws a broken frame. A resolver
      that answers nothing means there is nothing to draw yet.
    */
    const src = usableSrc(resolved);
    if (src) data.url = src;
    else if (contentType?.startsWith("image/")) data.previewable = false;

    const figure = el.ownerDocument.createElement("figure");
    figure.setAttribute("data-trix-attachment", JSON.stringify(data));
    if (contentType) figure.setAttribute("data-trix-content-type", contentType);
    if (presentation) {
      figure.setAttribute(
        "data-trix-attributes",
        JSON.stringify({ presentation })
      );
    }
    el.replaceWith(figure);
  });

  /*
    A picture Basecamp wrote as a plain `<img>` rather than as a tag.

    Not every picture comes back as `<bc-attachment>`: some notes hold an
    ordinary `<img>` pointing at `preview.app.basecamp.com`, which answers
    a browser holding a Basecamp session and nobody else. Left alone it is
    a 403 and a broken frame, in every browser and on every build — and
    Trix turns it into an attachment with a url and no sgid, which the
    save then dropped, taking the picture out of Basecamp's copy too.

    So it becomes a proper attachment here: drawn through this app's own
    route, carrying the blob it is, and keeping Basecamp's address for
    `trixToBasecamp` to write back.
  */
  body.querySelectorAll("img[src]").forEach((el) => {
    if (el.closest("figure[data-trix-attachment]")) return;
    const original = el.getAttribute("src");
    const blobId = basecampBlobId(original);
    if (!blobId || !original) return;

    const data: AttachmentData = {
      contentType: "image",
      blobId,
      basecampSrc: original,
    };
    const src = usableSrc(
      resolveImageSrc?.({ blobId, contentType: "image" })
    );
    if (src) data.url = src;
    else data.previewable = false;

    const figure = el.ownerDocument.createElement("figure");
    figure.setAttribute("data-trix-attachment", JSON.stringify(data));
    figure.setAttribute("data-trix-content-type", "image");
    el.replaceWith(figure);
  });

  return body.innerHTML;
}

/**
 * Trix's HTML, ready for `notes_html` and for the sync to push.
 *
 * An attachment with no sgid is one Basecamp has never been told about, so
 * there is nothing to write for it. It comes out rather than going up as a
 * tag Basecamp would strip anyway. Ask `pendingAttachments` first: a note
 * holding one is not ready to be saved to a linked list.
 */
export function trixToBasecamp(html: string | null | undefined): string {
  if (!html) return "";
  const body = parseBody(html);

  body.querySelectorAll("del").forEach((el) => rename(el, "strike"));

  body.querySelectorAll("figure[data-trix-attachment]").forEach((el) => {
    const data = readAttachmentData(el);
    // A picture in the app's own store is written whether or not Basecamp
    // has signed it yet: the sync gives it an sgid when the task reaches a
    // linked list, and the tag keeps its place in the text until then.
    if (!data?.sgid && !data?.mediaId) {
      /*
        A picture Basecamp wrote as a plain `<img>` has no sgid and never
        will — it was never uploaded through here. Removing it is what
        took two pictures out of a note and out of Basecamp's copy of it
        on the next sync, leaving their filenames behind as words.

        Basecamp's own address was kept when the note was read in, so the
        picture goes back exactly as it came. Only an attachment with no
        address at all is dropped: that one is a file still uploading,
        which `pendingAttachments` refuses to save in the first place.
      */
      if (data?.basecampSrc) {
        const img = el.ownerDocument.createElement("img");
        img.setAttribute("src", data.basecampSrc);
        el.replaceWith(img);
        return;
      }
      el.remove();
      return;
    }
    const tag = el.ownerDocument.createElement(BC_ATTACHMENT);
    if (data.sgid) tag.setAttribute("sgid", data.sgid);
    if (data.mediaId) tag.setAttribute(NOTE_MEDIA_ATTR, data.mediaId);
    if (data.caption) tag.setAttribute("caption", data.caption);
    if (data.blobId) tag.setAttribute(DH_BLOB, data.blobId);
    /*
      What the picture is, kept with it.

      Basecamp only asks for the sgid, and fills the rest in itself — but
      not until the note has been round-tripped through a sync. Reopening
      before that gave Trix an attachment with no content type, and an
      attachment Trix cannot tell is an image is not drawn as one: the
      picture simply stopped appearing. These are Basecamp's own attribute
      names, so it overwrites them with its own on the way back.
    */
    if (data.contentType) tag.setAttribute("content-type", data.contentType);
    if (data.filename) tag.setAttribute("filename", data.filename);
    if (data.width) tag.setAttribute("width", String(data.width));
    if (data.height) tag.setAttribute("height", String(data.height));
    el.replaceWith(tag);
  });

  return body.innerHTML;
}

function readAttachmentData(el: Element): AttachmentData | null {
  const raw = el.getAttribute("data-trix-attachment");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AttachmentData;
  } catch {
    return null;
  }
}

/**
 * The attachments in a Trix document that Basecamp has never seen.
 *
 * A file dropped into a note is stored here first and told to Basecamp
 * after, so between the two there is a picture on the page with no sgid.
 * Saving then would drop it silently.
 */
export function pendingAttachments(html: string | null | undefined): number {
  if (!html) return 0;
  const body = parseBody(html);
  let pending = 0;
  body.querySelectorAll("figure[data-trix-attachment]").forEach((el) => {
    const data = readAttachmentData(el);
    /*
      A picture Basecamp wrote as a plain `<img>` has no sgid and is not
      waiting for one: it is already at Basecamp, and the save writes it
      back as the `<img>` it came in as. Counting it held the whole note
      hostage — every save refused, for a picture that was never in
      flight.
    */
    if (!data?.sgid && !data?.basecampSrc && !data?.mediaId) pending += 1;
  });
  return pending;
}
