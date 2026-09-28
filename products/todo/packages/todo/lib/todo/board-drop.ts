/**
 * What a drop writes.
 *
 * The page carries a card, a tab, a group or a person pill with the
 * pointer, and on the drop these work out the writes: the fields each
 * task changes, or the position of a list, group or person. The page
 * sends each write through its own path (mutateTask, or a PATCH).
 *
 * No React in here, so a test can read it.
 */

import type { TodoView } from "./list-scope";
import {
  boardColumnOf,
  boardColumnPatch,
  type TodoBoardColumn,
  type TodoTask,
  type TodoTaskPatch,
} from "./types";

/**
 * A position between two neighbors, or past the one neighbor there is.
 * Returns null when the two neighbors sit so close that a double cannot
 * hold a value between them. The caller then reindexes the run instead.
 */
export function slotBetween(
  prev: number | undefined,
  next: number | undefined
): number | null {
  if (prev !== undefined && next !== undefined) {
    const mid = (prev + next) / 2;
    return mid > prev && mid < next ? mid : null;
  }
  if (prev !== undefined) return prev + 1;
  if (next !== undefined) return next - 1;
  return null;
}


/** One task's change, as mutateTask takes it. */
export type TaskWrite = { id: string; patch: TodoTaskPatch };

/**
 * The fewest position writes that make `order` the order of the positions.
 *
 * For a column that was sorted by something else (due date, name…) and is
 * now put in a hand-made order: the positions there follow no plan, so the
 * order asked for is written out. The longest run of tasks whose positions
 * already rise in that order keeps them; only the others get a position,
 * spread between the kept ones around them. Positions are real numbers, so
 * that is usually one write or a few, not one per task. Only when two kept
 * neighbours leave no room between them is the whole order numbered again,
 * from `now` (epoch ms), as a crowded drop is.
 */
export function planManualOrder(
  order: { id: string; position: number }[],
  now: number
): TaskWrite[] {
  const n = order.length;
  if (n === 0) return [];
  // The longest strictly rising run of positions, as a set of indexes.
  const best = new Array<number>(n).fill(1);
  const from = new Array<number>(n).fill(-1);
  let end = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (order[j].position < order[i].position && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        from[i] = j;
      }
    }
    if (best[i] > best[end]) end = i;
  }
  const kept = new Set<number>();
  for (let i = end; i >= 0; i = from[i]) kept.add(i);

  const next = order.map((t) => t.position);
  let i = 0;
  while (i < n) {
    if (kept.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !kept.has(j)) j++;
    // order[i..j-1] need positions between next[i-1] and next[j].
    const lo = i > 0 ? next[i - 1] : undefined;
    const hi = j < n ? next[j] : undefined;
    const count = j - i;
    for (let k = 0; k < count; k++) {
      next[i + k] =
        lo !== undefined && hi !== undefined
          ? lo + ((hi - lo) * (k + 1)) / (count + 1)
          : lo !== undefined
            ? lo + k + 1
            : (hi as number) - (count - k);
    }
    i = j;
  }
  const rising = next.every((p, k) => k === 0 || p > next[k - 1]);
  if (!rising) {
    const base = now / 1000;
    for (let k = 0; k < n; k++) next[k] = base + k;
  }
  const writes: TaskWrite[] = [];
  order.forEach((t, k) => {
    if (next[k] !== t.position) writes.push({ id: t.id, patch: { position: next[k] } });
  });
  return writes;
}

/** The column flags a task changes to be in `column`: only those that differ. */
function columnFlagChanges(task: TodoTask, column: TodoBoardColumn): TodoTaskPatch {
  const flags = boardColumnPatch(column);
  const patch: TodoTaskPatch = {};
  if (flags.isBacklog !== task.isBacklog) patch.isBacklog = flags.isBacklog;
  if (flags.isToday !== task.isToday) patch.isToday = flags.isToday;
  if (flags.isSomeday !== task.isSomeday) patch.isSomeday = flags.isSomeday;
  return patch;
}

/**
 * A drop in a sorted column: the order the drag drew, written with
 * planManualOrder. The dragged task's own write goes first and carries
 * `flagPatch`, the column flags it changes.
 */
function keepDrawnOrder(
  ids: string[],
  byId: Map<string, TodoTask>,
  taskId: string,
  flagPatch: TodoTaskPatch,
  now: number
): TaskWrite[] {
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((t): t is TodoTask => Boolean(t));
  const moves = planManualOrder(ordered, now);
  const own = moves.find((w) => w.id === taskId);
  const ownPatch: TodoTaskPatch = { ...flagPatch, ...own?.patch };
  const writes: TaskWrite[] = [];
  if (Object.keys(ownPatch).length) writes.push({ id: taskId, patch: ownPatch });
  for (const w of moves) if (w.id !== taskId) writes.push(w);
  return writes;
}

/**
 * The writes a card's drop makes, in the order they are sent.
 *
 * `previewIds` is the order the drag drew, `hover` the column under the
 * pointer on the board, and `dropListId` a list tab it was let go on.
 * `now` (epoch ms) numbers a column that has no room left between two
 * neighbours.
 */
export function planTaskDrop(input: {
  taskId: string;
  previewIds: string[] | null;
  hover: { taskId: string; column: TodoBoardColumn } | null;
  dropListId: string | null;
  view: TodoView;
  tasks: TodoTask[];
  somedayEnabled: boolean;
  now: number;
  /**
   * The column the task lands in is sorted (due date, name…), not in the
   * drag order. The drop then writes out the order the drag drew, with as
   * few writes as it can (planManualOrder), and the caller puts the column
   * on Manual: a midpoint between neighbours sorted by something else put
   * the card nowhere near where it was let go.
   */
  sortedColumn?: boolean;
}): TaskWrite[] {
  const { taskId, previewIds: ids, hover, dropListId, view, tasks, somedayEnabled, now } =
    input;
  const writes: TaskWrite[] = [];

  // Dropped on a tab: the task belongs to that list now, and keeps the
  // column it was in.
  if (dropListId) {
    const moved = tasks.find((t) => t.id === taskId);
    // The same path the menu's Change list takes, so a local task is
    // written to the server on its way and a synced one keeps its links.
    if (moved && moved.listId !== dropListId) {
      writes.push({ id: taskId, patch: { listId: dropListId } });
    }
    return writes;
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  /*
    Dropped on a pill, which is a section and not a place in one.

    A pill holds no rows, so the drag worked out no order to put the task
    in — and the ordering path below reads that as nothing to do. What was
    asked for is plain enough without it: this task belongs to that
    section now. It goes to the end of it, which is where a task dropped
    on a name rather than between two rows belongs.
  */
  if (!ids && hover?.taskId === taskId && hover.column) {
    const dropped = byId.get(taskId);
    if (!dropped || dropped.completed) return writes;
    const patch = columnFlagChanges(dropped, hover.column);
    if (Object.keys(patch).length) writes.push({ id: taskId, patch });
    return writes;
  }
  if (!ids) return writes;
  if (view === "favourites") {
    // Favourites keep their own ordering — reassign sequential positions.
    ids.forEach((id, index) => {
      const task = byId.get(id);
      if (task && task.favouritePosition !== index) {
        writes.push({ id, patch: { favouritePosition: index } });
      }
    });
    return writes;
  }
  const dragged = byId.get(taskId);
  const boardMode = view === "lists" && dragged && !dragged.completed;
  const targetColumn =
    boardMode && hover?.taskId === taskId
      ? hover.column
      : dragged
        ? boardColumnOf(dragged, somedayEnabled)
        : null;

  // Board: persist the visual column order (All tab mixes lists — do not
  // restrict neighbors to the dragged task's list). Positions are global,
  // so a slot between the column neighbors carries into per-list tabs.
  // One PATCH for the dragged task. The whole column is reindexed only
  // when the neighbors leave no room for a midpoint.
  if (boardMode && dragged && targetColumn) {
    const orderedIds = ids.filter((id) => {
      if (id === taskId) return true;
      const t = byId.get(id);
      return (
        Boolean(t) &&
        !t!.completed &&
        boardColumnOf(t!, somedayEnabled) === targetColumn
      );
    });
    const index = orderedIds.indexOf(taskId);
    if (index < 0) return writes;
    const flagPatch = columnFlagChanges(dragged, targetColumn);

    if (input.sortedColumn) {
      return keepDrawnOrder(orderedIds, byId, taskId, flagPatch, now);
    }
    const prev = index > 0 ? byId.get(orderedIds[index - 1]) : null;
    const next =
      index < orderedIds.length - 1 ? byId.get(orderedIds[index + 1]) : null;
    if (!prev && !next) {
      // Alone in the column: only the column flags can change.
      if (Object.keys(flagPatch).length) writes.push({ id: taskId, patch: flagPatch });
      return writes;
    }
    const slot = slotBetween(prev?.position, next?.position);
    if (slot !== null) {
      const patch: TodoTaskPatch = { ...flagPatch };
      if (slot !== dragged.position) patch.position = slot;
      if (Object.keys(patch).length) writes.push({ id: taskId, patch });
      return writes;
    }

    // No room: spread the column out again, one PATCH per task that moves.
    const base = now / 1000;
    orderedIds.forEach((id, i) => {
      const task = byId.get(id);
      if (!task) return;
      const patch: TodoTaskPatch = id === taskId ? { ...flagPatch } : {};
      const nextPos = base + i;
      if (task.position !== nextPos) patch.position = nextPos;
      if (Object.keys(patch).length) writes.push({ id, patch });
    });
    return writes;
  }

  if (!dragged) return writes;
  // The flat list ranks by column before position, so only peers in the
  // same column are real neighbors.
  const draggedColumn = boardColumnOf(dragged, somedayEnabled);
  const peers = ids.filter((id) => {
    if (id === taskId) return true;
    const t = byId.get(id);
    return (
      Boolean(t) &&
      t!.completed === dragged.completed &&
      boardColumnOf(t!, somedayEnabled) === draggedColumn
    );
  });
  const index = peers.indexOf(taskId);
  if (index < 0) return writes;
  const prev = index > 0 ? byId.get(peers[index - 1]) : null;
  const next = index < peers.length - 1 ? byId.get(peers[index + 1]) : null;
  if (!prev && !next) return writes;
  const slot = slotBetween(prev?.position, next?.position);
  if (slot !== null) {
    if (slot !== dragged.position) writes.push({ id: taskId, patch: { position: slot } });
    return writes;
  }
  // No room between the neighbors: spread the run out again.
  const base = now / 1000;
  peers.forEach((id, i) => {
    const task = byId.get(id);
    if (task && task.position !== base + i) {
      writes.push({ id, patch: { position: base + i } });
    }
  });
  return writes;
}

/**
 * Where a dragged tab, group or person pill goes: halfway between the two
 * it was let go between, or one past the one neighbour there is. Null when
 * it has none, or is not in the order.
 */
export function positionFromNeighbours(
  ids: string[],
  id: string,
  items: { id: string; position: number }[]
): number | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  const index = ids.indexOf(id);
  if (index < 0) return null;
  const prev = index > 0 ? byId.get(ids[index - 1]) : null;
  const next = index < ids.length - 1 ? byId.get(ids[index + 1]) : null;
  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + 1;
  if (next) return next.position - 1;
  return null;
}
