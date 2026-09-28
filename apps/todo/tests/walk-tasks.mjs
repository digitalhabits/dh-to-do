/**
 * A task, by hand: tick it and take the tick back with Cmd+Z, delete it and
 * undo that, change its words, and open its card to write a note and add
 * and tick a step. Every check reads both the page and the board under it.
 *
 * Run in both flavours: mounted-tasks and mounted-tasks-planner. Every list
 * and task is invented.
 */

import { check } from "./harness.mjs";
import {
  $,
  $$,
  cardOf,
  click,
  dropPicture,
  holdWrites,
  installFakeTrix,
  installUploads,
  noteEditor,
  press,
  pressCmd,
  settle,
  sleep,
  stubBoxes,
  text,
  typeInto,
  until,
  writeNote,
} from "./page-walk.mjs";

export async function walkTasks(page) {
  installFakeTrix();
  const { board, call } = page;
  const row = (words) =>
    board.query("SELECT * FROM todo_tasks WHERE text = ?", [words])[0] ?? null;
  const brief = (words) => {
    const r = row(words);
    return r
      ? JSON.stringify({ text: r.text, completed: r.completed, notes: r.notes_html, minutes: r.expected_duration_minutes })
      : "none";
  };

  // Linked to Basecamp, so a note's pictures go there in the planner. The
  // sync that linking starts fails quietly: nothing is connected.
  const { list } = await call("/api/todo/lists", "POST", {
    name: "Workshop",
    basecampProjectId: "p-walk",
    basecampListId: "bl-walk",
  });
  for (const words of ["Oil the hinges", "Sweep the floor", "Sort the screws"]) {
    await call("/api/todo/tasks", "POST", { listId: list.id, text: words });
  }
  const view = await page.mount();
  check(
    "the board paints the tasks",
    await until(() => text().includes("Oil the hinges") && text().includes("Sort the screws")),
    text().slice(0, 200)
  );
  if (page.flavor === "planner") {
    // The planner keeps a copy of the board, to paint the tab at once next time.
    const { PAGE_CACHE_KEYS, getPageSnapshot } = await import("@/lib/page-snapshot-cache");
    const cached = () => getPageSnapshot(PAGE_CACHE_KEYS.todo)?.state?.tasks?.map((task) => task.text) ?? [];
    check("the board is kept for the next paint", await until(() => cached().includes("Sort the screws")), cached().join());
  }

  // Tick a task off. The box is the task's own checkbox. Done is folded,
  // so the card flies to its heading, which shows it receiving.
  let received = false;
  let cardHidden = false;
  const watchHeading = new window.MutationObserver(() => {
    if ($(".done-heading.receiving-task")) received = true;
    if ($$(".task-item").some((el) => el.style.visibility === "hidden")) cardHidden = true;
  });
  watchHeading.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "style"] });
  cardOf("Oil the hinges")?.querySelector("input.task-checkbox")?.click();
  check(
    "a tick is saved",
    await until(() => row("Oil the hinges")?.completed === 1),
    brief("Oil the hinges")
  );
  await settle(900);
  check("the folded Done heading receives the ticked card", received);
  check("no card stands hidden for it to land on", !cardHidden);
  watchHeading.disconnect();
  // Cmd+Z takes the tick back. The key goes to the window, as it does when
  // no box is being typed in.
  pressCmd(window, "z");
  check(
    "Cmd+Z takes a tick back",
    await until(() => row("Oil the hinges")?.completed === 0),
    brief("Oil the hinges")
  );
  pressCmd(window, "z");
  await settle();
  check("a second Cmd+Z does nothing more", row("Oil the hinges")?.completed === 0);

  // Delete from the card's menu, and take it back from the toast.
  const sweep = row("Sweep the floor");
  click(cardOf("Sweep the floor").querySelector(".task-menu-btn"));
  const del = await until(() => Boolean($(".delete-task-item")));
  check("the card's menu opens", del);
  if (del) click($(".delete-task-item"));
  check("a delete is saved", await until(() => row("Sweep the floor") === null));
  check("the card goes", await until(() => !cardOf("Sweep the floor")));
  check("the undo toast says so", await until(() => Boolean($(".undo-toast"))), text().slice(-200));
  if ($(".undo-toast .undo-btn")) click($(".undo-toast .undo-btn"));
  check(
    "Undo brings the task back, with its id",
    await until(() => row("Sweep the floor")?.id === sweep.id),
    JSON.stringify(board.query("SELECT id, text FROM todo_tasks"))
  );
  check("the card comes back", await until(() => Boolean(cardOf("Sweep the floor"))));

  // Delete again, and take it back with Cmd+Z this time.
  click(cardOf("Sweep the floor").querySelector(".task-menu-btn"));
  if (await until(() => Boolean($(".delete-task-item")))) click($(".delete-task-item"));
  await until(() => row("Sweep the floor") === null);
  await settle();
  pressCmd(window, "z");
  check(
    "Cmd+Z takes a delete back",
    await until(() => row("Sweep the floor")?.id === sweep.id),
    JSON.stringify(board.query("SELECT id, text FROM todo_tasks"))
  );
  await until(() => Boolean(cardOf("Sweep the floor")));

  // Change a task's words: a click on the words, new words, Enter.
  click(cardOf("Sort the screws").querySelector(".task-text"));
  const editor = await until(() => Boolean($("textarea.task-edit-input")));
  check("a click on the words opens them for editing", editor);
  if (editor) {
    const box = $("textarea.task-edit-input");
    typeInto(box, "Sort the screws by size");
    press(box, "Enter");
  }
  check(
    "new words are saved",
    await until(() => row("Sort the screws by size") !== null),
    JSON.stringify(board.query("SELECT text FROM todo_tasks"))
  );
  check("the card shows the new words", await until(() => Boolean(cardOf("Sort the screws by size"))));
  check("the editor closes", !$("textarea.task-edit-input"));

  // Escape leaves the words as they were.
  click(cardOf("Sort the screws by size").querySelector(".task-text"));
  if (await until(() => Boolean($("textarea.task-edit-input")))) {
    const box = $("textarea.task-edit-input");
    typeInto(box, "Throw the screws away");
    press(box, "Escape");
  }
  await settle();
  check(
    "Escape keeps the old words",
    row("Throw the screws away") === null && row("Sort the screws by size") !== null
  );

  // The card: a note, and a step added and ticked.
  const parent = row("Oil the hinges");
  click(cardOf("Oil the hinges").querySelector(".task-expand-btn"));
  check("the expand button opens the card", await until(() => Boolean($(".notes-overlay"))));
  const note = await noteEditor(".notes-overlay-body trix-editor");
  check("the card has a notes editor", Boolean(note));
  if (note) writeNote(note, "<div>Use the light oil</div>");

  // A picture dropped in the note: to Basecamp in the planner, since the
  // list is linked, and to the app's own store in the desktop app.
  const uploads = installUploads({ mediaId: "media-walk-1", sgid: "sgid-walk-1", blobId: "blob-walk-1" });
  const given = note ? dropPicture(note, "hinge.png") : [];
  check("a picture in the note is uploaded", await until(() => given.length === 1), JSON.stringify(given));
  if (page.flavor === "desktop") {
    check(
      "the desktop app keeps it in its own store",
      board.commands.some((c) => c.command === "todo_media_write" && c.args.filename === "hinge.png"),
      JSON.stringify(board.commands.map((c) => c.command))
    );
  } else {
    check(
      "the planner sends it to Basecamp",
      uploads.some((u) => u.method === "POST" && u.url === "/api/todo/basecamp-attachment?name=hinge.png"),
      JSON.stringify(uploads)
    );
  }

  const stepBox = $(".task-subtask-add");
  check("the card has a box for a new step", Boolean(stepBox));
  if (stepBox) {
    typeInto(stepBox, "Find the oil can");
    press(stepBox, "Enter");
  }
  const step = () =>
    board.query("SELECT * FROM todo_tasks WHERE parent_task_id = ? AND text = ?", [parent.id, "Find the oil can"])[0] ?? null;
  check(
    "a new step is saved under its task",
    await until(() => step()?.text === "Find the oil can"),
    JSON.stringify(board.query("SELECT text, parent_task_id FROM todo_tasks"))
  );
  check(
    "the step is drawn in the card",
    await until(() => Boolean($(".task-subtask-row[data-subtask-id] textarea.task-subtask-text")))
  );
  check("the box is empty for the next step", $(".task-subtask-add")?.value === "");
  typeInto($(".task-subtask-add"), "Wipe the hinge");
  press($(".task-subtask-add"), "Enter");
  const stepRows = () => $$(".task-subtask-row[data-subtask-id]");
  await until(() => stepRows().length === 2);
  await settle();
  // A ticked step sorts to the pile, and the rows slide there. happy-dom
  // runs no animations, so the slide is recorded, with rows placed by order.
  const slides = [];
  const originalAnimate = window.Element.prototype.animate;
  window.Element.prototype.animate = function () {
    slides.push(this.dataset?.subtaskId);
    return { cancel() {}, finished: Promise.resolve() };
  };
  const undoStepBoxes = stubBoxes((el) =>
    el.dataset?.subtaskId ? { left: 0, top: stepRows().indexOf(el) * 30, width: 300, height: 24 } : null
  );
  const stepCheck = $(".task-subtask-row[data-subtask-id] .task-subtask-check");
  if (stepCheck) click(stepCheck);
  check("a ticked step is saved", await until(() => step()?.completed === 1));
  check("and the steps slide to their new places", await until(() => slides.includes(step()?.id)), slides.join());
  undoStepBoxes();
  window.Element.prototype.animate = originalAnimate;
  // The second step goes again: the checks below count one.
  const wipeRow = stepRows().find((row) => row.querySelector("textarea")?.value === "Wipe the hinge");
  if (wipeRow) click(wipeRow.querySelector("button.task-subtask-delete"));
  check(
    "a step's delete takes it away",
    await until(() => !board.query("SELECT id FROM todo_tasks WHERE text = ?", ["Wipe the hinge"]).length && stepRows().length === 1)
  );
  await settle();

  // A step's note keeps its pictures in the app's own store, linked list
  // or not: Basecamp has no notes on a step.
  const stepNotes = $$(".task-subtask-row[data-subtask-id] .task-subtask-action").find(
    (b) => b.title === "Notes"
  );
  check("a step has a notes button", Boolean(stepNotes));
  if (stepNotes) click(stepNotes);
  const stepNote = await noteEditor(".task-subtask-notes trix-editor");
  check("which opens the step's note", Boolean(stepNote));
  const stepGiven = stepNote ? dropPicture(stepNote, "can.png") : [];
  check("a picture in a step's note is uploaded", await until(() => stepGiven.length === 1));
  check(
    "to the app's own store",
    page.flavor === "desktop"
      ? board.commands.some((c) => c.command === "todo_media_write" && c.args.filename === "can.png")
      : uploads.some((u) => u.url === "/api/todo/media?name=can.png"),
    JSON.stringify(uploads)
  );
  if (stepNotes) click(stepNotes);

  // Durations in the card: the task's, a step's, and a new step's.
  const cardDuration = $(".task-overlay-duration");
  check("the card has a duration box", Boolean(cardDuration));
  if (cardDuration) {
    typeInto(cardDuration, "1.5");
    cardDuration.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  }
  check(
    "the card's box reads the number at the front, as the add row does: 1.5 is 1 minute",
    await until(() => row("Oil the hinges")?.expected_duration_minutes === 1),
    brief("Oil the hinges")
  );
  click($(".task-subtask-row[data-subtask-id] .task-subtask-action"));
  const stepDur = await until(() => Boolean($(".task-subtask-row[data-subtask-id] .task-subtask-dur-input")));
  check("a step's clock opens its duration box", stepDur);
  const stepDurBox = () => $(".task-subtask-row[data-subtask-id] .task-subtask-dur-input");
  if (stepDur) {
    typeInto(stepDurBox(), "7.5");
    stepDurBox().dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  }
  check(
    "a step's box reads the number at the front too: 7.5 is 7 minutes",
    await until(() => step()?.expected_duration_minutes === 7),
    JSON.stringify(step())
  );
  click($(".task-subtask-row[data-subtask-id] .task-subtask-action"));
  if (await until(() => Boolean(stepDurBox()))) {
    typeInto(stepDurBox(), "0");
    stepDurBox().dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  }
  check(
    "and 0 is no duration, as in every other box",
    await until(() => step()?.expected_duration_minutes === null),
    JSON.stringify(step())
  );
  click($(".task-subtask-add-row .task-subtask-action"));
  const newDur = await until(() => Boolean($(".task-subtask-add-row .task-subtask-dur-input")));
  check("the new step's clock opens its duration box", newDur);
  if (newDur) {
    const box = $(".task-subtask-add-row .task-subtask-dur-input");
    typeInto(box, "12 min");
    box.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
  }
  const addBox = $(".task-subtask-add");
  typeInto(addBox, "Wipe the drips");
  press(addBox, "Enter");
  check(
    "a new step keeps the duration typed for it",
    await until(() => row("Wipe the drips")?.expected_duration_minutes === 12),
    brief("Wipe the drips")
  );

  // Collapse: the card goes, and the note goes with the save.
  click($(".notes-collapse-btn"));
  check("the collapse button closes the card", await until(() => !$(".notes-overlay")));
  check(
    "the note is saved",
    await until(() => (row("Oil the hinges")?.notes_html ?? "").includes("Use the light oil")),
    brief("Oil the hinges")
  );
  check(
    "the card's chip counts the steps",
    await until(() => cardOf("Oil the hinges")?.querySelector(".task-subtask-chip")?.textContent === "1/2"),
    cardOf("Oil the hinges")?.textContent
  );
  check("a step is never a card of the board", !cardOf("Find the oil can"));

  // The add row's duration, from its popover.
  let durRow = $("input.task-composer-input");
  durRow.focus();
  typeInto(durRow, "Fold the tarp");
  const durChip = await until(() => Boolean($('.task-composer .composer-chip[aria-label="Add duration"]')));
  if (durChip) click($('.task-composer .composer-chip[aria-label="Add duration"]'));
  const preset = await until(() => $$(".duration-popover-preset").length > 0);
  check("the add row's clock opens the durations", preset);
  if (preset) click($$(".duration-popover-preset")[1]);
  // The chip says the duration once the row has drawn it.
  check(
    "the add row's chip says the duration",
    await until(() => $('.task-composer .composer-chip[aria-label="Add duration"]')?.textContent === "30m")
  );
  durRow = $("input.task-composer-input");
  press(durRow, "Enter");
  check(
    "a task added with a duration keeps it",
    await until(() => row("Fold the tarp")?.expected_duration_minutes === 30),
    brief("Fold the tarp")
  );

  // Cmd+Enter adds the task once, from the title and from an empty step.
  const count = (words) =>
    board.query("SELECT COUNT(*) AS n FROM todo_tasks WHERE text = ?", [words])[0].n;
  let composer = $("input.task-composer-input");
  composer.focus();
  typeInto(composer, "Stack the chairs");
  press(composer, "Enter", { metaKey: true });
  await until(() => count("Stack the chairs") > 0);
  await settle();
  check("Cmd+Enter in the title adds the task once", count("Stack the chairs") === 1, count("Stack the chairs"));
  composer = $("input.task-composer-input");
  composer.focus();
  typeInto(composer, "Lock the shed");
  const stepsChip = await until(() => Boolean($('.task-composer .composer-chip[aria-label="Subtasks"]')));
  if (stepsChip) click($('.task-composer .composer-chip[aria-label="Subtasks"]'));
  const stepInput = await until(() => Boolean($(".task-composer .composer-subtask-input")));
  check("the add row opens its steps", stepInput);
  if (stepInput) press($(".task-composer .composer-subtask-input"), "Enter", { metaKey: true });
  await until(() => count("Lock the shed") > 0);
  await settle();
  check("Cmd+Enter in an empty step adds the task once", count("Lock the shed") === 1, count("Lock the shed"));

  // Back at the front, the page reads the board again, at most once in ten
  // seconds, and not while a task's words are being written. The clock is
  // moved on by hand.
  const realNow = Date.now;
  let ahead = 0;
  Date.now = () => realNow() + ahead;
  const backAtFront = async () => {
    ahead += 11_000;
    window.dispatchEvent(new window.Event("focus"));
    await settle(400);
  };
  click(cardOf("Sweep the floor").querySelector(".task-text"));
  await until(() => Boolean($("textarea.task-edit-input")));
  await call("/api/todo/tasks", "POST", { listId: list.id, text: "Hang the rake" });
  await backAtFront();
  check("while words are being written, the board is not read again", !cardOf("Hang the rake"));
  press($("textarea.task-edit-input"), "Escape");
  await until(() => !$("textarea.task-edit-input"));
  await backAtFront();
  check("after, it is", await until(() => Boolean(cardOf("Hang the rake"))));

  // A read already on its way when a task is ticked comes back older than
  // the tick: it must not put the tick back on screen.
  await settle();
  const slowReads = holdWrites(/^\s*SELECT[\s\S]*FROM todo_tasks/i, 400);
  ahead += 11_000;
  window.dispatchEvent(new window.Event("focus"));
  await sleep(250);
  const box = () => cardOf("Hang the rake")?.querySelector("input.task-checkbox");
  box()?.click();
  let snappedBack = false;
  let seenTicked = false;
  for (let i = 0; i < 60; i += 1) {
    const ticked = Boolean(box()?.checked);
    if (ticked) seenTicked = true;
    else if (seenTicked && box()) snappedBack = true;
    await sleep(20);
  }
  slowReads();
  check("a read older than a tick does not undo it on screen", seenTicked && !snappedBack);
  check("and the tick is saved", await until(() => row("Hang the rake")?.completed === 1));
  Date.now = realNow;

  view.unmount();
}
