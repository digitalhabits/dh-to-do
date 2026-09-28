"use client";

import * as React from "react";
import { toast } from "sonner";

import { isNativeShell } from "@/lib/native-shell";
import { describeError } from "@/lib/todo/errors";
import { drainPendingFocusCompletes } from "@/lib/todo/focus-pending";
import { openTodoFocusPopout } from "@/lib/todo/focus-popout";
import { focusToGiveWay } from "@/lib/todo/focus-windows";
import { FOCUS_CHANNEL, type TodoTask } from "@/lib/todo/types";

/** The page's own tick for a task a focus window finished. */
export type CompleteFromFocus = (taskId: string, timeSpentSeconds?: number) => void;

/**
 * The floating focus windows of the desktop shell: which tasks have one,
 * the channel to them, and the tick a window gave while no board was open.
 *
 * `completeFromFocus` is the page's tick; the channel below calls the
 * newest one through `completeFromFocusRef`. `tasksLoaded` says the board
 * holds tasks to find a kept tick among.
 */
export function useFocusWindowState({
  completeFromFocus,
  tasksLoaded,
}: {
  completeFromFocus: CompleteFromFocus;
  tasksLoaded: boolean;
}) {
  // Start false so SSR / web never paints the control; native enables after mount.
  const [nativeShell, setNativeShell] = React.useState(false);
  const [activeFocusTaskIds, setActiveFocusTaskIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const focusChannelRef = React.useRef<BroadcastChannel | null>(null);
  /** Who waits for a focus window to say that it closed. See closeFocusWindowOf. */
  const focusEndWaitersRef = React.useRef(new Map<string, () => void>());
  /** The current completeFromFocus, for the channel handler above it. */
  const completeFromFocusRef = React.useRef<CompleteFromFocus>(
    completeFromFocus
  );
  completeFromFocusRef.current = completeFromFocus;

  /*
    A tick the focus window gave while no board was open. The planner kept
    it and opened this tile: see focus-pending. Taken up once there are
    tasks to find it among. A task the server already completed is skipped
    by completeFromFocus itself.
  */
  React.useEffect(() => {
    if (!tasksLoaded) return;
    /*
      Not in the effect itself. The tick measures the rows and writes the
      change in one go, with flushSync, which React refuses while it is
      rendering — "flushSync was called from inside a lifecycle method",
      and the flight it was called for does not happen. A turn later the
      render is over and the rows are on screen to be measured.

      The ticks are taken out of storage inside the timer, not before it,
      so a tile that closes first leaves them for the next board to find.
    */
    const timer = window.setTimeout(() => {
      for (const pending of drainPendingFocusCompletes()) {
        completeFromFocusRef.current(pending.taskId, pending.timeSpentSeconds);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tasksLoaded]);

  React.useEffect(() => {
    setNativeShell(isNativeShell());
  }, []);

  return {
    nativeShell,
    activeFocusTaskIds,
    setActiveFocusTaskIds,
    focusChannelRef,
    focusEndWaitersRef,
    completeFromFocusRef,
  };
}

/**
 * The channel to the focus windows, and the board's two requests of them:
 * open a window for a task, or ask one to close.
 */
export function useFocusChannel({
  nativeShell,
  refresh,
  standalone,
  activeFocusTaskIds,
  setActiveFocusTaskIds,
  focusChannelRef,
  focusEndWaitersRef,
  completeFromFocusRef,
  t,
}: {
  nativeShell: boolean;
  refresh: () => Promise<void>;
  standalone: boolean;
  activeFocusTaskIds: Set<string>;
  setActiveFocusTaskIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  focusChannelRef: React.MutableRefObject<BroadcastChannel | null>;
  focusEndWaitersRef: React.MutableRefObject<Map<string, () => void>>;
  completeFromFocusRef: React.MutableRefObject<CompleteFromFocus>;
  t: (key: string) => string;
}) {
  // Focus-window sync: track which tasks have live focus panels, refresh on
  // their writes, and route exit requests (mirrors redd-do's Tauri events).
  // Skip on the web — the floating panel is desktop-only.
  React.useEffect(() => {
    if (!nativeShell) return;
    const channel = new BroadcastChannel(FOCUS_CHANNEL);
    focusChannelRef.current = channel;
    channel.onmessage = (e) => {
      const msg = e.data as { type: string; taskId?: string };
      if (msg.type === "focus-started" && msg.taskId) {
        setActiveFocusTaskIds((prev) => new Set(prev).add(msg.taskId as string));
      } else if (msg.type === "focus-ended" && msg.taskId) {
        setActiveFocusTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.taskId as string);
          return next;
        });
        focusEndWaitersRef.current.get(msg.taskId)?.();
      } else if (msg.type === "task-updated") {
        void refresh();
      } else if (msg.type === "task-complete" && msg.taskId) {
        // The focus window's tick. The board completes the task the way
        // its own checkbox does: the party and the flight to Done.
        const done = msg as { taskId: string; timeSpentSeconds?: number };
        completeFromFocusRef.current(done.taskId, done.timeSpentSeconds);
      }
    };
    return () => {
      channel.close();
      focusChannelRef.current = null;
    };
  }, [
    completeFromFocusRef,
    focusChannelRef,
    focusEndWaitersRef,
    nativeShell,
    refresh,
    setActiveFocusTaskIds,
  ]);

  /**
   * Ask the focus window of a task to save and close, and wait until it says
   * that it did. The wait has an end: a window that never answers must not
   * stop the next one.
   */
  function closeFocusWindowOf(taskId: string): Promise<void> {
    return new Promise((resolve) => {
      const waiters = focusEndWaitersRef.current;
      const done = () => {
        window.clearTimeout(timer);
        waiters.delete(taskId);
        // The window says "ended" and then hides. Give the hide a moment to
        // reach the shell before the next window asks for a place.
        window.setTimeout(resolve, 60);
      };
      const timer = window.setTimeout(done, 1500);
      waiters.set(taskId, done);
      setActiveFocusTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      focusChannelRef.current?.postMessage({ type: "focus-exit-request", taskId });
    });
  }

  /**
   * Open the floating focus window for a task, or ask the open one to leave.
   * The board's button and the Today session both come through here.
   */
  function toggleTaskFocusPopout(task: TodoTask) {
    /*
      Which half of this ran, and how far it got.

      The focus button was reported as doing nothing. The shell logs every
      request it receives to open the panel and has never logged one, so
      either the press never became a request or it never reached the shell.
      This says which: the exit branch answers a task the page believes is
      already focused, and the open branch says whether the shell took it.
    */
    console.info(
      `[todo] focus pressed for ${task.id} — page thinks it is ${
        activeFocusTaskIds.has(task.id) ? "already focused (exit)" : "not focused (open)"
      }`
    );
    if (activeFocusTaskIds.has(task.id)) {
      // Clear locally even if the hidden panel never answers — otherwise the
      // button stays in "exit" mode and never re-opens focus.
      setActiveFocusTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      focusChannelRef.current?.postMessage({
        type: "focus-exit-request",
        taskId: task.id,
      });
      return;
    }
    // Two windows at most. In the desktop app each task has a window of its
    // own, so the board closes the one that gives way, by that window's own
    // save-and-close: its time is kept and its mark goes. The planner shell
    // has two fixed panels and points the second one at the new task itself.
    const giveWay = standalone
      ? focusToGiveWay([...activeFocusTaskIds], task.id)
      : null;
    setActiveFocusTaskIds((prev) => new Set(prev).add(task.id));
    void (giveWay ? closeFocusWindowOf(giveWay) : Promise.resolve())
      .then(() => openTodoFocusPopout(task))
      .then(() => console.info(`[todo] focus: the shell took ${task.id}`))
      .catch((err) => {
        setActiveFocusTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        console.warn("[todo] focus: the shell refused it:", err);
        toast.error(describeError(err, t("focusWindowFailed")));
      });
  }

  return { closeFocusWindowOf, toggleTaskFocusPopout };
}
