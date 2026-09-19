/**
 * Where a dragged task belongs in its whole column.
 *
 * The board shows rows; a search shows some of them. Dropping a task between
 * two rows on screen says where it goes among those two, and this says what
 * that means for the column entire — the part on screen and the part the
 * search is hiding.
 *
 * No React here, so the rule can be read and tried on its own.
 */

/**
 * The column, in order, with `taskId` put where the rows on screen say.
 *
 * The row above on screen is the anchor: the task goes straight after it in
 * the full order — or straight before the row below, when there was nothing
 * above — and last where the column shows nothing else at all. With no
 * search the rows on screen are the column, and this gives back exactly the
 * order the reader sees.
 *
 * The whole column matters because the drop is written from it: the
 * neighbours give the new position, and where they leave no room the column
 * is spread out again. Written from the rows on screen instead, a search
 * would silently reindex a handful of tasks over the top of the ones it was
 * hiding.
 */
export function placeInColumn(
  columnIds: string[],
  shownIds: string[],
  taskId: string
): string[] {
  const rest = columnIds.filter((id) => id !== taskId);
  const at = shownIds.indexOf(taskId);
  if (at < 0) return rest;
  const above = at > 0 ? shownIds[at - 1] : null;
  const below = at < shownIds.length - 1 ? shownIds[at + 1] : null;
  const afterAbove = above ? rest.indexOf(above) : -1;
  if (afterAbove >= 0) {
    rest.splice(afterAbove + 1, 0, taskId);
    return rest;
  }
  const beforeBelow = below ? rest.indexOf(below) : -1;
  if (beforeBelow >= 0) {
    rest.splice(beforeBelow, 0, taskId);
    return rest;
  }
  rest.push(taskId);
  return rest;
}

/**
 * What one drop means in positions: the moved row's new number, or — when
 * the floats between its neighbours leave no room — every row's, counted
 * afresh.
 *
 * The midpoint is the cheap case and nearly always enough: one write, and
 * the rest of the list untouched. Renumbering is the fallback that keeps
 * fifty drops in the same gap from exhausting the float. No React and no
 * store here, so the rule can be tried on its own.
 */
export function placeByPosition(
  rows: { id: string; position: number }[],
  order: string[],
  movedId: string
): { id: string; position: number }[] | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const moved = byId.get(movedId);
  if (!moved || order.length !== rows.length) return null;
  if (order.some((id) => !byId.has(id))) return null;
  const at = order.indexOf(movedId);
  const prev = at > 0 ? byId.get(order[at - 1]) : undefined;
  const next = at < order.length - 1 ? byId.get(order[at + 1]) : undefined;
  const position =
    prev && next
      ? (prev.position + next.position) / 2
      : prev
        ? prev.position + 1
        : next
          ? next.position - 1
          : moved.position;
  const crowded =
    (prev !== undefined && position <= prev.position) ||
    (next !== undefined && position >= next.position);
  if (crowded) {
    return order
      .map((id, index) => ({ id, position: index + 1 }))
      .filter((row) => byId.get(row.id)!.position !== row.position);
  }
  return position === moved.position ? [] : [{ id: movedId, position }];
}
