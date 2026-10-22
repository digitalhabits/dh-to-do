"use client";

/**
 * Deleted lists, in Settings under "Tasks and lists". A deleted list keeps
 * its tasks (store.deleteTodoList). The row folds open to the lists; a
 * list folds open to its first tasks, to see what it held before it is
 * brought back. The tasks are read only: a deleted list is not edited.
 */

import * as React from "react";
import { ChevronDown, ChevronRight, ChevronUp, Trash2 } from "lucide-react";

import { formatDurationShort } from "@/lib/todo/duration";
import type { TodoLang } from "@/lib/todo/i18n";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import type { DeletedListTask, DeletedTodoList } from "@/lib/todo/store";
import { formatDueOnShort } from "@/lib/todo/task-draft";

/** The tasks shown when a list opens; "+ N more" shows the rest. */
const FIRST_TASKS = 4;

type T = (key: string) => string;

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? String(values[key]) : all));
}

/** "8 open, 1 done · deleted 2 days ago". Done is left out when there is none. */
function listMeta(list: DeletedTodoList, lang: TodoLang, t: T): string {
  const counts = [fill(t("deletedListsOpen"), { n: list.openCount })];
  if (list.doneCount > 0) counts.push(fill(t("deletedListsDone"), { n: list.doneCount }));
  const days = Math.max(0, Math.round((Date.now() - new Date(list.deletedAt).getTime()) / 86_400_000));
  const when = new Intl.RelativeTimeFormat(lang === "da" ? "da-DK" : "en-GB", { numeric: "auto" }).format(
    -days,
    "day"
  );
  return `${counts.join(", ")} · ${fill(t("deletedListsWhen"), { when })}`;
}

function DeletedTaskRows({ tasks, lang, t }: { tasks: DeletedListTask[] | null; lang: TodoLang; t: T }) {
  const [all, setAll] = React.useState(false);
  if (tasks === null) return <div className="settings-deleted-tasks" aria-busy="true" />;
  if (tasks.length === 0) {
    return (
      <div className="settings-deleted-tasks">
        <span className="settings-deleted-task-none">{t("deletedListsNoTasks")}</span>
      </div>
    );
  }
  const shown = all ? tasks : tasks.slice(0, FIRST_TASKS);
  return (
    <div className="settings-deleted-tasks">
      <ul>
        {shown.map((task) => (
          <li key={task.id} className={`settings-deleted-task${task.completed ? " is-done" : ""}`}>
            <span className="settings-deleted-task-box" aria-hidden="true" />
            <span className="settings-deleted-task-text">{task.text}</span>
            <span className="settings-deleted-task-meta">
              {task.dueOn
                ? formatDueOnShort(task.dueOn, lang, t)
                : task.expectedDurationMinutes != null
                  ? formatDurationShort(task.expectedDurationMinutes, t("minutes"), t("hoursShort"))
                  : null}
            </span>
          </li>
        ))}
      </ul>
      {!all && tasks.length > FIRST_TASKS ? (
        <button type="button" className="settings-deleted-more" onClick={() => setAll(true)}>
          {fill(t("deletedListsMore"), { n: tasks.length - FIRST_TASKS })}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Restore and the bin; the bin asks on the row itself ("Delete forever?
 * Cancel / Delete") before the list and its tasks are gone for good.
 */
function ItemActions({
  t,
  open,
  busy,
  confirming,
  onRestore,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  t: T;
  open: boolean;
  busy: boolean;
  confirming: boolean;
  onRestore: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  if (confirming) {
    return (
      <div className="settings-deleted-actions is-confirming">
        <span className="settings-deleted-ask">{t("deletedListsDeleteForeverAsk")}</span>
        <button type="button" className="settings-deleted-cancel" onClick={onCancelDelete}>
          {t("cancel")}
        </button>
        <button type="button" className="settings-deleted-delete" disabled={busy} onClick={onDelete}>
          {t("delete")}
        </button>
      </div>
    );
  }
  return (
    <div className="settings-deleted-actions">
      <button
        type="button"
        className={`settings-deleted-restore${open ? " is-primary" : ""}`}
        disabled={busy}
        onClick={onRestore}
      >
        {t("restoreList")}
      </button>
      <button
        type="button"
        className="settings-deleted-bin"
        title={t("deletedListsDeleteForever")}
        aria-label={t("deletedListsDeleteForever")}
        disabled={busy}
        onClick={onAskDelete}
      >
        <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

function DeletedListItem({
  list,
  lang,
  t,
  open,
  onToggle,
  loadTasks,
  busy,
  onRestore,
  confirming,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  list: DeletedTodoList;
  lang: TodoLang;
  t: T;
  open: boolean;
  onToggle: () => void;
  loadTasks: (id: string) => Promise<DeletedListTask[]>;
  busy: boolean;
  onRestore: () => void;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const [tasks, setTasks] = React.useState<DeletedListTask[] | null>(null);
  React.useEffect(() => {
    if (!open || tasks !== null) return;
    loadTasks(list.id).then(setTasks).catch(() => setTasks([]));
  }, [open, tasks, list.id, loadTasks]);
  const Chevron = open ? ChevronDown : ChevronRight;
  // `emoji` holds the list's icon name, as on its tab.
  const iconId = resolveListIconId(list.emoji);
  return (
    <li className={`settings-deleted-item${open ? " is-open" : ""}`}>
      <div className="settings-deleted-item-row">
        <button type="button" className="settings-deleted-item-toggle" aria-expanded={open} onClick={onToggle}>
          <Chevron size={15} strokeWidth={2} aria-hidden="true" />
          <span className="settings-deleted-item-copy">
            <span className="settings-deleted-item-name">
              {iconId ? <ListIcon id={iconId} size={15} className="settings-deleted-item-icon" aria-hidden="true" /> : null}
              {list.name}
            </span>
            <span className="settings-deleted-item-meta">{listMeta(list, lang, t)}</span>
          </span>
        </button>
        <ItemActions
          t={t}
          open={open}
          busy={busy}
          confirming={confirming}
          onRestore={onRestore}
          onAskDelete={onAskDelete}
          onCancelDelete={onCancelDelete}
          onDelete={onDelete}
        />
      </div>
      {open ? <DeletedTaskRows tasks={tasks} lang={lang} t={t} /> : null}
    </li>
  );
}

export function DeletedListsRow({
  t,
  lang,
  load,
  loadTasks,
  restore,
  deleteForever,
}: {
  t: T;
  lang: TodoLang;
  load: () => Promise<DeletedTodoList[]>;
  loadTasks: (id: string) => Promise<DeletedListTask[]>;
  restore: (id: string) => Promise<void>;
  deleteForever: (id: string) => Promise<void>;
}) {
  const [lists, setLists] = React.useState<DeletedTodoList[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [openListId, setOpenListId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  /** The list whose bin was pressed: its row asks before it deletes. */
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  React.useEffect(() => {
    load().then(setLists).catch(() => setLists([]));
  }, [load]);
  // Nothing deleted: no row.
  if (!lists || lists.length === 0) return null;
  /** Restore or delete forever: either way the list leaves this row. */
  const takeOut = async (id: string, act: (id: string) => Promise<void>) => {
    setBusy(true);
    try {
      await act(id);
      setLists((current) => (current ?? []).filter((l) => l.id !== id));
      setConfirmingId(null);
    } finally {
      setBusy(false);
    }
  };
  const HeadChevron = open ? ChevronUp : ChevronDown;
  return (
    <div className={`settings-row settings-deleted${open ? " is-open" : ""}`}>
      <button type="button" className="settings-deleted-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="settings-row-label">{t("deletedLists")}</span>
        <span className="settings-deleted-count">
          {lists.length === 1 ? t("deletedListsOne") : fill(t("deletedListsCount"), { n: lists.length })}
        </span>
        <HeadChevron size={16} strokeWidth={2} aria-hidden="true" className="settings-deleted-head-chevron" />
      </button>
      {open ? (
        <ul className="settings-deleted-lists">
          {lists.map((list) => (
            <DeletedListItem
              key={list.id}
              list={list}
              lang={lang}
              t={t}
              open={openListId === list.id}
              onToggle={() => setOpenListId((id) => (id === list.id ? null : list.id))}
              loadTasks={loadTasks}
              busy={busy}
              onRestore={() => void takeOut(list.id, restore)}
              confirming={confirmingId === list.id}
              onAskDelete={() => setConfirmingId(list.id)}
              onCancelDelete={() => setConfirmingId(null)}
              onDelete={() => void takeOut(list.id, deleteForever)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
