"use client";

import * as React from "react";
import { toast } from "sonner";

import type { TodoApi } from "@/components/todo/use-write-tracking";
import { isOfflineNow } from "@/lib/offline/todo-offline";
import { fetchRemindersLists, isNativeShell, type RemindersList } from "@/lib/native-shell";
import { describeError } from "@/lib/todo/errors";
import { countText, fillText } from "@/lib/todo/i18n";
import { resolveListIconId } from "@/lib/todo/list-icons";
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
  const [importingGroup, setImportingGroup] = React.useState(false);
  return {
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
  }, [
    listModal,
    needsBcProjects,
    listModalOpen,
    bcConnected,
    remindersConnected,
    setBcProjects,
    setRemindersLists,
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
    if (!listId || modalName.trim()) return;
    const list = bcTodolists.find((l) => l.id === listId);
    if (!list) return;
    const project = bcProjects.find((p) => p.id === modalBcProjectId);
    const prefix = project?.name.trim().split(/\s+/)[0];
    setModalName(prefix ? `${prefix}: ${list.name}` : list.name);
  }

  function selectRemindersList(listId: string) {
    setModalRemindersListId(listId);
    if (!listId || modalName.trim()) return;
    const list = remindersLists.find((l) => l.id === listId);
    if (list) setModalName(list.name);
  }

  return { selectBcProject, selectBcList, selectRemindersList };
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
          ? bcListName || remindersListName || ""
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

  async function createList(
    name: string,
    appearance: ListAppearance,
    links: ListLinks
  ) {
    const listId = newClientId();
    const json = await api("/api/todo/lists", "POST", {
      id: listId,
      name,
      ...appearance,
      ...links,
      groupId: groupsEnabled ? (activeGroup?.id ?? null) : null,
    });
    const list = {
      ...(json.list as TodoList),
      id: (json.list as TodoList).id || listId,
      name,
      ...appearance,
      ...links,
      groupId: groupsEnabled ? (activeGroup?.id ?? null) : null,
    } as TodoList;
    setState((s) => ({ ...s, lists: [...s.lists, list] }));
    setCurrentListId(list.id);
    persistPref(TODO_CURRENT_LIST_KEY, list.id);
    if (
      list.remindersListId &&
      isNativeShell() &&
      remindersConnected &&
      !isOfflineNow()
    ) {
      await importNewListFromReminders(list);
    }
    if (list.basecampListId && !isOfflineNow()) {
      await importNewListFromBasecamp(list);
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
    await api("/api/todo/lists", "PATCH", {
      id,
      name,
      ...appearance,
      ...links,
    });
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
      const links: ListLinks = {
        basecampProjectId: modalBcListId ? modalBcProjectId || null : null,
        basecampListId: modalBcListId || null,
        remindersListId: modalRemindersListId || null,
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
