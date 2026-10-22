"use client";

/*
 * The tasks of a day over the Calendar, as their cards (see
 * renderCalendarDay), and the drag of a card in it.
 *
 * Moved up or down in the list, a card takes its new place among the
 * day's tasks: its position is written as the board's drop writes one, so
 * the same order shows in the Today column and in the lists. Taken out of
 * the list, the list goes and the Calendar carries on with the drag, so
 * the task can go to another day or to a time, as its chip in the week
 * can.
 */

import * as React from "react";

import { isInteractiveDragTarget } from "@/components/todo/use-pointer-drag";
import { renderTask } from "@/components/todo/todo-task-card";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { dayOrderWrites } from "@/lib/todo/board-drop";
import type { TodoTask } from "@/lib/todo/types";

const DRAG_START_PX = 4;

type Drag = { taskId: string; x: number; y: number; started: boolean };

/** The ids in the order the pointer makes, with `taskId` at the place of `y`. */
function orderAt(list: HTMLElement, ids: string[], taskId: string, y: number): string[] {
  const rest = ids.filter((id) => id !== taskId);
  let at = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const card = list.querySelector<HTMLElement>(`[data-day-task="${CSS.escape(rest[i])}"]`);
    if (!card) continue;
    const r = card.getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      at = i;
      break;
    }
  }
  rest.splice(at, 0, taskId);
  return rest;
}

function outside(el: HTMLElement, x: number, y: number): boolean {
  const r = el.getBoundingClientRect();
  return x < r.left || x > r.right || y < r.top || y > r.bottom;
}

/** The list of a day: its title, the cards, and the way to a new task. */
export function CalendarDayPopover({ m }: { m: TodoPageModel }) {
  const { state, calendarDay, calendarPopoverPlace, holdCalendarDay, openCalendarNewTask, t } = m;
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  if (!calendarDay) return null;
  // In their order on the board, so a move here shows at once. A task given
  // another due day here leaves the list at once: it is not due this day.
  const tasks = calendarDay.taskIds
    .map((id) => state.tasks.find((task) => task.id === id))
    .filter((task): task is TodoTask => task?.dueOn === calendarDay.dateKey)
    // Open tasks first, as in the week: the done ones are below them.
    .sort((a, b) => Number(a.completed) - Number(b.completed) || a.position - b.position);
  if (!tasks.length) return null;
  return (
    <div
      ref={popoverRef}
      className="calendar-task-popover calendar-day-popover"
      role="dialog"
      aria-label={calendarDay.title}
      style={calendarPopoverPlace(calendarDay.anchor)}
      onPointerEnter={() => holdCalendarDay(true)}
      onPointerLeave={() => holdCalendarDay(false)}
    >
      <div className="calendar-day-head">{calendarDay.title}</div>
      <CalendarDayList m={m} tasks={tasks} popoverRef={popoverRef} />
      <button
        type="button"
        className="calendar-day-add"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openCalendarNewTask({
            dateKey: calendarDay.dateKey,
            startMinutes: null,
            anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          });
        }}
      >
        + {t("addTaskForDay")}
      </button>
    </div>
  );
}

function CalendarDayList({
  m,
  tasks,
  popoverRef,
}: {
  m: TodoPageModel;
  /** The day's tasks, in their order. */
  tasks: TodoTask[];
  /** The whole list over the Calendar: out of it, the Calendar takes the drag. */
  popoverRef: React.RefObject<HTMLDivElement | null>;
}) {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<Drag | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<string[] | null>(null);
  const previewRef = React.useRef<string[] | null>(null);
  previewRef.current = preview;
  const tasksRef = React.useRef(tasks);
  tasksRef.current = tasks;
  const mRef = React.useRef(m);
  mRef.current = m;

  const stop = React.useRef<() => void>(() => {});

  const begin = (e: React.PointerEvent, task: TodoTask) => {
    if (e.button !== 0 || task.completed || e.pointerType === "touch") return;
    if (isInteractiveDragTarget(e.target)) return;
    dragRef.current = { taskId: task.id, x: e.clientX, y: e.clientY, started: false };

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      const list = listRef.current;
      const popover = popoverRef.current;
      if (!drag || !list || !popover) return;
      if (!drag.started) {
        if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < DRAG_START_PX) return;
        drag.started = true;
        window.getSelection()?.removeAllRanges();
        setDraggingId(drag.taskId);
      }
      ev.preventDefault();
      if (outside(popover, ev.clientX, ev.clientY)) {
        // Out of the list: the Calendar carries the task from here.
        const carried = window.PlanModule?.carryTask?.(drag.taskId, ev.clientX, ev.clientY);
        if (carried) {
          stop.current();
          mRef.current.setCalendarDay(null);
          window.PlanModule?.dayTasksClosed?.();
          return;
        }
      }
      const ids = tasksRef.current.map((t) => t.id);
      const next = orderAt(list, ids, drag.taskId, ev.clientY);
      setPreview((prev) =>
        prev && prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next
      );
    };

    const onUp = () => {
      const drag = dragRef.current;
      const order = previewRef.current;
      stop.current();
      if (!drag?.started || !order) return;
      // The click that ends a drag is not a click on the card.
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      for (const write of dayOrderWrites(tasksRef.current, order, Date.now())) {
        void mRef.current.mutateTask(write.id, write.patch);
      }
    };

    stop.current = () => {
      dragRef.current = null;
      setDraggingId(null);
      setPreview(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  React.useEffect(() => () => stop.current(), []);

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const shown = preview
    ? preview.map((id) => byId.get(id)).filter((t): t is TodoTask => Boolean(t))
    : tasks;
  return (
    <div ref={listRef} className={`calendar-day-tasks${draggingId ? " is-dragging" : ""}`}>
      {shown.map((task) => (
        <div
          key={task.id}
          data-day-task={task.id}
          className={`calendar-day-card${draggingId === task.id ? " is-carried" : ""}`}
          onPointerDown={(e) => begin(e, task)}
        >
          {renderTask(m, task)}
        </div>
      ))}
    </div>
  );
}
