"use client";

import * as React from "react";

import type { TodoView } from "@/lib/todo/list-scope";
import {
  ME_PERSON_KEY,
  PEOPLE_SCOPE_KEY,
  mePersonIds as mePersonIdsOf,
  tasksInScope,
  THIS_DEVICE_MAKER,
  type PeopleScope,
} from "@/lib/todo/people-scope";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import type { TodoPerson, TodoTask } from "@/lib/todo/types";

/**
 * Whose tasks the board shows: the person pills, "My tasks" or everyone,
 * and who the reader is on the roster. See people-scope.ts.
 */
export function usePeopleScopeState() {
  /** All-tab only: show tasks assigned to any of these people (`[]` = everyone). */
  const [assigneeFilterIds, setAssigneeFilterIds] = React.useState<string[]>(
    []
  );
  /**
   * Mine, or everyone's — see people-scope.ts. Kept per device, and read
   * after mount so the server's and the browser's first render agree.
   */
  const [peopleScope, setPeopleScope] = React.useState<PeopleScope>("mine");
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(PEOPLE_SCOPE_KEY);
      if (saved === "everyone" || saved === "mine") setPeopleScope(saved);
    } catch {
      /* private mode */
    }
  }, []);
  /**
   * The person marked as "Me" in the People dialog. For the desktop app,
   * which has no login to say who the reader is. Kept per device.
   */
  const [markedMeId, setMarkedMeId] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      setMarkedMeId(localStorage.getItem(ME_PERSON_KEY) || null);
    } catch {
      /* private mode */
    }
  }, []);
  function markMe(personId: string | null) {
    setMarkedMeId(personId);
    try {
      if (personId) localStorage.setItem(ME_PERSON_KEY, personId);
      else localStorage.removeItem(ME_PERSON_KEY);
      // The first mark must not hide most of the board at once. The board
      // stays on everyone, and the reader goes to "My tasks" when they like.
      if (personId && !localStorage.getItem(PEOPLE_SCOPE_KEY)) {
        setPeopleScope("everyone");
        localStorage.setItem(PEOPLE_SCOPE_KEY, "everyone");
      }
    } catch {
      /* private mode */
    }
  }
  function choosePeopleScope(next: PeopleScope) {
    setPeopleScope(next);
    // A person pill is an "everyone" thing: mine has no need of one.
    if (next === "mine") setAssigneeFilterIds([]);
    try {
      localStorage.setItem(PEOPLE_SCOPE_KEY, next);
    } catch {
      /* private mode */
    }
  }

  return {
    assigneeFilterIds,
    setAssigneeFilterIds,
    peopleScope,
    markedMeId,
    markMe,
    choosePeopleScope,
  };
}

/** The tasks the board shows under the people scope, and the pills it offers. */
export function usePeopleFilter({
  assignEnabled,
  view,
  tasksForView,
  peopleSorted,
  personPreviewIds,
  setAssigneeFilterIds,
  people,
  viewerEmails,
  markedMeId,
  peopleScope,
  viewerKeys,
  openTasks,
  doneTasks,
  assigneeFilterIds,
}: {
  assignEnabled: boolean;
  view: TodoView;
  tasksForView: TodoTask[];
  peopleSorted: TodoPerson[];
  personPreviewIds: string[] | null;
  setAssigneeFilterIds: React.Dispatch<React.SetStateAction<string[]>>;
  people: TodoPerson[];
  viewerEmails: string[];
  markedMeId: string | null;
  peopleScope: PeopleScope;
  viewerKeys: string[];
  openTasks: TodoTask[];
  doneTasks: TodoTask[];
  assigneeFilterIds: string[];
}) {
  /**
   * People who have at least one task on the current list (or across lists on
   * All). Filter chips only offer these names, not the full roster.
   */
  const assigneeFilterPeople = React.useMemo(() => {
    if (!assignEnabled || view !== "lists") return [];
    const assignedIds = new Set<string>();
    for (const task of tasksForView) {
      for (const id of task.assigneeIds) assignedIds.add(id);
    }
    if (assignedIds.size === 0) return [];
    const offered = peopleSorted.filter((person) => assignedIds.has(person.id));
    if (!personPreviewIds) return offered;
    // Mid-drag the row follows the pointer, not the roster.
    const byId = new Map(offered.map((person) => [person.id, person]));
    const previewed = personPreviewIds
      .map((id) => byId.get(id))
      .filter((person): person is TodoPerson => Boolean(person));
    return previewed.length === offered.length ? previewed : offered;
  }, [assignEnabled, view, tasksForView, peopleSorted, personPreviewIds]);

  // Drop filter ids that are not offered on this list (or left the roster).
  React.useEffect(() => {
    const allowed = new Set(assigneeFilterPeople.map((person) => person.id));
    setAssigneeFilterIds((ids) => {
      const next = ids.filter((id) => allowed.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [assigneeFilterPeople, setAssigneeFilterIds]);

  /** The roster rows that are the reader. Empty: the board has no "mine". */
  const mePersonIds = React.useMemo(
    () => mePersonIdsOf(people, viewerEmails, markedMeId),
    [people, viewerEmails, markedMeId]
  );
  /** With assigning off there is no "mine": the board shows every task. */
  const hasMe = assignEnabled && mePersonIds.length > 0;
  /** What the board shows: "mine" only once the reader is on the roster. */
  const scope: PeopleScope = hasMe ? peopleScope : "everyone";

  /** The makers that are the reader, for a task with nobody on it. */
  const makerKeys = React.useMemo(
    () => (isStandaloneTodo() ? [THIS_DEVICE_MAKER] : viewerKeys),
    [viewerKeys]
  );

  const boardTasks = React.useMemo(
    () => tasksInScope(openTasks, scope, mePersonIds, assigneeFilterIds, makerKeys),
    [openTasks, scope, mePersonIds, assigneeFilterIds, makerKeys]
  );
  const myOpenCount = React.useMemo(
    () => tasksInScope(openTasks, "mine", mePersonIds, [], makerKeys).length,
    [openTasks, mePersonIds, makerKeys]
  );

  const filteredDoneTasks = React.useMemo(
    () => tasksInScope(doneTasks, scope, mePersonIds, assigneeFilterIds, makerKeys),
    [doneTasks, scope, mePersonIds, assigneeFilterIds, makerKeys]
  );

  return {
    assigneeFilterPeople,
    mePersonIds,
    hasMe,
    scope,
    makerKeys,
    boardTasks,
    myOpenCount,
    filteredDoneTasks,
  };
}
