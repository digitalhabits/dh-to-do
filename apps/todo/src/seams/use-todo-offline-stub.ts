import { todoHostApi } from "@/lib/todo/standalone-api";

/** Standalone SQLite is already local-first — no remote outbox. */
export function useTodoOffline(_opts: { onSynced?: () => void } = {}) {
  return {
    api: todoHostApi,
    isOffline: false,
    pendingOpsCount: 0,
    isSyncing: false,
    syncOfflineOps: async () => {},
    /** No queue, so nothing can stop it. The planner's hook says why its queue stopped. */
    lastError: null as string | null,
  };
}
