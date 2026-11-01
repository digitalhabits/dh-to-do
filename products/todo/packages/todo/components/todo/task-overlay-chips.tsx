"use client";

/*
 * The full-screen card's top: the head (tick, words, close) and the row of
 * chips under it — people, due day, duration and list.
 *
 * Open, the head sits on the card's white. Done, it is a green band that
 * says when the task was finished and offers to undo it, and the chips
 * that only add something (an empty duration, the × on the day) step back.
 */

import * as React from "react";
import { Calendar, User, X } from "lucide-react";

import { DuePopover } from "@/components/todo/DuePopover";
import { DurationPopover } from "@/components/todo/DurationPopover";
import { SearchableListMenu } from "@/components/todo/SearchableListMenu";
import { TaskAssignMenu, TaskAssigneeStack } from "@/components/todo/TodoPeopleEditor";
import { TaskDetailsInfo } from "@/components/todo/task-details-info";
import { TaskOverlayDue } from "@/components/todo/task-overlay-due";
import { ClockIcon } from "@/components/todo/task-icons";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { doneBucket } from "@/lib/todo/done-groups";
import type { TodoLang } from "@/lib/todo/i18n";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import { daysUntilDue, formatDueOn } from "@/lib/todo/task-draft";
import { spawnCompletionParty } from "@/lib/todo/task-celebration";
import { columnEnd, dueDatePatch } from "@/lib/todo/task-helpers";
import { formatDurationLong, formatDurationShort } from "@/lib/todo/duration";
import { type TodoPerson, type TodoTask } from "@/lib/todo/types";

const noSubscribe = () => () => {};

/**
 * "Completed today at 12:36". Written in the browser only, for the reason
 * DoneStamp gives: the clock is the reader's, and the server has none.
 */
function completedLine(completedAt: string, lang: TodoLang, t: (key: string) => string): string {
  const at = new Date(completedAt);
  if (Number.isNaN(at.getTime())) return "";
  const locale = lang === "da" ? "da-DK" : undefined;
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const bucket = doneBucket(completedAt, new Date());
  if (bucket === "doneToday") return t("completedTodayAt").replace("{time}", time);
  if (bucket === "doneYesterday") return t("completedYesterdayAt").replace("{time}", time);
  const date = at.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return t("completedOn").replace("{date}", date);
}

function CompletedLine({ completedAt, lang, t }: { completedAt: string; lang: TodoLang; t: (key: string) => string }) {
  const inBrowser = React.useSyncExternalStore(noSubscribe, () => true, () => false);
  return <p className="task-overlay-done-when">{inBrowser ? completedLine(completedAt, lang, t) : null}</p>;
}

/** The head of the card: the box to tick (or untick), and the words. */
export function TaskOverlayHead({
  m,
  task,
  title,
}: {
  m: TodoPageModel;
  task: TodoTask;
  title: React.ReactNode;
}) {
  const { t, lang, toggleTaskCompleted } = m;
  if (!task.completed) {
    return (
      <div className="notes-overlay-head">
        <span className="task-overlay-gutter">
          <input
            type="checkbox"
            className="task-checkbox"
            checked={false}
            onChange={(event) => {
              // The 🎉 the card gets, over this box: in details there is no
              // card for the tick to cheer over (completeTaskWithFlight).
              spawnCompletionParty(event.currentTarget.parentElement ?? event.currentTarget);
              toggleTaskCompleted(task, event);
            }}
            aria-label={t("markDone")}
          />
        </span>
        {title}
      </div>
    );
  }
  return (
    <div className="notes-overlay-head task-overlay-done-band">
      <span className="task-overlay-gutter">
        {/* The ticked box: unticking it is how a task is marked not done,
            as on its card. */}
        <button
          type="button"
          role="checkbox"
          aria-checked="true"
          className="task-overlay-done-mark"
          aria-label={t("markNotDone")}
          title={t("markNotDone")}
          onClick={() => void m.mutateTask(task.id, { completed: false })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </span>
      <div className="task-overlay-done-title">
        {/* Under the name, so ticking it moves neither the box nor the name. */}
        {title}
        {task.completedAt ? <CompletedLine completedAt={task.completedAt} lang={lang} t={t} /> : null}
      </div>
    </div>
  );
}

/** The people on the task: their faces, or an Assign chip when there are none. */
function AssignChip({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  const { state, t, peopleById, overlayAssignAnchor, setOverlayAssignAnchor, toggleTaskAssignee, setPeopleEditorOpen } = m;
  const assignees = task.assigneeIds
    .map((id) => peopleById.get(id))
    .filter((p): p is TodoPerson => Boolean(p));
  return (
    <span className="task-overlay-chip-wrap">
      <button
        type="button"
        className={assignees.length ? "task-overlay-faces" : "task-overlay-chip is-ghost"}
        title={assignees.map((p) => p.name).join(", ") || t("assignPerson")}
        aria-label={t("fieldAssignedTo")}
        onClick={(e) => {
          e.stopPropagation();
          const el = e.currentTarget;
          setOverlayAssignAnchor((now) => (now ? null : el));
        }}
      >
        {assignees.length ? (
          <TaskAssigneeStack people={assignees} size={32} />
        ) : (
          <>
            <User size={15} strokeWidth={2} aria-hidden />
            <span>{t("composerAssign")}</span>
          </>
        )}
      </button>
      <TaskAssignMenu
        open={Boolean(overlayAssignAnchor)}
        anchorEl={overlayAssignAnchor}
        people={state.people}
        assigneeIds={task.assigneeIds}
        t={t}
        onToggle={(personId) => toggleTaskAssignee(task.id, personId)}
        onEditPeople={() => {
          setOverlayAssignAnchor(null);
          setPeopleEditorOpen(true);
        }}
        onClose={() => {
          overlayAssignAnchor?.focus();
          setOverlayAssignAnchor(null);
        }}
      />
    </span>
  );
}

/** "Add duration" until there is one, then the minutes; a click types them. */
function DurationChip({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  const { t, mutateTask } = m;
  /* The same picker the add row uses, in its pill look: presets and a
     "Custom" box. Open while it has a button to sit under. */
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const minutes = task.expectedDurationMinutes;
  const close = React.useCallback(() => setAnchor(null), []);
  return (
    <span className="task-overlay-duration-value">
      <button
        type="button"
        className={`task-overlay-chip task-overlay-duration${minutes == null ? " is-ghost" : ""}`}
        aria-label={t("fieldDuration")}
        aria-haspopup="dialog"
        aria-expanded={anchor != null}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {/* As for the date: the icon only asks. */}
        {minutes == null ? <ClockIcon /> : null}
        <span>
          {minutes == null ? t("addDuration") : formatDurationLong(minutes, t("hoursShort"))}
        </span>
      </button>
      {minutes != null ? (
        <button
          type="button"
          className="task-overlay-duration-clear"
          aria-label={t("clearDuration")}
          title={t("clearDuration")}
          onClick={() => void mutateTask(task.id, { expectedDurationMinutes: null })}
        >
          <X size={14} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
      <DurationPopover
        open={anchor != null}
        anchorEl={anchor}
        minutes={minutes ?? null}
        t={t}
        onClose={close}
        onPick={(next) => {
          setAnchor(null);
          if (next !== (minutes ?? null)) void mutateTask(task.id, { expectedDurationMinutes: next });
        }}
      />
    </span>
  );
}

/** The day, on a done task: what it was due, nothing to change at a glance. */
function DoneDueChip({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  const { t, lang, mutateTask } = m;
  const [anchor, setAnchor] = React.useState<HTMLButtonElement | null>(null);
  if (!task.dueOn) return <span>—</span>;
  const days = daysUntilDue(task.dueOn);
  const when = formatDueOn(task.dueOn, lang, t);
  // "Due yesterday", not "Due Yesterday"; a date keeps its capital.
  const said = days != null && Math.abs(days) <= 1 ? when.toLowerCase() : when;
  return (
    <span className="task-overlay-chip-wrap">
      <button
        type="button"
        className="task-overlay-chip is-filled"
        aria-haspopup="dialog"
        aria-expanded={anchor != null}
        onClick={(e) => {
          const el = e.currentTarget;
          setAnchor((open) => (open ? null : el));
        }}
      >
        <Calendar size={15} strokeWidth={2} aria-hidden />
        <span>{`${t("fieldDue")} ${said}`}</span>
      </button>
      <DuePopover
        open={anchor != null}
        anchorEl={anchor}
        value={task.dueOn}
        onPick={(dueOn) => {
          setAnchor(null);
          void mutateTask(task.id, dueDatePatch(dueOn, task, columnEnd(m.boardColumns.week)));
        }}
        onClose={() => setAnchor(null)}
        lang={lang}
        t={t}
      />
    </span>
  );
}

/** The list the task is on, in the details top bar: just its name, or "No list"
    in the error colour. The picker moves it. */
/**
 * The task's list, as a button that moves it to another. `iconOnly`: a list
 * with an icon shows just the icon (the details bar); its name is the tooltip.
 */
export function TaskDetailsListButton({ m, task, iconOnly = false }: { m: TodoPageModel; task: TodoTask; iconOnly?: boolean }) {
  const { state, moveTargets, t, overlayListOpen, setOverlayListOpen, mutateTask } = m;
  const taskList = state.lists.find((l) => l.id === task.listId);
  const shownIcon = iconOnly && taskList ? resolveListIconId(taskList.emoji) : null;
  return (
    <div className={`task-list-origin-wrap task-overlay-list-wrap${overlayListOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className={`task-details-list-btn${taskList ? "" : " is-unlisted"}${shownIcon ? " is-icon" : ""}`}
        title={taskList?.name}
        aria-haspopup="menu"
        aria-expanded={overlayListOpen}
        aria-label={t("fieldList")}
        disabled={state.lists.length === 0}
        onClick={(e) => {
          e.stopPropagation();
          setOverlayListOpen((v) => !v);
        }}
      >
        {shownIcon ? <ListIcon id={shownIcon} size={18} /> : <span>{taskList?.name ?? t("composerNoList")}</span>}
      </button>
      {overlayListOpen ? (
        <SearchableListMenu
          className="task-list-picker"
          lists={moveTargets.lists}
          headingOf={moveTargets.headingOf}
          t={t}
          onClose={() => setOverlayListOpen(false)}
          renderItem={(l) => {
            const iconId = resolveListIconId(l.emoji);
            const selected = l.id === task.listId;
            return (
              <button
                key={l.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`task-list-picker-item${selected ? " is-current" : ""}`}
                onClick={() => {
                  setOverlayListOpen(false);
                  if (!selected) void mutateTask(task.id, { listId: l.id });
                }}
              >
                <span className={`task-list-picker-icon${iconId ? " has-icon" : ""}`}>
                  {iconId ? <ListIcon id={iconId} size={14} /> : null}
                </span>
                <span className="task-list-picker-name">{l.name}</span>
              </button>
            );
          }}
        />
      ) : null}
    </div>
  );
}

/** The row of chips under the words. */
export function TaskOverlayChips({ m, task, withInfo = true }: { m: TodoPageModel; task: TodoTask; withInfo?: boolean }) {
  const done = task.completed;
  return (
    <div className="task-overlay-chips">
      {withInfo ? <TaskDetailsInfo m={m} task={task} /> : null}
      {m.assignEnabled ? <div className="task-details-field"><span className="task-details-field-label">{m.t("fieldAssignedTo")}</span><AssignChip m={m} task={task} /></div> : null}
      <div className="task-details-field"><span className="task-details-field-label">{m.t("fieldDueOn")}</span>{done ? (
        <DoneDueChip m={m} task={task} />
      ) : (
        <TaskOverlayDue
          task={task}
          planEnabled={m.planEnabled}
          mutateTask={m.mutateTask}
          soonEnd={() => columnEnd(m.boardColumns.week)}
          lang={m.lang}
          t={m.t}
        />
      )}</div>
      {done && task.expectedDurationMinutes == null ? null : <div className="task-details-field"><span className="task-details-field-label">{m.t("fieldDuration")}</span><DurationChip m={m} task={task} /></div>}
      {done ? <div className="task-details-field">
        <span className="task-details-field-label">{m.t("taskTimeSpent")}</span>
        {m.editingDurationTaskId === task.id ? <input
          autoFocus
          className="task-duration-input"
          aria-label={m.t("taskTimeSpent")}
          value={m.editingDuration}
          onChange={(event) => m.setEditingDuration(event.target.value)}
          onBlur={() => m.commitEditDuration(task)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.stopPropagation();
              m.setEditingDurationTaskId(null);
            }
          }}
        /> : <button type="button" className="task-overlay-chip" onClick={() => {
          m.setEditingDurationTaskId(task.id);
          m.setEditingDuration(task.timeSpentSeconds ? formatDurationShort(Math.round(task.timeSpentSeconds / 60), m.t("minutes"), m.t("hoursShort")) : "");
        }}>{task.timeSpentSeconds ? formatDurationShort(Math.round(task.timeSpentSeconds / 60), m.t("minutes"), m.t("hoursShort")) : m.t("addTimeSpent")}</button>}
      </div> : null}
    </div>
  );
}
