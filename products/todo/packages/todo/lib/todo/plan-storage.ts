/**
 * Where the To-Do calendar (TodoPlannerView) keeps what it draws, and what a
 * host adds to it.
 *
 * plan.js keeps its data in the window's localStorage. The standalone app is
 * one window at one address, so that is enough there, and it gives nothing
 * here. The Planner keeps the whole calendar on its server, the same one its
 * Calendar tab shows, and adds its Google calendars, deadlines and Roadmap
 * (the Planner's lib/plan/planner-calendar-host.ts): it says how through
 * this context. `prepare` runs before the calendar starts (to
 * load the shared data into localStorage), `start` once it is up (to send
 * changes on), and what `start` returns when it closes.
 */

import * as React from "react";

import type { CalendarFeed, CalendarSource, PickableAccount } from "@/lib/plan/calendar-board";

/** What a host adds to the calendar script's own options. */
export type TodoPlanHostOptions = {
  /** The accounts and calendars the picker offers. Left out: pasted addresses. */
  onListCalendarChoices?: () => Promise<PickableAccount[]>;
  /** The events of the calendars given, read by the host. */
  onReadCalendarEvents?: (
    sources: CalendarSource[],
    options?: { full?: boolean }
  ) => Promise<CalendarFeed[]>;
  /** What the board draws besides calendars, each with a name and whether it is on. */
  boardSources?: { id: string; name: string; detail?: string; colour?: string; shown?: boolean }[];
  /** The reader turned one of those on or off. */
  onBoardSourceToggle?: (id: string, shown: boolean) => Promise<void> | void;
  /** A Roadmap band was moved or made longer; ISO dates. */
  onRoadmapItemChange?: (id: string, start: string, end: string) => Promise<void> | void;
};

export type TodoPlanStorage = {
  /**
   * The calendar's localStorage keys start with this. Unset: To-Do's own,
   * kept on the device. The Planner gives the team calendar's.
   */
  storagePrefix?: string;
  prepare: (storagePrefix: string) => Promise<void>;
  start: (storagePrefix: string) => () => void;
  /** What the host adds to the calendar: its calendars, its layers. */
  initOptions?: () => TodoPlanHostOptions;
};

export const TodoPlanStorageContext = React.createContext<TodoPlanStorage | null>(null);
