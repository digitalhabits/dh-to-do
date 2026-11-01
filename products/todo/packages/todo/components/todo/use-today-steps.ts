"use client";

import * as React from "react";

import { tasksInScope, type PeopleScope } from "@/lib/todo/people-scope";
import { stepsDueToday } from "@/lib/todo/step-due";
import { todayDueOn } from "@/lib/todo/task-draft";
import { boardColumnOf, type TodoTask } from "@/lib/todo/types";

/**
 * The steps due today or before whose parent is on this tab but not in
 * Today: the board shows them above Today's cards, and the Today session
 * works through them with Today's tasks (see stepsDueToday). None while
 * searching, where the board shows what the words find.
 */
export function useTodaySteps({
  isSearching,
  boardTasks,
  tasks,
  openTasks,
  somedayEnabled,
  scope,
  mePersonIds,
  assigneeFilterIds,
  makerKeys,
}: {
  isSearching: boolean;
  /** The open tasks the board shows, after the person filter. */
  boardTasks: TodoTask[];
  tasks: TodoTask[];
  /** The open tasks on this tab, before the person filter. */
  openTasks: TodoTask[];
  somedayEnabled: boolean;
  scope: PeopleScope;
  mePersonIds: string[];
  assigneeFilterIds: string[];
  makerKeys: string[];
}): TodoTask[] {
  // Read on every draw, so the list moves on at midnight.
  const today = todayDueOn();
  return React.useMemo(() => {
    if (isSearching) return [];
    const shown = new Set(boardTasks.map((task) => task.id));
    return stepsDueToday(tasks, {
      today,
      parentsInView: new Map(openTasks.map((task) => [task.id, task])),
      parentInToday: (parent) => boardColumnOf(parent, somedayEnabled) === "today",
      parentShown: (parent) => shown.has(parent.id),
      stepShown: (step) =>
        tasksInScope([step], scope, mePersonIds, assigneeFilterIds, makerKeys).length > 0,
    });
  }, [isSearching, boardTasks, tasks, today, openTasks, somedayEnabled, scope, mePersonIds, assigneeFilterIds, makerKeys]);
}
