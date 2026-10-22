/*
 * A picture in a note, made bigger or smaller by its corners.
 *
 * The width is kept on the attachment as `displayWidth` (ours, in CSS
 * pixels), so it goes into the note's HTML and comes back with it; see
 * DH_WIDTH in basecamp-richtext.ts. A picture without one is drawn as
 * before: as wide as it is, up to the column.
 *
 * Everything here writes to the `<img>` and to handles marked
 * `data-trix-mutable`. Trix marks every picture's `<img>` so already, and
 * it ignores changes inside such elements. A change anywhere else in a
 * figure makes Trix read the note again from the page.
 */

type Attachment = { setAttributes: (attributes: Record<string, unknown>) => void };
type Editor = {
  getDocument?: () => { getAttachmentById?: (id: number) => Attachment | undefined };
};
type Element_ = HTMLElement;

/** The attachment a figure draws, from the editor's document. */
function attachmentOf(el: Element_, figure: HTMLElement): Attachment | undefined {
  const editor = (el as unknown as { editor?: Editor }).editor;
  return editor?.getDocument?.().getAttachmentById?.(Number(figure.dataset.trixId));
}

/**
 * The width onto the attachment, which saves the note.
 *
 * Trix's redraw after a change to an attachment finds no view to renew, so
 * the figure on the page keeps the old attachment data and a later look
 * at it would undo the width. The figure is written to as well: while the
 * picture is chosen Trix has marked it mutable, so it lets it be.
 */
function setWidth(el: Element_, figure: HTMLElement, width: number | null) {
  const attachment = attachmentOf(el, figure);
  if (!attachment) return;
  attachment.setAttributes({ displayWidth: width });
  figure.setAttribute("data-trix-attachment", JSON.stringify(attachment));
  applyPictureWidths(el);
}

const CORNERS = ["nw", "ne", "sw", "se"] as const;
const MIN_WIDTH = 60;

function shownWidth(figure: Element): number | null {
  try {
    const data = JSON.parse(figure.getAttribute("data-trix-attachment") ?? "{}");
    const width = Number(data?.displayWidth);
    return Number.isFinite(width) && width > 0 ? width : null;
  } catch {
    return null;
  }
}

/** Each picture at the width it was given. Run after every redraw. */
export function applyPictureWidths(el: HTMLElement) {
  el.querySelectorAll("figure.attachment--preview").forEach((figure) => {
    const img = figure.querySelector("img");
    if (!img) return;
    // Side by side, a picture takes its share of the row.
    const width = figure.parentElement?.classList.contains("attachment-gallery")
      ? null
      : shownWidth(figure);
    const style = width ? `${width}px` : "";
    if (img.style.width !== style) img.style.width = style;
    img.classList.toggle("is-sized", Boolean(width));
  });
}

function placeHandles(figure: HTMLElement, img: HTMLImageElement) {
  const left = img.offsetLeft;
  const top = img.offsetTop;
  const right = left + img.offsetWidth;
  const bottom = top + img.offsetHeight;
  figure.querySelectorAll<HTMLElement>(".dh-resize-handle").forEach((handle) => {
    const corner = handle.dataset.corner ?? "se";
    handle.style.left = `${corner.endsWith("w") ? left : right}px`;
    handle.style.top = `${corner.startsWith("n") ? top : bottom}px`;
  });
}

/**
 * Corner handles on the chosen picture, and none on any other.
 *
 * Trix builds the chosen picture's furniture itself and takes it away
 * when the picture is let go; the handles follow the toolbar, which is
 * how a picture tells it is chosen.
 */
export function dressResizeHandles(el: Element_) {
  el.querySelectorAll<HTMLElement>("figure.attachment--preview").forEach((figure) => {
    const img = figure.querySelector("img");
    const chosen = Boolean(figure.querySelector(".attachment__toolbar"));
    const inGallery = figure.parentElement?.classList.contains("attachment-gallery");
    const handles = figure.querySelectorAll(".dh-resize-handle");
    if (!chosen || !img || inGallery) {
      handles.forEach((h) => h.remove());
      return;
    }
    if (handles.length === 0) {
      for (const corner of CORNERS) figure.appendChild(resizeHandle(el, figure, img, corner));
    }
    placeHandles(figure, img);
  });
}

function resizeHandle(
  el: Element_,
  figure: HTMLElement,
  img: HTMLImageElement,
  corner: (typeof CORNERS)[number]
): HTMLElement {
  const handle = document.createElement("span");
  handle.className = "dh-resize-handle";
  handle.dataset.corner = corner;
  handle.setAttribute("data-trix-mutable", "true");
  handle.setAttribute("aria-hidden", "true");
  handle.addEventListener("mousedown", (event) => {
    // Not a click on the picture: that would let it go.
    event.preventDefault();
    event.stopPropagation();
  });
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    // The planner zooms the page with CSS: the pointer moves in the
    // window's pixels, the width is written in the page's.
    const scale = img.getBoundingClientRect().width / (img.offsetWidth || 1) || 1;
    const startX = event.clientX;
    const startWidth = img.offsetWidth;
    const sign = corner.endsWith("e") ? 1 : -1;
    const room = figure.parentElement?.clientWidth || el.clientWidth;
    let width = startWidth;
    const move = (e: PointerEvent) => {
      width = Math.round(
        Math.max(MIN_WIDTH, Math.min(room, startWidth + (sign * (e.clientX - startX)) / scale))
      );
      img.style.width = `${width}px`;
      img.classList.add("is-sized");
      placeHandles(figure, img);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (width === startWidth) return;
      setWidth(el, figure, width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
  // A double click gives the picture back its own size.
  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setWidth(el, figure, null);
  });
  return handle;
}
