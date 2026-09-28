"use client";

/*
 * The task's card over the Calendar, and the add-task box beside a day.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) first and reads the names it
 * needs from it. The JSX is TodoPage's own, word for word.
 */

import { AddTaskComposer } from "@/components/todo/AddTaskComposer";
import type { CalendarTaskRequest } from "@/components/todo/TodoPlannerView";
import { renderTask } from "@/components/todo/todo-task-card";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { resolveBasecampImage } from "@/lib/todo/basecamp-image";
import { calendarLengthMinutes } from "@/lib/todo/duration-input";

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
  if (!calendarCard) return null;
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
 * The add-task box over the Calendar, beside the day that was
 * double-clicked. It is the add-task box of a list, with the due day set.
 * The new task is ticked for the Calendar, it gets its hours when the
 * click was in the hours of the week view, and then its card takes the
 * place of the box, as after a double click on a task.
 */
export function renderCalendarNewTask(m: TodoPageModel, request: CalendarTaskRequest) {
  const {
    state,
    setCalendarCard,
    setCalendarNew,
    assignEnabled,
    setPeopleEditorOpen,
    lang,
    t,
    lists,
    addTargetList,
    mutateTask,
    addTask,
    uploaderForList,
    calendarPopoverPlace,
  } = m;
  return (
    <div
      className="calendar-task-popover calendar-task-popover--new"
      role="dialog"
      aria-label={t("addTask")}
      style={calendarPopoverPlace(request.anchor)}
    >
      <AddTaskComposer
        key={`${request.dateKey}-${request.startMinutes ?? "day"}`}
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
            if (request.startMinutes != null && draft.dueOn === request.dateKey) {
              const length = calendarLengthMinutes(draft.duration);
              window.PlanModule?.setTaskTime(
                id,
                request.startMinutes,
                Math.min(request.startMinutes + length, 23 * 60)
              );
            }
            setCalendarNew(null);
            setCalendarCard({ taskId: id, anchor: request.anchor });
          })();
        }}
        uploadImageForList={uploaderForList}
        resolveImageSrc={resolveBasecampImage}
        people={state.people}
        assignEnabled={assignEnabled}
        onEditPeople={() => setPeopleEditorOpen(true)}
        lists={lists}
        defaultList={addTargetList}
        lang={lang}
        t={t}
      />
    </div>
  );
}
