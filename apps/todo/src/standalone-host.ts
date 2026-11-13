/**
 * To-Do's host in the desktop app (see lib/todo/host.ts in the To-Do
 * package).
 *
 * The board is SQLite on this computer, so there is no offline queue, no
 * status to show for it, and no copy of the board to keep for a first
 * paint. Reads and writes go to the app's own answer for each address
 * (standalone-api.ts).
 *
 * main.tsx calls this before To-Do draws. The UI walks get it the same way
 * (tests/run.mjs).
 */

import { installTodoHost, type TodoOfflineState } from "@/lib/todo/host";
import { todoHostApi } from "@/lib/todo/standalone-api";

const NOTHING_WAITS: TodoOfflineState = {
  api: todoHostApi,
  isOffline: false,
  pendingOpsCount: 0,
  isSyncing: false,
  syncOfflineOps: async () => {},
  lastError: null,
};

export function installStandaloneTodoHost(): void {
  installTodoHost({
    useOffline: () => NOTHING_WAITS,
    isOfflineNow: () => false,
    wasOfflineRecently: () => false,
    OfflineStatusPill: () => null,
    saveBoardSnapshot: () => {},
  });
}

installStandaloneTodoHost();
