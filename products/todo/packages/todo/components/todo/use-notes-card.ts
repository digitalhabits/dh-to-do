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
  /** A title being written in details, shown on the task's card as typed;
      saved on Enter or leaving the box (OverlayTitle). */
  const [titleDraft, setTitleDraft] = React.useState<{ taskId: string; text: string } | null>(null);
  /** The open note, over the whole window. See renderNotesOverlay. */
  const [notesExpanded, setNotesExpandedOnly] = React.useState(false);
  /** Details widened over the whole window (TaskDetailsBar). Closing details ends it. */
  const [detailsFull, setDetailsFull] = React.useState(false);
  const setNotesExpanded = React.useCallback((open: boolean) => {
    setNotesExpandedOnly(open);
    if (!open) setDetailsFull(false);
  }, []);
  const detailsOpenerRef = React.useRef<HTMLElement | null>(null);
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
  /** The part of details to scroll to the top once they are drawn. */
  const scrollToOnOpenRef = React.useRef<DetailsPart | null>(null);

  return {
    detailsOpenerRef,
    focusSubtaskOnOpenRef,
    scrollToOnOpenRef,
    openNotesTaskId,
    setOpenNotesTaskId,
    notesExpanded,
    setNotesExpanded,
    detailsFull,
    setDetailsFull,
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
    titleDraft,
    setTitleDraft,
  };
}

/**
 * Opening a note, reading the editor on screen, saving, and the card over
 * the window; Escape on the card saves it.
 */
export function useNotesCard({
  notesCard,
  mutateTask,
  storedNotesOf,
  t,
}: {
  notesCard: ReturnType<typeof useNotesCardState>;
  mutateTask: (id: string, patch: TodoTaskPatch) => Promise<unknown>;
  /** The notes the board holds for a task now, to skip a save that changes nothing. */
  storedNotesOf: (taskId: string) => string | null | undefined;
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
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest?.(".assign-menu-portal, .task-menu, .task-list-picker, .due-popover, .duration-popover, .trix-lightbox, .people-editor")) return;
      // Escape in the title's box puts the box away, not the card.
      if ((event.target as HTMLElement | null)?.closest?.(".notes-overlay-title-input")) return;
      event.stopPropagation();
      // Full screen, Escape first puts details back beside the list.
      if (notesCard.detailsFull && document.querySelector(".task-details-full .task-details-expand")) {
        notesCard.setDetailsFull(false);
        return;
      }
      // The card is the task now, not only its notes: leaving it saves and
      // puts the reader back on the board, not into the small note box.
      if (openNotesTaskId) saveNotes(openNotesTaskId);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesExpanded, openNotesTaskId, notesDraft, notesCard.detailsFull]);


  /* Opened from a card's subtask count or its Notes mark: that part of
     details goes to the top of the scrolling area. The notes editor loads a
     moment later and can move the scroll as it takes the caret, so the
     scroll is set again once it has ("trix-initialize"), for 2s. */
  React.useEffect(() => {
    const part = notesCard.scrollToOnOpenRef.current;
    if (!notesExpanded || !part) return;
    notesCard.scrollToOnOpenRef.current = null;
    const frames: number[] = [requestAnimationFrame(() => scrollDetailsTo(part))];
    const onEditorReady = () => frames.push(requestAnimationFrame(() => scrollDetailsTo(part)));
    document.addEventListener("trix-initialize", onEditorReady);
    const stop = window.setTimeout(() => document.removeEventListener("trix-initialize", onEditorReady), 2000);
    return () => {
      frames.forEach(cancelAnimationFrame);
      document.removeEventListener("trix-initialize", onEditorReady);
      window.clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesExpanded, openNotesTaskId]);

  function saveNotes(taskId: string, restoreFocus = true) {
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
      return false;
    }
    setOpenNotesTaskId(null);
    setNotesExpanded(false);
    const isEmpty = !html || html === "<p><br></p>";
    const notesHtml = isEmpty ? null : html;
    // Closing a task without changing its notes sends nothing: a save of
    // the same words was a request and a redraw on every close.
    if (notesHtml !== (storedNotesOf(taskId) ?? null)) {
      void mutateTask(taskId, { notesHtml });
    }
    if (restoreFocus) requestAnimationFrame(() => notesCard.detailsOpenerRef.current?.focus({ preventScroll: true }));
    return true;
  }


  /**
   * Open task details from a title, subtask count or the Today session.
   * Switching tasks saves the live note before loading the next document.
   */
  function openTaskOverlay(task: TodoTask, opts?: { focusSubtask?: boolean; scrollTo?: DetailsPart }) {
    if (openNotesTaskId && openNotesTaskId !== task.id && !saveNotes(openNotesTaskId, false)) return;
    if (openNotesTaskId !== task.id || !notesExpanded) {
      notesCard.detailsOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    // From the subtask count, the subtasks are what the reader came for.
    const part = opts?.scrollTo ?? (opts?.focusSubtask ? "subtasks" : null);
    if (notesExpanded && openNotesTaskId === task.id) {
      // Already open on this task: nothing redraws to scroll after, so the
      // part is scrolled to now.
      if (part) requestAnimationFrame(() => scrollDetailsTo(part));
      return;
    }
    notesCard.focusSubtaskOnOpenRef.current = Boolean(opts?.focusSubtask);
    notesCard.scrollToOnOpenRef.current = part;
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
    notesCard.setOverlayListOpen(false);
    notesCard.setOverlayAssignAnchor(null);
    requestAnimationFrame(() => {
      if (!opts?.focusSubtask) document.querySelector<HTMLButtonElement>(".task-details-back")?.focus({ preventScroll: true });
    });
  }

  return { toggleNotes, readOpenNote, saveNotes, openTaskOverlay };
}

/** A part of task details a card can open them on. */
export type DetailsPart = "subtasks" | "notes";

/** Scroll the details so `part` starts at the top of their scrolling area. */
export function scrollDetailsTo(part: DetailsPart) {
  const box = document.querySelector<HTMLElement>(".task-details-panel .task-overlay-fields");
  const target = box?.querySelector<HTMLElement>(
    part === "notes" ? ".task-overlay-notes-band" : ".task-overlay-subtasks"
  );
  if (!box || !target) return;
  // The app may be zoomed (Settings > Zoom level, a CSS zoom). WebKit gives
  // the rects on screen, zoomed, and the scroll in the box's own pixels:
  // the screen distance is divided by the zoom. Where both are on screen
  // the two heights agree and this is 1.
  const scale = box.getBoundingClientRect().height / box.offsetHeight || 1;
  box.scrollTop += (target.getBoundingClientRect().top - box.getBoundingClientRect().top) / scale;
}

/**
 * Light up one subtask's row in task details for a moment: the step whose
 * card on the board opened its parent's details, so the eye finds it. The
 * details draw a frame or two after the click, so this waits for the row
 * (about a second at most). The colour is task-details.css's.
 */
export function flashSubtaskRow(subtaskId: string) {
  let frames = 0;
  const look = () => {
    const row = document.querySelector<HTMLElement>(
      `.task-details-panel .task-subtask-row[data-subtask-id="${CSS.escape(subtaskId)}"]`
    );
    if (!row) {
      if (++frames < 60) requestAnimationFrame(look);
      return;
    }
    row.classList.remove("is-flash");
    void row.offsetWidth; // start the animation again on a second click
    row.classList.add("is-flash");
    row.addEventListener("animationend", () => row.classList.remove("is-flash"), { once: true });
  };
  requestAnimationFrame(look);
}
