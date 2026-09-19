"use client";

import dynamicIconImports from "lucide-react/dynamicIconImports";

import { listInitials, resolveListIconId } from "@/lib/todo/list-icons";

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

/** A task with what is known about its list. */
export type CalendarTaskSource = {
  id: string;
  dateKey: string;
  name: string;
  /** The time the task is expected to take. A block in the week view starts that long. */
  minutes?: number | null;
  listName: string | null;
  /** The list's stored appearance value: an icon id, or an old emoji. */
  listIcon: string | null;
};

/** A task as the calendar script takes one. */
export type CalendarTask = {
  id: string;
  dateKey: string;
  name: string;
  minutes?: number | null;
  listName?: string;
  initials?: string;
  icon?: CalendarIconShape[];
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
    const task: CalendarTask = { id: s.id, dateKey: s.dateKey, name: s.name, minutes: s.minutes ?? null };
    if (!s.listName) return task;
    task.listName = s.listName;
    const iconId = resolveListIconId(s.listIcon);
    const icon = iconId ? loaded.get(iconId) : null;
    if (icon) task.icon = icon;
    else task.initials = listInitials(s.listName);
    return task;
  });
}
