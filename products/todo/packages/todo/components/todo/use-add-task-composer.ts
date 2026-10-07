"use client";

import * as React from "react";

import { type UploadImage } from "@/components/todo/TrixNotesEditor";
import {
  pendingAttachments,
  type ImageSrcResolver,
} from "@/lib/todo/basecamp-richtext";
import type { TodoLang } from "@/lib/todo/i18n";
import { resolveListIconId } from "@/lib/todo/list-icons";
import {
  EMPTY_TASK_DRAFT,
  draftHasExtras,
  newDraftKey,
  notesHtmlIsEmpty,
  type SubtaskDraft,
  type TaskDraft,
} from "@/lib/todo/task-draft";
import type { TodoList, TodoPerson } from "@/lib/todo/types";

/** What AddTaskComposer is given. */
export type AddTaskComposerProps = {
  inputId?: string;
  placeholder: string;
  addLabel: string;
  minutesLabel: string;
  /** The draft to add. A subtask still being typed is folded into it. */
  onSubmit: (draft: TaskDraft) => void;
  /** People the new task can go to. */
  people: TodoPerson[];
  onEditPeople: () => void;
  /** Off, the row has no assign chip. The setting is in TodoSettingsModal. */
  assignEnabled?: boolean;
  /**
   * On, the due-day picker offers "Show on the Calendar", as a task's own
   * picker does. It follows the Calendar View setting.
   */
  calendarEnabled?: boolean;
  /** The lists the chip can pick from. */
  lists: TodoList[];
  /** The list the tab is on, or null on the All tab. */
  defaultList: TodoList | null;
  lang: TodoLang;
  t: (key: string) => string;
  /**
   * Where a picture pasted into the note goes, for the list the task will
   * be on. The same choice a task's own note makes. Left out, a picture is
   * refused rather than half kept.
   */
  uploadImageForList?: (listId: string | null) => UploadImage;
  /** Where a Basecamp picture in the note is read from. */
  resolveImageSrc?: ImageSrcResolver;
  /** What the box starts with: the Calendar gives the due day of the day that was clicked. */
  initialDraft?: Partial<TaskDraft>;
  /** Put the caret in the box when it shows. */
  autoFocus?: boolean;
};

/**
 * The add-task row's state: the draft, which chip or section is open,
 * and what adding, dismissing and the step rows do. AddTaskComposer and
 * its parts (add-task-composer-parts.tsx) draw from it.
 */
export function useAddTaskComposer({
  inputId,
  placeholder,
  addLabel,
  minutesLabel,
  onSubmit,
  people,
  onEditPeople,
  assignEnabled = true,
  calendarEnabled = false,
  lists,
  defaultList,
  lang,
  t,
  uploadImageForList,
  resolveImageSrc,
  initialDraft,
  autoFocus = false,
}: AddTaskComposerProps) {
  const textRef = React.useRef<HTMLInputElement | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const assignRef = React.useRef<HTMLButtonElement | null>(null);
  const listRef = React.useRef<HTMLButtonElement | null>(null);
  const durationChipRef = React.useRef<HTMLButtonElement | null>(null);
  const dueChipRef = React.useRef<HTMLButtonElement | null>(null);
  const notesChipRef = React.useRef<HTMLButtonElement | null>(null);
  const subtasksChipRef = React.useRef<HTMLButtonElement | null>(null);
  /** Pictures in the note still on their way up. Adding waits for them. */
  const notesUploading = React.useRef(0);
  /** Reads the note straight from the editor, pictures included. */
  const notesReadCurrent = React.useRef<(() => string) | null>(null);
  /** Add was pressed while a picture was still uploading. */
  const [notesWait, setNotesWait] = React.useState(false);
  const newSubtaskRef = React.useRef<HTMLInputElement | null>(null);
  const subtaskRefs = React.useRef(new Map<string, HTMLInputElement>());
  const subtaskAssignRefs = React.useRef(new Map<string, HTMLButtonElement>());

  const [assignOpen, setAssignOpen] = React.useState(false);
  const [listOpen, setListOpen] = React.useState(false);
  const [durationOpen, setDurationOpen] = React.useState(false);
  const [dueOpen, setDueOpen] = React.useState(false);
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [subtasksOpen, setSubtasksOpen] = React.useState(false);
  /** The subtask row whose assign menu is up, by draft key. */
  const [subtaskAssignKey, setSubtaskAssignKey] = React.useState<string | null>(
    null
  );
  /** The subtask row still being typed, below the committed ones. */
  const [pendingSubtask, setPendingSubtask] = React.useState("");

  /*
    The draft lives here, not on the page. A keystroke then redraws this
    row and nothing else — held on the page it redrew every card on the
    board, which is what made typing a title feel slow.
  */
  const [draft, onDraftChange] = React.useState<TaskDraft>(() => ({
    ...EMPTY_TASK_DRAFT,
    ...initialDraft,
  }));
  React.useEffect(() => {
    if (autoFocus) textRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const patch = React.useCallback(
    (fields: Partial<TaskDraft>) =>
      onDraftChange((current) => ({ ...current, ...fields })),
    []
  );

  const hasText = draft.text.trim().length > 0;
  const hasDuration = draft.duration !== "";
  const hasNotes = !notesHtmlIsEmpty(draft.notes);
  const anyMenuOpen = assignOpen || listOpen || subtaskAssignKey !== null;
  /*
    The chips wait for the first letter. A focused, empty row stays a plain
    box — the row is for typing, and the chips are for what is typed.
    Once one holds a value, or a section or menu is up, they stay.
  */
  const open =
    hasText ||
    anyMenuOpen ||
    notesOpen ||
    subtasksOpen ||
    durationOpen ||
    dueOpen ||
    draftHasExtras(draft);

  const assignees = people.filter((person) =>
    draft.assigneeIds.includes(person.id)
  );
  const pickedList = draft.listId
    ? (lists.find((list) => list.id === draft.listId) ?? null)
    : null;
  const targetList = pickedList ?? defaultList;
  const targetIconId = resolveListIconId(targetList?.emoji);

  /**
   * Put the row away: what the chips held goes, and the row is a plain
   * box again. Only ever with no title typed — a title is work, and a
   * stray click must not lose it.
   */
  const dismiss = React.useCallback(() => {
    onDraftChange(EMPTY_TASK_DRAFT);
    setPendingSubtask("");
    setNotesOpen(false);
    setNotesWait(false);
    setSubtasksOpen(false);
    setDurationOpen(false);
    setDueOpen(false);
    setAssignOpen(false);
    setListOpen(false);
    setSubtaskAssignKey(null);
  }, []);

  /* A click anywhere else, with nothing typed, puts the row away. The
     pickers live in portals outside the row; a click in one is not
     "elsewhere". */
  React.useEffect(() => {
    if (!open || hasText) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target)) return;
      if (
        (target as Element).closest?.(
          ".todo-menu-portal-root, .assign-menu-portal-root"
        )
      ) {
        return;
      }
      dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, hasText, dismiss]);

  /* Focus follows a section the moment it opens. */
  React.useEffect(() => {
    if (subtasksOpen) newSubtaskRef.current?.focus();
  }, [subtasksOpen]);

  /* The list menu closes on a click anywhere else, or on Escape. */
  React.useEffect(() => {
    if (!listOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (listRef.current?.contains(event.target as Node)) return;
      setListOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setListOpen(false);
        listRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [listOpen]);

  /*
    A picker hands the caret back to its own chip, not to the title: Tab
    then carries on to the next chip, so a task can be dressed from the
    keyboard in one pass. Cmd+Enter adds it from anywhere in the row.
  */
  function closeAssign() {
    setAssignOpen(false);
    assignRef.current?.focus();
  }

  function closeSubtaskAssign() {
    const key = subtaskAssignKey;
    setSubtaskAssignKey(null);
    if (key) subtaskRefs.current.get(key)?.focus();
  }

  function submit() {
    /*
      The note as the editor holds it, read from the editor itself: a
      picture that has just finished uploading may not have reached the
      draft through React yet, and a task added from the draft alone would
      go without it. And not at all while one is still uploading — it has
      nowhere to land once the row is cleared.
    */
    const notes = notesOpen
      ? (notesReadCurrent.current?.() ?? draft.notes)
      : draft.notes;
    if (notesUploading.current > 0 || pendingAttachments(notes) > 0) {
      setNotesOpen(true);
      setNotesWait(true);
      return;
    }
    setNotesWait(false);
    const base: TaskDraft = { ...draft, notes };
    const pending = pendingSubtask.trim();
    const final: TaskDraft = pending
      ? {
          ...base,
          subtasks: [
            ...base.subtasks,
            { key: newDraftKey(), text: pending, assigneeIds: [] },
          ],
        }
      : base;
    if (!final.text.trim()) return;
    setPendingSubtask("");
    setDurationOpen(false);
    setDueOpen(false);
    setNotesOpen(false);
    setSubtasksOpen(false);
    setAssignOpen(false);
    setListOpen(false);
    setSubtaskAssignKey(null);
    onDraftChange(EMPTY_TASK_DRAFT);
    onSubmit(final);
    textRef.current?.focus();
  }

  /* ----------------------------------------------------------- duration */

  const durationMinutes = hasDuration
    ? Number.parseInt(draft.duration, 10) || null
    : null;

  function closeDuration() {
    setDurationOpen(false);
    durationChipRef.current?.focus();
  }

  function closeDue() {
    setDueOpen(false);
    dueChipRef.current?.focus();
  }

  /* ----------------------------------------------------------- subtasks */

  function updateSubtask(key: string, fields: Partial<SubtaskDraft>) {
    onDraftChange((current) => ({
      ...current,
      subtasks: current.subtasks.map((row) =>
        row.key === key ? { ...row, ...fields } : row
      ),
    }));
  }

  function removeSubtask(key: string) {
    const index = draft.subtasks.findIndex((row) => row.key === key);
    onDraftChange((current) => ({
      ...current,
      subtasks: current.subtasks.filter((row) => row.key !== key),
    }));
    const previous = draft.subtasks[index - 1];
    if (previous) subtaskRefs.current.get(previous.key)?.focus();
    else textRef.current?.focus();
  }

  /** Enter on the new row: keep it, and start the next. */
  function commitPendingSubtask() {
    const text = pendingSubtask.trim();
    if (!text) return;
    onDraftChange((current) => ({
      ...current,
      subtasks: [
        ...current.subtasks,
        { key: newDraftKey(), text, assigneeIds: [] },
      ],
    }));
    setPendingSubtask("");
  }

  const subtaskCount =
    draft.subtasks.length + (pendingSubtask.trim() ? 1 : 0);

  return {
    inputId,
    placeholder,
    addLabel,
    minutesLabel,
    onSubmit,
    people,
    onEditPeople,
    assignEnabled,
    calendarEnabled,
    lists,
    defaultList,
    lang,
    t,
    uploadImageForList,
    resolveImageSrc,
    initialDraft,
    autoFocus,
    textRef,
    wrapperRef,
    assignRef,
    listRef,
    durationChipRef,
    dueChipRef,
    notesChipRef,
    subtasksChipRef,
    notesUploading,
    notesReadCurrent,
    notesWait,
    setNotesWait,
    newSubtaskRef,
    subtaskRefs,
    subtaskAssignRefs,
    assignOpen,
    setAssignOpen,
    listOpen,
    setListOpen,
    durationOpen,
    setDurationOpen,
    dueOpen,
    setDueOpen,
    notesOpen,
    setNotesOpen,
    subtasksOpen,
    setSubtasksOpen,
    subtaskAssignKey,
    setSubtaskAssignKey,
    pendingSubtask,
    setPendingSubtask,
    draft,
    onDraftChange,
    patch,
    hasText,
    hasDuration,
    hasNotes,
    anyMenuOpen,
    open,
    assignees,
    pickedList,
    targetList,
    targetIconId,
    dismiss,
    closeAssign,
    closeSubtaskAssign,
    submit,
    durationMinutes,
    closeDuration,
    closeDue,
    updateSubtask,
    removeSubtask,
    commitPendingSubtask,
    subtaskCount,
  };
}

export type AddTaskComposerModel = ReturnType<typeof useAddTaskComposer>;
