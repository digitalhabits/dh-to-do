"use client";

/*
 * "Make subtask of..." in a task's ⋮ menu: the reverse of a subtask's
 * "Convert to task". The menu shows the open tasks, with a search box,
 * and a pick makes the task a step of the picked one.
 *
 * As Convert does, it makes a new row and deletes the old one, through
 * the app's own actions, so both changes sync as any other. Only the
 * parent field is not changed in place: in Basecamp a step and a to-do
 * are different things, and a moved to-do would confuse the next sync.
 */

import * as React from "react";
import { CornerRightDown, Search } from "lucide-react";
import { toast } from "sonner";

import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { flashSubtaskRow } from "@/components/todo/use-notes-card";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import { boardColumnOf, type TodoBoardColumn, type TodoList, type TodoTask } from "@/lib/todo/types";

const COLUMN_ORDER: TodoBoardColumn[] = ["today", "week", "backlog", "someday"];

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * A task can become a step when it is open, is not a step already, and
 * has no steps of its own: steps do not have steps, and its own would be
 * lost with it.
 */
export function canMakeSubtask(task: TodoTask, subtasksByTask: Map<string, TodoTask[]>): boolean {
  return !task.completed && !task.parentTaskId && !(subtasksByTask.get(task.id)?.length);
}

/**
 * The tasks it can go into: the open tasks of the board, the task's own
 * list first and then the lists in the order the move menu has them. In
 * a list, Today first, as the column menu has it.
 */
export function parentCandidates(
  task: TodoTask,
  tasks: TodoTask[],
  lists: TodoList[]
): { list: TodoList | null; tasks: TodoTask[] }[] {
  const order = [
    task.listId,
    ...lists.map((l) => l.id).filter((id) => id !== task.listId),
  ];
  const rank = (t: TodoTask) => COLUMN_ORDER.indexOf(boardColumnOf(t));
  return order
    .map((listId) => ({
      list: lists.find((l) => l.id === listId) ?? null,
      tasks: tasks
        .filter((t) => t.listId === listId && t.id !== task.id && !t.parentTaskId && !t.completed)
        .sort((a, b) => rank(a) - rank(b) || a.position - b.position),
    }))
    .filter((group) => group.tasks.length > 0);
}

/** Make `task` a step of `parent`, then show where it went. */
async function makeSubtaskOf(m: TodoPageModel, task: TodoTask, parent: TodoTask, inDetails: boolean) {
  const id = await m.addSubtask(parent, task.text, {
    assigneeIds: task.assigneeIds,
    notesHtml: task.notesHtml ?? null,
    expectedDurationMinutes: task.expectedDurationMinutes ?? null,
    dueOn: task.dueOn ?? null,
  });
  // Only once the step is made: a failed add keeps the task.
  if (!id) return;
  await m.removeTask(task.id, { undo: false });
  const show = () => {
    m.openTaskOverlay(parent, { scrollTo: "subtasks" });
    flashSubtaskRow(id);
  };
  // From the task's own details, they move on to the parent's, where the
  // step now is. On the board, a note says where it went.
  if (inDetails) show();
  else
    toast(m.t("nowSubtaskOf").replace("{name}", parent.text), {
      action: { label: m.t("openTask"), onClick: show },
    });
}

/** The ⋮ menu's offer. Nothing when the task cannot become a step. */
export function MakeSubtaskItem({
  m,
  task,
  onOpen,
}: {
  m: TodoPageModel;
  task: TodoTask;
  onOpen: () => void;
}) {
  if (!canMakeSubtask(task, m.subtasksByTask)) return null;
  if (!parentCandidates(task, m.state.tasks, m.moveTargets.lists).length) return null;
  return (
    <button role="menuitem" className="task-menu-item move-task-item" onClick={onOpen}>
      <CornerRightDown size={16} strokeWidth={2} aria-hidden />
      {m.t("makeSubtaskOf")}
    </button>
  );
}

/**
 * The menu's tasks to pick from, under their list's name, with a search
 * box first that keeps the tasks whose words hold what was typed. Enter
 * picks the first one left.
 */
export function ParentPickerItems({
  m,
  task,
  inDetails,
  close,
}: {
  m: TodoPageModel;
  task: TodoTask;
  inDetails: boolean;
  close: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const box = React.useRef<HTMLInputElement | null>(null);
  const holder = React.useRef<HTMLDivElement | null>(null);
  // A frame after it opens, as SearchableListMenu does.
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => box.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const q = fold(query.trim());
  const groups = parentCandidates(task, m.state.tasks, m.moveTargets.lists)
    .map((g) => ({ ...g, tasks: q ? g.tasks.filter((t) => fold(t.text).includes(q)) : g.tasks }))
    .filter((g) => g.tasks.length > 0)
    .map((g) => ({ ...g, iconId: g.list ? resolveListIconId(g.list.emoji) : null }));
  const pick = (parent: TodoTask) => {
    close();
    void makeSubtaskOf(m, task, parent, inDetails);
  };
  return (
    <div ref={holder} className="list-menu-items task-parent-picker">
      <label className="list-menu-search">
        <Search size={13} strokeWidth={2} aria-hidden />
        <input
          ref={box}
          type="text"
          value={query}
          placeholder={m.t("searchTasks")}
          aria-label={m.t("searchTasks")}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // The caret's own keys in the box, not the menu's.
            if (e.key === "Home" || e.key === "End") e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              holder.current?.querySelector<HTMLElement>('[role="menuitem"]')?.click();
            }
          }}
        />
      </label>
      {groups.map((g) => (
        <React.Fragment key={g.list?.id ?? "none"}>
          {g.list ? (
            <div className="list-menu-heading task-parent-heading" role="presentation">
              {/* The list's icon, as the tabs and Change list... draw it. */}
              {g.iconId ? <ListIcon id={g.iconId} size={12} /> : null}
              {g.list.name}
            </div>
          ) : null}
          {g.tasks.map((parent) => (
            <button
              key={parent.id}
              role="menuitem"
              className="task-menu-item task-parent-item"
              title={parent.text}
              onClick={() => pick(parent)}
            >
              <span className="task-parent-item-text">{parent.text}</span>
            </button>
          ))}
        </React.Fragment>
      ))}
      {groups.length === 0 ? <div className="list-menu-none">{m.t("noTasksMatch")}</div> : null}
    </div>
  );
}
