/**
 * The row a new task stands on the board as, before the server answers.
 *
 * The board draws a task the moment it is added, and replaces the row with
 * the server's when the answer comes. So the row must be what the server
 * will make: the same id (sent with the create), the same column, and the
 * same place in it. Otherwise the task moves the moment the answer lands.
 *
 * No React in here, so a test can read it.
 */

import { todayDueOn, type SubtaskDraft } from "./task-draft";
import {
  boardColumnOf,
  type TodoBoardColumn,
  type TodoPerson,
  type TodoTask,
} from "./types";

export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}


/** Due today, or already past: it lands in Today whatever row it was typed into. */
export function landingColumn(column: TodoBoardColumn, dueOn: string | null): TodoBoardColumn {
  return dueOn && dueOn <= todayDueOn() ? "today" : column;
}

/**
 * The people a new task starts with.
 *
 * People picked in the add row come first. Otherwise, with a people filter
 * on, assign those people so the new task stays visible. Under "mine" a new
 * task needs nobody on it: the reader made it, and that keeps it on their
 * board.
 */
export function seededAssignees(
  draftAssignees: string[],
  filterIds: string[],
  filterPeople: Pick<TodoPerson, "id">[]
): string[] {
  const filterableIds = new Set(filterPeople.map((p) => p.id));
  return draftAssignees.length
    ? draftAssignees
    : filterIds.length > 0
        ? filterIds.filter((id) => filterableIds.has(id))
        : [];
}

/*
  Who the new task has to get below.

  The server picks the spot — MAX(position) + 1 over the open tasks of
  the same list, or of the tasks on no list — and a spot chosen
  differently here would move the row the moment the answer came back.
  Below the column, and below the rest of the list.
*/
export function newTaskPosition(
  openTasks: TodoTask[],
  tasks: TodoTask[],
  listId: string | null,
  landing: TodoBoardColumn,
  somedayEnabled: boolean
): number {
  const columnPeers = openTasks.filter(
    (t) =>
      boardColumnOf(t, somedayEnabled) === landing && t.listId === listId
  );
  return (
    Math.max(
      0,
      ...columnPeers.map((t) => t.position),
      ...tasks
        .filter((t) => t.listId === listId && !t.completed)
        .map((t) => t.position)
    ) + 1
  );
}

/** A new step goes after its siblings, or first. */
export function nextStepPosition(siblings: Pick<TodoTask, "position">[]): number {
  return siblings.length ? Math.max(...siblings.map((s) => s.position)) + 1 : 1;
}

/** A new task's row: what it was given, and nothing else set yet. */
export function optimisticTask(
  fields: Pick<TodoTask, "id" | "listId" | "createdBy" | "text" | "position" | "createdAt"> &
    Partial<TodoTask>
): TodoTask {
  return {
    notesHtml: null,
    dueOn: null,
    completed: false,
    parentTaskId: null,
    completedAt: null,
    isFavourite: false,
    favouritePosition: null,
    isBacklog: false,
    isToday: false,
    isSomeday: false,
    showOnCalendar: false,
    assigneeIds: [],
    colour: null,
    expectedDurationMinutes: null,
    timeSpentSeconds: 0,
    basecampId: null,
    remindersId: null,
    ...fields,
  };
}

/**
 * The steps typed in the add row, as rows under their new task: the ones
 * with words, in the order typed. Each takes its task's list and maker.
 */
export function optimisticSteps(
  parent: TodoTask,
  drafts: Pick<SubtaskDraft, "text" | "assigneeIds">[]
): TodoTask[] {
  return drafts
    .map((row) => ({ ...row, text: row.text.trim() }))
    .filter((row) => row.text)
    .map((row, index) => ({
      ...parent,
      id: newClientId(),
      text: row.text,
      notesHtml: null,
      dueOn: null,
      isBacklog: false,
      isToday: false,
      isSomeday: false,
      assigneeIds: row.assigneeIds,
      expectedDurationMinutes: null,
      position: index + 1,
      parentTaskId: parent.id,
    }));
}
