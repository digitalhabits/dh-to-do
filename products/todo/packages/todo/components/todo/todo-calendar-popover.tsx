"use client";

/*
 * The task's card over the Calendar, and the add-task box beside a day.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) first and reads the names it
 * needs from it. The JSX is TodoPage's own, word for word.
 */

import React from "react";
import { AddTaskComposer } from "@/components/todo/AddTaskComposer";
import { CalendarDayPopover } from "@/components/todo/calendar-day-list";
import { TaskSwitchPicker } from "@/components/todo/TaskSwitchPicker";
import type { CalendarTaskRequest } from "@/components/todo/TodoPlannerView";
import { renderTask } from "@/components/todo/todo-task-card";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { resolveBasecampImage } from "@/lib/todo/basecamp-image";
import { calendarLengthMinutes } from "@/lib/todo/duration-input";
import type { TodoTask } from "@/lib/todo/types";

/** The room over a task's card for its hover bubble: the padding-top of
    .calendar-task-popover in todo.css. */
const CALENDAR_CARD_TOP_ROOM = 22;

export function renderCalendarCard(m: TodoPageModel) {
  const {
    state,
    view,
    calendarCard,
    calendarNew,
    calendarPopoverPlace,
  } = m;
  if (view !== "plan") return null;
  if (calendarNew) return renderCalendarNewTask(m, calendarNew);
  if (!calendarCard) return renderCalendarDay(m);
  const task = state.tasks.find((item) => item.id === calendarCard.taskId);
  if (!task) return null;
  return (
    <div
      className="calendar-task-popover"
      role="dialog"
      aria-label={task.text}
      style={calendarPopoverPlace(calendarCard.anchor, CALENDAR_CARD_TOP_ROOM)}
    >
      {renderTask(m, task)}
    </div>
  );
}

/**
 * The tasks of a day, while the pointer rests on one of them in the week:
 * each as its card, the same card a click on the task opens, so it is
 * changed in the same way. See CalendarDayPopover.
 */
function renderCalendarDay(m: TodoPageModel) {
  return m.calendarDay ? <CalendarDayPopover m={m} /> : null;
}

/**
 * The add-task box over the Calendar, beside the day that was
 * double-clicked (or whose "+ Add a task" was pressed). It makes a new task,
 * or puts an existing one on the day: see CalendarNewTask.
 */
export function renderCalendarNewTask(m: TodoPageModel, request: CalendarTaskRequest) {
  return (
    <CalendarNewTask
      key={`${request.dateKey}-${request.startMinutes ?? "day"}`}
      m={m}
      request={request}
    />
  );
}

/** Give a task on the Calendar the hours of the place it was put, if any. */
function giveCalendarHours(id: string, request: CalendarTaskRequest, minutes: number) {
  if (request.startMinutes == null) return;
  window.PlanModule?.setTaskTime(
    id,
    request.startMinutes,
    Math.min(request.startMinutes + minutes, 23 * 60)
  );
}

/**
 * Two ways in, side by side at the top. "New task" is the add-task box of
 * a list, with the due day set. "Existing task" is the focus window's task
 * switcher: the task picked gets the day as its due date. Either way the
 * task is ticked for the Calendar, gets its hours when the click was in the
 * hours of the week view, and then its card takes the place of the box, as
 * after a click on a task.
 */
function CalendarNewTask({ m, request }: { m: TodoPageModel; request: CalendarTaskRequest }) {
  // Every list, not the tab group the list view has open: the Calendar is
  // the whole board's.
  const { state, setCalendarCard, setCalendarNew, t, listsSorted: lists, mutateTask, calendarPopoverPlace } = m;
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const showCard = (id: string) => {
    setCalendarNew(null);
    setCalendarCard({ taskId: id, anchor: request.anchor });
  };
  const pickExisting = (task: TodoTask) => {
    void (async () => {
      await mutateTask(task.id, { dueOn: request.dateKey, showOnCalendar: true });
      giveCalendarHours(task.id, request, task.expectedDurationMinutes || 30);
      showCard(task.id);
    })();
  };
  return (
    <div
      className="calendar-task-popover calendar-task-popover--new"
      role="dialog"
      aria-label={t("addTask")}
      style={calendarPopoverPlace(request.anchor)}
    >
      <div className="calendar-task-mode" role="tablist">
        {(["new", "existing"] as const).map((each) => (
          <button
            key={each}
            type="button"
            role="tab"
            aria-selected={mode === each}
            className={`calendar-task-mode-btn${mode === each ? " active" : ""}`}
            onClick={() => setMode(each)}
          >
            {t(each === "new" ? "calendarNewTask" : "calendarExistingTask")}
          </button>
        ))}
      </div>
      {mode === "new" ? (
        renderNewTaskComposer(m, request, showCard)
      ) : (
        <div className="calendar-task-pick">
          <TaskSwitchPicker
            tasks={state.tasks}
            lists={lists}
            preferredListId={null}
            placeholder={t("calendarPickTaskPlaceholder")}
            t={t}
            onPick={pickExisting}
            onEscape={() => setCalendarNew(null)}
          />
        </div>
      )}
    </div>
  );
}

function renderNewTaskComposer(
  m: TodoPageModel,
  request: CalendarTaskRequest,
  showCard: (id: string) => void
) {
  // Every list, and No list to start: what the list view has open is not
  // the Calendar's.
  const { state, assignEnabled, setPeopleEditorOpen, lang, t, listsSorted: lists, mutateTask, addTask, uploaderForList } = m;
  return (
    <AddTaskComposer
      placeholder={t("addTaskPlaceholder")}
      addLabel={t("addTask")}
      minutesLabel={t("minutes")}
      initialDraft={{ dueOn: request.dateKey }}
      autoFocus
      onSubmit={(draft) => {
        void (async () => {
          const id = await addTask("week", draft);
          if (!id) return;
          await mutateTask(id, { showOnCalendar: true });
          if (draft.dueOn === request.dateKey) {
            giveCalendarHours(id, request, calendarLengthMinutes(draft.duration));
          }
          showCard(id);
        })();
      }}
      uploadImageForList={uploaderForList}
      resolveImageSrc={resolveBasecampImage}
      people={state.people}
      assignEnabled={assignEnabled}
      onEditPeople={() => setPeopleEditorOpen(true)}
      lists={lists}
      defaultList={null}
      lang={lang}
      t={t}
    />
  );
}
