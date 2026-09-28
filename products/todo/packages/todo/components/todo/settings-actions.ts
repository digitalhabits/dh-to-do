"use client";

import type * as React from "react";

import type { TodoTheme } from "@/components/todo/TodoSettingsModal";
import { FOCUS_TIMER_ALWAYS_KEY, FOCUS_TIMER_PREF_MESSAGE } from "@/lib/todo/focus-time";
import type { TodoLang } from "@/lib/todo/i18n";
import {
  ASSIGN_ENABLED_KEY,
  KANBAN_KEY,
  LANG_KEY,
  PLAN_ENABLED_KEY,
  SOMEDAY_ENABLED_KEY,
  THEME_KEY,
  ZOOM_KEY,
  persistPref,
} from "@/lib/todo/saved-prefs";
import { boardColumnPatch, type TodoTask, type TodoTaskPatch } from "@/lib/todo/types";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

/**
 * What a change in the Settings dialog does. Each handler sets the page's
 * state and keeps the choice for the next visit. Not a hook: it holds no
 * state and runs no effect, so it can be made again on each render.
 */
export function settingsActions({
  setLang,
  setTheme,
  setZoom,
  setKanbanEnabled,
  setSomedayEnabled,
  setAssignEnabled,
  setFocusTimerAlways,
  setPlanEnabled,
  setAssigneeFilterIds,
  setPeopleEditorOpen,
  closeAssignMenu,
  tasksRef,
  focusChannelRef,
  mutateTask,
}: {
  setLang: SetState<TodoLang>;
  setTheme: SetState<TodoTheme>;
  setZoom: SetState<number>;
  setKanbanEnabled: SetState<boolean>;
  setSomedayEnabled: SetState<boolean>;
  setAssignEnabled: SetState<boolean>;
  setFocusTimerAlways: SetState<boolean>;
  setPlanEnabled: SetState<boolean>;
  setAssigneeFilterIds: SetState<string[]>;
  setPeopleEditorOpen: SetState<boolean>;
  closeAssignMenu: () => void;
  tasksRef: React.RefObject<TodoTask[]>;
  focusChannelRef: React.RefObject<BroadcastChannel | null>;
  mutateTask: (id: string, patch: TodoTaskPatch) => Promise<unknown>;
}) {
  function changeLang(l: TodoLang) {
    setLang(l);
    persistPref(LANG_KEY, l);
  }

  function changeTheme(th: TodoTheme) {
    setTheme(th);
    persistPref(THEME_KEY, th);
  }

  function changeZoom(z: number) {
    setZoom(z);
    persistPref(ZOOM_KEY, String(z));
  }

  function changeKanbanEnabled(enabled: boolean) {
    setKanbanEnabled(enabled);
    persistPref(KANBAN_KEY, enabled ? "1" : "0");
  }

  /** Off: the Someday tasks go back to the backlog. */
  function changeSomedayEnabled(enabled: boolean) {
    if (!enabled) {
      for (const task of tasksRef.current) {
        if (!task.completed && task.isSomeday) {
          void mutateTask(task.id, boardColumnPatch("backlog"));
        }
      }
    }
    setSomedayEnabled(enabled);
    persistPref(SOMEDAY_ENABLED_KEY, enabled ? "1" : "0");
  }

  function changeAssignEnabled(enabled: boolean) {
    // The assignees stay on the tasks. Only the controls go.
    if (!enabled) {
      setAssigneeFilterIds([]);
      closeAssignMenu();
      setPeopleEditorOpen(false);
    }
    setAssignEnabled(enabled);
    persistPref(ASSIGN_ENABLED_KEY, enabled ? "1" : "0");
  }

  function changeFocusTimerAlways(always: boolean) {
    setFocusTimerAlways(always);
    persistPref(FOCUS_TIMER_ALWAYS_KEY, always ? "1" : "0");
    // A focus window is a page of its own. Tell the open ones.
    focusChannelRef.current?.postMessage({
      type: FOCUS_TIMER_PREF_MESSAGE,
      always,
    });
  }

  function changePlanEnabled(enabled: boolean) {
    setPlanEnabled(enabled);
    persistPref(PLAN_ENABLED_KEY, enabled ? "1" : "0");
  }

  return {
    changeLang,
    changeTheme,
    changeZoom,
    changeKanbanEnabled,
    changeSomedayEnabled,
    changeAssignEnabled,
    changeFocusTimerAlways,
    changePlanEnabled,
  };
}
