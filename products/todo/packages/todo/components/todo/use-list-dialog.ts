"use client";

import * as React from "react";
import { toast } from "sonner";

import type { TodoApi } from "@/components/todo/use-write-tracking";
import { todoHost } from "@/lib/todo/host";
import { fetchRemindersLists, isNativeShell, type RemindersList } from "@/lib/todo/native-bridge";
import { describeError } from "@/lib/todo/errors";
import { countText, fillText } from "@/lib/todo/i18n";
import { resolveListIconId } from "@/lib/todo/list-icons";
import { isEverythingGroup } from "@/lib/todo/list-scope";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import { newClientId } from "@/lib/todo/optimistic-task";
import { syncRemindersList } from "@/lib/todo/reminders-sync";
import { CURRENT_GROUP_KEY, persistPref } from "@/lib/todo/saved-prefs";
import { formatSyncCounts, remindersProgressLabel } from "@/lib/todo/sync-labels";
import { resolveTabColorHex } from "@/lib/todo/tab-colours";
import {
  TODO_ALL_LIST_ID,
  TODO_CURRENT_LIST_KEY,
  type TodoGroup,
  type TodoList,
  type TodoState,
} from "@/lib/todo/types";

/** The list or group dialog: making one, or changing its name and look. */
/** A task list of Google or Microsoft, and the account it is in. */
export type ServiceList = { id: string; name: string; account: string };

/**
 * The task lists of every connected account that may sync tasks. `account`
 * is the first such account, or "" when there is none (the field then
 * stays hidden). An account whose lists cannot be read gives none.
 */
async function readServiceLists(
  api: TodoApi,
  service: "google" | "microsoft"
): Promise<{ account: string; lists: ServiceList[] }> {
  const status = (await api(`/api/todo/${service}/status`, "GET")) as {
    accounts?: { email: string; tasks: boolean }[];
  };
  const accounts = (status.accounts ?? []).filter((a) => a.tasks).map((a) => a.email);
  const perAccount = await Promise.all(
    accounts.map(async (account) => {
      const json = await api(`/api/todo/${service}/lists`, "POST", { account }).catch(() => ({
        lists: [],
      }));
      const lists = (json.lists as { id: string; name: string }[]) ?? [];
      return lists.map((l) => ({ ...l, account }));
    })
  );
  return { account: accounts[0] ?? "", lists: perAccount.flat() };
}

/**
 * The account a picked list is in. A list that was linked before, and is
 * not in what the accounts gave now, keeps the account it had.
 */
function accountOfPick(
  lists: ServiceList[],
  listId: string,
  before: { account?: string | null; listId?: string | null } | null,
  first: string
): string {
  const picked = lists.find((l) => l.id === listId);
  if (picked) return picked.account;
  if (before?.listId === listId && before.account) return before.account;
  return first;
}

export type ListModalState =
  | { mode: "create"; kind: "list" }
  | { mode: "create"; kind: "group" }
  | { mode: "rename"; kind: "list"; list: TodoList }
  | { mode: "rename"; kind: "group"; group: TodoGroup }
  | null;

/** Where a list is linked, as the dialog saves it. */
type ListLinks = {
  basecampProjectId: string | null;
  basecampListId: string | null;
  remindersListId: string | null;
  githubRepo: string | null;
  /**
   * Only there when this app can sync Google Tasks (the desktop app, with
   * an account connected). The planner's server never gets these keys.
   */
  googleAccount?: string | null;
  googleListId?: string | null;
  /** The same for Microsoft To Do. */
  microsoftAccount?: string | null;
  microsoftListId?: string | null;
};

/** How a list looks, as the dialog saves it. */
type ListAppearance = {
  colour: string | null;
  emoji: string | null;
};

/** What the list dialog holds while it is open. */
export function useListDialogState() {
  const [listModal, setListModal] = React.useState<ListModalState>(null);
  const [modalName, setModalName] = React.useState("");
  const [modalColour, setModalColour] = React.useState<string>("");
  const [modalEmoji, setModalEmoji] = React.useState("");

  const [bcProjects, setBcProjects] = React.useState<{ id: string; name: string }[]>([]);
  const [bcTodolists, setBcTodolists] = React.useState<{ id: string; name: string }[]>([]);
  const [remindersLists, setRemindersLists] = React.useState<RemindersList[]>([]);
  const [modalBcProjectId, setModalBcProjectId] = React.useState("");
  const [modalBcListId, setModalBcListId] = React.useState("");
  const [modalRemindersListId, setModalRemindersListId] = React.useState("");
  /* GitHub: whether this server can reach it, the repositories the app is
     on, and the one picked. Only the planner has a GitHub connection yet;
     in the desktop app the status route is not there and the field stays
     hidden. */
  const [githubConfigured, setGithubConfigured] = React.useState(false);
  const [githubRepos, setGithubRepos] = React.useState<string[]>([]);
  const [modalGithubRepo, setModalGithubRepo] = React.useState("");
  /* Google Tasks, in the desktop app: the first connected account that may
     sync tasks ("" when there is none, and the field stays hidden), the
     task lists of every such account, and the one picked. */
  const [googleAccount, setGoogleAccount] = React.useState("");
  const [googleLists, setGoogleLists] = React.useState<ServiceList[]>([]);
  const [modalGoogleListId, setModalGoogleListId] = React.useState("");
  /* Microsoft To Do, in the desktop app: the same three. */
  const [microsoftAccount, setMicrosoftAccount] = React.useState("");
  const [microsoftLists, setMicrosoftLists] = React.useState<ServiceList[]>([]);
  const [modalMicrosoftListId, setModalMicrosoftListId] = React.useState("");
  const [importingGroup, setImportingGroup] = React.useState(false);
  return {
    googleAccount,
    setGoogleAccount,
    googleLists,
    setGoogleLists,
    modalGoogleListId,
    setModalGoogleListId,
    microsoftAccount,
    setMicrosoftAccount,
    microsoftLists,
    setMicrosoftLists,
    modalMicrosoftListId,
    setModalMicrosoftListId,
    githubConfigured,
    setGithubConfigured,
    githubRepos,
    setGithubRepos,
    modalGithubRepo,
    setModalGithubRepo,
    listModal,
    setListModal,
    modalName,
    setModalName,
    modalColour,
    setModalColour,
    modalEmoji,
    setModalEmoji,
    bcProjects,
    setBcProjects,
    bcTodolists,
    setBcTodolists,
    remindersLists,
    setRemindersLists,
    modalBcProjectId,
    setModalBcProjectId,
    modalBcListId,
    setModalBcListId,
    modalRemindersListId,
    setModalRemindersListId,
    importingGroup,
    setImportingGroup,
  };
}

/**
 * The Basecamp projects and to-do lists, and the Reminders lists, that the
 * dialog offers to link, and the picks that also give an empty name.
 */
export function useListDialogLinks({
  listDialog,
  api,
  bcConnected,
  remindersConnected,
}: {
  listDialog: ReturnType<typeof useListDialogState>;
  api: TodoApi;
  bcConnected: boolean;
  remindersConnected: boolean;
}) {
  const {
    listModal,
    modalName,
    setModalName,
    bcProjects,
    setBcProjects,
    bcTodolists,
    setBcTodolists,
    remindersLists,
    setRemindersLists,
    modalBcProjectId,
    setModalBcProjectId,
    setModalBcListId,
    setModalRemindersListId,
    setModalGithubRepo,
    setGithubConfigured,
    setGithubRepos,
    googleLists,
    setGoogleAccount,
    setGoogleLists,
    setModalGoogleListId,
    microsoftLists,
    setMicrosoftAccount,
    setMicrosoftLists,
    setModalMicrosoftListId,
  } = listDialog;
  // Load link options when list/group dialogs open with integrations connected.
  const needsBcProjects =
    listModal?.kind === "list" ||
    (listModal?.kind === "group" && listModal.mode === "create");
  const listModalOpen = listModal?.kind === "list";
  React.useEffect(() => {
    if (!listModal || !needsBcProjects) return;
    if (bcConnected) {
      void api("/api/todo/basecamp/projects", "GET")
        .then((json) =>
          setBcProjects(json.projects as { id: string; name: string }[])
        )
        .catch(() => setBcProjects([]));
    }
    if (listModalOpen && remindersConnected && isNativeShell()) {
      void fetchRemindersLists()
        .then(setRemindersLists)
        .catch(() => setRemindersLists([]));
    }
    if (listModalOpen) {
      void api("/api/todo/github/status", "GET")
        .then(async (json: { configured?: boolean }) => {
          setGithubConfigured(Boolean(json.configured));
          if (!json.configured) return;
          // A failed list still leaves the picker, with the linked repository.
          const repos = await api("/api/todo/github/repos", "GET").catch(() => ({ repos: [] }));
          setGithubRepos((repos.repos as string[]) ?? []);
        })
        .catch(() => setGithubConfigured(false));
    }
    // Google Tasks: the desktop app only. The planner has no such route.
    if (listModalOpen && isStandaloneTodo()) {
      void readServiceLists(api, "google")
        .then(({ account, lists }) => {
          setGoogleAccount(account);
          setGoogleLists(lists);
        })
        .catch(() => setGoogleAccount(""));
      void readServiceLists(api, "microsoft")
        .then(({ account, lists }) => {
          setMicrosoftAccount(account);
          setMicrosoftLists(lists);
        })
        .catch(() => setMicrosoftAccount(""));
    }
  }, [
    listModal,
    needsBcProjects,
    listModalOpen,
    bcConnected,
    remindersConnected,
    setBcProjects,
    setRemindersLists,
    setGithubConfigured,
    setGithubRepos,
    setGoogleAccount,
    setGoogleLists,
    setMicrosoftAccount,
    setMicrosoftLists,
  ]);

  async function selectBcProject(projectId: string) {
    setModalBcProjectId(projectId);
    setModalBcListId("");
    setBcTodolists([]);
    // Group create: prefill empty name from the project (like redd-do).
    if (listModal?.kind === "group" && listModal.mode === "create") {
      if (projectId && !modalName.trim()) {
        const project = bcProjects.find((p) => p.id === projectId);
        if (project) setModalName(project.name);
      }
      return;
    }
    if (!projectId) return;
    try {
      const json = await api(
        `/api/todo/basecamp/todolists?projectId=${encodeURIComponent(projectId)}`,
        "GET"
      );
      setBcTodolists(json.todolists as { id: string; name: string }[]);
    } catch {
      setBcTodolists([]);
    }
  }

  function selectBcList(listId: string) {
    setModalBcListId(listId);
    // A list syncs with one service. See selectGoogleList.
    if (listId) clearTaskServicePicks();
    if (!listId || modalName.trim()) return;
    const list = bcTodolists.find((l) => l.id === listId);
    if (!list) return;
    const project = bcProjects.find((p) => p.id === modalBcProjectId);
    const prefix = project?.name.trim().split(/\s+/)[0];
    setModalName(prefix ? `${prefix}: ${list.name}` : list.name);
  }

  function selectRemindersList(listId: string) {
    setModalRemindersListId(listId);
    if (listId) clearTaskServicePicks();
    if (!listId || modalName.trim()) return;
    const list = remindersLists.find((l) => l.id === listId);
    if (list) setModalName(list.name);
  }

  function selectGithubRepo(repo: string) {
    setModalGithubRepo(repo);
    if (repo) clearTaskServicePicks();
    if (!repo || modalName.trim()) return;
    // "owner/repo" gives the name "repo".
    setModalName(repo.split("/").pop() ?? repo);
  }

  function clearTaskServicePicks() {
    setModalGoogleListId("");
    setModalMicrosoftListId("");
  }

  function clearOtherPicks() {
    setModalBcProjectId("");
    setModalBcListId("");
    setModalRemindersListId("");
    setModalGithubRepo("");
  }

  /**
   * A list syncs with one service. Two at once would each take the other's
   * changes as the person's own, and a task removed in one would be
   * removed in the other. So a Google or Microsoft pick clears the other
   * links, and a pick of another service clears these two.
   */
  function selectGoogleList(listId: string) {
    setModalGoogleListId(listId);
    if (!listId) return;
    clearOtherPicks();
    setModalMicrosoftListId("");
    if (modalName.trim()) return;
    const list = googleLists.find((l) => l.id === listId);
    if (list) setModalName(list.name);
  }

  function selectMicrosoftList(listId: string) {
    setModalMicrosoftListId(listId);
    if (!listId) return;
    clearOtherPicks();
    setModalGoogleListId("");
    if (modalName.trim()) return;
    const list = microsoftLists.find((l) => l.id === listId);
    if (list) setModalName(list.name);
  }

  return {
    selectBcProject,
    selectBcList,
    selectRemindersList,
    selectGithubRepo,
    selectGoogleList,
    selectMicrosoftList,
  };
}

/** Opening the dialog for a list or a group, and saving what it holds. */
export function useListDialogActions({
  listDialog,
  api,
  refresh,
  setState,
  t,
  bcConnected,
  remindersConnected,
  suppressAutoSyncListIdsRef,
  groupsEnabled,
  activeGroup,
  setCurrentGroupId,
  setCurrentListId,
}: {
  listDialog: ReturnType<typeof useListDialogState>;
  api: TodoApi;
  refresh: () => Promise<void>;
  setState: React.Dispatch<React.SetStateAction<TodoState>>;
  t: (key: string) => string;
  bcConnected: boolean;
  remindersConnected: boolean;
  suppressAutoSyncListIdsRef: React.RefObject<Set<string>>;
  groupsEnabled: boolean;
  activeGroup: TodoGroup | null | undefined;
  setCurrentGroupId: React.Dispatch<React.SetStateAction<string | null>>;
  setCurrentListId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const {
    listModal,
    setListModal,
    modalName,
    setModalName,
    modalColour,
    setModalColour,
    modalEmoji,
    setModalEmoji,
    bcProjects,
    bcTodolists,
    setBcTodolists,
    remindersLists,
    modalBcProjectId,
    setModalBcProjectId,
    modalBcListId,
    setModalBcListId,
    modalRemindersListId,
    setModalRemindersListId,
    modalGithubRepo,
    setModalGithubRepo,
    googleAccount,
    googleLists,
    modalGoogleListId,
    setModalGoogleListId,
    microsoftAccount,
    microsoftLists,
    modalMicrosoftListId,
    setModalMicrosoftListId,
    importingGroup,
    setImportingGroup,
  } = listDialog;
  function openCreateListModal() {
    setModalName("");
    setModalColour("");
    setModalEmoji("");
    setModalBcProjectId("");
    setModalBcListId("");
    setBcTodolists([]);
    setModalRemindersListId("");
    setModalGithubRepo("");
    setModalGoogleListId("");
    setModalMicrosoftListId("");
    setListModal({ mode: "create", kind: "list" });
  }

  function openRenameListModal(list: TodoList) {
    setModalName(list.name);
    // Prefer hex for the blocker-style picker; map legacy named keys.
    setModalColour(
      list.colour?.startsWith("#")
        ? list.colour
        : resolveTabColorHex(list.colour) ?? list.colour ?? ""
    );
    setModalEmoji(resolveListIconId(list.emoji) ?? "");
    setModalBcProjectId(list.basecampProjectId ?? "");
    setModalBcListId(list.basecampListId ?? "");
    setBcTodolists([]);
    setModalRemindersListId(list.remindersListId ?? "");
    setModalGithubRepo(list.githubRepo ?? "");
    setModalGoogleListId(list.googleListId ?? "");
    setModalMicrosoftListId(list.microsoftListId ?? "");
    if (list.basecampProjectId) void selectBcProjectKeepList(list);
    setListModal({ mode: "rename", kind: "list", list });
  }

  async function selectBcProjectKeepList(list: TodoList) {
    try {
      const json = await api(
        `/api/todo/basecamp/todolists?projectId=${encodeURIComponent(list.basecampProjectId as string)}`,
        "GET"
      );
      setBcTodolists(json.todolists as { id: string; name: string }[]);
      setModalBcListId(list.basecampListId ?? "");
    } catch {
      /* selector stays empty */
    }
  }

  function openCreateGroupModal() {
    setModalName("");
    setModalColour("");
    setModalBcProjectId("");
    setModalBcListId("");
    setBcTodolists([]);
    setImportingGroup(false);
    setListModal({ mode: "create", kind: "group" });
  }

  function openRenameGroupModal(group: TodoGroup) {
    setModalName(group.name);
    setModalColour(group.colour ?? "");
    setModalBcProjectId("");
    setListModal({ mode: "rename", kind: "group", group });
  }

  /*
   * submitListModal, in named steps. Each step is the code that stood in
   * its place, and the steps run in the same order.
   */

  /** The name the dialog saves. Empty: the linked source's name. */
  function listModalName(
    modal: NonNullable<ListModalState>,
    isBcGroupImport: boolean
  ) {
    const projectName = bcProjects.find((p) => p.id === modalBcProjectId)?.name;
    const bcListName = bcTodolists.find((l) => l.id === modalBcListId)?.name;
    const remindersListName = remindersLists.find(
      (l) => l.id === modalRemindersListId
    )?.name;
    // Empty name: fall back to linked source name (redd-do behaviour).
    return (
      modalName.trim() ||
      (isBcGroupImport
        ? projectName || "New Group"
        : modal.kind === "list"
          ? bcListName ||
            remindersListName ||
            modalGithubRepo.split("/").pop() ||
            googleLists.find((l) => l.id === modalGoogleListId)?.name ||
            microsoftLists.find((l) => l.id === modalMicrosoftListId)?.name ||
            ""
          : "")
    );
  }

  /** A new group made from a Basecamp project: one list per to-do list. */
  async function importBasecampProject(group: TodoGroup) {
    const bcProjectId = modalBcProjectId;
    const listsJson = await api(
      `/api/todo/basecamp/todolists?projectId=${encodeURIComponent(bcProjectId)}`,
      "GET"
    );
    const todolists = (listsJson.todolists ?? []) as {
      id: string;
      name: string;
    }[];
    const createdLists: TodoList[] = [];
    for (const bcList of todolists) {
      const created = await api("/api/todo/lists", "POST", {
        id: newClientId(),
        name: bcList.name || "Untitled",
        groupId: group.id,
      });
      let list = created.list as TodoList;
      const patched = await api("/api/todo/lists", "PATCH", {
        id: list.id,
        basecampProjectId: bcProjectId,
        basecampListId: bcList.id,
      });
      list = patched.list as TodoList;
      createdLists.push(list);
    }
    await Promise.all(
      createdLists.map((list) =>
        api("/api/todo/basecamp/sync", "POST", { listId: list.id }).catch(
          () => null
        )
      )
    );
    setState((s) => ({
      ...s,
      groups: [...s.groups, group],
      lists: [...s.lists, ...createdLists],
    }));
    if (createdLists[0]) {
      setCurrentListId(createdLists[0].id);
      persistPref(TODO_CURRENT_LIST_KEY, createdLists[0].id);
    } else {
      setCurrentListId(TODO_ALL_LIST_ID);
      persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
    }
    await refresh();
    setListModal(null);
    setImportingGroup(false);
  }

  async function createGroup(name: string, isBcGroupImport: boolean) {
    if (isBcGroupImport) setImportingGroup(true);
    const json = await api("/api/todo/groups", "POST", {
      name,
      colour: modalColour || null,
    });
    const group = json.group as TodoGroup;
    setCurrentGroupId(group.id);
    persistPref(CURRENT_GROUP_KEY, group.id);

    if (isBcGroupImport) {
      await importBasecampProject(group);
    } else {
      setState((s) => ({ ...s, groups: [...s.groups, group] }));
      setCurrentListId(TODO_ALL_LIST_ID);
      persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
      // A new group starts with one list, so it is not empty.
      await createList(
        fillText(t("newGroupList"), { name }),
        { colour: null, emoji: null },
        { basecampProjectId: null, basecampListId: null, remindersListId: null, githubRepo: null },
        group.id
      );
    }
  }

  async function renameGroup(group: TodoGroup, name: string) {
    const { id } = group;
    setState((s) => ({
      ...s,
      groups: s.groups.map((g) =>
        g.id === id ? { ...g, name, colour: modalColour || null } : g
      ),
    }));
    await api("/api/todo/groups", "PATCH", {
      id,
      name,
      colour: modalColour || null,
    });
  }

  /** A new list linked to Reminders pulls its reminders at once. */
  async function importNewListFromReminders(list: TodoList) {
    suppressAutoSyncListIdsRef.current.add(list.id);
    const toastId = toast.loading(
      fillText(t("importingFromReminders"), { name: list.name })
    );
    try {
      const result = await syncRemindersList(list, [], {
        api,
        onProgress: (progress) => {
          toast.loading(
            fillText(t("listProgress"), {
              name: list.name,
              progress: remindersProgressLabel(t, progress),
            }),
            { id: toastId }
          );
        },
        onTaskPulled: (task) => {
          setState((s) => ({
            ...s,
            tasks: s.tasks.some((row) => row.id === task.id)
              ? s.tasks
              : [...s.tasks, task],
          }));
        },
      });
      toast.success(
        result.pulled
          ? countText(t, "importedFromReminders", result.pulled)
          : fillText(t("linkedToReminders"), { name: list.name }),
        { id: toastId, duration: 5000 }
      );
    } catch (err) {
      toast.error(
        describeError(err, t("importFromRemindersFailed")),
        { id: toastId }
      );
    } finally {
      suppressAutoSyncListIdsRef.current.delete(list.id);
    }
    void refresh();
  }

  /** A new list linked to Basecamp syncs at once. */
  async function importNewListFromBasecamp(list: TodoList) {
    suppressAutoSyncListIdsRef.current.add(list.id);
    const toastId = toast.loading(
      fillText(t("importingFromBasecamp"), { name: list.name })
    );
    try {
      const syncJson = await api("/api/todo/basecamp/sync", "POST", {
        listId: list.id,
      });
      const result = syncJson.result as {
        pulled: number;
        pushed: number;
        removed: number;
        updated: number;
      };
      toast.success(fillText(t("syncedList"), { name: list.name }), {
        id: toastId,
        description: formatSyncCounts(t, "Basecamp", result),
        duration: 5000,
      });
    } catch (err) {
      toast.error(
        describeError(err, t("importFromBasecampOneFailed")),
        { id: toastId }
      );
    } finally {
      suppressAutoSyncListIdsRef.current.delete(list.id);
    }
    void refresh();
  }

  /**
   * A list newly linked to Google Tasks or Microsoft To Do takes in the
   * open tasks, and sends its own.
   */
  async function importListFromTaskService(list: TodoList, service: "google" | "microsoft") {
    const names = {
      google: { label: "Google Tasks", importing: "importingFromGoogle", failed: "importFromGoogleFailed" },
      microsoft: {
        label: "Microsoft To Do",
        importing: "importingFromMicrosoft",
        failed: "importFromMicrosoftFailed",
      },
    }[service];
    suppressAutoSyncListIdsRef.current.add(list.id);
    const toastId = toast.loading(fillText(t(names.importing), { name: list.name }));
    try {
      const json = await api(`/api/todo/${service}/sync`, "POST", { listId: list.id });
      toast.success(fillText(t("syncedList"), { name: list.name }), {
        id: toastId,
        description: formatSyncCounts(
          t,
          names.label,
          json.result as { pulled: number; pushed: number; updated: number; removed: number }
        ),
        duration: 5000,
      });
    } catch (err) {
      toast.error(describeError(err, t(names.failed)), { id: toastId });
    } finally {
      suppressAutoSyncListIdsRef.current.delete(list.id);
    }
    void refresh();
  }

  /** A list newly linked to GitHub takes in the repository's open issues. */
  async function importListFromGithub(list: TodoList) {
    suppressAutoSyncListIdsRef.current.add(list.id);
    const toastId = toast.loading(
      fillText(t("importingFromGithub"), { name: list.name })
    );
    try {
      const json = await api("/api/todo/github/sync", "POST", { listId: list.id });
      toast.success(fillText(t("syncedList"), { name: list.name }), {
        id: toastId,
        // GitHub removes nothing from the board: a gone issue unlinks.
        description: formatSyncCounts(t, "GitHub", {
          removed: 0,
          ...(json.result as { pulled: number; pushed: number; updated: number }),
        }),
        duration: 5000,
      });
    } catch (err) {
      toast.error(describeError(err, t("importFromGithubFailed")), { id: toastId });
    } finally {
      suppressAutoSyncListIdsRef.current.delete(list.id);
    }
    void refresh();
  }

  async function createList(
    name: string,
    appearance: ListAppearance,
    links: ListLinks,
    inGroupId?: string
  ) {
    const listId = newClientId();
    // Everything holds no lists of its own: a list made there joins none.
    const groupId = inGroupId ?? (groupsEnabled && !isEverythingGroup(activeGroup) ? (activeGroup?.id ?? null) : null);
    const json = await api("/api/todo/lists", "POST", {
      id: listId,
      name,
      ...appearance,
      ...links,
      groupId,
    });
    const list = {
      ...(json.list as TodoList),
      id: (json.list as TodoList).id || listId,
      name,
      ...appearance,
      ...links,
      groupId,
    } as TodoList;
    setState((s) => ({ ...s, lists: [...s.lists, list] }));
    setCurrentListId(list.id);
    persistPref(TODO_CURRENT_LIST_KEY, list.id);
    if (
      list.remindersListId &&
      isNativeShell() &&
      remindersConnected &&
      !todoHost().isOfflineNow()
    ) {
      await importNewListFromReminders(list);
    }
    if (list.basecampListId && !todoHost().isOfflineNow()) {
      await importNewListFromBasecamp(list);
    }
    if (list.githubRepo && !todoHost().isOfflineNow()) await importListFromGithub(list);
    if (list.googleListId && !todoHost().isOfflineNow()) {
      await importListFromTaskService(list, "google");
    }
    if (list.microsoftListId && !todoHost().isOfflineNow()) {
      await importListFromTaskService(list, "microsoft");
    }
  }

  async function renameList(
    list: TodoList,
    name: string,
    appearance: ListAppearance,
    links: ListLinks
  ) {
    const { id } = list;
    setState((s) => ({
      ...s,
      lists: s.lists.map((l) =>
        l.id === id
          ? { ...l, name, ...appearance, ...links }
          : l
      ),
    }));
    const json = await api("/api/todo/lists", "PATCH", {
      id,
      name,
      ...appearance,
      ...links,
    });
    // Linked to another repository: its open issues come in now, not at
    // the next poll.
    if (links.githubRepo && links.githubRepo !== (list.githubRepo ?? null) && !todoHost().isOfflineNow()) {
      await importListFromGithub(json.list as TodoList);
    }
    if (
      links.googleListId &&
      links.googleListId !== (list.googleListId ?? null) &&
      !todoHost().isOfflineNow()
    ) {
      await importListFromTaskService(json.list as TodoList, "google");
    }
    if (
      links.microsoftListId &&
      links.microsoftListId !== (list.microsoftListId ?? null) &&
      !todoHost().isOfflineNow()
    ) {
      await importListFromTaskService(json.list as TodoList, "microsoft");
    }
  }

  async function submitListModal() {
    const modal = listModal;
    if (!modal || importingGroup) return;

    const isBcGroupImport =
      modal.kind === "group" &&
      modal.mode === "create" &&
      Boolean(modalBcProjectId && bcConnected);

    const name = listModalName(modal, isBcGroupImport);
    if (!name) return;

    // Keep the modal open while importing so we can show progress.
    if (!isBcGroupImport) setListModal(null);

    try {
      if (modal.kind === "group") {
        if (modal.mode === "create") {
          await createGroup(name, isBcGroupImport);
        } else {
          await renameGroup(modal.group, name);
        }
        return;
      }
      // The list as it was, when this is an edit: its links name their account.
      const before = modal.mode === "rename" && modal.kind === "list" ? modal.list : null;
      const links: ListLinks = {
        basecampProjectId: modalBcListId ? modalBcProjectId || null : null,
        basecampListId: modalBcListId || null,
        remindersListId: modalRemindersListId || null,
        githubRepo: modalGithubRepo || null,
        // With no account that may sync tasks, the keys stay out: a list
        // linked before keeps its link, and the planner never sees them.
        ...(googleAccount
          ? {
              googleAccount: modalGoogleListId
                ? accountOfPick(
                    googleLists,
                    modalGoogleListId,
                    before && { account: before.googleAccount, listId: before.googleListId },
                    googleAccount
                  )
                : null,
              googleListId: modalGoogleListId || null,
            }
          : {}),
        ...(microsoftAccount
          ? {
              microsoftAccount: modalMicrosoftListId
                ? accountOfPick(
                    microsoftLists,
                    modalMicrosoftListId,
                    before && { account: before.microsoftAccount, listId: before.microsoftListId },
                    microsoftAccount
                  )
                : null,
              microsoftListId: modalMicrosoftListId || null,
            }
          : {}),
      };
      const appearance: ListAppearance = {
        colour: modalColour || null,
        emoji: modalEmoji || null,
      };
      if (modal.mode === "create") {
        await createList(name, appearance, links);
      } else {
        await renameList(modal.list, name, appearance, links);
      }
    } catch (err) {
      if (isBcGroupImport) {
        toast.error(describeError(err, t("importFromBasecampFailed")));
        setImportingGroup(false);
        setListModal(null);
      } else {
        toast.error(describeError(err, t("saveFailed")));
      }
      void refresh();
    }
  }

  return {
    openCreateListModal,
    openRenameListModal,
    openCreateGroupModal,
    openRenameGroupModal,
    submitListModal,
  };
}
