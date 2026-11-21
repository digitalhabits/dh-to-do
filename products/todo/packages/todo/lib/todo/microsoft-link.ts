/**
 * Which board list is linked to which Microsoft To Do list.
 *
 * The links are in two tables of their own (todo_microsoft_lists and
 * todo_microsoft_tasks, desktop schema 20), not in columns of the lists and
 * tasks. Only the desktop app syncs Microsoft To Do, so the shared store,
 * the planner and Postgres know nothing of it. The desktop app adds the
 * link to each list it hands to the page (`withMicrosoftLinks`).
 *
 * Part of microsoft.ts, which re-exports what the rest of the app uses.
 */

import { todoDb } from "./db-driver";
import type { TodoList } from "./types";

export type MicrosoftListLink = {
  account: string;
  microsoftListId: string;
  /** Where the next poll starts (microsoft-sync.ts). */
  cursor: string | null;
};

export async function getMicrosoftLink(listId: string): Promise<MicrosoftListLink | null> {
  const { rows } = await todoDb().query(
    "SELECT * FROM todo_microsoft_lists WHERE list_id = $1",
    [listId]
  );
  if (!rows[0]) return null;
  return {
    account: rows[0].account as string,
    microsoftListId: rows[0].microsoft_list_id as string,
    cursor: (rows[0].cursor as string | null) ?? null,
  };
}

/**
 * Link a list to a Microsoft To Do list, or to none.
 *
 * Another Microsoft list, or none: the tasks' own links go too. They name
 * tasks of the old Microsoft list; with them kept, a sync with the new list
 * would take every task as removed in Microsoft. The Microsoft tasks
 * themselves stay where they are.
 */
export async function setMicrosoftLink(
  listId: string,
  account: string | null,
  microsoftListId: string | null
): Promise<void> {
  const now = await getMicrosoftLink(listId);
  const same =
    (now?.microsoftListId ?? null) === (microsoftListId || null) &&
    (microsoftListId ? now?.account === account : true);
  if (same) return;
  await todoDb().query("DELETE FROM todo_microsoft_tasks WHERE list_id = $1", [listId]);
  await todoDb().query("DELETE FROM todo_microsoft_lists WHERE list_id = $1", [listId]);
  if (!microsoftListId || !account) return;
  await todoDb().query(
    "INSERT INTO todo_microsoft_lists (list_id, account, microsoft_list_id) VALUES ($1, $2, $3)",
    [listId, account, microsoftListId]
  );
}

/** The lists, each with its Microsoft link when it has one. */
export async function withMicrosoftLinks<T extends TodoList>(lists: T[]): Promise<T[]> {
  const { rows } = await todoDb().query("SELECT * FROM todo_microsoft_lists");
  if (!rows.length) return lists;
  const byList = new Map(rows.map((row) => [row.list_id as string, row]));
  return lists.map((list) => {
    const link = byList.get(list.id);
    if (!link) return list;
    return {
      ...list,
      microsoftAccount: link.account as string,
      microsoftListId: link.microsoft_list_id as string,
    };
  });
}
