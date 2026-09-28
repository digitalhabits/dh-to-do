"use client";

import * as React from "react";

import { parseSpentText } from "@/lib/todo/duration";
import { minutesFromTyped } from "@/lib/todo/duration-input";
import { focusStops } from "@/lib/todo/focus-walk";
import type { TodoView } from "@/lib/todo/list-scope";
import type { TodoTask, TodoTaskPatch } from "@/lib/todo/types";

/**
 * A task's words and its length, edited in place on the card: the box
 * that grows with the words, where the caret goes when it closes, and
 * the save.
 */
export function useTitleEdit({
  view,
  navigateToList,
  editingTextRef,
  editingTaskId,
  setEditingTaskId,
  editingDuration,
  setEditingDurationTaskId,
  mutateTask,
}: {
  view: TodoView;
  navigateToList: (listId: string) => void;
  editingTextRef: React.RefObject<string>;
  editingTaskId: string | null;
  setEditingTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  editingDuration: string;
  setEditingDurationTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  mutateTask: (id: string, patch: TodoTaskPatch) => Promise<unknown>;
}) {
  const editInputRef = React.useRef<HTMLTextAreaElement | null>(null);

  function resizeEditTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }

  function startEditTask(task: TodoTask) {
    if (view === "favourites") {
      // redd-do navigates to the task's list from the favourites view.
      if (task.listId) navigateToList(task.listId);
      return;
    }
    editingTextRef.current = task.text;
    setEditingTaskId(task.id);
  }

  React.useLayoutEffect(() => {
    if (!editingTaskId) return;
    resizeEditTextarea(editInputRef.current);
  }, [editingTaskId]);

  /**
   * Where the caret goes when a title's editor closes: back to the title
   * (`0`), or on to the control after it (`1`), or the one before (`-1`).
   *
   * Set by the keys that close the editor, never by a click elsewhere:
   * the caret follows the pointer then. It waits for the title to be back
   * on the page — moving the caret while the editor was still being taken
   * away lost it altogether, and the card read as unselected.
   */
  const caretAfterEditRef = React.useRef<{
    taskId: string;
    step: -1 | 0 | 1;
  } | null>(null);
  React.useEffect(() => {
    if (editingTaskId) return;
    const exit = caretAfterEditRef.current;
    if (!exit) return;
    caretAfterEditRef.current = null;
    const card = document.querySelector(
      `.task-item[data-task-id="${CSS.escape(exit.taskId)}"]`
    ) as HTMLElement | null;
    const title = card?.querySelector(".task-text") as HTMLElement | null;
    if (!card || !title) return;
    // The title first, whatever else follows: the card holding the caret
    // is what draws its pill, and the pill's buttons are stops of their own.
    title.focus();
    if (exit.step === 0) return;
    const stops = focusStops(card);
    const at = stops.indexOf(title);
    if (at === -1) return;
    stops[at + exit.step]?.focus();
  }, [editingTaskId]);

  function commitEditTask() {
    const id = editingTaskId;
    const text = editingTextRef.current.trim();
    setEditingTaskId(null);
    if (!id || !text) return;
    void mutateTask(id, { text });
  }

  function commitEditDuration(task: TodoTask) {
    const raw = editingDuration.trim();
    setEditingDurationTaskId(null);
    if (task.completed) {
      // Words a duration takes are read the same way; words it cannot read
      // keep the time already there.
      const spent = parseSpentText(raw);
      if (spent == null) return;
      void mutateTask(task.id, { timeSpentSeconds: spent * 60 });
    } else {
      void mutateTask(task.id, { expectedDurationMinutes: minutesFromTyped(raw) });
    }
  }

  return {
    editInputRef,
    resizeEditTextarea,
    startEditTask,
    caretAfterEditRef,
    commitEditTask,
    commitEditDuration,
  };
}
