"use client";

import * as React from "react";
import { toast } from "sonner";

import { REMINDERS_CONNECTED_KEY } from "@/components/todo/TodoSettingsModal";
import type { TodoApi } from "@/components/todo/use-write-tracking";
import { isOfflineNow } from "@/lib/offline/todo-offline";
import { isNativeShell } from "@/lib/native-shell";
import { describeError } from "@/lib/todo/errors";
import type { TodoView } from "@/lib/todo/list-scope";
import { syncRemindersList } from "@/lib/todo/reminders-sync";
import { fillText } from "@/lib/todo/i18n";
import {
  formatSyncCounts,
  remindersProgressLabel,
  syncUpToDateLine,
} from "@/lib/todo/sync-labels";
import type { TodoList, TodoTask } from "@/lib/todo/types";

/**
 * Whether Basecamp and Apple Reminders are connected, and what the sync
 * keeps between renders. At the top of the page: the list dialog reads
 * the connections too.
 */
export function useSyncState() {
  const [bcConnected, setBcConnected] = React.useState(false);
  const [remindersConnected, setRemindersConnected] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  /** Skip enter-auto-sync while an explicit import/sync already covers this list. */
  const suppressAutoSyncListIdsRef = React.useRef(new Set<string>());
  const autoSyncKeyRef = React.useRef<string | null>(null);
  const syncChainRef = React.useRef(Promise.resolve());
  const remindersConnectedRef = React.useRef(false);
  return {
    bcConnected,
    setBcConnected,
    remindersConnected,
    setRemindersConnected,
    syncing,
    setSyncing,
    suppressAutoSyncListIdsRef,
    autoSyncKeyRef,
    syncChainRef,
    remindersConnectedRef,
  };
}

/** Reads the two connections again each time Settings closes. */
export function useIntegrationStatus({
  settingsOpen,
  api,
  setRemindersConnected,
  setBcConnected,
}: {
  settingsOpen: boolean;
  api: TodoApi;
  setRemindersConnected: React.Dispatch<React.SetStateAction<boolean>>;
  setBcConnected: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  // Integration connection state (re-checked whenever settings closes).
  React.useEffect(() => {
    if (settingsOpen) return;
    try {
      setRemindersConnected(
        localStorage.getItem(REMINDERS_CONNECTED_KEY) === "1"
      );
    } catch {
      /* ignore */
    }
    void api("/api/todo/basecamp/status", "GET")
      .then((json: { connected?: boolean }) =>
        setBcConnected(Boolean(json.connected))
      )
      .catch(() => setBcConnected(false));
  }, [settingsOpen, api, setRemindersConnected, setBcConnected]);
}

/**
 * The sync with Basecamp and Apple Reminders: the Sync button, the
 * silent sync on entering and leaving a linked list, and the push of one
 * change to Reminders.
 */
export function useSync({
  api,
  refresh,
  view,
  currentListId,
  lists,
  isAllListsView,
  activeList,
  remindersConnected,
  remindersConnectedRef,
  listsRef,
  tasksRef,
  setSyncing,
  syncChainRef,
  suppressAutoSyncListIdsRef,
  autoSyncKeyRef,
  t,
}: {
  api: TodoApi;
  refresh: () => Promise<void>;
  view: TodoView;
  currentListId: string | null;
  lists: TodoList[];
  isAllListsView: boolean;
  activeList: TodoList | null;
  remindersConnected: boolean;
  remindersConnectedRef: React.RefObject<boolean>;
  listsRef: React.RefObject<TodoList[]>;
  tasksRef: React.RefObject<TodoTask[]>;
  setSyncing: React.Dispatch<React.SetStateAction<boolean>>;
  syncChainRef: React.RefObject<Promise<void>>;
  suppressAutoSyncListIdsRef: React.RefObject<Set<string>>;
  autoSyncKeyRef: React.RefObject<string | null>;
  t: (key: string) => string;
}) {
  /** Best-effort client-side push to Apple Reminders (EventKit is on this
   *  machine, so unlike Basecamp this can't run on the server). */
  function pushReminders(fn: () => Promise<unknown>) {
    if (!isNativeShell() || !remindersConnected) return;
    void fn().catch(() => {
      /* surfaces at the next explicit sync */
    });
  }

  function listHasSyncLink(
    list: TodoList | null | undefined,
    remindersOk = remindersConnectedRef.current
  ): boolean {
    if (!list) return false;
    return Boolean(
      list.basecampListId ||
        (list.remindersListId && isNativeShell() && remindersOk)
    );
  }

  async function runSyncForLists(
    listsToSync: TodoList[],
    opts?: {
      silent?: boolean;
      toastId?: string | number;
    }
  ): Promise<string[]> {
    if (isOfflineNow()) {
      if (!opts?.silent) {
        toast.info(t("syncNeedsConnection"));
      }
      return [];
    }
    const silent = Boolean(opts?.silent);
    const summaries: string[] = [];
    const blockedAssignees = new Set<string>();
    const nameLinkedPeople = new Set<string>();
    const ambiguousPeople = new Set<string>();
    for (const list of listsToSync) {
      if (list.basecampListId) {
        const json = await api("/api/todo/basecamp/sync", "POST", {
          listId: list.id,
        });
        const result = json.result as {
          pulled: number;
          pushed: number;
          removed: number;
          updated: number;
          unpushableAssignees?: string[];
          nameLinkedPeople?: string[];
          ambiguousPeople?: string[];
        };
        for (const name of result.unpushableAssignees ?? []) {
          blockedAssignees.add(name);
        }
        for (const name of result.nameLinkedPeople ?? []) {
          nameLinkedPeople.add(name);
        }
        for (const name of result.ambiguousPeople ?? []) {
          ambiguousPeople.add(name);
        }
        summaries.push(
          `${list.name}: ${formatSyncCounts(t, "Basecamp", result)}`
        );
      }
      if (
        list.remindersListId &&
        isNativeShell() &&
        remindersConnectedRef.current
      ) {
        const result = await syncRemindersList(
          list,
          // Parents only: Reminders has no subtasks, and a child pushed
          // there would come back as a full task.
          tasksRef.current.filter((t) => t.listId === list.id && !t.parentTaskId),
          {
            // The page's api, which in the desktop app writes to SQLite.
            api,
            onProgress: silent
              ? undefined
              : (progress) => {
                  if (opts?.toastId == null) return;
                  toast.loading(
                    fillText(t("syncingListProgress"), {
                      name: list.name,
                      progress: remindersProgressLabel(t, progress),
                    }),
                    { id: opts.toastId }
                  );
                },
          }
        );
        summaries.push(
          `${list.name}: ${formatSyncCounts(t, t("remindersShort"), result)}`
        );
      }
    }
    // Basecamp only accepts people who are on the project, and matching by
    // name is a guess. Say both out loud — a quiet drop looks like data loss.
    if (!silent && blockedAssignees.size) {
      toast.warning(t("syncPeopleNotSent"), {
        description: fillText(t("syncPeopleNotSentHint"), {
          names: [...blockedAssignees].join(", "),
        }),
        duration: 9000,
      });
    }
    if (!silent && nameLinkedPeople.size) {
      toast.message(t("syncPeopleByName"), {
        description: fillText(t("syncPeopleByNameHint"), {
          names: [...nameLinkedPeople].join(", "),
        }),
        duration: 9000,
      });
    }
    if (!silent && ambiguousPeople.size) {
      toast.warning(t("syncPeopleTwice"), {
        description: fillText(t("syncPeopleTwiceHint"), {
          names: [...ambiguousPeople].join(", "),
        }),
        duration: 9000,
      });
    }
    await refresh();
    return summaries;
  }

  function enqueueSync(
    listsToSync: TodoList[],
    opts?: { silent?: boolean; toastId?: string | number }
  ): Promise<string[]> {
    const job = syncChainRef.current.then(async () => {
      setSyncing(true);
      try {
        return await runSyncForLists(listsToSync, opts);
      } finally {
        setSyncing(false);
      }
    });
    syncChainRef.current = job.then(
      () => undefined,
      () => undefined
    );
    return job;
  }

  async function doSync() {
    const listsToSync = isAllListsView
      ? lists.filter((l) => listHasSyncLink(l, remindersConnected))
      : activeList && listHasSyncLink(activeList, remindersConnected)
        ? [activeList]
        : [];
    if (!listsToSync.length) {
      toast.message(t("nothingToSync"), {
        description: t("nothingToSyncHint"),
      });
      return;
    }
    // Offline, nothing is synced: say so, and not "Syncing" and then "up
    // to date", which the empty answer below would read as.
    if (isOfflineNow()) {
      toast.info(t("syncNeedsConnection"));
      return;
    }

    const label = isAllListsView
      ? listsToSync.length === 1
        ? listsToSync[0].name
        : fillText(t("listsCount"), { count: listsToSync.length })
      : listsToSync[0].name;
    const syncSources = [
      listsToSync.some((l) => l.basecampListId) ? "Basecamp" : null,
      listsToSync.some(
        (l) => l.remindersListId && isNativeShell() && remindersConnected
      )
        ? t("appleReminders")
        : null,
    ].filter(Boolean);
    const toastId = toast.loading(
      fillText(t("syncingWith"), { name: label, sources: syncSources.join(" + ") })
    );
    try {
      const summaries = await enqueueSync(listsToSync, { toastId });
      const quiet = [
        syncUpToDateLine(t, "Basecamp"),
        syncUpToDateLine(t, t("remindersShort")),
      ];
      const allQuiet = summaries.every((s) => quiet.some((line) => s.endsWith(line)));
      toast.success(fillText(t(allQuiet ? "listUpToDate" : "syncedList"), { name: label }), {
        id: toastId,
        description: summaries.join(" · "),
        duration: allQuiet ? 3500 : 7000,
      });
    } catch (err) {
      toast.error(describeError(err, t("syncFailed")), {
        id: toastId,
      });
    }
  }

  function autoSyncList(list: TodoList | null | undefined) {
    if (!listHasSyncLink(list)) return;
    if (suppressAutoSyncListIdsRef.current.has(list!.id)) return;
    void enqueueSync([list!], { silent: true }).catch(() => {
      /* silent auto-sync: surface faults on the next manual sync */
    });
  }

  // Silent enter/leave sync for Basecamp / Apple Reminders lists.
  React.useEffect(() => {
    const nextKey =
      view === "lists" && !isAllListsView && currentListId
        ? currentListId
        : null;
    const prevKey = autoSyncKeyRef.current;
    if (prevKey === nextKey) return;

    const prevList = prevKey
      ? listsRef.current.find((l) => l.id === prevKey)
      : null;
    const nextList = nextKey
      ? listsRef.current.find((l) => l.id === nextKey)
      : null;

    autoSyncKeyRef.current = nextKey;
    autoSyncList(prevList);
    autoSyncList(nextList);
  }, [view, currentListId, isAllListsView, autoSyncKeyRef, listsRef]);

  // If Reminders connects while a linked list is already open, sync once.
  React.useEffect(() => {
    if (!remindersConnected) return;
    const key = autoSyncKeyRef.current;
    if (!key) return;
    const list = listsRef.current.find((l) => l.id === key);
    if (!list?.remindersListId) return;
    autoSyncList(list);
  }, [remindersConnected, autoSyncKeyRef, listsRef]);

  // Push a final silent sync when leaving the To-Do page.
  React.useEffect(() => {
    return () => {
      const key = autoSyncKeyRef.current;
      if (!key) return;
      const list = listsRef.current.find((l) => l.id === key);
      if (!list) return;
      const remindersOk =
        Boolean(list.remindersListId) &&
        isNativeShell() &&
        remindersConnectedRef.current;
      if (!list.basecampListId && !remindersOk) return;
      void (async () => {
        try {
          if (list.basecampListId) {
            await api("/api/todo/basecamp/sync", "POST", { listId: list.id });
          }
          if (remindersOk) {
            await syncRemindersList(
              list,
              // Parents only, as in runSyncForLists.
              tasksRef.current.filter((t) => t.listId === list.id && !t.parentTaskId),
              { api }
            );
          }
        } catch {
          /* unmount sync is best-effort */
        }
      })();
    };
  }, [autoSyncKeyRef, listsRef, remindersConnectedRef, tasksRef]);

  return { pushReminders, doSync };
}
