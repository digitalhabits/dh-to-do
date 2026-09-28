"use client";

import * as React from "react";

import type { TodoTheme } from "@/components/todo/TodoSettingsModal";
import { boardViewIsOn } from "@/lib/todo/board-view-default";
import { readFocusTimerAlways } from "@/lib/todo/focus-time";
import type { TodoLang } from "@/lib/todo/i18n";
import type { TodoView } from "@/lib/todo/list-scope";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import {
  ASSIGN_ENABLED_KEY,
  COLUMN_ORDER_KEY,
  CURRENT_GROUP_KEY,
  FOCUS_MODE_KEY,
  GROUPS_KEY,
  KANBAN_KEY,
  LANG_KEY,
  PLAN_ENABLED_KEY,
  SOMEDAY_ENABLED_KEY,
  SOMEDAY_EXPANDED_KEY,
  THEME_KEY,
  VIEW_KEY,
  ZOOM_KEY,
  parseSavedAssignEnabled,
  parseSavedColumnOrder,
  parseSavedLang,
  parseSavedTheme,
  parseSavedView,
  parseSavedZoom,
} from "@/lib/todo/saved-prefs";
import {
  TODO_ALL_LIST_ID,
  TODO_CURRENT_LIST_KEY,
  type TodoBoardColumn,
} from "@/lib/todo/types";

/**
 * The language, theme and zoom, and the one effect that reads back, after
 * mount, everything the device keeps: those three, the switches of
 * Settings, the column order, the open group, list and view, and focus
 * mode. After mount, so the server's first render and the browser's agree.
 * It also follows the system's dark mode.
 */
export function useSavedPrefs({
  setKanbanEnabled,
  setPlanEnabled,
  setColumnOrder,
  setSomedayExpanded,
  setSomedayEnabled,
  setAssignEnabled,
  setFocusTimerAlways,
  setGroupsEnabled,
  setCurrentGroupId,
  setCurrentListId,
  setFocusMode,
  setView,
  viewRestoredRef,
}: {
  setKanbanEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setPlanEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setColumnOrder: React.Dispatch<React.SetStateAction<TodoBoardColumn[]>>;
  setSomedayExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setSomedayEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setAssignEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setFocusTimerAlways: React.Dispatch<React.SetStateAction<boolean>>;
  setGroupsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentGroupId: React.Dispatch<React.SetStateAction<string | null>>;
  setCurrentListId: React.Dispatch<React.SetStateAction<string | null>>;
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>;
  setView: React.Dispatch<React.SetStateAction<TodoView>>;
  viewRestoredRef: React.RefObject<boolean>;
}) {
  const [lang, setLang] = React.useState<TodoLang>("en");
  const [theme, setTheme] = React.useState<TodoTheme>("system");
  const [zoom, setZoom] = React.useState(100);
  const [systemDark, setSystemDark] = React.useState(false);

  React.useEffect(() => {
    try {
      const l = parseSavedLang(localStorage.getItem(LANG_KEY));
      if (l) setLang(l);
      const th = parseSavedTheme(localStorage.getItem(THEME_KEY));
      if (th) setTheme(th);
      const z = parseSavedZoom(localStorage.getItem(ZOOM_KEY));
      if (z !== null) setZoom(z);
      // A new reader starts with one list. See board-view-default.ts for
      // who keeps the board. The answer is saved, so it is decided one time.
      const boardOn = boardViewIsOn({
        stored: localStorage.getItem(KANBAN_KEY),
        savedCurrentList: localStorage.getItem(TODO_CURRENT_LIST_KEY),
      });
      setKanbanEnabled(boardOn);
      if (localStorage.getItem(KANBAN_KEY) === null) {
        localStorage.setItem(KANBAN_KEY, boardOn ? "1" : "0");
      }
      setPlanEnabled(localStorage.getItem(PLAN_ENABLED_KEY) === "1");
      const storedOrder = parseSavedColumnOrder(localStorage.getItem(COLUMN_ORDER_KEY));
      if (storedOrder) setColumnOrder(storedOrder);
      setSomedayExpanded(localStorage.getItem(SOMEDAY_EXPANDED_KEY) === "1");
      setSomedayEnabled(localStorage.getItem(SOMEDAY_ENABLED_KEY) === "1");
      setAssignEnabled(
        parseSavedAssignEnabled(localStorage.getItem(ASSIGN_ENABLED_KEY), isStandaloneTodo())
      );
      setFocusTimerAlways(readFocusTimerAlways());
      setGroupsEnabled(localStorage.getItem(GROUPS_KEY) === "1");
      const g = localStorage.getItem(CURRENT_GROUP_KEY);
      if (g) setCurrentGroupId(g);
      const savedList = localStorage.getItem(TODO_CURRENT_LIST_KEY);
      if (savedList === TODO_ALL_LIST_ID || savedList) setCurrentListId(savedList);
      setFocusMode(localStorage.getItem(FOCUS_MODE_KEY) === "1");
      // A view that is off now is put right by the two effects below.
      const savedView = parseSavedView(localStorage.getItem(VIEW_KEY));
      if (savedView) setView(savedView);
    } catch {
      /* private mode */
    }
    viewRestoredRef.current = true;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [
    setAssignEnabled,
    setColumnOrder,
    setCurrentGroupId,
    setCurrentListId,
    setFocusMode,
    setFocusTimerAlways,
    setGroupsEnabled,
    setKanbanEnabled,
    setPlanEnabled,
    setSomedayEnabled,
    setSomedayExpanded,
    setView,
    viewRestoredRef,
  ]);

  return { lang, setLang, theme, setTheme, zoom, setZoom, systemDark };
}
