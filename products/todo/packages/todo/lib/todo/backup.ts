/**
 * The backup file: what Export writes.
 *
 * One shape for both apps. The planner's To-Do tab and the standalone app
 * write the same file, so a board can move either way. The whole board
 * state goes in as it is: every field of every group, list, task and
 * person, ids included. The import (`importTodoBackup` in store.ts) hands
 * out fresh ids and maps the links between rows onto them. It also reads
 * the 2.x app's files, which have another shape.
 */

import type { BackupMedia } from "./backup-media";
import { getTodoProductFlavor } from "./product-flavor";
import type { TodoState } from "./types";

export type TodoBackup = TodoState & {
  /** Which app wrote the file: "digital-habits-todo/planner" or ".../standalone". */
  exportedFrom: string;
  /** When, as an ISO stamp. The import reads the day from it. */
  exportedAt: string;
  /**
   * The pictures the notes and the avatars name, with their bytes. Files
   * written before this have none. See backup-media.ts.
   */
  media?: BackupMedia[];
};

export function buildTodoBackup(
  state: TodoState,
  now: Date = new Date(),
  media: BackupMedia[] = []
): TodoBackup {
  return {
    exportedFrom: `digital-habits-todo/${getTodoProductFlavor()}`,
    exportedAt: now.toISOString(),
    groups: state.groups,
    lists: state.lists,
    // Children ride in tasks, carrying parentTaskId.
    tasks: state.tasks,
    people: state.people,
    ...(media.length ? { media } : {}),
  };
}

export function todoBackupFileName(now: Date = new Date()): string {
  return `Digital-Habits-To-Do-backup-${now.toISOString().split("T")[0]}.json`;
}
