"use client";

import * as React from "react";

import { persistPref } from "@/lib/todo/saved-prefs";

/** Where the Compact cards choice is kept on this device. */
const COMPACT_CARDS_KEY = "redd-plan-todo-compact-cards";

/**
 * Compact cards: each task on one line where it fits, its date, people and
 * list beside its name. Off unless picked in Settings; a device setting.
 */
export function useCompactCards() {
  const [compactCards, setCompactCards] = React.useState(() => {
    try {
      return localStorage.getItem(COMPACT_CARDS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const changeCompactCards = React.useCallback((on: boolean) => {
    setCompactCards(on);
    persistPref(COMPACT_CARDS_KEY, on ? "1" : "0");
  }, []);
  return { compactCards, changeCompactCards };
}
