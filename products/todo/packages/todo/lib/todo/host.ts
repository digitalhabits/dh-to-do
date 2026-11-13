/**
 * What the app that shows To-Do gives it.
 *
 * Two apps show To-Do: the desktop app (apps/todo) and the planner's To-Do
 * tab. Most of To-Do is the same in both. The parts in this file are not:
 * the planner keeps a queue of changes made offline and a copy of the board
 * for its next first paint; the desktop app has neither, because its data is
 * already on the computer.
 *
 * Each app calls `installTodoHost` once at start, before To-Do draws:
 * the desktop app in apps/todo/src/standalone-host.ts, the planner in
 * components/todo/planner-todo-host.ts. To-Do never imports either app.
 *
 * With no host installed, `todoHost()` throws. A quiet default would be
 * the desktop's, and in the planner that would send every write to a
 * database that is not there.
 *
 * The other part of the contract is the addresses that `api` answers:
 * /api/todo/*, /api/calendar-proxy, /api/media, /vendor/trix and
 * /redd-do-calendar. The desktop app answers them itself
 * (lib/todo/standalone-api.ts); the planner's server answers them.
 */

import type * as React from "react";

import type { TodoApi } from "@/components/todo/use-write-tracking";
import type { TodoState } from "@/lib/todo/types";

/** What the offline hook gives the page. */
export type TodoOfflineState = {
  /** Every read and write of the page goes through this. */
  api: TodoApi;
  isOffline: boolean;
  pendingOpsCount: number;
  isSyncing: boolean;
  /** Send the waiting changes now. */
  syncOfflineOps: () => Promise<void>;
  /** Why the queue last stopped, or null. */
  lastError: string | null;
};

export type TodoOfflinePillProps = {
  isOffline: boolean;
  pendingOpsCount: number;
  isSyncing: boolean;
  /** Try the queue again now. */
  onRetry?: () => void;
  /** Why the queue last stopped. */
  lastError?: string | null;
};

export type TodoHost = {
  /**
   * A React hook. The page calls it once in each render, so a host must
   * give the same function for as long as the app runs.
   */
  useOffline: (opts: { onSynced?: () => void }) => TodoOfflineState;
  /** True while the browser says it has no network. */
  isOfflineNow: () => boolean;
  /** True when the app was offline in the last `ms` milliseconds. */
  wasOfflineRecently: (ms: number) => boolean;
  /** Shows the offline state and the waiting changes in the title bar. */
  OfflineStatusPill: React.ComponentType<TodoOfflinePillProps>;
  /** Keep the board, to draw it at once the next time the page opens. */
  saveBoardSnapshot: (state: TodoState) => void;
};

let installed: TodoHost | null = null;

export function installTodoHost(host: TodoHost): void {
  installed = host;
}

export function todoHost(): TodoHost {
  if (!installed) {
    throw new Error(
      "No To-Do host is installed. The app that shows To-Do must call " +
        "installTodoHost before To-Do draws (see lib/todo/host.ts)."
    );
  }
  return installed;
}
