"use client";

import * as React from "react";

import {
  COLUMN_SORT_KEY,
  columnSortsInUse,
  loadColumnSorts,
  pickedColumnSorts,
  sortColumnTasks,
  type ColumnSort,
} from "@/lib/todo/column-sort";
import { persistPref } from "@/lib/todo/saved-prefs";
import type { TodoBoardColumn, TodoPerson, TodoTask } from "@/lib/todo/types";

/**
 * Each board column's order: kept per device, picked from the column's
 * "⇅" menu, and put on the column's tasks. During a drag the rows follow
 * the drag instead (`taskPreviewIds`).
 */
export function useColumnSorts({
  assignEnabled,
  people,
  taskPreviewIds,
}: {
  assignEnabled: boolean;
  people: TodoPerson[];
  taskPreviewIds: string[] | null;
}) {
  /** Each column's order, from the header; due date until changed. */
  const [storedColumnSorts, setColumnSorts] = React.useState(loadColumnSorts);
  /** The orders in use: see columnSortsInUse. */
  const columnSorts = React.useMemo(
    () => columnSortsInUse(storedColumnSorts, assignEnabled),
    [storedColumnSorts, assignEnabled]
  );
  /** Pick an order for a column: see pickedColumnSorts. */
  function pickColumnSort(column: TodoBoardColumn, sort: ColumnSort) {
    setColumnSorts((current) => {
      const next = pickedColumnSorts(current, column, sort);
      persistPref(COLUMN_SORT_KEY, JSON.stringify(next));
      return next;
    });
  }
  /** The "⇅" menu that is up, and the glyph it hangs off. */
  const [columnSortMenu, setColumnSortMenu] =
    React.useState<TodoBoardColumn | null>(null);
  const [columnSortAnchor, setColumnSortAnchor] =
    React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!columnSortMenu) return;
    const close = () => {
      setColumnSortMenu(null);
      setColumnSortAnchor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // MenuPortal swallows the pointer inside the menu; the glyph toggles.
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [columnSortMenu]);

  /* Each column in its own order: see sortColumnTasks. */
  const sortColumn = React.useCallback(
    (column: TodoBoardColumn, tasks: TodoTask[]) =>
      sortColumnTasks(columnSorts[column], tasks, people, Boolean(taskPreviewIds)),
    [columnSorts, taskPreviewIds, people]
  );

  return {
    columnSorts,
    pickColumnSort,
    columnSortMenu,
    setColumnSortMenu,
    columnSortAnchor,
    setColumnSortAnchor,
    sortColumn,
  };
}
