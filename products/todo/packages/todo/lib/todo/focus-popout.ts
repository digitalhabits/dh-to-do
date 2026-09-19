import { isNativeShell, openFocusPopout } from "@/lib/native-shell";

import type { TodoTask } from "./types";

export const FOCUS_POPOUT_WIDTH = 320;
/** Matches the native panel default (redd-do); focus-bar CSS height is 48px. */
export const FOCUS_POPOUT_HEIGHT = 56;

/** Build /todo-focus with title/duration so the bar paints before state loads. */
export function todoFocusPath(
  task: Pick<TodoTask, "id" | "text" | "expectedDurationMinutes">,
  extras?: { elapsedMs?: number; fullscreen?: boolean }
): string {
  const params = new URLSearchParams({
    taskId: task.id,
    title: task.text,
  });
  if (task.expectedDurationMinutes != null) {
    params.set("duration", String(task.expectedDurationMinutes));
  }
  if (extras?.elapsedMs != null && extras.elapsedMs > 0) {
    params.set("elapsed", String(extras.elapsedMs));
  }
  if (extras?.fullscreen) {
    params.set("fullscreen", "1");
  }
  return `/todo-focus?${params.toString()}`;
}

/**
 * Open a floating always-on-top focus window for a task.
 *
 * Desktop shells only (Planner Tauri today; standalone To-Do when that host
 * exposes `open_focus_popout`). The browser product has no good always-on-top
 * API, so this is a no-op on the web — callers must hide the Focus control
 * when `isNativeShell()` is false.
 */
export async function openTodoFocusPopout(task: TodoTask): Promise<void> {
  if (!isNativeShell()) {
    throw new Error("Focus windows open from the desktop app");
  }
  await openFocusPopout({
    taskId: task.id,
    title: task.text,
    durationMinutes: task.expectedDurationMinutes,
  });
}
