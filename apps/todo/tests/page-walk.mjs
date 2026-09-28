/**
 * What every walk of the page does with its hands: wait, type, press,
 * click and carry. Plus the fakes a walk needs beside the board: a
 * BroadcastChannel for the focus windows, a shell with a Tauri bridge,
 * and boxes for the rows, which happy-dom does not lay out.
 *
 * A walk module (walk-*.mjs) takes a `page` from here and does not care
 * which flavour of the page it is: the desktop app's, or the planner's
 * To-Do tab. The two `*.impl.mjs` files of a walk make the page and hand
 * it over. So each check runs in both flavours from one text.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `test` holds, for at most `ms`. Says whether it came true. */
export async function until(test, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(20);
  }
  return false;
}

/** Let React and the store finish what one gesture started. */
export async function settle(ms = 300) {
  await sleep(ms);
}

export const text = () => document.body.textContent ?? "";
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** The card of the task with these words, or null. */
export function cardOf(words) {
  return (
    $$(".task-item").find((row) => row.querySelector(".task-text")?.textContent === words) ?? null
  );
}

/** Type into a text box the way React hears it: the native setter, then input. */
export function typeInto(el, value) {
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}

/** A key goes down on `el` (the window when left out). */
export function press(el, key, extra = {}) {
  (el ?? window).dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra })
  );
}

/** The platform's command key with `key`, as a Mac reader presses it. */
export function pressCmd(el, key, extra = {}) {
  press(el, key, { metaKey: true, ...extra });
}

export function click(el) {
  if (!el) throw new Error("click: there is nothing to click");
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** A press on `el` as the page's outside-click listeners hear it. */
export function pointerDown(el, extra = {}) {
  el.dispatchEvent(
    new window.PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerType: "mouse",
      ...extra,
    })
  );
  el.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true, ...extra }));
}

export function blur(el) {
  el.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  el.dispatchEvent(new window.FocusEvent("blur", { bubbles: false }));
}

/**
 * Boxes for the rows. happy-dom lays nothing out, so every box is zero and
 * a drag has no row to be over. `boxOf(el)` answers a box for an element,
 * or null for the zero box. Returns a function that takes the boxes away.
 */
export function stubBoxes(boxOf) {
  const proto = window.Element.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    const box = boxOf(this);
    if (!box) return original.call(this);
    const { left = 0, top = 0, width = 100, height = 20 } = box;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON() {},
    };
  };
  return () => {
    proto.getBoundingClientRect = original;
  };
}

/**
 * What is under the pointer. happy-dom has no layout, so a walk that drags
 * says what each point is over. Returns a function that takes it away.
 */
export function stubPointAt(elementAt) {
  const original = document.elementFromPoint;
  document.elementFromPoint = (x, y) => elementAt(x, y);
  return () => {
    document.elementFromPoint = original;
  };
}

/** Carry `el` from one point to another with the pointer, and let go. */
export async function drag(el, from, to, steps = 3) {
  el.dispatchEvent(
    new window.PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerType: "mouse",
      clientX: from.x,
      clientY: from.y,
    })
  );
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    window.dispatchEvent(
      new window.PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
      })
    );
    await sleep(20);
  }
  window.dispatchEvent(
    new window.PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse",
      clientX: to.x,
      clientY: to.y,
    })
  );
}

/**
 * A BroadcastChannel in memory, as the focus windows and the board use it.
 * A message goes to every other channel of the same name on the next turn.
 * `posts` holds what each channel sent, for a check to read.
 */
export function installBroadcastChannel() {
  const open = new Map();
  const posts = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      if (!open.has(name)) open.set(name, new Set());
      open.get(name).add(this);
    }
    postMessage(data) {
      posts.push({ name: this.name, data });
      for (const other of open.get(this.name) ?? []) {
        if (other === this || other.closed) continue;
        setTimeout(() => other.onmessage?.({ data: structuredClone(data) }), 0);
      }
    }
    close() {
      this.closed = true;
      open.get(this.name)?.delete(this);
    }
    addEventListener() {}
    removeEventListener() {}
  }
  globalThis.BroadcastChannel = window.BroadcastChannel = FakeBroadcastChannel;
  return {
    posts,
    /** A channel of the walk's own, as a focus window would hold. */
    channel: (name) => new FakeBroadcastChannel(name),
    /** How many channels of this name the page holds open. */
    openCount: (name) => [...(open.get(name) ?? [])].filter((c) => !c.closed).length,
  };
}

/**
 * The desktop shell's bridge, `window.__TAURI__`, over the fake board's
 * invoke. The page then takes itself for a native shell: focus windows,
 * Reminders. Every command that is not SQL lands in `board.commands`.
 * `answers` gives a command a reply of its own.
 */
export function installShell(answers = {}) {
  const inner = window.__TAURI_INTERNALS__.invoke;
  const invoke = async (command, args = {}) => {
    const out = await inner(command, args);
    if (command in answers) {
      const answer = answers[command];
      return typeof answer === "function" ? answer(args) : answer;
    }
    return out;
  };
  window.__TAURI__ = {
    core: { invoke },
    event: { listen: async () => () => {} },
  };
  return () => {
    delete window.__TAURI__;
  };
}

/**
 * A stand-in for Trix's `<trix-editor>`. The real one is a script the page
 * loads from its own server, which a walk has not got. This one holds its
 * HTML in `value`, says `trix-initialize` when it is put on the page, and
 * `write(el, html)` types into it: the value, then `trix-change`, as Trix
 * sends it.
 */
export function installFakeTrix() {
  if (window.customElements.get("trix-editor")) return;
  class FakeTrixEditor extends window.HTMLElement {
    constructor() {
      super();
      this._value = "";
      const self = this;
      this.editor = {
        loadHTML(html) {
          self._value = html;
        },
        getDocument() {
          return { toString: () => `${self.textContent}\n` };
        },
        setSelectedRange() {},
      };
    }
    get value() {
      return this._value;
    }
    set value(html) {
      this._value = html;
    }
    connectedCallback() {
      setTimeout(() => {
        this.dispatchEvent(new window.Event("trix-initialize"));
        this.dataset.initialized = "1";
      }, 0);
    }
  }
  window.customElements.define("trix-editor", FakeTrixEditor);
}

/**
 * The fake Trix editor that matches `selector`, once it has said
 * `trix-initialize`. The page loads the note into it then, so a note
 * written before that is overwritten.
 */
export async function noteEditor(selector, ms = 3000) {
  const ready = `${selector}[data-initialized]`;
  return (await until(() => Boolean(document.querySelector(ready)), ms))
    ? document.querySelector(ready)
    : null;
}

/**
 * An XMLHttpRequest that records each upload and answers it at once with
 * `answer` (an object, sent as JSON). The planner sends a note's pictures
 * this way; node has no XMLHttpRequest of its own. The desktop app's
 * store write is answered with `answer.mediaId` as the picture's id.
 */
export function installUploads(answer) {
  const sent = [];
  class FakeXhr {
    constructor() {
      this.status = 0;
      this.responseText = "";
      this.listeners = {};
      this.upload = { addEventListener() {} };
    }
    open(method, url) {
      this.request = { method, url };
    }
    setRequestHeader() {}
    addEventListener(name, fn) {
      (this.listeners[name] ??= []).push(fn);
    }
    send() {
      sent.push(this.request);
      setTimeout(() => {
        this.status = 200;
        this.responseText = JSON.stringify(answer);
        for (const fn of this.listeners.load ?? []) fn();
      }, 0);
    }
  }
  globalThis.XMLHttpRequest = window.XMLHttpRequest = FakeXhr;
  // The desktop app writes the picture to its SQLite store instead.
  const bridge = window.__TAURI_INTERNALS__;
  if (bridge) {
    const inner = bridge.invoke;
    bridge.invoke = async (command, args = {}) => {
      const out = await inner(command, args);
      return command === "todo_media_write" ? { id: answer.mediaId, ...args } : out;
    };
  }
  return sent;
}

/**
 * Drop a picture into a fake Trix editor, as Trix announces one. Answers
 * the attributes the page gave the picture once its upload was done.
 */
export function dropPicture(el, name = "picture.png") {
  const given = [];
  const event = new window.Event("trix-attachment-add");
  event.attachment = {
    file: new window.File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" }),
    setAttributes: (attributes) => given.push(attributes),
    setUploadProgress() {},
    remove() {},
  };
  el.dispatchEvent(event);
  return given;
}

/** Type into a fake Trix editor: the note's HTML, then the change. */
export function writeNote(el, html) {
  el.value = html;
  el.dispatchEvent(new window.Event("trix-change", { bubbles: true }));
}

/**
 * Hold back the store's writes that match `sql` for `ms`, on the SQL bridge
 * both flavours end at. A check can then see the page as it is before the
 * server answers: the board's own guess, and not the server's row.
 * Returns a function that lets the writes go at once again.
 */
export function holdWrites(sql, ms) {
  const bridge = window.__TAURI_INTERNALS__;
  const inner = bridge.invoke;
  bridge.invoke = async (command, args = {}) => {
    const statement = args.statement?.sql ?? args.statements?.[0]?.sql ?? "";
    if (sql.test(statement)) await sleep(ms);
    return inner(command, args);
  };
  return () => {
    bridge.invoke = inner;
  };
}

/**
 * Mount the page into a new element. `unmount` takes it away again, and
 * each walk step can mount a page of its own.
 */
export function mountPage(TodoPage, props) {
  installFakeTrix();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  flushSync(() => root.render(React.createElement(TodoPage, props)));
  return {
    el,
    unmount() {
      flushSync(() => root.unmount());
      el.remove();
    },
  };
}

/**
 * Run a hook in a component of its own, for a check of the hook alone.
 * `result()` is what the hook answered on its last render, `rerender(args)`
 * renders again with new arguments, and `unmount()` takes it away.
 */
export function renderHook(hook, initialArgs) {
  let latest;
  let args = initialArgs;
  function Probe() {
    latest = hook(args);
    return null;
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  flushSync(() => root.render(React.createElement(Probe)));
  return {
    result: () => latest,
    rerender(next) {
      args = next;
      flushSync(() => root.render(React.createElement(Probe)));
    },
    unmount() {
      flushSync(() => root.unmount());
      el.remove();
    },
  };
}
