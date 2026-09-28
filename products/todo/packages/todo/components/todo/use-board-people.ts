"use client";

import * as React from "react";
import { toast } from "sonner";

import type { LivePage } from "@/components/todo/use-pointer-drag";
import type { ConfirmModalState } from "@/components/todo/use-task-actions";
import type { TodoApi } from "@/components/todo/use-write-tracking";
import { squareAvatarFile } from "@/lib/todo/avatar-image";
import { noteMediaSrc } from "@/lib/todo/basecamp-image";
import { describeError } from "@/lib/todo/errors";
import { uploadLocalNoteImage } from "@/lib/todo/note-uploads";
import { toggleId } from "@/lib/todo/task-helpers";
import type {
  TodoPerson,
  TodoPersonCandidate,
  TodoState,
  TodoTask,
  TodoTaskPatch,
} from "@/lib/todo/types";

/**
 * The people of the board: finding and adding one, a photo, removing one,
 * and putting a person on a task or taking them off, with the rule that
 * joins a subtask's people to its task.
 */
export function useBoardPeople({
  state,
  setState,
  api,
  refresh,
  t,
  liveRef,
  subtasksByTask,
  mutateTask,
  setConfirmModal,
  assignAnchorEl,
  setOpenAssignTaskId,
  setAssignAnchorEl,
}: {
  state: TodoState;
  setState: React.Dispatch<React.SetStateAction<TodoState>>;
  api: TodoApi;
  refresh: () => Promise<void>;
  t: (key: string) => string;
  liveRef: React.RefObject<LivePage>;
  subtasksByTask: Map<string, TodoTask[]>;
  mutateTask: (id: string, patch: TodoTaskPatch) => Promise<unknown>;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
  assignAnchorEl: HTMLElement | null;
  setOpenAssignTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  setAssignAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
}) {
  const peopleById = React.useMemo(() => {
    const map = new Map<string, TodoPerson>();
    for (const person of state.people) map.set(person.id, person);
    return map;
  }, [state.people]);

  const searchPeopleCandidates = React.useCallback(
    async (query: string): Promise<TodoPersonCandidate[]> => {
      try {
        const json = await api(
          `/api/todo/people/search?q=${encodeURIComponent(query)}`,
          "GET"
        );
        return (json.results as TodoPersonCandidate[]) ?? [];
      } catch {
        return [];
      }
    },
    []
  );

  async function addBoardPerson(
    candidate: TodoPersonCandidate | { name: string }
  ): Promise<TodoPerson | null> {
    try {
      const body =
        "key" in candidate
          ? {
              name: candidate.name,
              photoUrl: candidate.photoUrl,
              sourceKind: candidate.sourceKind,
              sourceId: candidate.sourceId,
              email: candidate.email,
            }
          : { name: candidate.name, sourceKind: "manual" as const };
      const json = await api("/api/todo/people", "POST", body);
      const person = json.person as TodoPerson;
      // The add may have matched an existing row and filled in its blanks, so
      // take the returned row over the copy already on the board.
      setState((s) => ({
        ...s,
        people: s.people.some((p) => p.id === person.id)
          ? s.people.map((p) => (p.id === person.id ? person : p))
          : [...s.people, person],
      }));
      return person;
    } catch (err) {
      toast.error(describeError(err, t("addPersonFailed")));
      return null;
    }
  }


  /**
   * A picture for a person's avatar, or none. The picture is made small and
   * kept where note pictures are kept (see uploadLocalNoteImage), and the
   * person keeps its address. Without one, the avatar shows initials.
   */
  async function setPersonPhoto(personId: string, file: File | null) {
    let photoUrl: string | null = null;
    if (file) {
      try {
        const avatar = await squareAvatarFile(file);
        const stored = await uploadLocalNoteImage(avatar, () => {});
        photoUrl = stored.mediaId ? noteMediaSrc(stored.mediaId) : stored.url ?? null;
        if (!photoUrl) throw new Error("no address");
      } catch (err) {
        toast.error(describeError(err, t("photoFailed")));
        return;
      }
    }
    setState((s) => ({
      ...s,
      people: s.people.map((person) =>
        person.id === personId ? { ...person, photoUrl } : person
      ),
    }));
    try {
      await api("/api/todo/people", "PATCH", { id: personId, photoUrl });
    } catch (err) {
      toast.error(describeError(err, t("photoFailed")));
      void refresh();
    }
  }

  async function removeBoardPerson(id: string) {
    const snapshot = state.people;
    setState((s) => ({
      ...s,
      people: s.people.filter((p) => p.id !== id),
      tasks: s.tasks.map((t) =>
        t.assigneeIds.includes(id)
          ? { ...t, assigneeIds: t.assigneeIds.filter((pid) => pid !== id) }
          : t
      ),
    }));
    try {
      await api(`/api/todo/people?id=${encodeURIComponent(id)}`, "DELETE");
    } catch (err) {
      toast.error(describeError(err, t("removePersonFailed")));
      setState((s) => ({ ...s, people: snapshot }));
      void refresh();
    }
  }

  function toggleTaskAssignee(taskId: string, personId: string) {
    const task = liveRef.current.state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const removing = task.assigneeIds.includes(personId);
    const next = toggleId(task.assigneeIds, personId);

    /*
      The people on a subtask are always on its task too, so the two
      directions need care here:

      Putting somebody on a subtask quietly puts them on the parent — the
      store does the write; the card is updated at once so the avatar does
      not lag the menu.

      Taking somebody off a task they still hold subtasks of is asked
      about first: the store will strip their subtask assignments with the
      same write, and that should never be a surprise.
    */
    if (removing && !task.parentTaskId) {
      const held = (subtasksByTask.get(taskId) ?? []).filter((child) =>
        child.assigneeIds.includes(personId)
      );
      if (held.length) {
        const name = peopleById.get(personId)?.name ?? "";
        closeAssignMenu();
        setConfirmModal({
          title: t("unassignCascadeTitle"),
          message: t("unassignCascadeMessage")
            .replace("{name}", name)
            .replace("{count}", String(held.length)),
          confirmLabel: t("unassignCascadeConfirm"),
          danger: true,
          onConfirm: () => {
            // The children on screen follow at once; the store makes the
            // same cut authoritatively.
            setState((s) => ({
              ...s,
              tasks: s.tasks.map((row) =>
                row.parentTaskId === taskId && row.assigneeIds.includes(personId)
                  ? {
                      ...row,
                      assigneeIds: row.assigneeIds.filter((id) => id !== personId),
                    }
                  : row
              ),
            }));
            void mutateTask(taskId, { assigneeIds: next });
          },
        });
        return;
      }
    }
    if (!removing && task.parentTaskId) {
      const parent = liveRef.current.state.tasks.find(
        (row) => row.id === task.parentTaskId
      );
      if (parent && !parent.assigneeIds.includes(personId)) {
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((row) =>
            row.id === parent.id
              ? { ...row, assigneeIds: [...row.assigneeIds, personId] }
              : row
          ),
        }));
      }
    }
    // Keep the menu open so multiple people can be checked.
    void mutateTask(taskId, { assigneeIds: next });
  }

  function closeAssignMenu() {
    // The menu holds the caret while it is up. Hand it back to the button,
    // or it falls to the page and the next Tab starts from the top.
    assignAnchorEl?.focus();
    setOpenAssignTaskId(null);
    setAssignAnchorEl(null);
  }

  return {
    peopleById,
    searchPeopleCandidates,
    addBoardPerson,
    setPersonPhoto,
    removeBoardPerson,
    toggleTaskAssignee,
    closeAssignMenu,
  };
}
