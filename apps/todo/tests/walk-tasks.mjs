import { openTaskDetails, editTaskTitle, openTaskMenu, closeTaskDetails } from "./page-walk.mjs";
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
  if (page.keptBoard) {
    // The planner keeps a copy of the board, to paint the tab at once next
    // time. The page object gives it, so this walk names no planner file.
    const cached = () => page.keptBoard()?.tasks?.map((task) => task.text) ?? [];
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
  await openTaskMenu("Sweep the floor");
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
  await openTaskMenu("Sweep the floor");
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
  await editTaskTitle("Sort the screws");
  const editor = await until(() => Boolean($("textarea.notes-overlay-title-input")));
  check("a click on the words opens them for editing", editor);
  if (editor) {
    const box = $("textarea.notes-overlay-title-input");
    typeInto(box, "Sort the screws by size");
    press(box, "Enter");
  }
  check(
    "new words are saved",
    await until(() => row("Sort the screws by size") !== null),
    JSON.stringify(board.query("SELECT text FROM todo_tasks"))
  );
  check("the card shows the new words", await until(() => Boolean(cardOf("Sort the screws by size"))));
  check("the editor closes", !$("textarea.notes-overlay-title-input"));

  // Escape leaves the words as they were.
  await editTaskTitle("Sort the screws by size");
  if (await until(() => Boolean($("textarea.notes-overlay-title-input")))) {
    const box = $("textarea.notes-overlay-title-input");
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
  await openTaskDetails("Oil the hinges");
  check("the task title opens details", await until(() => Boolean($(".notes-overlay"))));
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
  // A step's ⋮ menu holds its Delete.
  if (wipeRow) click(wipeRow.querySelector("button.task-subtask-more"));
  if (await until(() => Boolean($(".task-menu .delete-task-item")))) click($(".task-menu .delete-task-item"));
  check(
    "a step's delete takes it away",
    await until(() => !board.query("SELECT id FROM todo_tasks WHERE text = ?", ["Wipe the hinge"]).length && stepRows().length === 1)
  );
  await settle();

  // A step's note keeps its pictures in the app's own store, linked list
  // or not: Basecamp has no notes on a step.
  // A step with no note yet adds one from its ⋮ (design "20d").
  const stepMore = $(".task-subtask-row[data-subtask-id] .task-subtask-more");
  if (stepMore) click(stepMore);
  const addNotes = await until(() => $$(".task-menu-item").find((b) => b.textContent.includes("Add notes")));
  check("a step's ⋮ offers Add notes", Boolean(addNotes));
  if (addNotes) click($$(".task-menu-item").find((b) => b.textContent.includes("Add notes")));
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
  // Done puts the step's note away, saved.
  if ($(".task-subtask-row[data-subtask-id] + .task-subtask-notes .notes-done-btn")) click($(".task-subtask-row[data-subtask-id] + .task-subtask-notes .notes-done-btn"));

  // Durations in the card: the task's, a step's, and a new step's.
  // The duration is a field in details: a click on it opens the picker.
  const durationChip = [...document.querySelectorAll("button.task-overlay-chip")].find((b) =>
    /duration/i.test(b.getAttribute("aria-label") ?? "")
  );
  if (durationChip) click(durationChip);
  await until(() => Boolean($(".duration-popover-input")));
  const cardDuration = $(".duration-popover-input");
  check("the card has a duration box", Boolean(cardDuration));
  if (cardDuration) {
    typeInto(cardDuration, "1.5h");
    press(cardDuration, "Enter");
  }
  check(
    "the card's box reads words as the add row's picker does: 1.5h is 90 minutes",
    await until(() => row("Oil the hinges")?.expected_duration_minutes === 90),
    brief("Oil the hinges")
  );
  // A step with no time adds one from its ⋮; the picker is the task's own.
  const pickerBox = () => $(".duration-popover.is-pills .duration-popover-input");
  click($(".task-subtask-row[data-subtask-id] .task-subtask-more"));
  await until(() => $$(".task-menu-item").some((b) => b.textContent.includes("Add duration")));
  click($$(".task-menu-item").find((b) => b.textContent.includes("Add duration")));
  const stepDur = await until(() => Boolean(pickerBox()));
  check("a step's Add duration opens the duration picker", stepDur);
  if (stepDur) {
    typeInto(pickerBox(), "7m");
    press(pickerBox(), "Enter");
  }
  check(
    "a step takes the duration typed in the picker",
    await until(() => step()?.expected_duration_minutes === 7),
    JSON.stringify(step())
  );
  // Set, the time is on the step's second line: a click there changes it.
  const stepTime = () => $$(".task-subtask-row[data-subtask-id] .task-subtask-meta-item").find((b) => b.textContent === "7m");
  check("the step's time is on its second line", await until(() => Boolean(stepTime())));
  click(stepTime());
  if (await until(() => Boolean($(".duration-popover .popover-remove-row")))) {
    click($(".duration-popover .popover-remove-row"));
  }
  check(
    "and Remove estimate clears it, as a step has no × of its own",
    await until(() => step()?.expected_duration_minutes === null),
    JSON.stringify(step())
  );
  click($(".task-subtask-add-row .task-subtask-dur"));
  const newDur = await until(() => Boolean(pickerBox()));
  check("the new step's clock opens the duration picker", newDur);
  if (newDur) {
    typeInto(pickerBox(), "12 min");
    press(pickerBox(), "Enter");
  }
  await until(() => !pickerBox());
  const addBox = $(".task-subtask-add");
  typeInto(addBox, "Wipe the drips");
  press(addBox, "Enter");
  check(
    "a new step keeps the duration typed for it",
    await until(() => row("Wipe the drips")?.expected_duration_minutes === 12),
    brief("Wipe the drips")
  );

  // Collapse: the card goes, and the note goes with the save.
  click($(".task-details-back"));
  check("Back to tasks closes details", await until(() => !$(".notes-overlay")));
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
  const durChip = await until(() => Boolean($('.task-composer .composer-chip[title="Add duration"]')));
  if (durChip) click($('.task-composer .composer-chip[title="Add duration"]'));
  const preset = await until(() => $$(".duration-popover-preset").length > 0);
  check("the add row's clock opens the durations", preset);
  if (preset) click($$(".duration-popover-preset")[2]);
  // The chip says the duration once the row has drawn it.
  check(
    "the add row's chip says the duration",
    await until(() => $('.task-composer .composer-chip[title="Add duration"]')?.textContent === "25m")
  );
  durRow = $("input.task-composer-input");
  press(durRow, "Enter");
  check(
    "a task added with a duration keeps it",
    await until(() => row("Fold the tarp")?.expected_duration_minutes === 25),
    brief("Fold the tarp")
  );

  // The durations from the keyboard: they open on 15m, marked so WebKit
  // shows the caret, and the arrows walk the pills (three to a row:
  // 5m 15m 25m / 45m 1h 2h) and the field.
  durRow = $("input.task-composer-input");
  durRow.focus();
  typeInto(durRow, "Sweep the porch");
  await until(() => Boolean($('.task-composer .composer-chip[title="Add duration"]')));
  click($('.task-composer .composer-chip[title="Add duration"]'));
  const presets = () => $$(".duration-popover-preset");
  check(
    "the durations open with the caret on 15m, marked",
    await until(() => document.activeElement === presets()[1] && presets()[1].hasAttribute("data-focus-walked"))
  );
  press(presets()[1], "ArrowRight");
  check("Right walks to 25m", document.activeElement === presets()[2]);
  press(presets()[2], "ArrowDown");
  check("Down walks a row, to 2h", document.activeElement === presets()[5]);
  press(presets()[5], "ArrowDown");
  check("Down from the last row goes to the field", document.activeElement === $(".duration-popover-input"));
  check("the field says what it takes", $(".duration-popover-input")?.placeholder?.startsWith("Custom"));
  press($(".duration-popover-input"), "ArrowUp");
  check("Up from the field comes back to the pills", document.activeElement === presets()[3]);
  click(presets()[3]);
  check(
    "the preset under the caret is the one set",
    await until(() => $('.task-composer .composer-chip[title="Add duration"]')?.textContent === "45m")
  );
  press($("input.task-composer-input"), "Enter");
  check(
    "and the task is added with it",
    await until(() => row("Sweep the porch")?.expected_duration_minutes === 45),
    brief("Sweep the porch")
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
  await editTaskTitle("Sweep the floor");
  await until(() => Boolean($("textarea.notes-overlay-title-input")));
  await call("/api/todo/tasks", "POST", { listId: list.id, text: "Hang the rake" });
  await backAtFront();
  check("while words are being written, the board is not read again", !cardOf("Hang the rake"));
  press($("textarea.notes-overlay-title-input"), "Escape");
  await until(() => !$("textarea.notes-overlay-title-input"));
  await closeTaskDetails();
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
