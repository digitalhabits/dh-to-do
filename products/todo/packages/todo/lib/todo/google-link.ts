/**
 * Which board list is linked to which Google Tasks list.
 *
 * The links are in two tables of their own (todo_google_lists and
 * todo_google_tasks, desktop schema 19), not in columns of the lists and
 * tasks. Only the desktop app syncs Google Tasks, so the shared store,
 * the planner and Postgres know nothing of it. The desktop app adds the
 * link to each list it hands to the page (`withGoogleLinks`).
 *
 * Part of google.ts, which re-exports what the rest of the app uses.
 */

import { todoDb } from "./db-driver";
import type { TodoList } from "./types";

export type GoogleListLink = {
  account: string;
  googleListId: string;
  /** Where the next poll starts (google-sync.ts). */
  cursor: string | null;
};

export async function getGoogleLink(listId: string): Promise<GoogleListLink | null> {
  const { rows } = await todoDb().query(
    "SELECT * FROM todo_google_lists WHERE list_id = $1",
    [listId]
  );
  if (!rows[0]) return null;
  return {
    account: rows[0].account as string,
    googleListId: rows[0].google_list_id as string,
    cursor: (rows[0].cursor as string | null) ?? null,
  };
}

/**
 * Link a list to a Google Tasks list, or to none.
 *
 * Another Google list, or none: the tasks' own links go too. They name
 * tasks of the old Google list; with them kept, a sync with the new list
 * would take every task as removed in Google. The Google tasks
 * themselves stay where they are.
 */
export async function setGoogleLink(
  listId: string,
  account: string | null,
  googleListId: string | null
): Promise<void> {
  const now = await getGoogleLink(listId);
  const same =
    (now?.googleListId ?? null) === (googleListId || null) &&
    (googleListId ? now?.account === account : true);
  if (same) return;
  await todoDb().query("DELETE FROM todo_google_tasks WHERE list_id = $1", [listId]);
  await todoDb().query("DELETE FROM todo_google_lists WHERE list_id = $1", [listId]);
  if (!googleListId || !account) return;
  await todoDb().query(
    "INSERT INTO todo_google_lists (list_id, account, google_list_id) VALUES ($1, $2, $3)",
    [listId, account, googleListId]
  );
}

/** The lists, each with its Google link when it has one. */
export async function withGoogleLinks<T extends TodoList>(lists: T[]): Promise<T[]> {
  const { rows } = await todoDb().query("SELECT * FROM todo_google_lists");
  if (!rows.length) return lists;
  const byList = new Map(rows.map((row) => [row.list_id as string, row]));
  return lists.map((list) => {
    const link = byList.get(list.id);
    if (!link) return list;
    return {
      ...list,
      googleAccount: link.account as string,
      googleListId: link.google_list_id as string,
    };
  });
}
