"use client";

import type * as React from "react";
import { toast } from "sonner";

import type { ConfirmModalState } from "@/components/todo/use-task-actions";
import type { TodoApi } from "@/components/todo/use-write-tracking";
import { describeError } from "@/lib/todo/errors";
import { newClientId } from "@/lib/todo/optimistic-task";
import { CURRENT_GROUP_KEY, GROUPS_KEY, persistPref } from "@/lib/todo/saved-prefs";
import {
  TODO_ALL_LIST_ID,
  TODO_CURRENT_LIST_KEY,
  type TodoGroup,
  type TodoList,
  type TodoState,
  type TodoTask,
} from "@/lib/todo/types";

/**
 * Groups and the removal of a list: groups on and off (the first time
 * makes a group and puts every list in it), opening a group, and
 * deleting a group or a list, with an undo that makes them again.
 */
export function useGroupsAndLists({
  state,
  setState,
  api,
  refresh,
  t,
  lists,
  currentListId,
  currentGroupId,
  setGroupsEnabled,
  setCurrentGroupId,
  setCurrentListId,
  setConfirmModal,
  showUndo,
  recreateTask,
}: {
  state: TodoState;
  setState: React.Dispatch<React.SetStateAction<TodoState>>;
  api: TodoApi;
  refresh: () => Promise<void>;
  t: (key: string) => string;
  lists: TodoList[];
  currentListId: string | null;
  currentGroupId: string | null;
  setGroupsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentGroupId: React.Dispatch<React.SetStateAction<string | null>>;
  setCurrentListId: React.Dispatch<React.SetStateAction<string | null>>;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
  showUndo: (message: string, restore: () => void) => void;
  recreateTask: (task: TodoTask) => Promise<void>;
}) {
  /** redd-do's enable-groups semantics: first enable creates a default group
   *  and adopts every ungrouped list into it. */
  function handleGroupsEnabledChange(enabled: boolean) {
    setGroupsEnabled(enabled);
    persistPref(GROUPS_KEY, enabled ? "1" : "0");
    if (!enabled) return;
    void (async () => {
      try {
        if (state.groups.length === 0) {
          const json = await api("/api/todo/groups", "POST", {
            name: "General",
          });
          const group = json.group as TodoGroup;
          const ungrouped = state.lists.filter((l) => !l.groupId);
          await Promise.all(
            ungrouped.map((l) =>
              api("/api/todo/lists", "PATCH", { id: l.id, groupId: group.id })
            )
          );
          setState((s) => ({
            ...s,
            groups: [...s.groups, group],
            lists: s.lists.map((l) =>
              l.groupId ? l : { ...l, groupId: group.id }
            ),
          }));
          setCurrentGroupId(group.id);
          persistPref(CURRENT_GROUP_KEY, group.id);
        } else {
          // Adopt any lists created while groups were off into the first group.
          const first = [...state.groups].sort(
            (a, b) => a.position - b.position
          )[0];
          const ungrouped = state.lists.filter((l) => !l.groupId);
          if (ungrouped.length) {
            await Promise.all(
              ungrouped.map((l) =>
                api("/api/todo/lists", "PATCH", { id: l.id, groupId: first.id })
              )
            );
            setState((s) => ({
              ...s,
              lists: s.lists.map((l) =>
                l.groupId ? l : { ...l, groupId: first.id }
              ),
            }));
          }
        }
      } catch (err) {
        toast.error(describeError(err, t("enableGroupsFailed")));
        void refresh();
      }
    })();
  }

  function switchToGroup(groupId: string) {
    setCurrentGroupId(groupId);
    persistPref(CURRENT_GROUP_KEY, groupId);
    const groupLists = state.lists.filter((l) => l.groupId === groupId);
    if (groupLists.length === 1) {
      setCurrentListId(groupLists[0].id);
      persistPref(TODO_CURRENT_LIST_KEY, groupLists[0].id);
    } else if (groupLists.length > 1) {
      setCurrentListId(TODO_ALL_LIST_ID);
      persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
    } else {
      setCurrentListId(null);
      persistPref(TODO_CURRENT_LIST_KEY, "");
    }
  }

  /**
   * A deleted list made again, as it was, for an undo: its name, look and
   * group, then its Basecamp and Reminders links.
   */
  async function recreateList(list: TodoList): Promise<TodoList> {
    const json = await api("/api/todo/lists", "POST", {
      id: newClientId(),
      name: list.name,
      colour: list.colour,
      emoji: list.emoji,
      groupId: list.groupId,
    });
    let created = json.list as TodoList;
    if (list.basecampListId || list.remindersListId) {
      const patched = await api("/api/todo/lists", "PATCH", {
        id: created.id,
        basecampProjectId: list.basecampProjectId,
        basecampListId: list.basecampListId,
        remindersListId: list.remindersListId,
      });
      created = patched.list as TodoList;
    }
    return created;
  }

  function removeGroup(group: TodoGroup) {
    if (state.groups.length <= 1) {
      toast(t("keepOneGroup"));
      return;
    }
    const groupLists = state.lists.filter((l) => l.groupId === group.id);
    const groupListIds = new Set(groupLists.map((l) => l.id));
    const groupTasks = state.tasks.filter(
      (t) => t.listId !== null && groupListIds.has(t.listId)
    );
    const completed = groupTasks.filter((t) => t.completed).length;
    setConfirmModal({
      title: t("deleteGroupTitle"),
      message: t("deleteGroupMessage")
        .replace("{name}", group.name)
        .replace("{lists}", String(groupLists.length))
        .replace("{open}", String(groupTasks.length - completed))
        .replace("{done}", String(completed)),
      confirmLabel: t("delete"),
      danger: true,
      onConfirm: () => {
        setState((s) => ({
          ...s,
          groups: s.groups.filter((g) => g.id !== group.id),
          lists: s.lists.filter((l) => l.groupId !== group.id),
          tasks: s.tasks.filter(
            (task) => task.listId === null || !groupListIds.has(task.listId)
          ),
        }));
        if (currentGroupId === group.id) setCurrentGroupId(null);
        void api(`/api/todo/groups?id=${encodeURIComponent(group.id)}`, "DELETE")
          .then(() =>
            showUndo(t("groupDeleted"), () => {
              void (async () => {
                const json = await api("/api/todo/groups", "POST", {
                  name: group.name,
                  colour: group.colour,
                });
                const created = json.group as TodoGroup;
                for (const list of groupLists) {
                  // Each list as it was: its look and its links too.
                  const newList = await recreateList({
                    ...list,
                    groupId: created.id,
                  });
                  for (const task of groupTasks.filter(
                    (task) => task.listId === list.id
                  )) {
                    await recreateTask({ ...task, listId: newList.id });
                  }
                }
                await refresh();
              })();
            })
          )
          .catch((err) => {
            toast.error(describeError(err, t("deleteFailed")));
            void refresh();
          });
      },
    });
  }

  function removeList(list: TodoList) {
    const listTasks = state.tasks.filter((task) => task.listId === list.id);
    setConfirmModal({
      title: t("deleteList"),
      message: `${t("deleteConfirm")} (${list.name})`,
      confirmLabel: t("deleteList"),
      danger: true,
      onConfirm: () => {
        setState((s) => ({
          ...s,
          lists: s.lists.filter((l) => l.id !== list.id),
          tasks: s.tasks.filter((task) => task.listId !== list.id),
        }));
        if (currentListId === list.id || currentListId === TODO_ALL_LIST_ID) {
          const remaining = lists.filter((l) => l.id !== list.id);
          if (remaining.length === 1) {
            setCurrentListId(remaining[0].id);
            persistPref(TODO_CURRENT_LIST_KEY, remaining[0].id);
          } else if (remaining.length > 1) {
            setCurrentListId(TODO_ALL_LIST_ID);
            persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
          } else {
            setCurrentListId(null);
            persistPref(TODO_CURRENT_LIST_KEY, "");
          }
        }
        void api(`/api/todo/lists?id=${encodeURIComponent(list.id)}`, "DELETE")
          .then(() =>
            showUndo(t("listDeleted"), () => {
              void (async () => {
                // A deleted list is kept with its tasks, so Undo brings
                // that one back. Making a copy left the deleted one in
                // Settings, under Deleted lists, for a list that was
                // never gone. A host without the route makes the copy.
                try {
                  await api("/api/todo/lists/deleted", "POST", { id: list.id });
                } catch {
                  const created = await recreateList(list);
                  for (const task of listTasks) {
                    await recreateTask({ ...task, listId: created.id });
                  }
                }
                await refresh();
              })();
            })
          )
          .catch((err) => {
            toast.error(describeError(err, t("deleteFailed")));
            void refresh();
          });
      },
    });
  }

  return { handleGroupsEnabledChange, switchToGroup, removeGroup, removeList };
}
