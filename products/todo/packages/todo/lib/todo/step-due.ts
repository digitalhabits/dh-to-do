/**
 * The day a task's steps ask for first (design "19b"): the earliest due
 * date among its open steps, when that comes before the task's own day
 * (or the task has none). Otherwise null: the task's day says it already.
 */
export function earliestStepDue(
  steps: readonly { completed: boolean; dueOn?: string | null }[],
  taskDueOn: string | null
): string | null {
  let first: string | null = null;
  for (const step of steps) {
    if (step.completed || !step.dueOn) continue;
    if (first === null || step.dueOn < first) first = step.dueOn;
  }
  if (first === null) return null;
  return taskDueOn === null || first < taskDueOn ? first : null;
}

type StepLike = {
  id: string;
  parentTaskId?: string | null;
  completed: boolean;
  dueOn?: string | null;
  assigneeIds: string[];
  position: number;
};

/**
 * The steps the board's Today column shows as cards of their own: open,
 * due today or before, of a parent on this tab that is not in Today
 * itself (there the parent says it already). A step with people on it is
 * shown by the person filter as a task is; one with nobody, as its parent.
 * Earliest day first, then in the parent's order.
 */
export function stepsDueToday<T extends StepLike>(
  tasks: readonly T[],
  {
    today,
    parentsInView,
    parentInToday,
    parentShown,
    stepShown,
  }: {
    /** "YYYY-MM-DD". */
    today: string;
    /** The open tasks on this tab, by id, before the person filter. */
    parentsInView: ReadonlyMap<string, T>;
    parentInToday: (parent: T) => boolean;
    /** Whether the person filter shows the parent. */
    parentShown: (parent: T) => boolean;
    /** Whether the person filter shows a step that has people on it. */
    stepShown: (step: T) => boolean;
  }
): T[] {
  const due = tasks.filter((step) => {
    if (!step.parentTaskId || step.completed || !step.dueOn || step.dueOn > today) return false;
    const parent = parentsInView.get(step.parentTaskId);
    if (!parent || parentInToday(parent)) return false;
    return step.assigneeIds.length ? stepShown(step) : parentShown(parent);
  });
  return due.sort(
    (a, b) =>
      (a.dueOn! < b.dueOn! ? -1 : a.dueOn! > b.dueOn! ? 1 : 0) ||
      (parentsInView.get(a.parentTaskId!)!.position - parentsInView.get(b.parentTaskId!)!.position) ||
      a.position - b.position
  );
}
