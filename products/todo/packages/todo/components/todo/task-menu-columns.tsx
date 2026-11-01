"use client";

import { Check } from "lucide-react";

import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { planTaskDrop } from "@/lib/todo/board-drop";
import { boardColumnOf, type TodoBoardColumn, type TodoTask } from "@/lib/todo/types";

/**
 * "Move to column..." in a task's ⋮ menu: Board View's columns, the
 * task's own ticked. A pick is a drop on that column's name: the task
 * goes to its end, with what a drop there changes (planTaskDrop).
 */
export function ColumnPickerItems({ m, task, close }: { m: TodoPageModel; task: TodoTask; close: () => void }) {
  const currentColumn = boardColumnOf(task, m.somedayEnabled);
  // Today first, as the nearest: the board's own order runs the other way.
  const columns: TodoBoardColumn[] = ["today", "week", "backlog", ...(m.somedayEnabled ? (["someday"] as const) : [])];
  return columns.map((column) => (
    <button
      key={column}
      role="menuitemradio"
      aria-checked={column === currentColumn}
      className={`task-menu-item board-sort-item${column === currentColumn ? " is-current" : ""}`}
      onClick={() => {
        close();
        if (column === currentColumn) return;
        const writes = planTaskDrop({
          taskId: task.id,
          previewIds: null,
          hover: { taskId: task.id, column },
          dropListId: null,
          view: m.view,
          tasks: m.state.tasks,
          somedayEnabled: m.somedayEnabled,
          now: Date.now(),
        });
        for (const write of writes) void m.mutateTask(write.id, write.patch);
      }}
    >
      <span className="board-sort-check" aria-hidden>
        {column === currentColumn ? <Check size={14} strokeWidth={2.5} /> : null}
      </span>
      {m.boardColumnLabel(column)}
    </button>
  ));
}
