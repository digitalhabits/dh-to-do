/**
 * The light DOM every mounted- suite renders the page against.
 *
 * A copy of apps/mail/tests/mounted-dom.mjs. It is a copy, not an import,
 * because this directory goes to the public To-Do mirror, and the mirror
 * holds no Mail code. When one of the two changes, change the other too.
 *
 * happy-dom's window, with the globals a component module reads when it
 * loads. They must stand before any such module runs, so a suite calls
 * installDom() first and then imports its walk dynamically.
 *
 * Node has an Event and a CustomEvent of its own, which happy-dom will not
 * deliver: Radix makes a CustomEvent when a menu opens, and the text size
 * announces its change with an Event. So the DOM's own are put in place
 * always, over Node's.
 */

import { Window } from "happy-dom";

export function installDom(url = "http://localhost:3482/") {
  const win = new Window({ url });
  globalThis.window = win;
  for (const key of [
    "document",
    "navigator",
    "location",
    "history",
    "localStorage",
    "sessionStorage",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "matchMedia",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLIFrameElement",
    "SVGElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
    "PointerEvent",
    "DragEvent",
    "StorageEvent",
    "MutationObserver",
    "ResizeObserver",
    "IntersectionObserver",
    "FileReader",
    "CSSStyleDeclaration",
    "DOMParser",
    "XMLSerializer",
    "Range",
    "Selection",
    "Text",
    "Comment",
    "DocumentFragment",
    "NodeFilter",
    "HTMLTextAreaElement",
    "ClipboardEvent",
    "DataTransfer",
    "CSS",
  ]) {
    if (win[key] !== undefined && globalThis[key] === undefined) {
      globalThis[key] = win[key];
    }
  }
  globalThis.Event = win.Event;
  globalThis.CustomEvent = win.CustomEvent;
  // Node 21 and later have a navigator of their own, with no onLine: a
  // page that asks `navigator.onLine` would take itself to be offline.
  Object.defineProperty(globalThis, "navigator", {
    value: win.navigator,
    configurable: true,
    writable: true,
  });
  // happy-dom leaves these out; the app only needs them to exist.
  for (const name of ["ResizeObserver", "IntersectionObserver"]) {
    if (typeof globalThis[name] === "undefined") {
      globalThis[name] = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  }
  return win;
}
