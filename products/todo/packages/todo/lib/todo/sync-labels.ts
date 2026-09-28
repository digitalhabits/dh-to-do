/**
 * The words the board says about a sync: the loading toast's progress for
 * Apple Reminders, and the summary of what one list's sync changed, in
 * the user's language (`t`, from makeT).
 *
 * No React in here, so a test can read it.
 */

import { countText, fillText } from "./i18n";
import type { RemindersSyncProgress } from "./reminders-sync";

type T = (key: string) => string;

export function remindersProgressLabel(
  t: T,
  progress: RemindersSyncProgress
): string {
  if (progress.phase === "reading") {
    return t("remindersReading");
  }
  if (progress.total <= 0) {
    if (progress.phase === "importing") return t("remindersImporting");
    if (progress.phase === "updating") return t("remindersUpdatingTasks");
    if (progress.phase === "pushing") return t("remindersPushingTasks");
    if (progress.phase === "removing") return t("remindersRemoving");
    return t("remindersSyncing");
  }
  const count = `${progress.done}/${progress.total}`;
  if (progress.phase === "importing") {
    return fillText(t("remindersImportingCount"), { count });
  }
  if (progress.phase === "updating") {
    return fillText(t("remindersUpdatingCount"), { count });
  }
  if (progress.phase === "pushing") {
    return fillText(t("remindersPushingCount"), { count });
  }
  if (progress.phase === "removing") {
    return fillText(t("remindersRemovingCount"), { count });
  }
  return fillText(t("remindersSyncingCount"), { count });
}

export function formatSyncCounts(
  t: T,
  source: string,
  counts: {
    pulled: number;
    pushed: number;
    removed: number;
    updated: number;
  }
): string {
  const parts: string[] = [];
  if (counts.pulled) parts.push(countText(t, "syncLineAdded", counts.pulled, { source }));
  if (counts.pushed) parts.push(countText(t, "syncLineSent", counts.pushed, { source }));
  if (counts.updated) parts.push(countText(t, "syncLineUpdated", counts.updated));
  if (counts.removed) parts.push(countText(t, "syncLineRemoved", counts.removed));
  if (!parts.length) return syncUpToDateLine(t, source);
  return parts.join(" · ");
}

/** What formatSyncCounts says for a source when nothing changed. */
export function syncUpToDateLine(t: T, source: string): string {
  return fillText(t("syncLineUpToDate"), { source });
}
