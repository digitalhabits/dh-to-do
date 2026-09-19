/** Hidden in standalone — SQLite is always local. */
export function TodoOfflineStatusPill(_props: {
  isOffline: boolean;
  pendingOpsCount: number;
  isSyncing: boolean;
  onRetry?: () => void;
  lastError?: string | null;
}) {
  return null;
}
