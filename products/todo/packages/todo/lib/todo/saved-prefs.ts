/**
 * What the board keeps per device in localStorage: the keys, and the reads
 * of the values the page restores on mount. A value that is not one the
 * page knows reads as null, and the page then keeps its default.
 *
 * No React in here, so a test can read it.
 */

import { makeT, type TodoLang } from "./i18n";
import type { TodoBoardColumn } from "./types";

export const LANG_KEY = "redd-plan-todo-lang";
export const THEME_KEY = "redd-plan-todo-theme";
export const ZOOM_KEY = "redd-plan-todo-zoom";
export const GROUPS_KEY = "redd-plan-todo-groups";
export const KANBAN_KEY = "redd-plan-todo-kanban";
export const PLAN_ENABLED_KEY = "redd-plan-todo-plan";
export const COLUMN_ORDER_KEY = "redd-plan-todo-column-order";
export const SOMEDAY_EXPANDED_KEY = "redd-plan-todo-someday-expanded";
export const SOMEDAY_ENABLED_KEY = "redd-plan-todo-someday-enabled";
/**
 * Assigning tasks to people. Missing key = the default: on inside the
 * planner, where a team shares the board, and off in the standalone app.
 */
export const ASSIGN_ENABLED_KEY = "redd-plan-todo-assign-enabled";
/** Left to right on a wide board. One column reads it the other way up. */
export const DEFAULT_COLUMN_ORDER: TodoBoardColumn[] = ["backlog", "week", "today"];
export const TILE_OPEN_COLUMN_KEY = "redd-plan-todo-tile-open-column";
export const CURRENT_GROUP_KEY = "redd-plan-todo-current-group";
export const FOCUS_MODE_KEY = "redd-plan-todo-focus-mode";
/** Set once the board has held a task. After that, no "Add a task below". */
export const HAD_TASK_KEY = "redd-plan-todo-had-task";
/** The view the reader left the app on: Lists, Favourites or Calendar. */
export const VIEW_KEY = "redd-plan-todo-view";

/** Keep one value on this device. Private mode keeps nothing, and says nothing. */
export function persistPref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** The language kept, or null. */
export function parseSavedLang(raw: string | null): TodoLang | null {
  return raw === "da" || raw === "en" ? raw : null;
}

/** The theme kept, or null. */
export function parseSavedTheme(raw: string | null): "light" | "dark" | "system" | null {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : null;
}

/** The zoom kept, in per cent, when it is one the settings offer. */
export function parseSavedZoom(raw: string | null): number | null {
  const z = Number(raw);
  return Number.isFinite(z) && z >= 50 && z <= 170 ? z : null;
}

/** The order of the three columns, when it names each of them once. */
export function parseSavedColumnOrder(raw: string | null): TodoBoardColumn[] | null {
  if (!raw) return null;
  const parsed = raw.split(",") as TodoBoardColumn[];
  const complete =
    parsed.length === DEFAULT_COLUMN_ORDER.length &&
    DEFAULT_COLUMN_ORDER.every((column) => parsed.includes(column));
  return complete ? parsed : null;
}

/** Assigning kept on or off; not kept, on in the planner and off in the app. */
export function parseSavedAssignEnabled(raw: string | null, standalone: boolean): boolean {
  return raw === null ? !standalone : raw === "1";
}

/** The view the reader left, when it is not the lists view. */
export function parseSavedView(raw: string | null): "favourites" | "plan" | null {
  return raw === "favourites" || raw === "plan" ? raw : null;
}

/**
 * The words of the language the page last saved, for code that is given
 * no `t`: the note's picture uploads and the desktop app's Basecamp login.
 * English when none is saved, or when storage cannot be read.
 */
export function savedLangT(): (key: string) => string {
  let lang: TodoLang = "en";
  try {
    lang = parseSavedLang(localStorage.getItem(LANG_KEY)) ?? "en";
  } catch {
    /* no storage: English */
  }
  return makeT(lang);
}
