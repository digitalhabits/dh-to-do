/**
 * A drag that ends outside a dialog or menu does not close it.
 *
 * Press inside one (to select text) and let go outside it, and the browser
 * fires the click on the box that holds both ends, such as the backdrop.
 * Every "click outside closes" handler then closed the dialog. So a click
 * whose press began inside one of these boxes, and which landed outside
 * it, is stopped before the page sees it. As in Digital Habits: Blocker.
 */

const BOXES = [
  ".modal-content", ".people-editor", ".notes-overlay-card", ".trix-lightbox-frame",
  ".todo-menu-portal", ".assign-menu-portal", ".board-pill-menu", ".task-list-picker",
].join(",");

let pressBox: Element | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (event) => {
    pressBox = event.target instanceof Element ? event.target.closest(BOXES) : null;
  }, true);
  window.addEventListener("click", (event) => {
    const box = pressBox;
    pressBox = null;
    if (box?.isConnected && event.target instanceof Node && !box.contains(event.target)) {
      event.stopPropagation();
    }
  }, true);
}
