"use client";

import * as React from "react";
import { toast } from "sonner";

import { GITHUB_PUBLISH_EVENT } from "@/components/todo/task-github-item";
import { REMINDERS_CONNECTED_KEY } from "@/components/todo/TodoSettingsModal";
import type { TodoApi } from "@/components/todo/use-write-tracking";
import { todoHost } from "@/lib/todo/host";
import { isNativeShell } from "@/lib/todo/native-bridge";
import { describeError } from "@/lib/todo/errors";
import { onGoogleBoardWrite } from "@/lib/todo/google-push";
import type { TodoView } from "@/lib/todo/list-scope";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import { syncRemindersList } from "@/lib/todo/reminders-sync";
import { fillText } from "@/lib/todo/i18n";
import {
  formatSyncCounts,
  remindersProgressLabel,
  syncUpToDateLine,
} from "@/lib/todo/sync-labels";
import type { TodoList, TodoTask } from "@/lib/todo/types";

/** How often every linked list syncs by itself. */
const AUTO_SYNC_EVERY_MS = 10 * 60_000;

/**
 * How long after the last change to a Google-linked list it syncs. Long
 * enough that a person who is typing is not interrupted: each change
 * starts the wait again.
 */
const GOOGLE_PUSH_DELAY_MS = 4000;

/**
 * How often the app asks Google Tasks and Microsoft To Do for changes
 * while its window shows. Neither service tells a desktop app of a change,
 * so the app must ask. One ask is one small request for each linked list.
 */
const TASK_SERVICE_ASK_EVERY_MS = 30_000;
/** The window coming to the front asks too, but not more often than this. */
const TASK_SERVICE_ASK_GAP_MS = 10_000;

/** No ask this soon after a key: the person is in the middle of their words. */
const TYPING_REST_MS = 5000;

/** Google Tasks syncs in the desktop app only (lib/todo/google.ts). */
function syncsWithGoogle(list: TodoList | null | undefined): boolean {
  return Boolean(list?.googleListId) && isStandaloneTodo();
}

/** The same for Microsoft To Do (lib/todo/microsoft.ts). */
function syncsWithMicrosoft(list: TodoList | null | undefined): boolean {
  return Boolean(list?.microsoftListId) && isStandaloneTodo();
}

/** The two services that sync through a sign-in kept by the desktop shell. */
const TASK_SERVICES = {
  google: { label: "Google Tasks", linked: syncsWithGoogle },
  microsoft: { label: "Microsoft To Do", linked: syncsWithMicrosoft },
} as const;
type TaskService = keyof typeof TASK_SERVICES;
const TASK_SERVICE_KEYS = Object.keys(TASK_SERVICES) as TaskService[];

function syncsWithTaskService(list: TodoList | null | undefined): boolean {
  return TASK_SERVICE_KEYS.some((key) => TASK_SERVICES[key].linked(list));
}

type GoogleSyncAnswer = {
  pulled: number;
  pushed: number;
  updated: number;
  removed: number;
  needsConfirm?: { count: number; titles: string[] };
};

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

/**
 * One GitHub sync of a list, as the summary line says it. The people GitHub
 * could not take join Basecamp's in the one note after the sync.
 */
async function syncGithubOnce(
  api: TodoApi,
  t: (key: string) => string,
  list: TodoList,
  people: GithubPeopleNotes
): Promise<string> {
  const json = await api("/api/todo/github/sync", "POST", { listId: list.id });
  const result = json.result as {
    pulled: number;
    pushed: number;
    updated: number;
    unpushableAssignees?: string[];
    nameLinkedPeople?: string[];
    reviewsNeedPermission?: boolean;
  };
  if (result.reviewsNeedPermission) people.reviewsNeedPermission = true;
  for (const name of result.unpushableAssignees ?? []) people.blocked.add(name);
  for (const name of result.nameLinkedPeople ?? []) people.byName.add(name);
  // GitHub removes nothing from the board: a gone issue unlinks its task.
  return formatSyncCounts(t, "GitHub", { removed: 0, ...result });
}

type GithubPeopleNotes = {
  blocked: Set<string>;
  byName: Set<string>;
  /** The app may not read pull requests, so review requests are missing. */
  reviewsNeedPermission?: boolean;
};

/** Who did not go on an issue, and who was matched by name: said, not hidden. */
function noteGithubPeople(t: (key: string) => string, people: GithubPeopleNotes) {
  if (people.reviewsNeedPermission) {
    toast.message(t("githubReviewsNeedPermission"), {
      description: t("githubReviewsNeedPermissionHint"),
      duration: 9000,
    });
  }
  if (people.blocked.size) {
    toast.warning(t("githubPeopleNotSent"), {
      description: fillText(t("githubPeopleNotSentHint"), {
        names: [...people.blocked].join(", "),
      }),
      duration: 9000,
    });
  }
  if (people.byName.size) {
    toast.message(t("githubPeopleByName"), {
      description: fillText(t("githubPeopleByNameHint"), {
        names: [...people.byName].join(", "),
      }),
      duration: 9000,
    });
  }
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
        list.githubRepo ||
        syncsWithTaskService(list) ||
        (list.remindersListId && isNativeShell() && remindersOk)
    );
  }

  /**
   * One sync of a list with Google Tasks or Microsoft To Do, as the
   * summary line says it.
   *
   * The service no longer has many of the list's tasks: the sync wrote
   * nothing, and the person is asked. Asked also after a silent sync,
   * because the other choice is to remove their tasks without a word, or
   * to leave the list out of step without a word.
   */
  async function syncTaskServiceOnce(
    service: TaskService,
    list: TodoList,
    confirmRemovals: boolean
  ): Promise<string> {
    const label = TASK_SERVICES[service].label;
    const json = await api(`/api/todo/${service}/sync`, "POST", {
      listId: list.id,
      confirmRemovals,
    });
    const result = json.result as GoogleSyncAnswer;
    const ask = result.needsConfirm;
    if (!ask) return formatSyncCounts(t, label, result);
    // One note per list: a later sync puts its note in the place of this one.
    toast.warning(fillText(t(`${service}RemovalsTitle`), { count: ask.count, name: list.name }), {
      id: `${service}-removals-${list.id}`,
      description: fillText(t(`${service}RemovalsHint`), { titles: ask.titles.join(", ") }),
      duration: Infinity,
      action: {
        label: t(`${service}RemovalsConfirm`),
        onClick: () => {
          void enqueueSync([list], { silent: true, confirmRemovals: true })
            .then(() => toast.success(fillText(t("syncedList"), { name: list.name })))
            .catch((err) => toast.error(describeError(err, t("syncFailed"))));
        },
      },
    });
    return fillText(t(`${service}SyncStopped`), { count: ask.count });
  }

  async function runSyncForLists(
    listsToSync: TodoList[],
    opts?: {
      silent?: boolean;
      toastId?: string | number;
      /** The person said yes to removing the tasks Google no longer has. */
      confirmRemovals?: boolean;
    }
  ): Promise<string[]> {
    if (todoHost().isOfflineNow()) {
      if (!opts?.silent) {
        toast.info(t("syncNeedsConnection"));
      }
      return [];
    }
    const silent = Boolean(opts?.silent);
    const summaries: string[] = [];
    const blockedAssignees = new Set<string>();
    const githubPeople: GithubPeopleNotes = { blocked: new Set(), byName: new Set() };
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
      if (list.githubRepo) {
        summaries.push(`${list.name}: ${await syncGithubOnce(api, t, list, githubPeople)}`);
      }
      for (const service of TASK_SERVICE_KEYS) {
        if (!TASK_SERVICES[service].linked(list)) continue;
        const line = await syncTaskServiceOnce(service, list, Boolean(opts?.confirmRemovals));
        summaries.push(`${list.name}: ${line}`);
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
    if (!silent) noteGithubPeople(t, githubPeople);
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
    opts?: {
      silent?: boolean;
      toastId?: string | number;
      confirmRemovals?: boolean;
      /** The half-minute ask: the Sync button does not turn for it. */
      unseen?: boolean;
    }
  ): Promise<string[]> {
    const job = syncChainRef.current.then(async () => {
      if (!opts?.unseen) setSyncing(true);
      try {
        return await runSyncForLists(listsToSync, opts);
      } finally {
        if (!opts?.unseen) setSyncing(false);
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
    if (todoHost().isOfflineNow()) {
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
      listsToSync.some((l) => l.githubRepo) ? "GitHub" : null,
      listsToSync.some((l) => syncsWithGoogle(l)) ? "Google Tasks" : null,
      listsToSync.some((l) => syncsWithMicrosoft(l)) ? "Microsoft To Do" : null,
    ].filter(Boolean);
    const toastId = toast.loading(
      fillText(t("syncingWith"), { name: label, sources: syncSources.join(" + ") })
    );
    try {
      const summaries = await enqueueSync(listsToSync, { toastId });
      const quiet = [
        syncUpToDateLine(t, "Basecamp"),
        syncUpToDateLine(t, t("remindersShort")),
        syncUpToDateLine(t, "GitHub"),
        syncUpToDateLine(t, "Google Tasks"),
        syncUpToDateLine(t, "Microsoft To Do"),
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

  // A task made public on GitHub: its list syncs now, so the issue and its
  // number come at once and not at the next ten-minute sync.
  React.useEffect(() => {
    const onPublish = (e: Event) => {
      const listId = (e as CustomEvent<{ listId?: string }>).detail?.listId;
      const list = listsRef.current.find((l) => l.id === listId);
      if (!list?.githubRepo || todoHost().isOfflineNow()) return;
      void enqueueSync([list], { silent: true }).catch((err) => {
        toast.error(describeError(err, t("syncFailed")));
      });
    };
    window.addEventListener(GITHUB_PUBLISH_EVENT, onPublish);
    return () => window.removeEventListener(GITHUB_PUBLISH_EVENT, onPublish);
  });

  // A change to a list linked to Google Tasks or Microsoft To Do goes
  // there soon after the person stops, and not at the next ten-minute sync. The store says which lists
  // a write touched (lib/todo/google-push.ts); each write starts the wait
  // again. The timer outlives a redraw, so it is not cleared on cleanup.
  const googleDirtyRef = React.useRef(new Set<string>());
  const googleTimerRef = React.useRef(0);
  React.useEffect(() => {
    if (!isStandaloneTodo()) return;
    return onGoogleBoardWrite((listIds) => {
      for (const id of listIds) googleDirtyRef.current.add(id);
      window.clearTimeout(googleTimerRef.current);
      googleTimerRef.current = window.setTimeout(() => {
        const ids = googleDirtyRef.current;
        googleDirtyRef.current = new Set();
        const dirty = listsRef.current.filter((l) => ids.has(l.id) && syncsWithTaskService(l));
        if (!dirty.length || todoHost().isOfflineNow()) return;
        void enqueueSync(dirty, { silent: true }).catch(() => {
          /* silent: a fault shows at the next sync the person starts */
        });
      }, GOOGLE_PUSH_DELAY_MS);
    });
  });

  // If Reminders connects while a linked list is already open, sync once.
  React.useEffect(() => {
    if (!remindersConnected) return;
    const key = autoSyncKeyRef.current;
    if (!key) return;
    const list = listsRef.current.find((l) => l.id === key);
    if (!list?.remindersListId) return;
    autoSyncList(list);
  }, [remindersConnected, autoSyncKeyRef, listsRef]);

  /**
   * Every linked list syncs when the page starts, and again every ten
   * minutes, without a word. Before this, a list only synced when it was
   * opened or left, so a list read from All, or one left open all day,
   * showed what Basecamp or Reminders had at that moment and no more.
   * The start waits for the lists, which come in after the first paint.
   */
  const hasListsRef = React.useRef(false);
  const autoSyncAllRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    autoSyncAllRef.current = () => {
      if (todoHost().isOfflineNow()) return;
      const linked = listsRef.current.filter((l) => listHasSyncLink(l));
      if (!linked.length) return;
      void enqueueSync(linked, { silent: true }).catch(() => {
        /* silent auto-sync: surface faults on the next manual sync */
      });
    };
  });
  React.useEffect(() => {
    if (hasListsRef.current || !lists.length) return;
    hasListsRef.current = true;
    autoSyncAllRef.current();
  }, [lists.length]);
  React.useEffect(() => {
    const timer = window.setInterval(() => autoSyncAllRef.current(), AUTO_SYNC_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * A change made in Google Tasks or Microsoft To Do comes in soon: the
   * linked lists sync every half minute while the window shows, and when
   * the window comes to the front. Not in the seconds after a key, and not
   * while a change of theirs waits to go (that sync reads too).
   */
  const askTaskServicesRef = React.useRef<(gap: number) => void>(() => {});
  const lastTaskServiceAskRef = React.useRef(0);
  const lastKeyRef = React.useRef(0);
  React.useEffect(() => {
    askTaskServicesRef.current = (gap) => {
      if (document.visibilityState !== "visible" || todoHost().isOfflineNow()) return;
      if (googleDirtyRef.current.size) return;
      if (Date.now() - lastKeyRef.current < TYPING_REST_MS) return;
      if (Date.now() - lastTaskServiceAskRef.current < gap) return;
      const linked = listsRef.current.filter((l) => syncsWithTaskService(l));
      if (!linked.length) return;
      lastTaskServiceAskRef.current = Date.now();
      void enqueueSync(linked, { silent: true, unseen: true }).catch(() => {
        /* silent: a fault shows at the next sync the person starts */
      });
    };
  });
  React.useEffect(() => {
    if (!isStandaloneTodo()) return;
    const onFront = () => askTaskServicesRef.current(TASK_SERVICE_ASK_GAP_MS);
    const timer = window.setInterval(
      () => askTaskServicesRef.current(TASK_SERVICE_ASK_EVERY_MS - 1000),
      TASK_SERVICE_ASK_EVERY_MS
    );
    const onKey = () => {
      lastKeyRef.current = Date.now();
    };
    window.addEventListener("focus", onFront);
    document.addEventListener("visibilitychange", onFront);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("focus", onFront);
      document.removeEventListener("visibilitychange", onFront);
    };
  }, []);

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
      if (!list.basecampListId && !list.githubRepo && !syncsWithTaskService(list) && !remindersOk) {
        return;
      }
      void (async () => {
        try {
          if (list.basecampListId) {
            await api("/api/todo/basecamp/sync", "POST", { listId: list.id });
          }
          if (list.githubRepo) {
            await api("/api/todo/github/sync", "POST", { listId: list.id });
          }
          for (const service of TASK_SERVICE_KEYS) {
            if (!TASK_SERVICES[service].linked(list)) continue;
            await api(`/api/todo/${service}/sync`, "POST", { listId: list.id });
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
