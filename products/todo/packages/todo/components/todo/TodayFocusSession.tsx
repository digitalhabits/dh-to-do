"use client";

import * as React from "react";
import { Pause, Play } from "lucide-react";

import { NotesIcon } from "@/components/todo/TodoPage";
import { TaskAssignMenu, TaskAssigneeStack } from "@/components/todo/TodoPeopleEditor";
import { walkArrowStops, walkTabStops } from "@/lib/todo/focus-walk";
import { focusTimerShown, formatFocusTime } from "@/lib/todo/focus-time";
import {
  flyGhostTo,
  prefersReducedMotion,
  spawnCompletionParty,
  randomSubtaskPartyEmoji,
  spawnTaskGhost,
  waitForElement,
} from "@/lib/todo/task-celebration";
import type { makeT } from "@/lib/todo/i18n";
import type { TodoPerson, TodoTask } from "@/lib/todo/types";

/** How often the running task's time is written back, as in the focus panel. */
const PERSIST_INTERVAL_MS = 30000;

export type TodaySessionHandlers = {
  /** Pop the task out into the floating focus window, or close that window. */
  onToggleFocus: (task: TodoTask) => void;
  /** Open or close the board's notes editor for this task. */
  onToggleNotes: (task: TodoTask) => void;
  /** The board's notes editor for this task, or null when it is shut. */
  renderNotes: (task: TodoTask) => React.ReactNode;
  onToggleAssignee: (taskId: string, personId: string) => void;
  onEditPeople: () => void;
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
  /** Open the task as the full-window expanded card, over the session. */
  onExpand: (task: TodoTask) => void;
  /** Tick a subtask of the task in hand, or take the tick back. */
  onToggleSubtask: (subtask: TodoTask) => void;
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
  handlers,
  canPopOut,
  focusTaskIds,
  people,
  assignEnabled = true,
  timerAlways = true,
  subtasksOf,
}: {
  /** Every task of the session, running order first, done ones included. */
  tasks: TodoTask[];
  /** A task's subtasks, open ones first, as the board orders them. */
  subtasksOf: (taskId: string) => TodoTask[];
  t: ReturnType<typeof makeT>;
  handlers: TodaySessionHandlers;
  /** Only a desktop shell has a window to pop a task into. */
  canPopOut: boolean;
  /** Tasks whose floating focus window is open. */
  focusTaskIds: Set<string>;
  /** The board's roster, for the assign menu. */
  people: TodoPerson[];
  /** Off, a task has no assign button. The setting is in TodoSettingsModal. */
  assignEnabled?: boolean;
  /** Off: the timer shows only for a task with a duration. */
  timerAlways?: boolean;
}) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const celebrationRef = React.useRef<HTMLDivElement | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [sessionStart, setSessionStart] = React.useState(() => Date.now());
  /** When the clock was stopped, or null while it runs. */
  const [pausedAt, setPausedAt] = React.useState<number | null>(null);
  /** The task under the pointer, and the order the queue would take. */
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [previewIds, setPreviewIds] = React.useState<string[] | null>(null);
  const queueRef = React.useRef<HTMLDivElement | null>(null);
  const addRef = React.useRef<HTMLInputElement | null>(null);
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
      Whether the copy comes to rest on the row it flies to, or fades on the
      way down.

      A waiting row and a done row are the same row, so the copy of one lands
      on the other and the two are never both on screen. The card of the task
      in hand is several times the height of a done row, and the flight
      carries a copy without resizing it — deliberately, because stretching a
      card stretches the words in it. So that one fades instead: it leaves
      towards Done rather than landing on it.
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
        running.expectedDurationMinutes
      )
    : { text: "", overtime: false };

  /**
   * Drag a task to another place in the queue, as the board's columns do it:
   * nothing happens under four pixels of movement, the rows part to show
   * where it will land, and the queue keeps that order when the pointer
   * lifts. The board is not touched — the order belongs to the session.
   */
  function startRowDrag(event: React.PointerEvent, task: TodoTask) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        /* Trix, not Quill, and a bare `[contenteditable]`: Trix does not
           spell the attribute "true", so a selection inside a note read as
           the start of a drag. */
        "input, button, a, textarea, select, [contenteditable]," +
          " trix-editor, .trix-notes-bubble, .assign-menu"
      )
    ) {
      return;
    }
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
          className={`today-session-now${running ? " is-card" : ""}`}
          ref={celebrationRef}
        >
          {allDone ? (
            <p className="today-session-cheer">{t("sessionAllDone")}</p>
          ) : null}
          {running ? (
            <>
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
                    onClick={() => startEdit(running)}
                  >
                    {running.text}
                  </h2>
                )}
              </div>
              <div className="today-session-now-actions">
                {open.length > 1 ? (
                  <button
                    type="button"
                    className="today-session-skip"
                    onClick={() => handlersRef.current.onSkip(running)}
                  >
                    {t("sessionSkip")} <span aria-hidden="true">→</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="today-session-pause"
                  onClick={togglePaused}
                >
                  {pausedAt === null ? (
                    <Pause size={13} strokeWidth={2.5} aria-hidden />
                  ) : (
                    <Play size={13} strokeWidth={2.5} aria-hidden />
                  )}
                  {pausedAt === null ? t("sessionPause") : t("sessionStart")}
                </button>
                {running.expectedDurationMinutes != null ? (
                  <SessionDuration
                    task={running}
                    t={t}
                    handlers={handlersRef}
                  />
                ) : null}
                {focusTimerShown(timerAlways, running.expectedDurationMinutes) ? (
                  <span
                    className={`today-session-timer${overtime ? " overtime" : ""}`}
                  >
                    {timerText}
                  </span>
                ) : null}
                <SessionTaskControls
                  task={running}
                  t={t}
                  people={people}
                  assignEnabled={assignEnabled}
                  canPopOut={canPopOut}
                  focusOpen={focusTaskIds.has(running.id)}
                  handlers={handlersRef}
                  inline
                />
              </div>
              <SessionSubtasks
                subtasks={subtasksOf(running.id)}
                t={t}
                showDone={showDoneSubtasks}
                onShowDone={setShowDoneSubtasks}
                onToggle={(subtask) => handlersRef.current.onToggleSubtask(subtask)}
              />
              {handlersRef.current.renderNotes(running)}
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

        {queued.length > 0 ? (
          <div className="today-session-upnext">
            <span>{t("sessionUpNext")}</span>
            <span className="today-session-upnext-rule" />
          </div>
        ) : null}

        <div className="today-session-queue" ref={queueRef}>
          {queued.map((task) => (
            <React.Fragment key={task.id}>
              <div
                className={`today-session-task${
                  draggingId === task.id ? " is-dragging" : ""
                }`}
                data-task-id={task.id}
                onPointerDown={(event) => startRowDrag(event, task)}
              >
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
                    onClick={() => startEdit(task)}
                  >
                    {task.text}
                  </span>
                )}
                {/* What the task carries, at the end of the row. The controls
                    come over these when the pointer is on the row. */}
                <span className="today-session-marks">
                  {task.notesHtml ? (
                    <button
                      type="button"
                      className="notes-btn has-notes"
                      title={t("notes")}
                      onClick={() =>
                        handlersRef.current.onToggleNotes(task)
                      }
                    >
                      <NotesIcon />
                    </button>
                  ) : null}
                  {task.expectedDurationMinutes != null ? (
                    <SessionDuration task={task} t={t} handlers={handlersRef} />
                  ) : null}
                </span>
                <SessionTaskControls
                  task={task}
                  t={t}
                  people={people}
                  assignEnabled={assignEnabled}
                  canPopOut={canPopOut}
                  focusOpen={focusTaskIds.has(task.id)}
                  handlers={handlersRef}
                />
              </div>
              {handlersRef.current.renderNotes(task)}
            </React.Fragment>
          ))}

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
  showDone,
  onShowDone,
  onToggle,
}: {
  subtasks: TodoTask[];
  t: ReturnType<typeof makeT>;
  showDone: boolean;
  onShowDone: (show: boolean) => void;
  onToggle: (subtask: TodoTask) => void;
}) {
  if (subtasks.length === 0) return null;
  const done = subtasks.filter((st) => st.completed);
  const shown = showDone ? subtasks : subtasks.filter((st) => !st.completed);
  return (
    <div className="today-session-subtasks task-subtask-list" aria-label={t("subtasks")}>
      {shown.map((subtask) => (
        <div
          key={subtask.id}
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
        </div>
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

function SessionTaskControls({
  task,
  t,
  people,
  assignEnabled,
  canPopOut,
  focusOpen,
  handlers,
  inline = false,
}: {
  task: TodoTask;
  t: ReturnType<typeof makeT>;
  people: TodoPerson[];
  assignEnabled: boolean;
  canPopOut: boolean;
  focusOpen: boolean;
  handlers: React.MutableRefObject<TodaySessionHandlers>;
  /** In the running block the cluster sits in the flow of the buttons. */
  inline?: boolean;
}) {
  const assignRef = React.useRef<HTMLButtonElement | null>(null);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const assignees = people.filter((person) =>
    task.assigneeIds.includes(person.id)
  );

  React.useEffect(() => {
    if (!assignOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (assignRef.current?.contains(event.target as Node)) return;
      setAssignOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [assignOpen]);

  return (
    <div
      className={`today-session-controls${inline ? " is-inline" : ""}`}
    >
      <button
        type="button"
        className="notes-btn today-session-expand"
        title={t("expandTask")}
        aria-label={t("expandTask")}
        onClick={() => handlers.current.onExpand(task)}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
      <button
        type="button"
        className={`notes-btn${task.notesHtml ? " has-notes" : ""}`}
        title={t("notes")}
        onClick={() => handlers.current.onToggleNotes(task)}
      >
        <NotesIcon />
      </button>

      <SessionDuration task={task} t={t} handlers={handlers} />

      {assignEnabled ? (
        <div className="assign-menu-wrap">
          <button
            ref={assignRef}
            type="button"
            className={`assign-btn${assignees.length ? " has-assignee" : ""}`}
            title={t("assignPerson")}
            onClick={() => setAssignOpen((open) => !open)}
          >
            {assignees.length ? (
              <TaskAssigneeStack people={assignees} size={22} />
            ) : (
              <SessionPersonIcon />
            )}
          </button>
          <TaskAssignMenu
            open={assignOpen}
            anchorEl={assignOpen ? assignRef.current : null}
            people={people}
            assigneeIds={task.assigneeIds}
            t={t}
            onToggle={(personId) =>
              handlers.current.onToggleAssignee(task.id, personId)
            }
            onEditPeople={() => {
              setAssignOpen(false);
              handlers.current.onEditPeople();
            }}
            onClose={() => setAssignOpen(false)}
          />
        </div>
      ) : null}

      {canPopOut ? (
        <button
          type="button"
          className={`focus-btn today-session-focus${
            focusOpen ? " active-focus is-open" : ""
          }`}
          title={focusOpen ? t("exitFocusMode") : t("focusMode")}
          onClick={() => handlers.current.onToggleFocus(task)}
        >
          <FocusRingIcon />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The minutes a task is expected to take. A task that carries one says so at
 * all times, as a board card does. A task that carries none offers the clock
 * with the other controls, under the pointer.
 */
function SessionDuration({
  task,
  t,
  handlers,
}: {
  task: TodoTask;
  t: ReturnType<typeof makeT>;
  handlers: React.MutableRefObject<TodaySessionHandlers>;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  function commit() {
    const minutes = Number.parseInt(draft, 10);
    handlers.current.onSetDuration(
      task,
      Number.isFinite(minutes) && minutes > 0 ? minutes : null
    );
    setOpen(false);
  }

  if (open) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        max={999}
        className="task-duration-input"
        style={{ width: 52 }}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setOpen(false);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="task-meta today-session-duration"
      title="Add duration"
      onClick={() => {
        setDraft(
          task.expectedDurationMinutes
            ? String(task.expectedDurationMinutes)
            : ""
        );
        setOpen(true);
      }}
    >
      {task.expectedDurationMinutes
        ? `${task.expectedDurationMinutes}${t("minutes")}`
        : <SessionClockIcon />}
    </button>
  );
}

function SessionClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 6v6l3.644 1.822" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
      <path d="M21.92 13.267a10 10 0 1 0-8.653 8.653" />
    </svg>
  );
}

function SessionPersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/** The board's focus mark, so the two buttons read as the same thing. */
function FocusRingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </svg>
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
