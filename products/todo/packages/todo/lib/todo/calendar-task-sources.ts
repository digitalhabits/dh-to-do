/**
 * Which tasks the Calendar gets, apart from how they are drawn (that is
 * calendar-tasks.ts, which needs the icon library). Here, so a test can
 * read the rule without the icons.
 */

/** A task with what is known about its list. */
export type CalendarTaskSource = {
  id: string;
  dateKey: string;
  name: string;
  /** The time the task is expected to take. A block in the week view starts that long. */
  minutes?: number | null;
  /** The task's list, for the Lists pill; null for a task on no list. */
  listId: string | null;
  listName: string | null;
  /** The list's stored appearance value: an icon id, or an old emoji. */
  listIcon: string | null;
  /** The reader ticked "Show on the Calendar": the months show it too, not only the week. */
  shown: boolean;
  /** Who the task is for: the week shows the first one on the task. */
  assigneeIds: string[];
  /** Ticked: the week shows it struck through, the months not at all. */
  completed: boolean;
};

/** What the calendar needs to know of a task and its list. */
type BoardTask = {
  id: string;
  text: string;
  dueOn?: string | null;
  completed: boolean;
  showOnCalendar: boolean;
  expectedDurationMinutes?: number | null;
  listId?: string | null;
  assigneeIds?: readonly string[];
  /** Its place on the board: a day shows its tasks in this order. */
  position?: number;
};

/**
 * The tasks for the calendar: each task with a due day, done or not.
 * The week shows them all, on their due days, and the done ones struck
 * through: a day shows what was got through, not only what is left. The
 * months show only the open ones the reader ticked "Show on the Calendar"
 * for. They come in their order on the board, so a day shows them as the
 * list of the day does, with the done ones after the open ones.
 */
export function calendarTaskSources(
  tasks: readonly BoardTask[],
  lists: readonly { id: string; name: string; emoji?: string | null }[],
): CalendarTaskSource[] {
  const listsById = new Map(lists.map((l) => [l.id, l]));
  return tasks
    .filter((t) => t.dueOn)
    .sort(
      (a, b) =>
        Number(a.completed) - Number(b.completed) || (a.position ?? 0) - (b.position ?? 0)
    )
    .map((t) => {
      const list = t.listId ? listsById.get(t.listId) : undefined;
      return {
        id: t.id,
        dateKey: t.dueOn as string,
        name: t.text,
        minutes: t.expectedDurationMinutes,
        listId: t.listId ?? null,
        listName: list?.name ?? null,
        listIcon: list?.emoji ?? null,
        shown: t.showOnCalendar,
        assigneeIds: [...(t.assigneeIds ?? [])],
        completed: t.completed,
      };
    });
}
