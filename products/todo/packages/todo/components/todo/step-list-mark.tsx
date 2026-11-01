"use client";

import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import type { TodoTask } from "@/lib/todo/types";

/**
 * A step's list at the right of its card on the board: its parent's list,
 * shown and not changed, since a step goes where its parent goes. A task's
 * card has the picker that moves it (cardOriginPicker) in this place.
 */
export function StepListMark({ m, step }: { m: TodoPageModel; step: TodoTask }) {
  const parent = m.state.tasks.find((t) => t.id === step.parentTaskId);
  const list = parent ? m.listOfTask(parent) : null;
  if (!list) return null;
  const iconId = resolveListIconId(list.emoji);
  return (
    <span
      className={`task-list-origin is-static${iconId ? " has-icon" : " has-name"}`}
      title={`List: ${list.name}`}
      aria-label={`List: ${list.name}`}
      role="img"
    >
      {iconId ? <ListIcon id={iconId} size={14} /> : <span className="task-list-origin-name">{list.name}</span>}
    </span>
  );
}
