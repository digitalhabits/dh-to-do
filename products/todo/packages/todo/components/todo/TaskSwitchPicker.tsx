"use client";

/*
 * The task switcher's search and lists: a search over every list, or one
 * list at a time from a row of tabs. The focus window switches to the task
 * picked here; the Calendar's add-task box puts it on the day.
 *
 * What it offers, and in what order: buildFocusSwitcher
 * (lib/todo/focus-switcher.ts). The search and the list tab it browses are
 * its own, so they start again each time it opens.
 */

import React from "react";
import { buildFocusSwitcher } from "@/lib/todo/focus-switcher";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import type { TodoList, TodoTask } from "@/lib/todo/types";

type Props = {
  tasks: TodoTask[];
  lists: TodoList[];
  /** A task not to offer: the one in focus. "" for none. */
  taskId?: string;
  /** More tasks not to offer: those in focus in another window. */
  focusedElsewhere?: Set<string>;
  /** The list it browses first, and whose hits come first. */
  preferredListId: string | null;
  placeholder: string;
  t: (key: string) => string;
  onPick: (task: TodoTask) => void;
  onEscape: () => void;
};

const NO_TASKS = new Set<string>();

/** The tab before the lists: every list's tasks, under each list's name. */
const EVERYTHING_TAB = "__everything__";

/**
 * The board's own settings, from the storage the board keeps them in: with
 * the board on, a list's tasks are shown under its columns; with Someday
 * on, that column is one of them.
 */
function readBoard() {
  try {
    return {
      kanban: localStorage.getItem("redd-plan-todo-kanban") !== "0",
      someday: localStorage.getItem("redd-plan-todo-someday-enabled") === "1",
    };
  } catch {
    return { kanban: true, someday: false }; // no storage: the plain list
  }
}

function SearchIcon() {
  return (
    <svg className="focus-task-switch-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function TaskButtons({ tasks, onPick }: { tasks: TodoTask[]; onPick: (task: TodoTask) => void }) {
  return (
    <>
      {tasks.map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          className="focus-task-switch-item"
          onClick={() => onPick(candidate)}
        >
          {candidate.text}
        </button>
      ))}
    </>
  );
}

/** The list's icon, as on its tab on the board; none when it has none. */
function TabIcon({ emoji }: { emoji?: string | null }) {
  const id = resolveListIconId(emoji);
  return id ? (
    <span className="focus-task-switch-tab-icon" aria-hidden="true">
      <ListIcon id={id} size={13} />
    </span>
  ) : null;
}

export function TaskSwitchPicker({
  tasks,
  lists,
  taskId = "",
  focusedElsewhere = NO_TASKS,
  preferredListId,
  placeholder,
  t,
  onPick,
  onEscape,
}: Props) {
  const [query, setQuery] = React.useState("");
  /** The list tab picked (or Everything); null until one is. */
  const [listId, setListId] = React.useState<string | null>(null);
  const everything = listId === EVERYTHING_TAB;
  const [board] = React.useState(readBoard);
  const {
    switchLists,
    currentSwitchListId,
    switchGroups,
    browsingTasks,
    browsingColumns,
    columnLabel,
  } = buildFocusSwitcher({
    tasks,
    lists,
    taskId,
    focusedElsewhere,
    focusedListId: preferredListId,
    switchListId: everything ? null : listId,
    switchQuery: query,
    switchBoard: board,
    t,
  });

  const list = everything && !switchGroups ? (
    switchLists.every((entry) => entry.tasks.length === 0) ? (
      <div className="focus-task-switch-empty">{t("switchTaskEmptyList")}</div>
    ) : (
      switchLists.map((entry) =>
        entry.tasks.length ? (
          <React.Fragment key={entry.list.id}>
            <div className="focus-task-switch-group-label">{entry.list.name}</div>
            <TaskButtons tasks={entry.tasks} onPick={onPick} />
          </React.Fragment>
        ) : null
      )
    )
  ) : switchGroups ? (
    switchGroups.length === 0 ? (
      <div className="focus-task-switch-empty">{t("switchTaskNoMatches")}</div>
    ) : (
      switchGroups.map((group) => (
        <React.Fragment key={group.list.id}>
          {switchLists.length > 1 ? (
            <div className="focus-task-switch-group-label">{group.list.name}</div>
          ) : null}
          <TaskButtons tasks={group.tasks} onPick={onPick} />
        </React.Fragment>
      ))
    )
  ) : browsingTasks.length === 0 ? (
    <div className="focus-task-switch-empty">{t("switchTaskEmptyList")}</div>
  ) : browsingColumns ? (
    browsingColumns.map((group) => (
      <React.Fragment key={group.column}>
        <div className="focus-task-switch-group-label">{columnLabel(group.column)}</div>
        <TaskButtons tasks={group.tasks} onPick={onPick} />
      </React.Fragment>
    ))
  ) : (
    <TaskButtons tasks={browsingTasks} onPick={onPick} />
  );

  return (
    <>
      <div className="focus-task-switch-search">
        <SearchIcon />
        <input
          autoCorrect="off"
          autoCapitalize="off"
          autoFocus
          type="text"
          className="focus-task-switch-search-input"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onEscape();
          }}
        />
        <span className="focus-task-switch-esc" aria-hidden="true">
          Esc
        </span>
      </div>
      {/* Tabs are for browsing one list at a time; they go while a
          search crosses every list. */}
      {!switchGroups && switchLists.length > 1 ? (
        <div className="focus-task-switch-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={everything}
            className={`focus-task-switch-tab${everything ? " active" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setListId(EVERYTHING_TAB);
            }}
          >
            <span className="focus-task-switch-tab-name">{t("everythingGroup")}</span>
            <span className="focus-task-switch-tab-count">
              {switchLists.reduce((sum, entry) => sum + entry.tasks.length, 0)}
            </span>
          </button>
          {switchLists.map((entry) => (
            <button
              key={entry.list.id}
              type="button"
              role="tab"
              aria-selected={!everything && entry.list.id === currentSwitchListId}
              title={entry.list.name}
              className={`focus-task-switch-tab${
                !everything && entry.list.id === currentSwitchListId ? " active" : ""
              }`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setListId(entry.list.id);
              }}
            >
              <TabIcon emoji={entry.list.emoji} />
              <span className="focus-task-switch-tab-name">{entry.list.name}</span>
              <span className="focus-task-switch-tab-count">{entry.tasks.length}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="focus-task-switch-list">{list}</div>
    </>
  );
}
