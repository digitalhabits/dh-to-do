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

import { PlanError } from "@/lib/todo/plan-error";

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
 * One Google Tasks list can be linked to one list of the board. With two, a new
 * task from there goes into the list that syncs first and never shows in
 * the other, and the person sees a sync that works in one direction only.
 * Throws when another list of the board (not a deleted one) has the link.
 */
export async function assertGoogleListFree(
  listId: string | null,
  account: string,
  remoteListId: string
): Promise<void> {
  const { rows } = await todoDb().query(
    `SELECT l.name AS name FROM todo_google_lists k JOIN todo_lists l ON l.id = k.list_id
     WHERE k.account = $1 AND k.google_list_id = $2 AND l.deleted_at IS NULL AND k.list_id <> $3`,
    [account, remoteListId, listId ?? ""]
  );
  if (!rows[0]) return;
  throw new PlanError(
    `This Google Tasks list is already connected to your list "${rows[0].name as string}". Connect another Google Tasks list, or remove that connection first.`,
    409
  );
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
  if (googleListId && account) await assertGoogleListFree(listId, account, googleListId);
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
