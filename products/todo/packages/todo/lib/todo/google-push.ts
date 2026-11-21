/**
 * What a board write tells the Google sync: which lists it touched.
 *
 * Nothing goes to Google from here. Every change, a delete too, is
 * settled by the sync (google-sync.ts). But the sync should come soon, so
 * that a change is in Google a moment after the person made it and not
 * ten minutes later. So each write is told to whoever listens
 * (`onGoogleBoardWrite`); the page listens, and syncs the list when the
 * person stops typing.
 *
 * Part of google.ts, which re-exports what the rest of the app uses.
 */

type BoardAction = {
  type: string;
  listId: string | null;
  fromListId?: string | null;
};

type WriteListener = (listIds: string[]) => void;
const listeners = new Set<WriteListener>();

/** Hear which lists a board write touched. Returns the way to stop. */
export function onGoogleBoardWrite(fn: WriteListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The store calls this after each task write (standalone-api.ts). */
export async function noteGoogleBoardWrite(action: BoardAction): Promise<void> {
  const listIds = [action.listId, action.fromListId].filter((id): id is string => Boolean(id));
  if (!listIds.length) return;
  for (const fn of listeners) fn(listIds);
}
