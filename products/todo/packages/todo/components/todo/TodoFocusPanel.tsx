"use client";

import * as React from "react";

import {
  beginNativeWindowDragOnMove,
  closeFocusPopout,
  enterFullscreenFocus,
  exitFullscreenFocus,
  exitFullscreenFocusToHome,
  isNativeShell,
  listenFocusOpen,
  notifyFocusPanelTask,
  setFocusPopoutHeight,
  signalFocusPanelReady,
} from "@/lib/native-shell";
import { pendingAttachments } from "@/lib/todo/basecamp-richtext";
import { loadTrix, TrixNotesEditor } from "@/components/todo/TrixNotesEditor";
import { resolveBasecampImage } from "@/lib/todo/basecamp-image";
import {
  clearFocusSession,
  currentNavigationKind,
  focusSessionKey,
  readFocusSession,
  writeFocusSession,
  type FocusSessionRecord,
} from "@/lib/todo/focus-session";
import { walkArrowStops, walkTabStops } from "@/lib/todo/focus-walk";
import {
  FOCUS_TIMER_ALWAYS_KEY,
  FOCUS_TIMER_PREF_MESSAGE,
  focusTimerShown,
  formatFocusTime,
  readFocusTimerAlways,
} from "@/lib/todo/focus-time";
import { makeT, type TodoLang } from "@/lib/todo/i18n";
import {
  BOARD_TASK_CHANGED_MESSAGE,
  FOCUS_CHANNEL,
  boardColumnOf,
  type TodoBoardColumn,
  type TodoState,
  type TodoTask,
} from "@/lib/todo/types";

/**
 * The notes editor, which is a chunk of its own.
 *
 * The import is named so the warm-up below and the component share one module
 * promise: asking twice is asking once, and the second caller waits on the
 * fetch the first one started.
 */
// A focus window is its own document, so it warms its own copy.

function useWarmNotesEditor() {
  React.useEffect(() => {
    // The editor's own loader — see loadTrix for why it is not an import.
    const id = window.setTimeout(() => void loadTrix().catch(() => {}), 300);
    return () => window.clearTimeout(id);
  }, []);
}

export const FOCUS_PERSIST_INTERVAL_MS = 30000;

/** The window the shell opens: the bar alone, with a little chrome room. */
const FOCUS_PANEL_MIN_HEIGHT = 56;
/** The gap the CSS leaves between the bar and an open menu. */
const FOCUS_PANEL_CONTENT_GAP = 6;
/** Matches the shell clamp, so the measurement never asks for more. */
const FOCUS_PANEL_MAX_HEIGHT = 640;

/**
 * Text entry keeps its own pointer. A press-and-drag inside the search box
 * or the notes editor selects text, and must not move the window.
 */
const FOCUS_PANEL_NO_DRAG =
  'input, textarea, select, [contenteditable="true"], trix-editor, trix-toolbar, .ql-editor, .ql-toolbar, .focus-task-switch-menu, .focus-notes-container';

export type TodoFocusApi = (
  path: string,
  method: string,
  body?: unknown
) => Promise<Record<string, unknown>>;

/** The planner's data path: the To-Do routes over fetch. */
async function fetchApi(
  path: string,
  method: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((json.error as string) || `Request failed (${res.status})`);
  }
  return json;
}

export function TodoFocusPanel({
  initialTaskId,
  initialTitle,
  initialDurationMinutes = null,
  initialFullscreen = false,
  initialElapsedMs = 0,
  slot = 1,
  api = fetchApi,
}: {
  /**
   * Empty when the shell pre-loads the panel hidden (`?prewarm=1`). The
   * panel then waits for a `focus-open` event before it shows a task.
   */
  initialTaskId: string;
  /** From the open URL so the bar shows a name before /api/todo/state returns. */
  initialTitle?: string;
  initialDurationMinutes?: number | null;
  initialFullscreen?: boolean;
  initialElapsedMs?: number;
  /**
   * Which of the shell's panels this is. The planner keeps two, so two
   * tasks can be up at once; the second wears the light cream so the pair
   * tell apart at a glance. Anything but 2 is the first.
   */
  slot?: number;
  /**
   * How the panel reads and writes tasks. The planner uses the default, the
   * To-Do routes over fetch. The standalone app passes its SQLite host API,
   * because the panel is a second webview with no server behind it.
   */
  api?: TodoFocusApi;
}) {
  useWarmNotesEditor();
  const [state, setState] = React.useState<TodoState | null>(null);
  const [taskId, setTaskId] = React.useState(initialTaskId);
  const [titleHint, setTitleHint] = React.useState(initialTitle ?? "");
  const [durationHint, setDurationHint] = React.useState<number | null>(
    initialDurationMinutes
  );
  const [fullscreen, setFullscreen] = React.useState(initialFullscreen);
  const [now, setNow] = React.useState(() => Date.now());
  const [sessionStart, setSessionStart] = React.useState(
    () => Date.now() - initialElapsedMs
  );
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [notesDraft, setNotesDraft] = React.useState("");
  const [switchOpen, setSwitchOpen] = React.useState(false);
  const [switchQuery, setSwitchQuery] = React.useState("");
  /** The list the switcher is browsing; null until it opens. */
  const [switchListId, setSwitchListId] = React.useState<string | null>(null);
  /**
   * The board's own settings, read from the storage the board keeps them
   * in when the switcher opens: with the board on, a list's tasks are shown
   * under its columns; with Someday on, that column is one of them.
   */
  const [switchBoard, setSwitchBoard] = React.useState({
    kanban: true,
    someday: false,
  });
  const [resetToast, setResetToast] = React.useState<number | null>(null);
  const [closed, setClosed] = React.useState(false);
  /** Tasks up in the other panel, kept out of this one's switcher. */
  /**
    "Always show timer in Focus Mode", from Settings. Read after mount, as
    the page is drawn once with no storage to read. The board tells an open
    window of a change on the channel. The storage event is a second way in.
  */
  const [timerAlways, setTimerAlways] = React.useState(true);
  React.useEffect(() => {
    setTimerAlways(readFocusTimerAlways());
    const onStorage = (e: StorageEvent) => {
      if (e.key === FOCUS_TIMER_ALWAYS_KEY) setTimerAlways(e.newValue !== "0");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const [focusedElsewhere, setFocusedElsewhere] = React.useState<Set<string>>(
    () => new Set()
  );
  const [lang, setLang] = React.useState<TodoLang>("en");
  /* The window itself, for the Tab walk over its buttons. */
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const switchMenuRef = React.useRef<HTMLDivElement | null>(null);
  const notesRef = React.useRef<HTMLDivElement | null>(null);
  const draggedRef = React.useRef(false);
  const channelRef = React.useRef<BroadcastChannel | null>(null);
  const persistedRef = React.useRef({ taskId: initialTaskId, baseSpent: 0 });
  const pendingPersistRef = React.useRef<Promise<void> | null>(null);
  /**
   * The session this window is showing, kept in storage so a reload of
   * the page gives it back. The shell loads its panels with no task in the
   * address and hands one over by an event; a reload would otherwise leave
   * the panel waiting for an event that already went.
   */
  const sessionKey = focusSessionKey(slot, initialFullscreen);
  const sessionRecordRef = React.useRef<FocusSessionRecord | null>(null);
  /** What a reload found in storage, read before the timer is pointed. */
  const restoredRef = React.useRef<FocusSessionRecord | null | undefined>(undefined);

  const t = React.useMemo(() => makeT(lang), [lang]);
  const task = state?.tasks.find((candidate) => candidate.id === taskId) ?? null;
  const displayTitle = task?.text || titleHint || "…";
  const displayDuration =
    task?.expectedDurationMinutes ?? durationHint ?? null;

  React.useEffect(() => {
    try {
      const l = localStorage.getItem("redd-plan-todo-lang");
      if (l === "da" || l === "en") setLang(l);
    } catch {
      /* ignore */
    }
  }, []);

  const loadState = React.useCallback(async () => {
    const json = await api("/api/todo/state", "GET");
    const loaded = json.state as TodoState | undefined;
    // Now and then the answer is not the board: a session being renewed
    // sends the request through a sign-in handshake and back with a page,
    // which reads as an empty object. Say so rather than hand back nothing
    // for the caller to read `.tasks` off.
    if (!loaded?.tasks) throw new Error("The board did not answer.");
    setState(loaded);
    return loaded;
  }, [api]);

  /**
   * Point the timer at a task: read the board so `timeSpentSeconds` becomes
   * the base, minus what a fullscreen/panel handoff already persisted, so
   * the display keeps running without double-counting.
   */
  const beginSession = React.useCallback(
    (id: string, elapsedMs: number) => {
      persistedRef.current = { taskId: id, baseSpent: 0 };
      // A task pointed at again is a task worth trying again: it may be the
      // one that had gone, put back by an undo on the tab.
      goneRef.current = null;
      // A save from the session that just ended may still be in flight.
      // Read after it lands, or the base misses that session and the next
      // save overwrites it.
      const pending = pendingPersistRef.current ?? Promise.resolve();
      void pending
        .then(loadState)
        .then((loaded) => {
          if (persistedRef.current.taskId !== id) return;
          const current = loaded.tasks.find((candidate) => candidate.id === id);
          const handedOver = Math.floor(elapsedMs / 1000);
          persistedRef.current = {
            taskId: id,
            baseSpent: Math.max(0, (current?.timeSpentSeconds ?? 0) - handedOver),
          };
        })
        // No board to read: the base stays at nought and the timer runs on
        // from what was handed over. The next save reads the board again.
        .catch(() => {});
    },
    [loadState]
  );

  // After a reload, take up the session the page was showing. Runs before
  // the effect below so a task from the address keeps its running time.
  React.useEffect(() => {
    if (restoredRef.current !== undefined) return;
    const saved = readFocusSession(localStorage, sessionKey, {
      now: Date.now(),
      navigation: currentNavigationKind(),
    });
    restoredRef.current = saved;
    if (!saved || initialTaskId) return;
    setTaskId(saved.taskId);
    setTitleHint(saved.title);
    setDurationHint(saved.durationMinutes);
    setSessionStart(saved.sessionStart);
    setNow(Date.now());
    beginSession(saved.taskId, Math.max(0, Date.now() - saved.sessionStart));
  }, [beginSession, initialTaskId, sessionKey]);

  React.useEffect(() => {
    if (!initialTaskId) return;
    const saved = restoredRef.current;
    if (saved && saved.taskId === initialTaskId) {
      // The same task, reloaded: its time carries on from where it was.
      setSessionStart(saved.sessionStart);
      beginSession(initialTaskId, Math.max(0, Date.now() - saved.sessionStart));
      return;
    }
    beginSession(initialTaskId, initialElapsedMs);
  }, [beginSession, initialTaskId, initialElapsedMs]);

  // What this window shows, for a reload to find. Gone once it closes.
  React.useEffect(() => {
    if (closed || !taskId) {
      sessionRecordRef.current = null;
      clearFocusSession(localStorage, sessionKey);
      return;
    }
    const record: FocusSessionRecord = {
      taskId,
      title: task?.text || titleHint,
      durationMinutes: task?.expectedDurationMinutes ?? durationHint,
      sessionStart,
      savedAt: Date.now(),
    };
    sessionRecordRef.current = record;
    writeFocusSession(localStorage, sessionKey, record);
  }, [
    closed,
    taskId,
    task?.text,
    task?.expectedDurationMinutes,
    titleHint,
    durationHint,
    sessionStart,
    sessionKey,
  ]);

  // The planner shell keeps this panel alive and re-targets it with an event
  // (redd-do's `enter-focus-mode`). Subscribe first, then tell the shell —
  // an event sent before the listener exists is lost.
  React.useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listenFocusOpen((payload) => {
      const prevTaskId = persistedRef.current.taskId;
      if (prevTaskId && prevTaskId !== payload.taskId) {
        channelRef.current?.postMessage({
          type: "focus-ended",
          taskId: prevTaskId,
        });
      }
      setTaskId(payload.taskId);
      setTitleHint(payload.title);
      setDurationHint(payload.durationMinutes ?? null);
      setSessionStart(Date.now() - (payload.elapsedMs || 0));
      setNow(Date.now());
      setFullscreen(false);
      setNotesOpen(false);
      setSwitchOpen(false);
      setSwitchQuery("");
      setResetToast(null);
      setClosed(false);
      beginSession(payload.taskId, payload.elapsedMs || 0);
      // The [taskId] effect announces a new task. A reopen of the same task
      // must announce too, because closing announced the end.
      channelRef.current?.postMessage({
        type: "focus-started",
        taskId: payload.taskId,
      });
    }).then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      void signalFocusPanelReady();
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [beginSession]);

  /**
   * A task this panel can no longer write to.
   *
   * The board answers 404 for a task that is not there — completed and
   * cleared, or deleted from the tab while the timer ran. The save runs
   * every few seconds, so without this it asks again for as long as the
   * panel is open, and every one of those was swallowed whole: the console
   * filled with 404s and nothing said which task or why.
   */
  const goneRef = React.useRef<string | null>(null);

  const persistTime = React.useCallback(
    async (extra?: { completed?: boolean }) => {
      const { taskId: id, baseSpent } = persistedRef.current;
      if (!id || goneRef.current === id) return;
      const elapsed = Math.max(
        0,
        Math.floor((Date.now() - sessionStart) / 1000)
      );
      const write = api("/api/todo/tasks", "PATCH", {
        id,
        timeSpentSeconds: baseSpent + elapsed,
        ...(extra?.completed ? { completed: true } : {}),
      })
        .then(() => {
          channelRef.current?.postMessage({ type: "task-updated" });
        })
        .catch((err: unknown) => {
          const said = err instanceof Error ? err.message : String(err);
          if (/task not found/i.test(said)) {
            goneRef.current = id;
            console.warn(
              `[focus] the task being timed is no longer on the board (${id}) — time is not being saved`
            );
            return;
          }
          // Anything else is worth one line. A window on its way out drops
          // the request it was making, and that is the one this used to be
          // written for — but it is not the only thing that lands here.
          console.warn("[focus] couldn't save the time spent:", said);
        });
      pendingPersistRef.current = write;
      await write;
    },
    [api, sessionStart]
  );

  // Timer tick + periodic crash-resilient persistence, as in redd-do.
  // Stops when the panel is "closed" — on macOS the NSPanel is hidden rather
  // than destroyed, so the page keeps running until the next open reloads it.
  React.useEffect(() => {
    if (closed || !taskId) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    const persist = window.setInterval(() => {
      void persistTime();
      const record = sessionRecordRef.current;
      if (record) {
        writeFocusSession(localStorage, sessionKey, { ...record, savedAt: Date.now() });
      }
    }, FOCUS_PERSIST_INTERVAL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(persist);
    };
  }, [persistTime, closed, taskId, sessionKey]);

  // Cross-window channel: announce focus, obey exit requests from the tab.
  React.useEffect(() => {
    const channel = new BroadcastChannel(FOCUS_CHANNEL);
    channelRef.current = channel;
    if (taskId) channel.postMessage({ type: "focus-started", taskId });
    channel.onmessage = (e) => {
      const msg = e.data as { type: string; taskId?: string; always?: boolean };
      if (msg.type === FOCUS_TIMER_PREF_MESSAGE) {
        setTimerAlways(msg.always !== false);
      } else if (msg.type === BOARD_TASK_CHANGED_MESSAGE && msg.taskId) {
        // The board changed a task: new text, new duration. Take the values
        // as they are.
        const changed = (msg as { task?: TodoTask }).task;
        const changedId = msg.taskId;
        // The hints too: they are what shows when the board was never read.
        if (changed && changedId === taskId) {
          setTitleHint(changed.text);
          setDurationHint(changed.expectedDurationMinutes ?? null);
        }
        setState((prev) => {
          if (!prev || !changed) return prev;
          return {
            ...prev,
            tasks: prev.tasks.map((candidate) =>
              candidate.id === changedId ? { ...candidate, ...changed } : candidate
            ),
          };
        });
      } else if (msg.type === "focus-exit-request" && msg.taskId === taskId) {
        void exitFocus();
      } else if (msg.type === "focus-started" && msg.taskId) {
        // The other panel's task. A channel never echoes to its sender, so
        // this is never this panel's own.
        const started = msg.taskId;
        setFocusedElsewhere((prev) => new Set(prev).add(started));
      } else if (msg.type === "focus-ended" && msg.taskId) {
        const ended = msg.taskId;
        setFocusedElsewhere((prev) => {
          if (!prev.has(ended)) return prev;
          const next = new Set(prev);
          next.delete(ended);
          return next;
        });
      }
    };
    const onBeforeUnload = () => {
      if (taskId) channel.postMessage({ type: "focus-ended", taskId });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (taskId) channel.postMessage({ type: "focus-ended", taskId });
      channel.close();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  React.useEffect(() => {
    if (displayTitle && displayTitle !== "…") document.title = displayTitle;
  }, [displayTitle]);

  // The shell routes a press for a task that is already up to the panel
  // holding it, so it hears about every change, the switcher's included.
  React.useEffect(() => {
    if (taskId) void notifyFocusPanelTask(taskId);
  }, [taskId]);

  function announceFocusEnded() {
    // Native panels are hidden, not destroyed, so React may stay mounted.
    // Tell the To-Do tab immediately — do not wait for unmount/beforeunload.
    channelRef.current?.postMessage({ type: "focus-ended", taskId });
  }

  async function closeWindow() {
    setClosed(true);
    announceFocusEnded();
    if (isNativeShell()) {
      // Do not await — hide must feel instant (redd-do sends IPC and returns).
      void closeFocusPopout().catch(() => {
        window.close();
      });
      return;
    }
    window.close();
  }

  /** Native panels stay alive when hidden, so save can finish after hide.
   *  Browser popups must save first or the PATCH dies with the window. */
  async function saveThenClose(extra?: { completed?: boolean }) {
    /*
      A fullscreen focus is a window of its own, not the panel, and the
      panel's hide refuses any window that is not a panel. The page's own
      close does nothing in the desktop app either, so the tick in
      fullscreen saved the task and then left the window standing, as if
      the press had done nothing. It leaves the way the home button does:
      the fullscreen window closes and the app comes back to the front.
    */
    if (isNativeShell() && fullscreen && taskId) {
      void persistTime(extra);
      setClosed(true);
      announceFocusEnded();
      void exitFullscreenFocusToHome({ taskId });
      return;
    }
    if (isNativeShell()) {
      // Hide first, as redd-do does: the panel is kept alive hidden, so
      // the save finishes behind it, and the board — told already, for a
      // completion — plays the tick while this window is already gone.
      void persistTime(extra);
      await closeWindow();
      return;
    }
    await persistTime(extra);
    await closeWindow();
  }

  async function exitFocus() {
    await saveThenClose();
  }

  async function completeTask() {
    /*
      Told to the board as well as to the server.

      A task made on the All tab lives in the board's own storage until it
      is put on a list, and the server answers 404 for it — so the tick
      here saved nothing, and the task stayed open on the board. The board
      knows every task it shows and completes them by its own path, local
      or not; the write below still goes for a board that is not open.
    */
    const { taskId: id, baseSpent } = persistedRef.current;
    if (id) {
      const elapsed = Math.max(0, Math.floor((Date.now() - sessionStart) / 1000));
      channelRef.current?.postMessage({
        type: "task-complete",
        taskId: id,
        timeSpentSeconds: baseSpent + elapsed,
      });
    }
    await saveThenClose({ completed: true });
  }

  function resetTimer() {
    setResetToast(sessionStart);
    // The clock and the start move together. Moved alone, the start stood
    // ahead of a clock that had not ticked since — and a clock stopped by a
    // close that did not happen never would — so the timer read negative.
    const at = Date.now();
    setNow(at);
    setSessionStart(at);
    window.setTimeout(() => setResetToast(null), 5000);
  }

  /** Fullscreen focus: native shells swap windows (redd-do's handoff);
   *  browsers toggle the Fullscreen API on the popup itself. */
  async function toggleFullscreen() {
    // The window knows its task from its address before the board is read.
    // With `task` alone, a press in that first moment did nothing at all.
    if (!taskId) return;
    const target = {
      id: taskId,
      text: displayTitle,
      expectedDurationMinutes: task?.expectedDurationMinutes ?? displayDuration ?? null,
    };
    const elapsedMs = Date.now() - sessionStart;
    if (isNativeShell()) {
      void persistTime();
      setClosed(true);
      try {
        if (fullscreen) {
          void exitFullscreenFocus({
            taskId: target.id,
            title: target.text,
            elapsedMs,
            durationMinutes: target.expectedDurationMinutes,
          });
        } else {
          void enterFullscreenFocus({
            taskId: target.id,
            title: target.text,
            elapsedMs,
            durationMinutes: target.expectedDurationMinutes,
          });
        }
        return;
      } catch {
        setClosed(false); // older shell build — stay in this window
      }
    }
    if (!fullscreen) {
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        /* browser refused — still show the fullscreen layout */
      }
      setFullscreen(true);
    } else {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          /* ignore */
        }
      }
      setFullscreen(false);
    }
  }

  async function exitToHome() {
    if (!task) return;
    if (isNativeShell()) {
      void persistTime();
      setClosed(true);
      announceFocusEnded();
      void exitFullscreenFocusToHome({ taskId: task.id });
      return;
    }
    await persistTime();
    setClosed(true);
    announceFocusEnded();
    window.close();
  }

  function switchToTask(next: TodoTask) {
    void persistTime().then(() => {
      persistedRef.current = {
        taskId: next.id,
        baseSpent: next.timeSpentSeconds,
      };
      channelRef.current?.postMessage({ type: "focus-ended", taskId });
      setTaskId(next.id);
      setTitleHint(next.text);
      setDurationHint(next.expectedDurationMinutes);
      setSessionStart(Date.now());
      setSwitchOpen(false);
      setSwitchQuery("");
      channelRef.current?.postMessage({ type: "focus-started", taskId: next.id });
    });
  }

  function toggleNotes() {
    if (!task) return;
    if (notesOpen) {
      saveNotes();
      return;
    }
    setNotesDraft(task.notesHtml ?? "");
    setNotesOpen(true);
  }

  function saveNotes() {
    if (!task) return;
    const html = notesDraft;
    /*
      A picture Basecamp has not answered for has no sgid, and the shape a
      save writes keeps the sgid and nothing else — so saving drops it, and
      the picture goes from the note and from Basecamp's copy of it with
      nothing said. The board's editor has refused this since it was
      written; this window never did, and a note is a note wherever it is
      opened. Keeping it shut is the whole of the fix: nothing is written,
      so nothing is lost.
    */
    if (pendingAttachments(html) > 0) {
      return;
    }
    const isEmpty = !html || html === "<p><br></p>";
    setNotesOpen(false);
    void api("/api/todo/tasks", "PATCH", {
      id: task.id,
      notesHtml: isEmpty ? null : html,
    }).then(() => {
      channelRef.current?.postMessage({ type: "task-updated" });
      void loadState().catch(() => {});
    });
  }

  /**
   * Fit the window to the bar plus whatever is open under it. The shell
   * opens the panel at the height of the bar, so an open task list or the
   * notes editor draws outside the window and nothing appears to happen.
   * A fullscreen focus window owns the whole screen and needs none of this.
   */
  React.useEffect(() => {
    if (fullscreen) return;
    if (!isNativeShell()) return;
    let stopped = false;

    const fit = () => {
      if (stopped) return;
      // scrollHeight as well as offsetHeight: a panel the flex box has
      // squeezed still reports what it wants to be.
      const natural = (el: HTMLElement | null) =>
        el ? Math.max(el.offsetHeight, el.scrollHeight) : 0;
      const bar = barRef.current?.offsetHeight || 48;
      const menu = natural(switchMenuRef.current);
      const notes = natural(notesRef.current);
      const open = menu + notes;
      const target = Math.min(
        Math.max(
          bar + (open > 0 ? open + FOCUS_PANEL_CONTENT_GAP * 2 : 0),
          FOCUS_PANEL_MIN_HEIGHT
        ),
        FOCUS_PANEL_MAX_HEIGHT
      );
      void setFocusPopoutHeight(target);
    };

    // Measure after the browser lays the new panel out, not during render.
    const frame = window.requestAnimationFrame(fit);

    /*
      The list grows and shrinks as the search narrows it, and the notes
      editor grows as somebody types. Both change height without a render
      that this effect sees, so watch the elements themselves.
    */
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    if (switchMenuRef.current) observer?.observe(switchMenuRef.current);
    if (notesRef.current) observer?.observe(notesRef.current);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [fullscreen, switchOpen, notesOpen]);

  /**
   * Drag the panel from anywhere on it, which is what redd-do does on macOS.
   * `data-tauri-drag-region` on the bar swallows the first click on the
   * buttons inside it, so the drag starts from JavaScript instead: a press
   * that moves drags the window, and a press that does not still clicks.
   */
  function startPanelDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (fullscreen) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(FOCUS_PANEL_NO_DRAG)) return;
    beginNativeWindowDragOnMove(event, () => {
      draggedRef.current = true;
    });
  }

  /** Swallow the click the OS drag loop can leave behind on a button. */
  function swallowClickAfterDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const { text: timerText, overtime } = formatFocusTime(
    Math.max(0, now - sessionStart),
    displayDuration
  );
  /* No timer, no button to reset it. The time spent is counted all the same. */
  const showTimer = focusTimerShown(timerAlways, displayDuration);

  /*
    The switcher, as redd-do has it.

    Browsing: one list at a time, chosen from a row of tabs that say how
    many open tasks each holds; the focused task's own list first. Searching
    crosses every list, the hits grouped under their list's name, the
    focused task's list first and the tasks within a group alphabetical.
    The port had a flat list of every task and a search over it, which on
    a board of hundreds was a wall.
  */
  const openTasks = (state?.tasks ?? []).filter(
    (candidate) =>
      !candidate.completed &&
      candidate.id !== taskId &&
      !focusedElsewhere.has(candidate.id)
  );
  const switchLists = [...(state?.lists ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((list) => ({
      list,
      tasks: openTasks.filter((candidate) => candidate.listId === list.id),
    }));
  const focusedListId = task?.listId ?? null;
  const currentSwitchListId =
    switchListId && switchLists.some((entry) => entry.list.id === switchListId)
      ? switchListId
      : focusedListId && switchLists.some((entry) => entry.list.id === focusedListId)
        ? focusedListId
        : (switchLists[0]?.list.id ?? null);
  const switchNeedle = switchQuery.trim().toLowerCase();
  const byText = (a: TodoTask, b: TodoTask) =>
    (a.text || "").localeCompare(b.text || "", undefined, {
      sensitivity: "base",
      numeric: true,
    });
  const switchGroups = switchNeedle
    ? (() => {
        const groups = switchLists
          .map((entry) => ({
            ...entry,
            tasks: entry.tasks
              .filter((candidate) =>
                (candidate.text || "").toLowerCase().includes(switchNeedle)
              )
              .sort(byText),
          }))
          .filter((entry) => entry.tasks.length > 0);
        const currentIdx = groups.findIndex(
          (entry) => entry.list.id === focusedListId
        );
        if (currentIdx > 0) {
          const [current] = groups.splice(currentIdx, 1);
          groups.unshift(current);
        }
        return groups;
      })()
    : null;
  const browsingTasks =
    switchLists.find((entry) => entry.list.id === currentSwitchListId)?.tasks ??
    [];
  /* With the board on, the list reads as the board does: its columns in
     the board's order, each named, empty ones left out. */
  const columnOrder: TodoBoardColumn[] = [
    "today",
    "week",
    "backlog",
    ...(switchBoard.someday ? (["someday"] as const) : []),
  ];
  const columnLabel = (column: TodoBoardColumn) =>
    column === "today"
      ? t("boardToday")
      : column === "week"
        ? t("boardThisWeek")
        : column === "backlog"
          ? t("boardBacklog")
          : t("boardSomeday");
  const browsingColumns = switchBoard.kanban
    ? columnOrder
        .map((column) => ({
          column,
          tasks: browsingTasks.filter(
            (candidate) =>
              boardColumnOf(candidate, switchBoard.someday) === column
          ),
        }))
        .filter((group) => group.tasks.length > 0)
    : null;

  return (
    <div
      ref={shellRef}
      className={`todo-shell focus-shell focus-panel-window ${
        fullscreen ? "is-fullscreen" : ""
      }${slot === 2 ? " is-second" : ""}`}
      /*
        Tab walks the window's own controls and wraps at the end: the bar
        is buttons alone, and WebKit hands Tab to text boxes only, so the
        caret used to skip every one of them. See `focus-walk`.
      */
      onKeyDown={(e) => {
        if (walkArrowStops(e, shellRef.current, { wrap: true })) return;
        walkTabStops(e, shellRef.current, { wrap: true });
      }}
    >
      <div id="focus-mode">
        <div
          className={`focus-container ${fullscreen ? "fullscreen" : ""}${
            showTimer ? "" : " no-timer"
          }`}
          onPointerDown={startPanelDrag}
          onClickCapture={swallowClickAfterDrag}
        >
          <div className="focus-bar" ref={barRef}>
            <div className="focus-task-name">{displayTitle}</div>
            {showTimer ? (
              <div className={`focus-timer ${overtime ? "overtime" : ""}`}>
                {timerText}
              </div>
            ) : null}
            {showTimer && resetToast != null ? (
              <div className="focus-toast">
                <span>Timer reset</span>
                <button
                  id="focus-undo-btn"
                  onClick={() => {
                    setSessionStart(resetToast);
                    setResetToast(null);
                  }}
                >
                  {t("undo")}
                </button>
              </div>
            ) : null}
            <div className="focus-buttons-container">
              <button
                className="complete-focus-btn"
                title="Mark task as complete"
                onClick={() => void completeTask()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button
                className="fullscreen-focus-btn"
                title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                onClick={() => void toggleFullscreen()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
              {showTimer ? (
                <button
                  className="reset-focus-btn"
                  title="Reset timer"
                  onClick={resetTimer}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 2h4" />
                    <path d="M12 14v-4" />
                    <path d="M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6" />
                    <path d="M9 17H4v5" />
                  </svg>
                </button>
              ) : null}
              <button
                className="notes-focus-btn"
                title="Toggle notes"
                onClick={toggleNotes}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
                  <path d="M2 6h4" />
                  <path d="M2 10h4" />
                  <path d="M2 14h4" />
                  <path d="M2 18h4" />
                  <path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
                </svg>
              </button>
              <div className="focus-switch-task-wrapper">
                <button
                  className="switch-focus-task-btn"
                  title="Switch task"
                  onClick={() =>
                    setSwitchOpen((v) => {
                      if (!v) {
                        setSwitchListId(null);
                        try {
                          setSwitchBoard({
                            kanban:
                              localStorage.getItem("redd-plan-todo-kanban") !==
                              "0",
                            someday:
                              localStorage.getItem(
                                "redd-plan-todo-someday-enabled"
                              ) === "1",
                          });
                        } catch {
                          /* no storage: the plain list */
                        }
                      }
                      return !v;
                    })
                  }
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
              </div>
              <button
                className="exit-focus-btn"
                title="Exit focus mode"
                onClick={() => {
                  // Home is the list. The planner can be on other tiles by
                  // now: it puts To-Do back on one. See NativeShowTodo.
                  channelRef.current?.postMessage({ type: "show-todo" });
                  void (fullscreen ? exitToHome() : exitFocus());
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9,22 9,12 15,12 15,22" />
                </svg>
              </button>
            </div>
          </div>

          {switchOpen ? (
            <div className="focus-task-switch-menu" ref={switchMenuRef}>
              <div className="focus-task-switch-search">
                <svg className="focus-task-switch-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoFocus
                  type="text"
                  className="focus-task-switch-search-input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("switchTaskSearchPlaceholder")}
                  value={switchQuery}
                  onChange={(e) => setSwitchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSwitchOpen(false);
                  }}
                />
                <span className="focus-task-switch-esc" aria-hidden="true">
                  Esc
                </span>
              </div>
              {/* Tabs are for browsing one list at a time; they go while a
                  search crosses every list. */}
              {!switchGroups && switchLists.length > 1 ? (
                <div className="focus-task-switch-tabs" role="tablist">
                  {switchLists.map((entry) => (
                    <button
                      key={entry.list.id}
                      type="button"
                      role="tab"
                      aria-selected={entry.list.id === currentSwitchListId}
                      title={entry.list.name}
                      className={`focus-task-switch-tab${
                        entry.list.id === currentSwitchListId ? " active" : ""
                      }`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSwitchListId(entry.list.id);
                      }}
                    >
                      <span className="focus-task-switch-tab-name">
                        {entry.list.name}
                      </span>
                      <span className="focus-task-switch-tab-count">
                        {entry.tasks.length}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="focus-task-switch-list">
                {switchGroups ? (
                  switchGroups.length === 0 ? (
                    <div className="focus-task-switch-empty">
                      {t("switchTaskNoMatches")}
                    </div>
                  ) : (
                    switchGroups.map((group) => (
                      <React.Fragment key={group.list.id}>
                        {switchLists.length > 1 ? (
                          <div className="focus-task-switch-group-label">
                            {group.list.name}
                          </div>
                        ) : null}
                        {group.tasks.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            className="focus-task-switch-item"
                            onClick={() => switchToTask(candidate)}
                          >
                            {candidate.text}
                          </button>
                        ))}
                      </React.Fragment>
                    ))
                  )
                ) : browsingTasks.length === 0 ? (
                  <div className="focus-task-switch-empty">
                    {t("switchTaskEmptyList")}
                  </div>
                ) : browsingColumns ? (
                  browsingColumns.map((group) => (
                    <React.Fragment key={group.column}>
                      <div className="focus-task-switch-group-label">
                        {columnLabel(group.column)}
                      </div>
                      {group.tasks.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          className="focus-task-switch-item"
                          onClick={() => switchToTask(candidate)}
                        >
                          {candidate.text}
                        </button>
                      ))}
                    </React.Fragment>
                  ))
                ) : (
                  browsingTasks.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className="focus-task-switch-item"
                      onClick={() => switchToTask(candidate)}
                    >
                      {candidate.text}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {notesOpen ? (
            <div className="focus-notes-container" ref={notesRef}>
              <div className="focus-notes-editor-wrapper active">
                {/* The board's notes editor, so the same bubble and the
                    same Basecamp-shaped HTML — and the board's way of
                    reading a picture, which is a path on the server this
                    window is served by. Without it a picture in the note
                    was drawn as a file card with its name and size. No
                    uploader: this window has nowhere to put a new one. */}
                <TrixNotesEditor
                  value={notesDraft}
                  onChange={setNotesDraft}
                  placeholder="Add notes..."
                  resolveImageSrc={resolveBasecampImage}
                  onDone={saveNotes}
                />
                <button
                  className="notes-done-btn"
                  title="Done editing"
                  onClick={saveNotes}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
