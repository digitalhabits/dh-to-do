"use client";

import * as React from "react";

import {
  doneTasksInOrder,
  openTasksInOrder,
  tasksInView,
  type TodoView,
} from "@/lib/todo/list-scope";
import type { TodoTask } from "@/lib/todo/types";

/**
 * The tasks the view holds, its open ones in order, and its done ones.
 *
 * Kept from render to render while what they are made from is the same,
 * so the memos that read them (the people filter, the Done pile) do not
 * run again on every render.
 */
export function useViewTasks({
  parentTasks,
  view,
  isAllListsView,
  scopedListIds,
  activeListId,
}: {
  parentTasks: TodoTask[];
  view: TodoView;
  isAllListsView: boolean;
  scopedListIds: Set<string>;
  activeListId: string | null;
}) {
  const tasksForView = React.useMemo(
    () => tasksInView(parentTasks, view, isAllListsView, scopedListIds, activeListId),
    [parentTasks, view, isAllListsView, scopedListIds, activeListId]
  );
  const openTasksSorted = React.useMemo(
    () => openTasksInOrder(tasksForView, view),
    [tasksForView, view]
  );
  const doneTasks = React.useMemo(
    () => doneTasksInOrder(tasksForView, view),
    [tasksForView, view]
  );
  return { tasksForView, openTasksSorted, doneTasks };
}
