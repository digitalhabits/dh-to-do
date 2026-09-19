"use client";

/**
 * Planner View — the calendar surface inside To-Do.
 *
 * This mounts the same vanilla plan.js that the planner's Calendar tab
 * serves from /redd-do-calendar (components/CalendarView.tsx wraps it
 * there). Calendar tab work therefore lands here without a port. The
 * differences are deliberate:
 *
 *  - Own storage prefix. The Calendar tab keys ('redd-do-plan-*') are
 *    team state, synced with the planner server. This surface keeps its
 *    own local keys, so its linked calendars and notes are independent
 *    of any account linking elsewhere in the planner.
 *  - No server sync. State lives in localStorage in both hosts, which
 *    is also all the standalone app has.
 *  - ICS fetch: the planner host proxies through /api/calendar-proxy
 *    (webview fetch answers to CORS); the standalone app uses the Tauri
 *    HTTP plugin.
 */

import * as React from "react";

import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import type { TodoLang } from "@/lib/todo/i18n";
import {
  loadCalendarTaskIcons,
  toCalendarTasks,
  type CalendarTask,
  type CalendarTaskSource,
} from "@/lib/todo/calendar-tasks";
import { TaskAssignMenu } from "@/components/todo/TodoPeopleEditor";
import { colourForPerson, initialsOf, shortPersonName } from "@/lib/todo/people";
import type { TodoList, TodoPerson, TodoTask } from "@/lib/todo/types";

const ASSET_BASE = "/redd-do-calendar";
/** Not 'redd-do-plan-': that namespace belongs to the planner Calendar tab. */
const STORAGE_PREFIX = "redd-todo-plan-";

declare global {
  interface Window {
    PlanModule?: {
      init: (
        el: HTMLElement,
        options?: {
          storagePrefix?: string;
          language?: string;
          /** Who a week goal can be for: the To-Do people list. */
          people?: { id: string; name: string; colour: string; photoUrl?: string | null; initials?: string; shortName?: string }[];
          /** Adds a person to that list, and answers with the person. */
          onAddPerson?: (
            name: string,
          ) => Promise<{ id: string; name: string; colour: string; photoUrl?: string | null; initials?: string; shortName?: string } | null>;
          /**
           * The host's menu for who a goal is for: the one a task is
           * assigned from. A request opens it, null puts it away. Left out,
           * the goal card draws a plain list of its own.
           */
          onPickGoalPerson?: (
            request: {
              anchorEl: HTMLElement;
              assigneeId: string | null;
              onPick: (personId: string | null) => void;
              onLeave: () => void;
            } | null,
          ) => void;
          tasks?: CalendarTask[];
          /** Every task of the board, for a week goal to be linked to. */
          linkableTasks?: { id: string; name: string; listName: string | null; completed: boolean }[];
          /** The person who is the reader: a new goal is theirs. */
          mePersonId?: string | null;
          /**
           * A task was dragged to another day in the week view: give it that
           * due date. Left out, a task stays in its own day.
           */
          onTaskDueChange?: (taskId: string, dateKey: string) => Promise<void> | void;
          /**
           * A task was double-clicked: open it for editing, beside the place
           * given (in the window's own pixels). Left out, nothing opens.
           */
          onTaskOpen?: (
            taskId: string,
            anchor: { left: number; top: number; right: number; bottom: number },
          ) => void;
          /**
           * A day was double-clicked: make a task for that day. `startMinutes`
           * is the time, when the click was in the hours of the week view.
           * Left out, a double click on a day makes no task.
           */
          onTaskCreate?: (request: {
            dateKey: string;
            startMinutes: number | null;
            anchor: { left: number; top: number; right: number; bottom: number };
          }) => void;
        },
      ) => void;
      destroy: () => void;
      refresh: () => void;
      setPeople: (
        people: { id: string; name: string; colour: string; photoUrl?: string | null; initials?: string; shortName?: string }[],
      ) => void;
      /** Tasks to draw on their due day: the ones ticked "Show on the Calendar". */
      setTasks: (tasks: CalendarTask[]) => void;
      /** Give a task its hours in the week view, in minutes from midnight. */
      setTaskTime: (taskId: string, startMinutes: number, endMinutes: number) => void;
      /** Every task of the board, for a week goal to be linked to. */
      setLinkableTasks: (
        tasks: { id: string; name: string; listName: string | null; completed: boolean }[],
      ) => void;
      /** The person who is the reader: a new goal is theirs. */
      setMe: (personId: string | null) => void;
    };
    tauriAPI?: { fetch: typeof fetch };
  }
}

// Same data attribute as components/CalendarView.tsx, so in the planner the
// two surfaces share one loaded copy of each script.
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-redd-do-calendar="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ${src}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.reddDoCalendar = src;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${src}`)),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

function loadStylesheet(href: string) {
  if (document.querySelector(`link[data-redd-do-calendar="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.reddDoCalendar = href;
  document.head.appendChild(link);
}

let calendarScriptsPromise: Promise<void> | null = null;

function ensureCalendarScriptsLoaded(): Promise<void> {
  if (!calendarScriptsPromise) {
    calendarScriptsPromise = (async () => {
      await loadScript(`${ASSET_BASE}/ical.js`);
      await loadScript(`${ASSET_BASE}/calendar-sync.js`);
      // plan.js reads these rules as window.PlanCalendarEvents the moment
      // it draws a day, so they go up first. The Calendar tab loads the
      // same four in the same order (see components/CalendarView.tsx).
      await loadScript(`${ASSET_BASE}/calendar-events.js`);
      await loadScript(`${ASSET_BASE}/plan.js`);
    })();
  }
  return calendarScriptsPromise;
}

function toPlannerPeople(people: TodoPerson[]): PlannerPerson[] {
  return people.map((p) => ({
    id: p.id,
    name: p.name,
    colour: colourForPerson(p.name, p.colour),
    photoUrl: p.photoUrl ?? null,
    initials: initialsOf(p.name),
    shortName: shortPersonName(p.name),
  }));
}

/** calendar-sync.js fetches ICS feeds through window.tauriAPI.fetch. */
function installCalendarFetch() {
  if (isStandaloneTodo()) {
    window.tauriAPI = {
      fetch: async (input, init) => {
        const { fetch: nativeFetch } = await import("@tauri-apps/plugin-http");
        return nativeFetch(input as Parameters<typeof nativeFetch>[0], init);
      },
    } as { fetch: typeof fetch };
    return;
  }
  window.tauriAPI = {
    fetch: (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const proxied = `/api/calendar-proxy?url=${encodeURIComponent(url)}`;
      return fetch(proxied, init);
    },
  } as { fetch: typeof fetch };
}

/** Where a task is on the Calendar, in the window's own pixels. */
export type CalendarTaskAnchor = { left: number; top: number; right: number; bottom: number };

/** A double click on a day of the Calendar: a new task is wanted there. */
export type CalendarTaskRequest = {
  dateKey: string;
  /** The time, when the click was in the hours of the week view. */
  startMinutes: number | null;
  anchor: CalendarTaskAnchor;
};

/** A person as the calendar script needs one: who a week goal can be for. */
export type PlannerPerson = {
  id: string;
  name: string;
  colour: string;
  /** As on a task: the photo, the two letters, and "Vera H.". */
  photoUrl: string | null;
  initials: string;
  shortName: string;
};

/** The goal card asks who the goal is for. `onPick(null)` is nobody. */
export type GoalPersonRequest = {
  anchorEl: HTMLElement;
  assigneeId: string | null;
  onPick: (personId: string | null) => void;
  /** "Edit people…" was chosen: the card keeps what it has and closes. */
  onLeave: () => void;
};

export function TodoPlannerView({
  lang,
  people,
  onAddPerson,
  tasks,
  lists,
  onTaskDueChange,
  onTaskOpen,
  onTaskCreate,
  mePersonId,
  t,
  onEditPeople,
}: {
  lang: TodoLang;
  /** For the assign menu of a goal, the same menu a task has. */
  t: (key: string) => string;
  onEditPeople: () => void;
  /** The board's people, the list a task is assigned from. */
  people: TodoPerson[];
  /** Adds a person to that list, and answers with the person. */
  onAddPerson: (name: string) => Promise<TodoPerson | null>;
  /** The board's tasks. The ones to show here are picked out below. */
  tasks: TodoTask[];
  /** The board's lists: a task on the Calendar shows the mark of its list. */
  lists: TodoList[];
  /** A task was dragged to another day in the week view. */
  onTaskDueChange: (taskId: string, dueOn: string) => Promise<void> | void;
  /** A task was double-clicked on the Calendar: show its card beside it. */
  onTaskOpen: (taskId: string, anchor: CalendarTaskAnchor) => void;
  /** A day was double-clicked on the Calendar: show the add-task box beside it. */
  onTaskCreate: (request: CalendarTaskRequest) => void;
  /** The person who is the reader, when the board knows. A new goal is theirs. */
  mePersonId: string | null;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  /** The goal card's question, while the assign menu is up for it. */
  const [goalPick, setGoalPick] = React.useState<GoalPersonRequest | null>(null);

  // The script is started once for each language. It reads the newest people
  // and the newest callback through these, so a change to either does not
  // start it again and lose an open form.
  const plannerPeople = React.useMemo(() => toPlannerPeople(people), [people]);
  const peopleRef = React.useRef(plannerPeople);
  peopleRef.current = plannerPeople;
  const onAddPersonRef = React.useRef(onAddPerson);
  onAddPersonRef.current = onAddPerson;
  const onTaskDueChangeRef = React.useRef(onTaskDueChange);
  onTaskDueChangeRef.current = onTaskDueChange;
  const onTaskOpenRef = React.useRef(onTaskOpen);
  onTaskOpenRef.current = onTaskOpen;
  const onTaskCreateRef = React.useRef(onTaskCreate);
  onTaskCreateRef.current = onTaskCreate;

  React.useEffect(() => {
    window.PlanModule?.setPeople(plannerPeople);
  }, [plannerPeople]);

  // A task is on the Calendar when it has a due day, the reader ticked
  // "Show on the Calendar", and it is still to do.
  // Each one carries the mark of its list, as the board shows that list.
  const taskSources = React.useMemo(() => {
    const listsById = new Map(lists.map((l) => [l.id, l]));
    return tasks
      .filter((t) => t.showOnCalendar && t.dueOn && !t.completed)
      .map((t): CalendarTaskSource => {
        const list = t.listId ? listsById.get(t.listId) : undefined;
        return {
          id: t.id,
          dateKey: t.dueOn as string,
          name: t.text,
          minutes: t.expectedDurationMinutes,
          listName: list?.name ?? null,
          listIcon: list?.emoji ?? null,
        };
      });
  }, [tasks, lists]);
  // Every task, for a goal to be linked to, and to count how many of a goal's
  // tasks are done. Steps of a task are not offered.
  const linkable = React.useMemo(() => {
    const listsById = new Map(lists.map((l) => [l.id, l.name]));
    return tasks
      .filter((t) => !t.parentTaskId)
      .map((t) => ({
        id: t.id,
        name: t.text,
        listName: t.listId ? (listsById.get(t.listId) ?? null) : null,
        completed: t.completed,
      }));
  }, [tasks, lists]);
  const linkableRef = React.useRef(linkable);
  linkableRef.current = linkable;
  React.useEffect(() => {
    window.PlanModule?.setLinkableTasks(linkable);
  }, [linkable]);
  const meRef = React.useRef(mePersonId);
  meRef.current = mePersonId;
  React.useEffect(() => {
    window.PlanModule?.setMe(mePersonId);
  }, [mePersonId]);

  const tasksRef = React.useRef<CalendarTask[]>([]);
  tasksRef.current = toCalendarTasks(taskSources);
  React.useEffect(() => {
    let live = true;
    // An icon is loaded on first use. Give the tasks when the icons are in,
    // so a task does not show its letters first and its icon a moment later.
    void loadCalendarTaskIcons(taskSources).then(() => {
      if (!live) return;
      tasksRef.current = toCalendarTasks(taskSources);
      window.PlanModule?.setTasks(tasksRef.current);
    });
    return () => {
      live = false;
    };
  }, [taskSources]);

  React.useEffect(() => {
    let cancelled = false;

    installCalendarFetch();
    loadStylesheet(`${ASSET_BASE}/plan.css`);

    void (async () => {
      try {
        await ensureCalendarScriptsLoaded();
        if (cancelled || !containerRef.current || !window.PlanModule) return;
        window.PlanModule.init(containerRef.current, {
          storagePrefix: STORAGE_PREFIX,
          language: lang,
          people: peopleRef.current,
          tasks: tasksRef.current,
          linkableTasks: linkableRef.current,
          mePersonId: meRef.current,
          onTaskDueChange: (taskId: string, dateKey: string) =>
            onTaskDueChangeRef.current(taskId, dateKey),
          onTaskOpen: (taskId: string, anchor: CalendarTaskAnchor) =>
            onTaskOpenRef.current(taskId, anchor),
          onTaskCreate: (request: CalendarTaskRequest) => onTaskCreateRef.current(request),
          onAddPerson: async (name: string) => {
            const person = await onAddPersonRef.current(name);
            return person ? toPlannerPeople([person])[0] : null;
          },
          // A second press on the card's button puts the menu away.
          onPickGoalPerson: (request) =>
            setGoalPick((open) =>
              request && open?.anchorEl === request.anchorEl ? null : request
            ),
        });
      } catch (err) {
        console.error("[TodoPlannerView] Failed to initialise calendar:", err);
      }
    })();

    return () => {
      cancelled = true;
      try {
        window.PlanModule?.destroy();
      } catch (err) {
        console.error("[TodoPlannerView] destroy failed:", err);
      }
    };
  }, [lang]);

  // plan.css scopes every calendar rule under #plan-mode.
  return (
    <>
      <div id="plan-mode" ref={containerRef} className="todo-plan-view" />
      {/* Who a goal is for: the menu a task is assigned from. A goal is for
          one person, so a pick closes the menu, and a pick of the person it
          has takes the person away. */}
      <TaskAssignMenu
        open={goalPick != null}
        anchorEl={goalPick?.anchorEl ?? null}
        people={people}
        assigneeIds={goalPick?.assigneeId ? [goalPick.assigneeId] : []}
        t={t}
        onToggle={(personId) => {
          if (!goalPick) return;
          goalPick.onPick(goalPick.assigneeId === personId ? null : personId);
          setGoalPick(null);
        }}
        onEditPeople={() => {
          goalPick?.onLeave();
          setGoalPick(null);
          onEditPeople();
        }}
        onClose={() => setGoalPick(null)}
      />
    </>
  );
}
