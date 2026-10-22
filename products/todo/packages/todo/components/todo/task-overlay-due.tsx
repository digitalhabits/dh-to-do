"use client";

/*
 * The due chip of the expanded card: the same picker as the card's date
 * chip (DuePopover), not the web view's own date box, which looked and
 * worked like nothing else in To-Do.
 */

import * as React from "react";
import { Calendar, X } from "lucide-react";

import { DuePopover } from "@/components/todo/DuePopover";
import type { TodoLang } from "@/lib/todo/i18n";
import { daysUntilDue, formatDueOn } from "@/lib/todo/task-draft";
import { dueDatePatch } from "@/lib/todo/task-helpers";
import type { TodoTask } from "@/lib/todo/types";

export function TaskOverlayDue({
  task,
  planEnabled,
  mutateTask,
  soonEnd,
  lang,
  t,
}: {
  task: TodoTask;
  planEnabled: boolean;
  mutateTask: (taskId: string, patch: Partial<TodoTask>) => unknown;
  /** Where a task leaving Today goes in Soon (dueDatePatch). */
  soonEnd?: () => number | undefined;
  lang: TodoLang;
  t: (key: string) => string;
}) {
  const [anchor, setAnchor] = React.useState<HTMLButtonElement | null>(null);
  // Ticked before a day is picked: the first day puts the task on the
  // Calendar, as on the card.
  const [calendarWanted, setCalendarWanted] = React.useState(Boolean(task.showOnCalendar));
  const days = task.dueOn ? daysUntilDue(task.dueOn) : null;
  const overdue = days != null && days < 0;
  const close = () => {
    anchor?.focus();
    setAnchor(null);
  };
  return (
    <div
      className={`task-overlay-due-value${task.dueOn ? "" : " is-empty"}${
        overdue ? " is-overdue" : days === 0 ? " is-today" : ""
      }`}
    >
      <button
        type="button"
        className={`task-overlay-due${task.dueOn ? "" : " is-empty"}`}
        aria-label={t("fieldDue")}
        aria-haspopup="dialog"
        aria-expanded={anchor != null}
        onClick={(e) => {
          const el = e.currentTarget;
          setCalendarWanted(Boolean(task.showOnCalendar));
          setAnchor((open) => (open ? null : el));
        }}
      >
        <Calendar size={14} strokeWidth={2} aria-hidden />
        <span>{task.dueOn ? formatDueOn(task.dueOn, lang, t) : t("fieldDue")}</span>
      </button>
      {task.dueOn ? (
        <button
          type="button"
          className="task-overlay-due-clear"
          title={t("composerClear")}
          aria-label={t("composerClear")}
          onClick={() => void mutateTask(task.id, { dueOn: null, showOnCalendar: false })}
        >
          <X size={13} strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
      <DuePopover
        open={anchor != null}
        anchorEl={anchor}
        value={task.dueOn}
        onPick={(dueOn) => {
          close();
          void mutateTask(task.id, {
            ...dueDatePatch(dueOn, task, soonEnd?.()),
            showOnCalendar: dueOn ? calendarWanted : false,
          });
        }}
        onClose={close}
        calendar={
          planEnabled
            ? {
                checked: calendarWanted,
                onChange: (checked) => {
                  setCalendarWanted(checked);
                  if (task.dueOn) void mutateTask(task.id, { showOnCalendar: checked });
                },
              }
            : undefined
        }
        lang={lang}
        t={t}
      />
    </div>
  );
}
