/**
 * Typing in a note never reloads it: a reload puts the caret at the start
 * and loses a letter. The second letter lands after React draws the first
 * and before its effects run, as on a slow machine.
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

suite(async () => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { installFakeTrix, noteEditor, writeNote, settle } = await import("./page-walk.mjs");
  const { TrixNotesEditor } = await import("@/components/todo/TrixNotesEditor");
  installFakeTrix();

  let afterDraw = null;
  function Host() {
    const [draft, setDraft] = React.useState("<div>Start</div>");
    React.useLayoutEffect(() => {
      const next = afterDraw;
      afterDraw = null;
      if (next) queueMicrotask(next);
    }, [draft]);
    return React.createElement(TrixNotesEditor, { value: draft, onChange: setDraft });
  }
  const host = document.body.appendChild(document.createElement("div"));
  createRoot(host).render(React.createElement(Host));

  const el = await noteEditor("trix-editor");
  await settle();
  let loads = 0;
  const load = el.editor.loadHTML;
  el.editor.loadHTML = (html) => (loads++, load(html));

  afterDraw = () => writeNote(el, "<div>Start ab</div>");
  writeNote(el, "<div>Start a</div>");
  await settle(400);
  check("typing never reloads the note", loads === 0, loads);
  check("the second letter is kept", el.value === "<div>Start ab</div>", el.value);
});
