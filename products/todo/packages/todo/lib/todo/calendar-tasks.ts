"use client";

import dynamicIconImports from "lucide-react/dynamicIconImports";

import type { CalendarTaskSource } from "@/lib/todo/calendar-task-sources";
import { listInitials, resolveListIconId } from "@/lib/todo/list-icons";

export { calendarTaskSources, type CalendarTaskSource } from "@/lib/todo/calendar-task-sources";

/**
 * The tasks the Calendar draws, with the mark of each task's list.
 *
 * The calendar script is plain JavaScript and has no React, so it cannot draw
 * a list icon component. It gets the icon as shape data (the tag and the
 * attributes of each shape) and makes the SVG itself. A list with no icon
 * gets its two letters, as on the board. A task on no list gets neither, and
 * the script draws its own small tick.
 *
 * Both calendars use this: the To-Do tab's Calendar View and the planner's
 * Calendar tab.
 */

/** One shape of an icon: its SVG tag and its attributes. */
export type CalendarIconShape = [tag: string, attrs: Record<string, string>];

/** A task as the calendar script takes one. */
export type CalendarTask = {
  id: string;
  dateKey: string;
  name: string;
  minutes?: number | null;
  /** False: the week shows it, the months do not. */
  shown: boolean;
  listName?: string;
  initials?: string;
  icon?: CalendarIconShape[];
  /** Who the task is for, by person id. The script has the people. */
  assigneeIds?: string[];
  /** The task's list, for the Lists pill; absent for a task on no list. */
  listId?: string;
  /** Ticked: struck through in the week, left out of the months. */
  completed?: boolean;
};

/**
 * A list as the Lists pill shows it: its mark, as a task's is, and the tab
 * group it is in, so the pill can show the lists under their groups.
 */
export type CalendarTaskList = {
  id: string;
  name: string;
  initials?: string;
  icon?: CalendarIconShape[];
  groupId: string | null;
  groupName: string | null;
};

const loaded = new Map<string, CalendarIconShape[] | null>();

type IconModule = { __iconNode?: CalendarIconShape[] };
const imports = dynamicIconImports as unknown as Record<
  string,
  (() => Promise<IconModule>) | undefined
>;

async function loadIcon(iconId: string): Promise<void> {
  if (loaded.has(iconId)) return;
  try {
    const mod = await imports[iconId]?.();
    const shapes = mod?.__iconNode;
    loaded.set(iconId, Array.isArray(shapes) ? shapes : null);
  } catch {
    loaded.set(iconId, null);
  }
}

/**
 * Load the icons these tasks need. Answers true when an icon came in that
 * was not there before, so the caller knows to make the tasks again.
 */
export async function loadCalendarTaskIcons(
  sources: CalendarTaskSource[],
): Promise<boolean> {
  const wanted = new Set<string>();
  for (const s of sources) {
    const iconId = resolveListIconId(s.listIcon);
    if (iconId && !loaded.has(iconId)) wanted.add(iconId);
  }
  if (wanted.size === 0) return false;
  await Promise.all([...wanted].map(loadIcon));
  return true;
}

/** The tasks for the script, with the icons that are loaded at this moment. */
export function toCalendarTasks(sources: CalendarTaskSource[]): CalendarTask[] {
  return sources.map((s) => {
    const task: CalendarTask = {
      id: s.id,
      dateKey: s.dateKey,
      name: s.name,
      minutes: s.minutes ?? null,
      shown: s.shown,
      assigneeIds: s.assigneeIds,
    };
    if (s.completed) task.completed = true;
    if (s.listId) task.listId = s.listId;
    if (!s.listName) return task;
    task.listName = s.listName;
    const iconId = resolveListIconId(s.listIcon);
    const icon = iconId ? loaded.get(iconId) : null;
    if (icon) task.icon = icon;
    else task.initials = listInitials(s.listName);
    return task;
  });
}

type BoardList = { id: string; name: string; emoji?: string | null; groupId?: string | null };

/**
 * The lists for the Lists pill, in the board's order: under their tab
 * groups when the board has them on (`groups` given), else as one run.
 */
export function toCalendarLists(
  lists: readonly BoardList[],
  groups: readonly { id: string; name: string }[],
): CalendarTaskList[] {
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const order = new Map(groups.map((g, i) => [g.id, i]));
  const grouped = [...lists].sort((a, b) => {
    const ga = a.groupId && groupName.has(a.groupId) ? (order.get(a.groupId) ?? 0) : groups.length;
    const gb = b.groupId && groupName.has(b.groupId) ? (order.get(b.groupId) ?? 0) : groups.length;
    return ga - gb;
  });
  return grouped.map((l) => {
    const inGroup = l.groupId && groupName.has(l.groupId) ? l.groupId : null;
    const list: CalendarTaskList = {
      id: l.id,
      name: l.name,
      groupId: inGroup,
      groupName: inGroup ? (groupName.get(inGroup) ?? null) : null,
    };
    const iconId = resolveListIconId(l.emoji);
    const icon = iconId ? loaded.get(iconId) : null;
    if (icon) list.icon = icon;
    else list.initials = listInitials(l.name);
    return list;
  });
}

/** Load the icons of these lists; true when one came in that was not there. */
export async function loadCalendarListIcons(lists: readonly BoardList[]): Promise<boolean> {
  const wanted = new Set<string>();
  for (const l of lists) {
    const iconId = resolveListIconId(l.emoji);
    if (iconId && !loaded.has(iconId)) wanted.add(iconId);
  }
  if (wanted.size === 0) return false;
  await Promise.all([...wanted].map(loadIcon));
  return true;
}

