/**
 * The add-task row on its own: each chip, the note and the steps, and the
 * draft that one Add hands over. The page walks add tasks through it, but
 * reach few of its chips.
 *
 * Run in both flavours: mounted-composer and mounted-composer-planner.
 * Every person, list and task is invented.
 */

import { check } from "./harness.mjs";
import { $, $$, click, mountPage, noteEditor, press, typeInto, until, writeNote } from "./page-walk.mjs";

export async function walkComposer() {
  const { makeT } = await import("@/lib/todo/i18n");
  const { AddTaskComposer } = await import("@/components/todo/AddTaskComposer");
  const t = makeT("en");
  const yard = { id: "l-yard", name: "Yard", position: 1, colour: null, emoji: null, groupId: null };
  const shed = { id: "l-shed", name: "Shed", position: 2, colour: null, emoji: null, groupId: null };
  const zoe = { id: "p-zoe", name: "Zoe Park", colour: null, photoUrl: null, email: null, position: 1 };
  const added = [];
  let peopleEdits = 0;
  const view = mountPage(AddTaskComposer, {
    placeholder: "Add a task",
    addLabel: "Add",
    minutesLabel: "min",
    onSubmit: (draft) => added.push(draft),
    people: [zoe],
    onEditPeople: () => (peopleEdits += 1),
    assignEnabled: true,
    lists: [yard, shed],
    defaultList: yard,
    lang: "en",
    t,
  });
  const title = () => $("input.task-composer-input");
  const chip = (label) => $$(".composer-chip").find((el) => el.getAttribute("title") === label);
  const option = (name) =>
    $$(".assign-menu-portal [role=option]").find((el) => el.textContent.includes(name));

  check("an empty row has no chips", !$(".composer-chips"));
  typeInto(title(), "Rake the leaves");
  check("a title brings the chips", await until(() => Boolean($(".composer-chips"))));

  // Assign.
  click(chip(t("assignPerson")));
  check("the assign chip opens the people", await until(() => Boolean(option("Zoe"))));
  click(option("Zoe"));
  check("a person picked is on the chip", await until(() => chip(t("assignPerson"))?.textContent.includes("Zoe")), chip(t("assignPerson"))?.textContent);
  // The menu stays up for more; the chip puts it away.
  click(chip(t("assignPerson")));
  check("the chip again puts the people away", await until(() => !option("Zoe")));

  // Due.
  click(chip(t("fieldDue")));
  check("the due chip opens the dates", await until(() => Boolean($(".due-popover-preset"))));
  click($(".due-popover-preset"));
  check("a date picked is on the chip", await until(() => chip(t("fieldDue"))?.classList.contains("is-set")));

  // The list.
  click(chip(t("fieldList")));
  const pickerItems = () => $$(".task-list-picker-item").map((el) => el.textContent.trim()).join("|");
  // A list with no icon shows its name alone: no two letters in its place.
  check("the list chip opens the lists", await until(() => pickerItems() === "Yard|Shed"), pickerItems());
  click($$(".task-list-picker-item").find((el) => el.textContent.includes("Shed")));
  check("a list picked is on the chip", await until(() => chip(t("fieldList"))?.textContent.includes("Shed")), chip(t("fieldList"))?.textContent);

  // The note.
  click(chip(t("fieldNotes")));
  check("the notes chip opens the note", await until(() => Boolean($(".composer-notes-editor"))));
  const editor = await noteEditor(".composer-notes-editor trix-editor");
  if (editor) writeNote(editor, "<div>By the gate</div>");

  // A step, with a person of its own.
  click(chip(t("subtasks")));
  check("the steps chip opens the steps", await until(() => Boolean($(".composer-subtask-row.is-new input"))));
  typeInto($(".composer-subtask-row.is-new input"), "Find the rake");
  press($(".composer-subtask-row.is-new input"), "Enter");
  const stepAssign = () => $(".composer-subtask-row:not(.is-new) .composer-subtask-assign");
  check("Enter keeps the step, with its own assign button", await until(() => Boolean(stepAssign())));
  click(stepAssign());
  check("the step's assign button opens the people", await until(() => Boolean(option("Zoe"))));
  click(option("Zoe"));
  check("a person picked is on the step", await until(() => stepAssign()?.classList.contains("is-set")));

  // One Add hands over all of it.
  press(title(), "Enter");
  const draft = added[0];
  check("Add hands over the draft", await until(() => added.length === 1));
  check(
    "with the title, the person, the date and the list",
    draft?.text === "Rake the leaves" && draft.assigneeIds.join() === "p-zoe" && Boolean(draft.dueOn) && draft.listId === "l-shed",
    JSON.stringify(draft)
  );
  check("with the note", draft?.notes === "<div>By the gate</div>", draft?.notes);
  check(
    "and the step with its person",
    draft?.subtasks.length === 1 && draft.subtasks[0].text === "Find the rake" && draft.subtasks[0].assigneeIds.join() === "p-zoe",
    JSON.stringify(draft?.subtasks)
  );
  check("the row is empty again", await until(() => title().value === "" && !$(".composer-chips")));
  check("the people editor was not asked for", peopleEdits === 0);

  view.unmount();

  // On All there is no tab's list: the box starts on the list it last
  // added to, kept per device, or says "No list".
  localStorage.removeItem("redd-plan-todo-add-list");
  const onAll = [];
  const all = mountPage(AddTaskComposer, {
    placeholder: "Add a task",
    addLabel: "Add",
    minutesLabel: "min",
    onSubmit: (d) => onAll.push(d),
    people: [zoe],
    onEditPeople: () => {},
    assignEnabled: true,
    lists: [yard, shed],
    defaultList: null,
    lang: "en",
    t,
  });
  const listChip = () => chip(t("fieldList"));
  typeInto(title(), "Sweep the path");
  check("on All with nothing kept, the list chip says No list, marked", await until(() => listChip()?.classList.contains("is-unlisted") && listChip().textContent.includes(t("composerNoList"))));
  click(listChip());
  const shedItem = () => $$(".task-list-picker-item").find((el) => el.textContent.includes("Shed"));
  check("the lists open, No list among them", await until(() => Boolean(shedItem())), $$(".task-list-picker-item").map((el) => el.textContent.trim()).join("|"));
  click(shedItem());
  check("Shed is on the chip", await until(() => listChip()?.textContent.includes("Shed")), listChip()?.textContent);
  press(title(), "Enter");
  check("a list picked on All goes with the task", await until(() => onAll[0]?.listId === "l-shed"), JSON.stringify(onAll[0]));
  check("and is kept", localStorage.getItem("redd-plan-todo-add-list") === "l-shed");
  typeInto(title(), "Oil the gate");
  check("the next task starts on it, tinted, with a ×", await until(() => listChip()?.classList.contains("is-set") && listChip().textContent.includes("Shed") && Boolean($(".composer-chip-list-wrap .composer-chip-clear"))));
  click($(".composer-chip-list-wrap .composer-chip-clear"));
  check("the × puts it on no list", await until(() => listChip()?.classList.contains("is-unlisted")));
  check("and forgets the list", localStorage.getItem("redd-plan-todo-add-list") === null);
  press(title(), "Enter");
  check("so the task goes on no list", await until(() => onAll.length === 2 && onAll[1].listId === null), JSON.stringify(onAll[1]));
  all.unmount();
}
