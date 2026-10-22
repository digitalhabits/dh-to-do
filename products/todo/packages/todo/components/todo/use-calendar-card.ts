"use client";

import * as React from "react";

import type {
  CalendarDayRequest,
  CalendarTaskAnchor,
  CalendarTaskRequest,
} from "@/components/todo/TodoPlannerView";
import type { TodoView } from "@/lib/todo/list-scope";
import type { TodoState } from "@/lib/todo/types";

/** Sent by the calendar script (plan.js) when it opens a card of its own. */
const PLAN_CARD_OPEN_EVENT = "plan-calendar-card-open";

/** The card over the Calendar, and the add-task box beside a day. */
export function useCalendarCardState({ view }: { view: TodoView }) {
  /**
   * The task whose card shows over the Calendar, and where the task is
   * there. A click on a task in the Calendar opens it. The card is
   * the same card as in the lists view, so it is changed in the same way.
   */
  const [calendarCard, setCalendarCard] = React.useState<{
    taskId: string;
    anchor: CalendarTaskAnchor;
  } | null>(null);
  /** The card that a press put away a moment ago, so the click of that press does not bring it back. */
  const calendarCardClosedRef = React.useRef<{ taskId: string; at: number } | null>(null);
  /** A day of the Calendar was double-clicked: the add-task box shows beside it. */
  const [calendarNew, setCalendarNew] = React.useState<CalendarTaskRequest | null>(null);
  /**
   * The pointer rests on a task in the week: the tasks of its day, each as
   * its card, the same card a click opens.
   */
  const [calendarDay, setCalendarDay] = React.useState<CalendarDayRequest | null>(null);
  React.useEffect(() => {
    if (view !== "plan") {
      setCalendarCard(null);
      setCalendarNew(null);
      setCalendarDay(null);
    }
  }, [view]);

  return {
    calendarCard,
    setCalendarCard,
    calendarCardClosedRef,
    calendarNew,
    setCalendarNew,
    calendarDay,
    setCalendarDay,
  };
}

/**
 * The press that put a card away does only that. The Calendar starts a note
 * or a line on mousedown, which comes just after the pointerdown that closed
 * the card, so that one mousedown is stopped before it gets there. The click
 * still comes, so a press on another task opens that task.
 */
function swallowPressOnCalendar(): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("mousedown", swallow, { capture: true, once: true });
  // A touch can come with no mousedown. Then the trap must not wait for the next press.
  window.setTimeout(() => window.removeEventListener("mousedown", swallow, true), 150);
}

/**
 * Opening the card and the add-task box from the Calendar, where they
 * stand in the window, and when they go: a press on the Calendar or the
 * top bar, Escape, or the task ticked or deleted.
 */
export function useCalendarCard({
  calendarCardState,
  state,
  zoom,
  duePopoverTaskId,
  openMenuTaskId,
  openListPickerTaskId,
  openAssignTaskId,
  editingTaskId,
  openNotesTaskId,
}: {
  calendarCardState: ReturnType<typeof useCalendarCardState>;
  state: TodoState;
  zoom: number;
  duePopoverTaskId: string | null;
  openMenuTaskId: string | null;
  openListPickerTaskId: string | null;
  openAssignTaskId: string | null;
  editingTaskId: string | null;
  openNotesTaskId: string | null;
}) {
  const {
    calendarCard,
    setCalendarCard,
    calendarCardClosedRef,
    calendarNew,
    setCalendarNew,
    calendarDay,
    setCalendarDay,
  } = calendarCardState;
  // The card over the Calendar goes away on a press on the Calendar or on the
  // top bar, and on Escape when nothing of the card's own is open. A menu of
  // the card is drawn outside the card, on the page, so a press there stays.
  const cardBusy = Boolean(
    duePopoverTaskId || openMenuTaskId || openListPickerTaskId || openAssignTaskId ||
      editingTaskId || openNotesTaskId
  );
  const cardBusyRef = React.useRef(cardBusy);
  cardBusyRef.current = cardBusy;
  const calendarCardRef = React.useRef(calendarCard);
  calendarCardRef.current = calendarCard;
  const calendarNewRef = React.useRef(calendarNew);
  calendarNewRef.current = calendarNew;
  React.useEffect(() => {
    if (!calendarCard && !calendarNew && !calendarDay) return;
    const close = () => {
      if (calendarCard) {
        calendarCardClosedRef.current = { taskId: calendarCard.taskId, at: Date.now() };
      }
      setCalendarCard(null);
      setCalendarNew(null);
      if (calendarDay) {
        setCalendarDay(null);
        window.PlanModule?.dayTasksClosed?.();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;
      if (target.closest(".calendar-task-popover")) return;
      if (target.closest(".title-bar")) close();
      else if (target.closest("#plan-mode")) {
        close();
        swallowPressOnCalendar();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || cardBusyRef.current) return;
      // A menu of the card or of the add-task box is drawn on the page.
      // Escape is for that menu first.
      if (document.querySelector(".todo-menu-portal-root, .assign-menu-portal-root")) return;
      close();
    };
    // The Calendar opened a card of its own (a Roadmap entry's): one card
    // at a time. The press that opened it never reaches the document.
    const onPlanCard = () => close();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(PLAN_CARD_OPEN_EVENT, onPlanCard);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(PLAN_CARD_OPEN_EVENT, onPlanCard);
    };
  }, [
    calendarCard,
    calendarNew,
    calendarDay,
    calendarCardClosedRef,
    setCalendarCard,
    setCalendarNew,
    setCalendarDay,
  ]);
  // A task that is ticked, or deleted, leaves the Calendar. Its card goes too,
  // after the tick has had its moment.
  const calendarCardTask = calendarCard
    ? state.tasks.find((item) => item.id === calendarCard.taskId)
    : undefined;
  const calendarCardGone = Boolean(calendarCard) && (!calendarCardTask || calendarCardTask.completed);
  React.useEffect(() => {
    if (!calendarCardGone) return;
    const id = window.setTimeout(() => setCalendarCard(null), 700);
    return () => window.clearTimeout(id);
  }, [calendarCardGone, setCalendarCard]);

  /**
   * `topRoom`: the empty room at the top of the popover, over its card. When
   * the popover opens below its anchor it is taken off, so the card itself
   * stands 10px under the task, as it stands 10px over it when it opens above.
   */
  function calendarPopoverPlace(
    at: CalendarTaskAnchor,
    topRoom = 0
  ): React.CSSProperties {
    const scale = zoom / 100;
    const winW = window.innerWidth / scale;
    const winH = window.innerHeight / scale;
    const anchor = { left: at.left / scale, top: at.top / scale, bottom: at.bottom / scale };
    const width = Math.min(420, winW - 24);
    const left = Math.min(Math.max(anchor.left, 12), winW - width - 12);
    // Under the place, or over it when the place is low in the window.
    const below = anchor.bottom < winH * 0.62;
    return below
      ? { left, width, top: anchor.bottom + 10 - topRoom }
      : { left, width, bottom: winH - anchor.top + 10 };
  }

  function openCalendarTask(taskId: string, anchor: CalendarTaskAnchor) {
    // A click on the task whose card is up puts the card away. The
    // press of that click closed it a moment ago, so it stays closed.
    const closed = calendarCardClosedRef.current;
    if (closed && closed.taskId === taskId && Date.now() - closed.at < 500) return;
    setCalendarNew(null);
    setCalendarDay(null);
    setCalendarCard({ taskId, anchor });
  }

  function openCalendarNewTask(request: CalendarTaskRequest) {
    setCalendarCard(null);
    setCalendarDay(null);
    setCalendarNew(request);
  }

  /** From the calendar script: the pointer rests on a task in the week. */
  function openCalendarDay(request: CalendarDayRequest) {
    // An open card or add-task box is the reader's work: it stays.
    if (calendarCardRef.current || calendarNewRef.current) return;
    setCalendarDay(request);
  }

  /**
   * From the calendar script: the pointer has gone. A menu of a card in the
   * list is drawn outside the list, so while one is open the list stays.
   */
  function closeCalendarDay() {
    if (cardBusyRef.current) return;
    setCalendarDay(null);
  }

  /** The pointer is on the list of a day (true), or has left it. */
  function holdCalendarDay(held: boolean) {
    if (!held && cardBusyRef.current) return;
    window.PlanModule?.holdDayTasks?.(held);
  }

  return {
    calendarPopoverPlace,
    openCalendarTask,
    openCalendarNewTask,
    openCalendarDay,
    closeCalendarDay,
    holdCalendarDay,
  };
}
