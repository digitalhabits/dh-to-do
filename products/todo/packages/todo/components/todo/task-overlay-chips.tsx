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
import { Calendar, ChevronDown, User } from "lucide-react";

import { DuePopover } from "@/components/todo/DuePopover";
import { SearchableListMenu } from "@/components/todo/SearchableListMenu";
import { TaskAssignMenu, TaskAssigneeStack } from "@/components/todo/TodoPeopleEditor";
import { TaskOverlayDue } from "@/components/todo/task-overlay-due";
import { ClockIcon } from "@/components/todo/task-icons";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { doneBucket } from "@/lib/todo/done-groups";
import type { TodoLang } from "@/lib/todo/i18n";
import { minutesFromTyped } from "@/lib/todo/duration-input";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import { daysUntilDue, formatDueOn } from "@/lib/todo/task-draft";
import { columnEnd, dueDatePatch, listOriginLetters } from "@/lib/todo/task-helpers";
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

const CollapseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

/** The head of the card: the tick, the words, and the way out. */
export function TaskOverlayHead({
  m,
  task,
  title,
}: {
  m: TodoPageModel;
  task: TodoTask;
  title: React.ReactNode;
}) {
  const { t, lang, toggleTaskCompleted, saveNotes } = m;
  const close = (
    <button
      type="button"
      className="notes-collapse-btn"
      title={t("collapseTask")}
      aria-label={t("collapseTask")}
      onClick={() => saveNotes(task.id)}
    >
      <CollapseIcon />
    </button>
  );
  if (!task.completed) {
    return (
      <div className="notes-overlay-head">
        <span className="task-overlay-gutter">
          <input
            type="checkbox"
            className="task-checkbox"
            checked={false}
            onChange={(event) => toggleTaskCompleted(task, event)}
            aria-label={t("markDone")}
          />
        </span>
        {title}
        {close}
      </div>
    );
  }
  return (
    <div className="notes-overlay-head task-overlay-done-band">
      <span className="task-overlay-gutter">
        <span className="task-overlay-done-mark" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      </span>
      <div className="task-overlay-done-title">
        {task.completedAt ? <CompletedLine completedAt={task.completedAt} lang={lang} t={t} /> : null}
        {title}
      </div>
      <button
        type="button"
        className="task-overlay-undone-btn"
        onClick={() => void m.mutateTask(task.id, { completed: false })}
      >
        {t("markNotDone")}
      </button>
      {close}
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
        onClose={() => setOverlayAssignAnchor(null)}
      />
    </span>
  );
}

/** "Add duration" until there is one, then the minutes; a click types them. */
function DurationChip({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  const { t, mutateTask } = m;
  const [editing, setEditing] = React.useState(false);
  const minutes = task.expectedDurationMinutes;
  if (editing) {
    return (
      <span className="task-overlay-chip is-editing">
        <ClockIcon />
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          className="task-overlay-chip-input"
          defaultValue={minutes == null ? "" : String(minutes)}
          placeholder="min"
          aria-label={t("fieldDuration")}
          onBlur={(e) => {
            setEditing(false);
            const next = minutesFromTyped(e.target.value);
            if (next !== (minutes ?? null)) void mutateTask(task.id, { expectedDurationMinutes: next });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <span className="task-overlay-unit">min</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`task-overlay-chip${minutes == null ? " is-ghost" : ""}`}
      aria-label={t("fieldDuration")}
      onClick={() => setEditing(true)}
    >
      <ClockIcon />
      <span>{minutes == null ? t("addDuration") : `${minutes} min`}</span>
    </button>
  );
}

/** The day, on a done task: what it was due, nothing to change at a glance. */
function DoneDueChip({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  const { t, lang, mutateTask } = m;
  const [anchor, setAnchor] = React.useState<HTMLButtonElement | null>(null);
  if (!task.dueOn) return null;
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

/** The list the task is on, at the far end of the row; the picker moves it. */
function ListChip({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  const { state, moveTargets, t, overlayListOpen, setOverlayListOpen, mutateTask } = m;
  const taskList = state.lists.find((l) => l.id === task.listId);
  return (
    <div className={`task-list-origin-wrap task-overlay-list-wrap${overlayListOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className={`task-overlay-chip task-overlay-list-chip${taskList ? " is-filled" : " is-ghost"}`}
        aria-haspopup="menu"
        aria-expanded={overlayListOpen}
        aria-label={t("fieldList")}
        disabled={state.lists.length === 0}
        onClick={(e) => {
          e.stopPropagation();
          setOverlayListOpen((v) => !v);
        }}
      >
        {resolveListIconId(taskList?.emoji) ? (
          <ListIcon id={resolveListIconId(taskList?.emoji)!} size={15} />
        ) : null}
        <span>{taskList?.name ?? t("composerNoList")}</span>
        <ChevronDown size={15} strokeWidth={2} aria-hidden />
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
                  {iconId ? <ListIcon id={iconId} size={14} /> : listOriginLetters(l)}
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
export function TaskOverlayChips({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  const done = task.completed;
  return (
    <div className="task-overlay-chips">
      {m.assignEnabled ? <AssignChip m={m} task={task} /> : null}
      {done ? (
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
      )}
      {done && task.expectedDurationMinutes == null ? null : <DurationChip m={m} task={task} />}
      <ListChip m={m} task={task} />
    </div>
  );
}
