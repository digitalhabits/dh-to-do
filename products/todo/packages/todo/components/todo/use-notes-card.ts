"use client";

import * as React from "react";
import { toast } from "sonner";

import { pendingAttachments, trixToBasecamp } from "@/lib/todo/basecamp-richtext";
import type { TodoTask, TodoTaskPatch } from "@/lib/todo/types";

/**
 * The open note of a task: under its row, or as the whole card over the
 * window, with the card's own pickers and the fade at its foot.
 */
export function useNotesCardState() {
  const [openNotesTaskId, setOpenNotesTaskId] = React.useState<string | null>(null);
  /** The open note, over the whole window. See renderNotesOverlay. */
  const [notesExpanded, setNotesExpanded] = React.useState(false);
  /** The expanded card's own pickers, so the card's stay untouched. */
  const [overlayListOpen, setOverlayListOpen] = React.useState(false);
  const [overlayAssignAnchor, setOverlayAssignAnchor] =
    React.useState<HTMLElement | null>(null);
  /* A click anywhere else puts either picker away — the same window
     listener the cards' menus use. The menus stop their own clicks, so
     picking several people keeps the list open. */
  React.useEffect(() => {
    if (!overlayAssignAnchor) return;
    const close = () => setOverlayAssignAnchor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [overlayAssignAnchor]);
  React.useEffect(() => {
    if (!overlayListOpen) return;
    const close = () => setOverlayListOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [overlayListOpen]);
  /** Whether the expanded card has more below the fold, for the fade. */
  const [overlayMoreBelow, setOverlayMoreBelow] = React.useState(false);
  const overlayFieldsRef = React.useRef<HTMLDivElement | null>(null);
  const overlayFieldsResize = React.useRef<ResizeObserver | null>(null);
  const updateOverlayFade = React.useCallback(() => {
    const el = overlayFieldsRef.current;
    if (!el) return;
    setOverlayMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);
  /* A stable ref callback: the observer is made once per mount of the
     fields, not once per render, and content growing (a subtask added, a
     note typed) re-measures without a scroll. */
  const setOverlayFieldsNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      overlayFieldsResize.current?.disconnect();
      overlayFieldsResize.current = null;
      overlayFieldsRef.current = node;
      if (!node) return;
      const observer = new ResizeObserver(updateOverlayFade);
      observer.observe(node);
      for (const child of Array.from(node.children)) observer.observe(child);
      overlayFieldsResize.current = observer;
      updateOverlayFade();
    },
    [updateOverlayFade]
  );
  /** Pictures still on their way to Basecamp, from the open editor. */
  const notesUploading = React.useRef(0);
  /** The open editor's note, read at the moment of saving. */
  const notesReadCurrent = React.useRef<(() => string) | null>(null);
  const [notesDraft, setNotesDraft] = React.useState("");
  /**
   * Set when the expanded card was opened from a card's subtask button: the
   * caret then starts in "Add a subtask", where the click meant to go. See
   * useSubtasks.
   */
  const focusSubtaskOnOpenRef = React.useRef(false);

  return {
    focusSubtaskOnOpenRef,
    openNotesTaskId,
    setOpenNotesTaskId,
    notesExpanded,
    setNotesExpanded,
    overlayListOpen,
    setOverlayListOpen,
    overlayAssignAnchor,
    setOverlayAssignAnchor,
    overlayMoreBelow,
    setOverlayMoreBelow,
    overlayFieldsRef,
    overlayFieldsResize,
    updateOverlayFade,
    setOverlayFieldsNode,
    notesUploading,
    notesReadCurrent,
    notesDraft,
    setNotesDraft,
  };
}

/**
 * Opening a note, reading the editor on screen, saving, and the card over
 * the window; Escape on the card saves it.
 */
export function useNotesCard({
  notesCard,
  mutateTask,
  t,
}: {
  notesCard: ReturnType<typeof useNotesCardState>;
  mutateTask: (id: string, patch: TodoTaskPatch) => Promise<unknown>;
  t: (key: string) => string;
}) {
  const {
    openNotesTaskId,
    setOpenNotesTaskId,
    notesExpanded,
    setNotesExpanded,
    notesUploading,
    notesReadCurrent,
    notesDraft,
    setNotesDraft,
  } = notesCard;
  function toggleNotes(task: TodoTask) {
    if (openNotesTaskId === task.id) {
      saveNotes(task.id);
      return;
    }
    setOpenNotesTaskId(task.id);
    setNotesDraft(task.notesHtml ?? "");
    setNotesExpanded(false);
  }


  /**
   * The note as the reader sees it: read from the visible editor itself.
   *
   * A slot the editors registered into answered for this before, and hot
   * reload proved how weak that is — a stale instance can hold the slot
   * while the visible one goes unread, and the save quietly writes the
   * wrong document. The DOM cannot be stale about which editor is on
   * screen: the one inside the open note container is the one the reader
   * is typing in.
   */
  function readOpenNote(): string | null {
    const el = (document.querySelector(
      ".notes-overlay-body trix-editor"
    ) ?? document.querySelector(
      ".notes-container.open trix-editor"
    )) as (HTMLElement & { value: string }) | null;
    if (!el || !el.isConnected) return null;
    return trixToBasecamp(el.value);
  }


  React.useEffect(() => {
    if (!notesExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // The card is the task now, not only its notes: leaving it saves and
      // puts the reader back on the board, not into the small note box.
      if (openNotesTaskId) saveNotes(openNotesTaskId);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesExpanded]);


  function saveNotes(taskId: string) {
    /*
      Straight from the editor, not from the draft.

      The draft is state, filled by the editor's change events — and a
      picture's sgid arrives outside any event Trix raises, so a draft can
      be one step behind the document at exactly the moment that matters.
      The editor serializes on demand; asking it at save time cannot be
      stale.
    */
    const html = readOpenNote() ?? notesReadCurrent.current?.() ?? notesDraft;
    /*
      A picture Basecamp has not answered for yet has no sgid, and the
      Basecamp HTML this draft holds has already dropped it — so the note
      would save without it, and the picture would vanish from under the
      writer with nothing said.

      Counted by the editor rather than read out of the draft: by the time
      the HTML is in Basecamp's shape the evidence is gone, which is why
      asking the draft always answered none.
    */
    if (notesUploading.current > 0 || pendingAttachments(html) > 0) {
      toast.error(t("pictureUploading"));
      return;
    }
    setOpenNotesTaskId(null);
    setNotesExpanded(false);
    const isEmpty = !html || html === "<p><br></p>";
    void mutateTask(taskId, {
      notesHtml: isEmpty ? null : html,
    });
  }


  /**
   * The whole task, expanded: title, list, people, duration, notes and
   * subtasks in one card over the window. The expand button on a card and
   * the subtask chip both come here.
   */
  function openTaskOverlay(task: TodoTask, opts?: { focusSubtask?: boolean }) {
    notesCard.focusSubtaskOnOpenRef.current = Boolean(opts?.focusSubtask);
    if (openNotesTaskId === task.id) {
      /*
        The small note box may be open with unsaved words in it. The big
        card runs a second editor over the same draft, so what is live in
        the small one is carried into the draft first — the same carry the
        old expand button made — or the last keystrokes would be lost.
      */
      if (notesUploading.current > 0) {
        toast.error(t("pictureUploading"));
        return;
      }
      const live = readOpenNote() ?? notesReadCurrent.current?.();
      if (live != null) setNotesDraft(live);
    } else {
      setOpenNotesTaskId(task.id);
      setNotesDraft(task.notesHtml ?? "");
    }
    setNotesExpanded(true);
  }

  return { toggleNotes, readOpenNote, saveNotes, openTaskOverlay };
}
