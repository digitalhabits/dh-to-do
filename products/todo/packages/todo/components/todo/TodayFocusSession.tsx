"use client";

import * as React from "react";
import { ArrowRight, Calendar, Clock, Pause, Play } from "lucide-react";

import { FocusIcon } from "@/components/todo/task-icons";
import { TaskAssigneeStack } from "@/components/todo/TodoPeopleEditor";
import { walkArrowStops, walkTabStops } from "@/lib/todo/focus-walk";
import { beginNativeWindowDragOnMove } from "@/lib/todo/native-bridge";
import { focusTimerShown, formatFocusTime } from "@/lib/todo/focus-time";
import {
  flyGhostTo,
  prefersReducedMotion,
  spawnCompletionParty,
  randomSubtaskPartyEmoji,
  spawnTaskGhost,
  waitForElement,
} from "@/lib/todo/task-celebration";
import type { makeT, TodoLang } from "@/lib/todo/i18n";
import { NotesChip } from "@/components/todo/notes-chip";
import { useSessionWindowFit } from "@/components/todo/session-window-fit";
import { formatDurationShort } from "@/lib/todo/duration";
import { daysUntilDue, formatDueOnShort } from "@/lib/todo/task-draft";
import type { TodoPerson, TodoTask } from "@/lib/todo/types";

/** How long the task in hand shows its tick before the next task takes the card. */
const NOW_TICK_HOLD_MS = 450;

/** How often the running task's time is written back, as in the focus panel. */
const PERSIST_INTERVAL_MS = 30000;

/** What on a session card is a control of its own: a press there neither
    drags the card nor opens its details. Trix, not Quill, and a bare
    `[contenteditable]`: Trix does not spell the attribute "true", so a
    selection inside a note read as the start of a drag. Menus and
    pickers, as an open one's padding is not the card. */
const CARD_CONTROLS =
  "input, button, a, textarea, select, label, [contenteditable]," +
  " trix-editor, .trix-notes-bubble, .assign-menu, [role=menu], [role=dialog], [role=listbox]";

export type TodaySessionHandlers = {
  /** Open or close the board's notes editor for this task. */
  onToggleNotes: (task: TodoTask) => void;
  /** Open the task's details, as a click on a board card's name does. */
  onOpenDetails: (task: TodoTask) => void;
  /** The board's notes editor for this task, or null when it is shut. */
  renderNotes: (task: TodoTask) => React.ReactNode;
  /** Whether a task's (or step's) note is open in place. */
  isNotesOpen: (task: TodoTask) => boolean;
  /** Minutes the task is expected to take, or null to clear it. */
  onSetDuration: (task: TodoTask, minutes: number | null) => void;
  /** Mark the running task done. The board keeps the record. */
  onComplete: (task: TodoTask) => void;
  /** Take a finished task back up: not done, and in hand again. */
  onUncomplete: (task: TodoTask) => void;
  /** Send the running task to the end of the queue. */
  onSkip: (task: TodoTask) => void;
  /** The queue in a new order, after a drag. */
  onReorder: (taskIds: string[]) => void;
  /** Add a task to Today. The session shows it at the end of the queue. */
  onAddTask: (text: string, durationMinutes: number | null) => void;
  /** Write the time the session spent on a task. */
  onPersistTime: (taskId: string, totalSeconds: number) => void;
  /** Save a new name for the task. */
  onEditText: (task: TodoTask, text: string) => void;
  /** Tick a subtask of the task in hand, or take the tick back. */
  onToggleSubtask: (subtask: TodoTask) => void;
  /**
   * A subtask in a focus window of its own, as from the open card. Only
   * where there are windows to open: the desktop app.
   */
  subtaskFocus?: {
    isActive: (subtask: TodoTask) => boolean;
    toggle: (subtask: TodoTask) => void;
  };
  /** Who a subtask is for, from its assignee ids, as the open card shows them. */
  peopleOf?: (ids: string[]) => TodoPerson[];
  onExit: () => void;
};

/**
 * The Today session: one task at a time, in a window with nothing else in it.
 *
 * The queue is the Today column, in the order the board holds it. The first
 * task that is not done is the running one, and it carries the focus timer.
 * Skip sends it to the end. Done sends it to the list at the foot. When the
 * queue empties, the session says so.
 */
export function TodayFocusSession({
  tasks,
  t,
  lang,
  handlers,
  timerAlways = true,
  subtasksOf,
  renderChrome,
}: {
  /** Every task of the session, running order first, done ones included. */
  tasks: TodoTask[];
  /** A task's subtasks, open ones first, as the board orders them. */
  subtasksOf: (taskId: string) => TodoTask[];
  /**
   * The board card's controls for this task: the corner pill and the row
   * under the words (taskCardChrome), so the task in hand has them in the
   * same places as on the board.
   */
  /** A card's chrome; `now` for the task in hand (see taskCardChrome). */
  renderChrome: (task: TodoTask, now?: boolean) => {
    utilityPill: React.ReactNode;
    metaRow: React.ReactNode;
    anyOpen: boolean;
    /** "↳ Parent" above a step's name; null for a task. */
    parentLine?: React.ReactNode;
  };
  t: ReturnType<typeof makeT>;
  /** For a step's day on its second line. */
  lang: TodoLang;
  handlers: TodaySessionHandlers;
  /** Off: the timer shows only for a task with a duration. */
  timerAlways?: boolean;
}) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const celebrationRef = React.useRef<HTMLDivElement | null>(null);
  // In the Planner app the window shrinks to this column, at the screen's left.
  useSessionWindowFit(overlayRef);
  const [now, setNow] = React.useState(() => Date.now());
  const [sessionStart, setSessionStart] = React.useState(() => Date.now());
  /** When the clock was stopped, or null while it runs. */
  const [pausedAt, setPausedAt] = React.useState<number | null>(null);
  /** The task under the pointer, and the order the queue would take. */
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [previewIds, setPreviewIds] = React.useState<string[] | null>(null);
  const queueRef = React.useRef<HTMLDivElement | null>(null);
  /** When the last drag of a card ended: the click it ends with is not a click on the card. */
  const dragEndedAt = React.useRef(0);
  const addRef = React.useRef<HTMLInputElement | null>(null);
  /** The task in hand is between its tick and the next task: one tick only. */
  const completingRef = React.useRef(false);
  const [draft, setDraft] = React.useState("");
  /** Whether the ticked-off subtasks of the task in hand are shown. */
  const [showDoneSubtasks, setShowDoneSubtasks] = React.useState(false);

  /**
   * The task whose name is being rewritten, here as on the board: a click
   * on the words opens a box over them, Enter or leaving saves, Escape
   * puts the old name back.
   */
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editDraft, setEditDraft] = React.useState("");
  const editRef = React.useRef<HTMLTextAreaElement | null>(null);
  function resizeEdit(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }
  React.useLayoutEffect(() => {
    if (editingId) resizeEdit(editRef.current);
  }, [editingId, editDraft]);
  function startEdit(task: TodoTask) {
    setEditingId(task.id);
    setEditDraft(task.text);
  }
  function commitEdit() {
    const id = editingId;
    const text = editDraft.trim();
    setEditingId(null);
    if (!id || !text) return;
    const task = tasks.find((item) => item.id === id);
    if (task && text !== task.text) handlersRef.current.onEditText(task, text);
  }
  function editKeys(event: React.KeyboardEvent) {
    // Plain Enter saves; Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitEdit();
    }
    if (event.key === "Escape") setEditingId(null);
  }

  /**
   * Tick a task off the way the board does: the cheer over the box, and the
   * row carried down to Done rather than vanishing out of one list and
   * appearing in another.
   *
   * The copy is taken first, because telling the board is what takes the row
   * away. Then the board is told, and the row that arrives in Done is held
   * back until the copy reaches it — otherwise the same task is on screen
   * twice for the length of the flight.
   */
  async function completeWithCheer(
    task: TodoTask,
    row: HTMLElement | null,
    /*
      Whether a copy of the row flies down and comes to rest on its done row.

      A waiting row and a done row are the same row, so the copy of one lands
      on the other and the two are never both on screen. The card of the task
      in hand is several times the height of a done row, so it does not fly:
      it ticks in place (see below).
    */
    land: boolean
  ) {
    if (!row || prefersReducedMotion()) {
      handlersRef.current.onComplete(task);
      return;
    }
    spawnCompletionParty(row, {
      anchorSelector: ".today-session-check",
      textSelector: ".today-session-task-text",
    });
    if (!land) {
      /*
        The task in hand: no copy flies from it. The copy is drawn outside
        the session, so it lost the card's look, and it sat over the next
        task while its fade was left painted in the Mac app's web view
        (see webkit opacity). Here the box ticks and the cheer plays in
        place, and after a moment the next task takes the card.
      */
      if (completingRef.current) return;
      completingRef.current = true;
      const check = row.querySelector<HTMLElement>(".today-session-now-check");
      check?.classList.add("is-checked");
      row.classList.add("is-completing");
      try {
        await new Promise<void>((resolve) => window.setTimeout(resolve, NOW_TICK_HOLD_MS));
        handlersRef.current.onComplete(task);
      } finally {
        // React keeps these elements for the next task, and does not know
        // about the classes added here.
        check?.classList.remove("is-checked");
        row.classList.remove("is-completing");
        completingRef.current = false;
      }
      return;
    }
    const { startRect, wrap, ghost } = spawnTaskGhost(row);
    handlersRef.current.onComplete(task);

    const landed = await waitForElement(() =>
      document.querySelector<HTMLElement>(
        `.today-session-done .today-session-task.is-done[data-task-id="${CSS.escape(task.id)}"]`
      )
    );
    if (!landed) {
      wrap.remove();
      return;
    }
    await flyGhostTo({
      startRect,
      target: landed,
      wrap,
      ghost,
      hideTarget: land,
      receiver: document.querySelector<HTMLElement>(
        ".today-session-done-head"
      ),
    });
  }

  const openInOrder = tasks.filter((task) => !task.completed);
  const open = previewIds
    ? [
        ...openInOrder.slice(0, 1),
        ...previewIds
          .map((id) => openInOrder.find((task) => task.id === id))
          .filter((task): task is TodoTask => Boolean(task)),
      ]
    : openInOrder;
  const done = tasks.filter((task) => task.completed);
  const running = open[0] ?? null;
  /** What comes after the task in hand. */
  const queued = open.slice(1);
  const allDone = tasks.length > 0 && open.length === 0;

  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;
  /** The queue as it stands, for a drag that starts before the next render. */
  const openRef = React.useRef(openInOrder);
  openRef.current = openInOrder;
  const runningId = React.useRef<string | null>(null);
  runningId.current = openInOrder[0]?.id ?? null;

  // The running task's own base, so a task picked up twice adds up.
  const baseRef = React.useRef({ taskId: running?.id ?? "", spent: 0 });
  const startRef = React.useRef(sessionStart);
  startRef.current = sessionStart;
  const pausedAtRef = React.useRef(pausedAt);
  pausedAtRef.current = pausedAt;

  /** Time on this task's clock. A stopped clock reads what it stopped at. */
  const elapsedMs = React.useCallback(
    () => (pausedAtRef.current ?? Date.now()) - startRef.current,
    []
  );

  const persistRunning = React.useCallback(() => {
    const { taskId, spent } = baseRef.current;
    if (!taskId) return;
    const elapsed = Math.max(0, Math.floor(elapsedMs() / 1000));
    if (elapsed <= 0) return;
    handlersRef.current.onPersistTime(taskId, spent + elapsed);
  }, [elapsedMs]);

  // A new running task starts its own clock, and the one before it keeps the
  // time it was given.
  React.useEffect(() => {
    const id = running?.id ?? "";
    if (baseRef.current.taskId === id) return;
    persistRunning();
    baseRef.current = { taskId: id, spent: running?.timeSpentSeconds ?? 0 };
    setSessionStart(Date.now());
    setPausedAt(null);
    setNow(Date.now());
  }, [running?.id, running?.timeSpentSeconds, persistRunning]);

  // Tick, and save now and then so a crash costs at most one interval.
  React.useEffect(() => {
    if (!running || pausedAt !== null) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    const save = window.setInterval(persistRunning, PERSIST_INTERVAL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(save);
    };
  }, [running, pausedAt, persistRunning]);

  // Save on the way out, however the session ends.
  React.useEffect(() => {
    return () => {
      persistRunning();
    };
  }, [persistRunning]);

  const exit = React.useCallback(() => {
    persistRunning();
    handlersRef.current.onExit();
  }, [persistRunning]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      // Escape in the add-task box clears it first.
      if (target?.tagName === "INPUT" && (target as HTMLInputElement).value) {
        return;
      }
      // Escape in an edit box puts the old name back, not the board back.
      if (target?.tagName === "TEXTAREA") return;
      event.preventDefault();
      exit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exit]);

  // Paper on the last task of the day.
  const celebrated = React.useRef(false);
  React.useEffect(() => {
    if (!allDone) {
      celebrated.current = false;
      return;
    }
    if (celebrated.current) return;
    celebrated.current = true;
    spawnConfetti(celebrationRef.current);
  }, [allDone]);

  const doneCount = done.length;
  const total = tasks.length;
  const progress = total === 0 ? 0 : (doneCount / total) * 100;
  const { text: timerText, overtime } = running
    ? formatFocusTime(
        (pausedAt ?? now) - sessionStart,
        running.expectedDurationMinutes,
        { compact: true }
      )
    : { text: "", overtime: false };

  /**
   * Drag a task to another place in the queue, as the board's columns do it:
   * nothing happens under four pixels of movement, the rows part to show
   * where it will land, and the queue keeps that order when the pointer
   * lifts. The board is not touched — the order belongs to the session.
   */
  /**
   * A click on a card, anywhere but on one of its controls, opens the
   * task's details, as its name does on the board. Not the click that ends
   * a drag, nor one that ends a selection of the words, nor while the name
   * is being changed.
   */
  function openFromCard(event: React.MouseEvent, task: TodoTask) {
    const target = event.target as HTMLElement | null;
    if (target?.closest(CARD_CONTROLS) || dragEndedAt.current > Date.now() - 300) return;
    if (editingId === task.id || !window.getSelection()?.isCollapsed) return;
    handlersRef.current.onOpenDetails(task);
  }

  function startRowDrag(event: React.PointerEvent, task: TodoTask) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(CARD_CONTROLS)) return;
    // Stops the browser starting a text selection at the press. The rows
    // hold no focus and no caret, so there is nothing else this takes away.
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const openIds = openRef.current.slice(1).map((item) => item.id);
    let started = false;

    const onMove = (move: PointerEvent) => {
      if (!started) {
        if (
          Math.abs(move.clientX - startX) < 4 &&
          Math.abs(move.clientY - startY) < 4
        ) {
          return;
        }
        started = true;
        // A selection made before the press began must not travel with it.
        window.getSelection()?.removeAllRanges();
        setDraggingId(task.id);
      }
      const rows = Array.from(
        queueRef.current?.querySelectorAll<HTMLElement>(
          ":scope > .today-session-task"
        ) ?? []
      ).filter((row) => row.dataset.taskId !== task.id);
      let index = rows.length;
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i].getBoundingClientRect();
        if (move.clientY < rect.top + rect.height / 2) {
          index = i;
          break;
        }
      }
      const next = rows
        .map((row) => row.dataset.taskId)
        .filter((id): id is string => Boolean(id));
      next.splice(index, 0, task.id);
      setPreviewIds((prev) =>
        prev && prev.length === next.length && prev.every((v, i) => v === next[i])
          ? prev
          : next
      );
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDraggingId(null);
      if (started) dragEndedAt.current = Date.now();
      setPreviewIds((order) => {
        if (started && order && order.length === openIds.length) {
          handlersRef.current.onReorder(
            runningId.current ? [runningId.current, ...order] : order
          );
        }
        return null;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  /**
   * Stop the clock, or set it going again. Stopping banks the time first,
   * and starting again moves the clock's start by however long it stood.
   */
  function togglePaused() {
    if (pausedAt === null) {
      persistRunning();
      setPausedAt(Date.now());
      return;
    }
    setSessionStart((start) => start + (Date.now() - pausedAt));
    setPausedAt(null);
    setNow(Date.now());
  }

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    handlersRef.current.onAddTask(text, null);
  }

  const runningChrome = running ? renderChrome(running, true) : null;

  return (
    <div
      className="today-session"
      ref={overlayRef}
      /*
        The session is the whole window, so Tab walks its own controls and
        wraps at the end. WebKit gives Tab to text boxes alone, which left
        every button here out of reach. See `focus-walk`.
      */
      onKeyDown={(event) => {
        if (walkArrowStops(event, overlayRef.current, { wrap: true })) return;
        walkTabStops(event, overlayRef.current, { wrap: true });
      }}
      /*
        The session covers the title bar too, so in the Mac app the window
        is dragged by the empty space around the card instead. A press that
        does not move still clicks (Esc in the corner).
      */
      onPointerDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".today-session-card, button, input, textarea, a, [contenteditable]")) {
          return;
        }
        beginNativeWindowDragOnMove(event);
      }}
    >
      {/* In the corner of the whole window, and shown whenever the pointer is
          anywhere on it — see todo-shell.css. */}
      <button type="button" className="today-session-esc" onClick={exit}>
        {t("sessionEsc")}
      </button>
      <div
        className="today-session-card"
        // A text box matches :focus-visible however it was reached, so one
        // click in an empty add box would leave it on screen for good. Let
        // it go when the pointer leaves and nothing has been typed. A box
        // with words in it keeps both the caret and its place on screen.
        onPointerLeave={() => {
          if (draft) return;
          if (document.activeElement === addRef.current) addRef.current?.blur();
        }}
      >
        {/* The task in hand, said plainly, with what can be done to it. */}
        <div
          /*
            The task in hand is a card of its own: the same white the ones
            waiting are drawn on, lifted off the cream and given the room to
            be read first. Only while there is one — the cheer at the end of
            a session is a line on the card, not a card of its own.
          */
          className={`today-session-now${running ? " is-card task-item" : ""}${
            runningChrome?.anyOpen ? " has-open-menu" : ""
          }`}
          ref={celebrationRef}
          onClick={running ? (event) => openFromCard(event, running) : undefined}
        >
          {allDone ? (
            <p className="today-session-cheer">{t("sessionAllDone")}</p>
          ) : null}
          {running ? (
            <>
              {/* Focus and ⋮ in the corner, on hover, as on the cards waiting. */}
              {runningChrome?.utilityPill}
              {runningChrome?.parentLine}
              {/* The task in hand, ticked off where every other task on the
                  card is ticked off: a box on its left, in line with the
                  boxes of the ones waiting. It was a Done button under the
                  name, which is a second way of saying the one thing the
                  rows below say with a tick. */}
              <div className="today-session-now-head">
                <button
                  type="button"
                  className="today-session-check today-session-now-check"
                  aria-label={t("sessionComplete")}
                  onClick={(event) => {
                    persistRunning();
                    // The card, not the head it sits in: what leaves the top
                    // of the session is the whole card of the task in hand.
                    void completeWithCheer(
                      running,
                      event.currentTarget.closest(".today-session-now"),
                      false
                    );
                  }}
                />
                {editingId === running.id ? (
                  <textarea
                    ref={editRef}
                    autoFocus
                    className="today-session-now-title today-session-edit"
                    value={editDraft}
                    rows={1}
                    onChange={(event) => {
                      setEditDraft(event.target.value);
                      resizeEdit(event.currentTarget);
                    }}
                    onBlur={commitEdit}
                    onKeyDown={editKeys}
                  />
                ) : (
                  <h2
                    className="today-session-now-title"
                    // A click opens the task's details, as anywhere on the
                    // card (openFromCard); a double-click changes its name.
                    onDoubleClick={() => startEdit(running)}
                  >
                    {running.text}
                  </h2>
                )}
              </div>
              {/* What it carries: the day, who, and the list, by name. */}
              {runningChrome?.metaRow}
              {/* Its note, opened from Notes in the row above: above the
                  steps, next to what opened it. */}
              {handlersRef.current.renderNotes(running)}
              <SessionSubtasks
                subtasks={subtasksOf(running.id)}
                t={t}
                lang={lang}
                showDone={showDoneSubtasks}
                onShowDone={setShowDoneSubtasks}
                onToggle={(subtask) => handlersRef.current.onToggleSubtask(subtask)}
                focus={handlersRef.current.subtaskFocus}
                peopleOf={handlersRef.current.peopleOf}
                onToggleNotes={(subtask) => handlersRef.current.onToggleNotes(subtask)}
                renderNotes={(subtask) => handlersRef.current.renderNotes(subtask)}
                isNotesOpen={(subtask) => handlersRef.current.isNotesOpen(subtask)}
              />
              {/* Under a rule at the foot: Pause, Skip, and the clock. */}
              <div className="today-session-now-actions today-session-now-footer">
                <button
                  type="button"
                  className="today-session-pause"
                  onClick={togglePaused}
                >
                  {pausedAt === null ? (
                    <Pause size={14} strokeWidth={2.5} aria-hidden />
                  ) : (
                    <Play size={14} strokeWidth={2.5} aria-hidden />
                  )}
                  {pausedAt === null ? t("sessionPause") : t("sessionStart")}
                </button>
                {open.length > 1 ? (
                  <button
                    type="button"
                    className="today-session-skip"
                    onClick={() => handlersRef.current.onSkip(running)}
                  >
                    <ArrowRight size={14} strokeWidth={2.5} aria-hidden />
                    {t("sessionSkip")}
                  </button>
                ) : null}
                {focusTimerShown(timerAlways, running.expectedDurationMinutes) ? (
                  <span
                    className={`today-session-timer${overtime ? " overtime" : ""}`}
                  >
                    {timerText}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <div className="today-session-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <p className="today-session-count">
          {t("sessionProgress")
            .replace("{done}", String(doneCount))
            .replace("{total}", String(total))}
        </p>

        {/* The way out, under the count that says there is nothing left.
            With every task done the session has no next step, and the only
            way back was a small "esc to exit" in the far corner of the
            window. */}
        {allDone ? (
          <button type="button" className="today-session-back" onClick={exit}>
            {t("sessionBackToBoard")}
          </button>
        ) : null}

        {queued.length > 0 ? (
          <div className="today-session-upnext">
            <span>{t("sessionUpNext")}</span>
            <span className="today-session-upnext-rule" />
          </div>
        ) : null}

        <div className="today-session-queue" ref={queueRef}>
          {queued.map((task) => {
            const chrome = renderChrome(task);
            return (
            <React.Fragment key={task.id}>
              {/* A waiting task wears the board card's controls as the task
                  in hand does: the pill in the corner and the chips under
                  the words, both on hover. */}
              <div
                className={`today-session-task task-item${
                  draggingId === task.id ? " is-dragging" : ""
                }${chrome.anyOpen ? " has-open-menu" : ""}`}
                data-task-id={task.id}
                onPointerDown={(event) => startRowDrag(event, task)}
                onClick={(event) => openFromCard(event, task)}
              >
                {chrome.utilityPill}
                {chrome.parentLine}
                <div className="today-session-task-line">
                <button
                  type="button"
                  className="today-session-check"
                  aria-label={t("sessionComplete")}
                  onClick={(event) => {
                    persistRunning();
                    void completeWithCheer(
                      task,
                      event.currentTarget.closest(".today-session-task"),
                      true
                    );
                  }}
                />
                {editingId === task.id ? (
                  <textarea
                    ref={editRef}
                    autoFocus
                    className="today-session-task-text today-session-edit"
                    value={editDraft}
                    rows={1}
                    onChange={(event) => {
                      setEditDraft(event.target.value);
                      resizeEdit(event.currentTarget);
                    }}
                    onBlur={commitEdit}
                    onKeyDown={editKeys}
                  />
                ) : (
                  <span
                    className="today-session-task-text"
                    onDoubleClick={() => startEdit(task)}
                  >
                    {task.text}
                  </span>
                )}
                </div>
                {chrome.metaRow}
              </div>
              {handlersRef.current.renderNotes(task)}
            </React.Fragment>
            );
          })}

          <input
            ref={addRef}
            type="text"
            className={`today-session-add${draft ? " has-text" : ""}`}
            placeholder={t("addTaskPlaceholder")}
            maxLength={100}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitDraft();
              if (event.key === "Escape" && draft) setDraft("");
            }}
          />
        </div>

        {doneCount > 0 ? (
          <div className="today-session-done">
            <div className="today-session-done-head">
              <span>
                {t("sessionDoneCount").replace("{count}", String(doneCount))}
              </span>
              <span className="today-session-done-rule" />
            </div>
            {done.map((task) => (
              <div
                key={task.id}
                className="today-session-task is-done"
                data-task-id={task.id}
              >
                {/* The tick is a button here too: pressing it takes the
                    task back up. It was a mark to look at, so a task ticked
                    off by mistake could only be put right on the board. */}
                <button
                  type="button"
                  className="today-session-check is-checked"
                  aria-label={t("sessionUncomplete")}
                  title={t("sessionUncomplete")}
                  onClick={() => {
                    persistRunning();
                    handlersRef.current.onUncomplete(task);
                  }}
                />
                <span className="today-session-task-text">{task.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Everything the board lets you do to a task, in the row of the session.
 * Nothing here shows until the pointer is on the row — a session is for the
 * work, not for its marks — so an avatar or a duration is a control here,
 * not a label.
 */
/**
 * The steps of the task in hand, under its name.
 *
 * The session is where a task is worked through, so its steps belong on
 * the card: the ones still to do, each with the board's round tick, and
 * the done ones folded into one line that opens them. Names are edited
 * on the board or in the expanded card, not here.
 */
function SessionSubtasks({
  subtasks,
  t,
  lang,
  showDone,
  onShowDone,
  onToggle,
  focus,
  peopleOf,
  onToggleNotes,
  renderNotes,
  isNotesOpen,
}: {
  subtasks: TodoTask[];
  t: ReturnType<typeof makeT>;
  lang: TodoLang;
  showDone: boolean;
  onShowDone: (show: boolean) => void;
  onToggle: (subtask: TodoTask) => void;
  focus?: TodaySessionHandlers["subtaskFocus"];
  peopleOf?: TodaySessionHandlers["peopleOf"];
  /** A step's note opens under it, in the board's notes editor. */
  onToggleNotes: (subtask: TodoTask) => void;
  renderNotes: (subtask: TodoTask) => React.ReactNode;
  isNotesOpen: (subtask: TodoTask) => boolean;
}) {
  if (subtasks.length === 0) return null;
  const done = subtasks.filter((st) => st.completed);
  const shown = showDone ? subtasks : subtasks.filter((st) => !st.completed);
  return (
    <div className="today-session-subtasks task-subtask-list" aria-label={t("subtasks")}>
      {shown.map((subtask) => (
        <React.Fragment key={subtask.id}>
        <div
          className={`task-subtask-row${subtask.completed ? " is-done" : ""}`}
        >
          <button
            type="button"
            className={`task-subtask-check${subtask.completed ? " is-checked" : ""}`}
            aria-label={subtask.text}
            aria-pressed={subtask.completed}
            onClick={(e) => {
              if (!subtask.completed && !prefersReducedMotion()) {
                spawnCompletionParty(e.currentTarget, {
                  emoji: randomSubtaskPartyEmoji(),
                });
              }
              onToggle(subtask);
            }}
          >
            {subtask.completed ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : null}
          </button>
          <span className="task-subtask-text">{subtask.text}</span>
          {/* Its day, time and notes on a second line, when set, as in details. */}
          {!subtask.completed && (subtask.dueOn || subtask.expectedDurationMinutes != null || subtask.notesHtml) ? (
            <span className="today-session-subtask-meta">
              {subtask.dueOn ? (
                <span
                  className={`task-subtask-meta-item task-subtask-due${
                    (daysUntilDue(subtask.dueOn) ?? 2) <= 1 ? " is-soon" : ""
                  }`}
                >
                  <Calendar size={13} strokeWidth={2} aria-hidden />
                  {formatDueOnShort(subtask.dueOn, lang, t)}
                </span>
              ) : null}
              {subtask.expectedDurationMinutes != null ? (
                <span className="task-subtask-meta-item">
                  <Clock size={13} strokeWidth={2} aria-hidden />
                  {formatDurationShort(subtask.expectedDurationMinutes, t("minutes"), t("hoursShort"))}
                </span>
              ) : null}
              {subtask.notesHtml ? (
                <NotesChip
                  html={subtask.notesHtml}
                  open={isNotesOpen(subtask)}
                  onToggle={() => onToggleNotes(subtask)}
                  t={t}
                  className="task-subtask-meta-item is-button"
                />
              ) : null}
            </span>
          ) : null}
          {/* Who it is for, always there: on the first line, as the check is. */}
          {peopleOf && subtask.assigneeIds.length ? (
            <span className="today-session-subtask-people">
              <TaskAssigneeStack people={peopleOf(subtask.assigneeIds)} size={20} />
            </span>
          ) : null}
          {/* Shown on hover, as on the open card's subtasks. */}
          {focus && !subtask.completed ? (
            <span className="task-subtask-actions">
              <button
                type="button"
                className={`task-subtask-action task-subtask-focus${focus.isActive(subtask) ? " is-focusing" : ""}`}
                title={focus.isActive(subtask) ? "Exit focus mode" : "Focus on this task"}
                aria-label={focus.isActive(subtask) ? "Exit focus mode" : "Focus on this task"}
                onClick={() => focus.toggle(subtask)}
              >
                <FocusIcon />
              </button>
            </span>
          ) : null}
        </div>
        {/* Its note, in place, while open. */}
        {renderNotes(subtask)}
        </React.Fragment>
      ))}
      {done.length > 0 ? (
        <button
          type="button"
          className="today-session-subtasks-toggle"
          onClick={() => onShowDone(!showDone)}
        >
          {(showDone ? t("sessionHideDoneSubtasks") : t("sessionShowDoneSubtasks")).replace(
            "{n}",
            String(done.length)
          )}
        </button>
      ) : null}
    </div>
  );
}



/** A short burst of paper over the heading. Nothing to clean up but itself. */
function spawnConfetti(anchor: HTMLElement | null) {
  if (!anchor || typeof document === "undefined") return;
  const rect = anchor.getBoundingClientRect();
  const colours = ["#2a9d8f", "#e07b75", "#1e2d3e", "#f0c987", "#6aa9d8"];
  const layer = document.createElement("div");
  layer.className = "today-session-confetti";
  for (let i = 0; i < 24; i += 1) {
    const bit = document.createElement("span");
    const drift = (i % 2 === 0 ? 1 : -1) * (20 + ((i * 37) % 160));
    bit.style.left = `${rect.left + rect.width / 2}px`;
    bit.style.top = `${rect.top + 12}px`;
    bit.style.background = colours[i % colours.length];
    bit.style.setProperty("--drift", `${drift}px`);
    bit.style.setProperty("--spin", `${(i % 2 === 0 ? 1 : -1) * 240}deg`);
    bit.style.animationDelay = `${(i % 6) * 40}ms`;
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 1800);
}
