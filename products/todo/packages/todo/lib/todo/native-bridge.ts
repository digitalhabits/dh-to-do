/**
 * The desktop bridge for To-Do: the question "is this the desktop app", the
 * window drag, the floating focus bar, and Apple Reminders.
 *
 * The planner's `lib/native-shell.ts` exports everything here again, next to
 * its own functions for mail and the CRM, so planner code imports as before.
 * The standalone To-Do app points `@/lib/native-shell` at this file. One copy
 * serves both, and the published To-Do source holds no planner file.
 *
 * Each shell puts `window.__TAURI__` (withGlobalTauri) into the page.
 */

export type TauriInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

/**
 * The shell's bridge, wherever this page is drawn.
 *
 * A tab shown in a split pane is an iframe, and Tauri puts its bridge in
 * the main frame only — so a page that was native as the open tab had no
 * shell at all once it was put in a second pane. Everything gated on this
 * quietly went: the focus popout, Reminders, the native clipboard. Nothing
 * said why, because they all ask this one question and all got the same
 * wrong answer.
 *
 * `shellTop` is what reaches the frame above, and it was already trusted
 * for opening links and for `shellInvoke`. It belongs here too, at the
 * question everything else is built on.
 */
export function tauriGlobal(): TauriGlobal | null {
  if (typeof window === "undefined") return null;
  const own = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  if (own?.core?.invoke) return own;
  const top = shellTop()?.__TAURI__;
  return top?.core?.invoke ? top : null;
}

export function tauriInvoke(): TauriInvoke | null {
  return tauriGlobal()?.core?.invoke ?? null;
}

/** True when running inside any Tauri desktop shell (call client-side only). */
export function isNativeShell(): boolean {
  return tauriInvoke() != null;
}

/** Begin an OS window drag (no-op outside the desktop shell). */
export async function startWindowDragging(): Promise<void> {
  const tauri = tauriGlobal();
  if (!tauri?.core?.invoke) return;
  // The same shell the invoke goes through. From inside a pane that is the
  // window the pane is drawn in, which is the one worth dragging.
  const getCurrent = tauri.window?.getCurrentWindow;
  if (typeof getCurrent === "function") {
    await getCurrent().startDragging();
    return;
  }
  await tauri.core.invoke("plugin:window|start_dragging");
}

const WINDOW_DRAG_MOVE_PX = 4;

/**
 * On native shells: after a short pointer move, drag the window.
 * A click without that move still fires normally (buttons, menus).
 */
export function beginNativeWindowDragOnMove(
  event: {
    button: number;
    clientX: number;
    clientY: number;
  },
  /**
   * Called once, when the move passes the threshold and the drag starts.
   * A caller with buttons under the drag surface uses it to swallow the
   * click that the OS drag loop can still leave behind.
   */
  onDragStart?: () => void
): void {
  if (typeof window === "undefined") return;
  if (event.button !== 0) return;
  if (!isNativeShell()) return;

  const startX = event.clientX;
  const startY = event.clientY;
  let started = false;
  const thresholdSq = WINDOW_DRAG_MOVE_PX * WINDOW_DRAG_MOVE_PX;

  const onMove = (ev: PointerEvent) => {
    if (started) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (dx * dx + dy * dy < thresholdSq) return;
    started = true;
    cleanup();
    onDragStart?.();
    void startWindowDragging();
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}

/**
 * Pop a to-do task out into a floating focus bar. On macOS this is a true
 * NSPanel that floats above full-screen windows (see src-tauri
 * open_focus_popout), matching Digital Habits: To-Do.
 */
export async function openFocusPopout(input: {
  taskId: string;
  title: string;
  durationMinutes?: number | null;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("open_focus_popout", {
    taskId: input.taskId,
    title: input.title,
    durationMinutes: input.durationMinutes ?? null,
    userAgent: navigator.userAgent,
  });
}

/**
 * Ask the planner shell to load the focus panel hidden, so the first Focus
 * press finds it ready. Call from a signed-in page only: the panel loads
 * /todo-focus with the same session, and without one it would show the
 * sign-in flow. A no-op outside the shell or in an older shell build.
 */
export async function prewarmFocusPopout(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  try {
    await invoke("prewarm_focus_popout", { userAgent: navigator.userAgent });
  } catch {
    /* older shell: no command */
  }
}

export type FocusOpenPayload = {
  taskId: string;
  title: string;
  durationMinutes: number | null;
  elapsedMs: number;
};

/**
 * The planner shell keeps its focus panels alive and re-targets one with a
 * `focus-open` event instead of a page load. Subscribe from inside the panel.
 * Resolves to an unsubscribe function, or a no-op outside a shell that emits
 * the event.
 *
 * The subscription names this window: the shell keeps two panels, both
 * listening for the same event, and a listener with no target hears an
 * event sent to either of them — which put one task in both panels at once.
 */
export async function listenFocusOpen(
  handler: (payload: FocusOpenPayload) => void
): Promise<() => void> {
  const w = window as unknown as {
    __TAURI__?: {
      event?: {
        listen?: (
          name: string,
          cb: (event: { payload: FocusOpenPayload }) => void,
          options?: { target: string }
        ) => Promise<() => void>;
      };
      webviewWindow?: {
        getCurrentWebviewWindow?: () => { label: string };
      };
      window?: {
        getCurrentWindow?: () => { label: string };
      };
    };
  };
  const listen = w.__TAURI__?.event?.listen;
  if (!listen) return () => {};
  const label =
    w.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.().label ??
    w.__TAURI__?.window?.getCurrentWindow?.().label;
  return listen(
    "focus-open",
    (event) => handler(event.payload),
    label ? { target: label } : undefined
  );
}

/**
 * "Settings…" in the app menu of the desktop app (Cmd+Comma). The shell owns
 * the menu and the page owns the settings sheet, so the shell sends
 * `open-settings` to the main window and the page opens the sheet. See
 * apps/todo/src-tauri/src/menu.rs. Outside the desktop app this does nothing.
 */
export async function listenOpenSettings(handler: () => void): Promise<() => void> {
  const w = window as unknown as {
    __TAURI__?: {
      event?: { listen?: (name: string, cb: () => void) => Promise<() => void> };
    };
  };
  const listen = w.__TAURI__?.event?.listen;
  if (!listen) return () => {};
  return listen("open-settings", () => handler());
}

/**
 * Tell the shell that the panel page listens for `focus-open`. Until this is
 * called, a Focus press reloads the page instead. Older shells lack the
 * command, so a failure is ignored.
 */
export async function signalFocusPanelReady(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  try {
    await invoke("focus_panel_ready");
  } catch {
    /* older shell: no command, and no event either */
  }
}

/**
 * Tell the shell which task this panel now shows. The shell keeps two panels
 * and sends a press for a task that is already up to the panel holding it,
 * so the panel reports every change, including its own switcher. A no-op
 * outside the shell or in an older shell build.
 */
export async function notifyFocusPanelTask(taskId: string): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  try {
    await invoke("focus_panel_task_changed", { taskId });
  } catch {
    /* older shell: no command */
  }
}

/**
 * Fit the floating focus panel to what it shows. The window is 56px tall,
 * which is the bar alone, so an open task list or the notes editor falls
 * outside it and stays invisible. The panel measures its own content and
 * calls this, which is what redd-do does with `set-focus-window-height`.
 * A no-op outside the shell or in an older shell build.
 */
export async function setFocusPopoutHeight(height: number): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  try {
    await invoke("set_focus_popout_height", { height });
  } catch {
    /* older shell: no command */
  }
}

/** Hide the focus panel (called from inside it). */
export async function closeFocusPopout(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("close_focus_popout");
}

/** Hand the running focus session to a fullscreen window (from the panel). */
export async function enterFullscreenFocus(input: {
  taskId: string;
  title: string;
  elapsedMs: number;
  durationMinutes?: number | null;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("enter_fullscreen_focus", {
    taskId: input.taskId,
    title: input.title,
    elapsedMs: input.elapsedMs,
    durationMinutes: input.durationMinutes ?? null,
    userAgent: navigator.userAgent,
  });
}

/** Return from fullscreen focus to the mini panel (from the fullscreen window). */
export async function exitFullscreenFocus(input: {
  taskId: string;
  title: string;
  elapsedMs: number;
  durationMinutes?: number | null;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("exit_fullscreen_focus", {
    taskId: input.taskId,
    title: input.title,
    elapsedMs: input.elapsedMs,
    durationMinutes: input.durationMinutes ?? null,
    userAgent: navigator.userAgent,
  });
}

/** Leave fullscreen focus entirely and bring the main window back. */
export async function exitFullscreenFocusToHome(input: {
  taskId: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("exit_fullscreen_focus_to_home", input);
}

// --- Apple Reminders (EventKit, macOS desktop shell only) -------------------

export type RemindersList = {
  id: string;
  name: string;
  groupName?: string | null;
  sourceName?: string | null;
};

export type RemindersTask = {
  id: string;
  name: string;
  completed: boolean;
  notes: string;
  creationDate: number;
  completionDate: number;
  lastModifiedDate: number;
  /** "YYYY-MM-DD", or null: the due day, the shape the board keeps too. */
  dueOn?: string | null;
};

function remindersInvoke() {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  return invoke;
}

/** First call triggers the macOS Reminders permission prompt. */
export async function fetchRemindersLists(): Promise<RemindersList[]> {
  return (await remindersInvoke()("fetch_reminders_lists")) as RemindersList[];
}

export async function fetchRemindersTasks(
  listId: string
): Promise<RemindersTask[]> {
  return (await remindersInvoke()("fetch_reminders_tasks", {
    listId,
  })) as RemindersTask[];
}

export async function createRemindersTask(
  listId: string,
  title: string,
  dueOn: string | null = null
): Promise<{ id?: string | null }> {
  return (await remindersInvoke()("create_reminders_task", {
    listId,
    title,
    dueOn,
  })) as { id?: string | null };
}

/** Set or clear the due day ("YYYY-MM-DD", or null). */
export async function updateRemindersDue(
  taskId: string,
  dueOn: string | null
): Promise<void> {
  await remindersInvoke()("update_reminders_due", { taskId, dueOn });
}

export async function updateRemindersStatus(
  taskId: string,
  completed: boolean
): Promise<void> {
  await remindersInvoke()("update_reminders_status", { taskId, completed });
}

export async function updateRemindersTitle(
  taskId: string,
  title: string
): Promise<void> {
  await remindersInvoke()("update_reminders_title", { taskId, title });
}

export async function deleteRemindersTask(taskId: string): Promise<void> {
  await remindersInvoke()("delete_reminders_task", { taskId });
}

export async function openRemindersPrivacySettings(): Promise<void> {
  await remindersInvoke()("open_reminders_privacy_settings");
}

/**
 * The document above this one, when it is one we may read.
 *
 * A tab in a split pane is an iframe holding one of the planner's own
 * pages, and Tauri puts its bridge in the main frame only. So everything
 * inside a pane had no shell to ask — and WKWebView drops `window.open`
 * from a subframe, which is why "Open portal" answered a click with
 * nothing at all.
 *
 * The panes are this origin's own pages, so the top document's own bridge
 * is ours to call. A frame from somewhere else throws on the first read,
 * and then there is nothing above.
 */
export function shellTop(): { __TAURI__?: TauriGlobal } | null {
  if (typeof window === "undefined" || window.top === window) return null;
  try {
    const top = window.top as unknown as { __TAURI__?: TauriGlobal } | null;
    // The read itself is the test: cross-origin throws here.
    void top?.__TAURI__;
    return top;
  } catch {
    return null;
  }
}

export type TauriGlobal = {
  core?: { invoke?: TauriInvoke };
  window?: {
    getCurrentWindow?: () => { startDragging: () => Promise<void> };
  };
  opener?: { openUrl?: (url: string) => Promise<void> };
};
