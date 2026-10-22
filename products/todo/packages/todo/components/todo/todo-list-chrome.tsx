"use client";

/*
 * The list and group tabs, and the sync button with its sources.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) first and reads the names it
 * needs from it. The JSX is TodoPage's own, word for word.
 */

import * as React from "react";

import { isInteractiveDragTarget } from "@/components/todo/use-pointer-drag";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import {
  TODO_EVERYTHING_GROUP_ID,
  groupOfTab,
  groupTabId,
  isEverythingGroup,
} from "@/lib/todo/list-scope";
import { persistPref } from "@/lib/todo/saved-prefs";
import { hexToRgba, resolveTabColorHex } from "@/lib/todo/tab-colours";
import {
  TODO_ALL_LIST_ID,
  TODO_CURRENT_LIST_KEY,
  type TodoGroup,
  type TodoList,
} from "@/lib/todo/types";

export function renderGroupTab(m: TodoPageModel, group: TodoGroup) {
  const {
    draggingGroupId,
    tabDropGroupId,
    groupDragRef,
    suppressGroupClickUntil,
    groupsSorted,
    activeGroup,
    openRenameGroupModal,
    switchToGroup,
    removeGroup,
  } = m;
  const active = activeGroup?.id === group.id;
  let className = `group-tab ${active ? "active" : ""} ${
    !active ? "dimmed" : ""
  } ${draggingGroupId === group.id ? "dragging" : ""} ${
    tabDropGroupId === group.id ? "list-drop-target" : ""
  }`;
  const style: React.CSSProperties = {};
  if (group.colour) {
    if (group.colour.startsWith("#")) {
      style.backgroundColor = group.colour;
      style.borderColor = group.colour;
    } else {
      className += ` tab-bg-${group.colour}`;
    }
  }
  return (
    <div
      key={group.id}
      className={className}
      style={style}
      data-group-id={group.id}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (isInteractiveDragTarget(e.target)) return;
        groupDragRef.current = {
          groupId: group.id,
          startX: e.clientX,
          startY: e.clientY,
          started: false,
        };
      }}
      onClick={() => {
        if (Date.now() < suppressGroupClickUntil.current) return;
        if (active) {
          openRenameGroupModal(group);
        } else {
          switchToGroup(group.id);
        }
      }}
    >
      <span>{group.name}</span>
      {groupsSorted.length > 1 ? (
        <button
          className="group-delete-btn"
          title="Delete group"
          onClick={(e) => {
            e.stopPropagation();
            removeGroup(group);
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/**
 * Everything, the fixed first group (lib/todo/list-scope.ts): like a group
 * tab, but with no × and no drag, and a divider after it.
 */
export function renderEverythingGroupTab(m: TodoPageModel) {
  const { activeGroup, switchToGroup, t } = m;
  const active = isEverythingGroup(activeGroup);
  return (
    <React.Fragment key={TODO_EVERYTHING_GROUP_ID}>
      <div
        className={`group-tab group-tab-everything ${active ? "active" : "dimmed"}`}
        onClick={() => {
          if (!active) switchToGroup(TODO_EVERYTHING_GROUP_ID);
        }}
      >
        <span>{t("everythingGroup")}</span>
      </div>
      <span className="group-divider" aria-hidden="true" />
    </React.Fragment>
  );
}

/**
 * Everything's tab row: All (every list's tasks), then a tab per group that
 * shows the tasks of that group's lists. A group's tab says "All Sales", not
 * "Sales": beside the group tabs above, the bare name read as the group
 * itself, not as every list in it.
 */
export function renderEverythingTabs(m: TodoPageModel) {
  const { view, setView, currentListId, setCurrentListId, t, groupsSorted } = m;
  const openGroupId = groupOfTab(currentListId);
  const choose = (listId: string) => {
    setView("lists");
    setCurrentListId(listId);
    persistPref(TODO_CURRENT_LIST_KEY, listId);
  };
  const tab = (key: string, label: string, active: boolean, listId: string) => (
    <div
      key={key}
      className={`tab ${key === TODO_ALL_LIST_ID ? "tab-all " : ""}${view === "lists" && active ? "active" : ""}`}
      onClick={() => choose(listId)}
    >
      <span className="tab-label">
        <span className="tab-name">{label}</span>
      </span>
    </div>
  );
  return [
    tab(TODO_ALL_LIST_ID, t("boardAll"), openGroupId === null, TODO_ALL_LIST_ID),
    ...groupsSorted.map((group) =>
      tab(
        group.id,
        t("allOfGroup").replace("{name}", group.name),
        openGroupId === group.id,
        groupTabId(group.id)
      )
    ),
  ];
}

export function renderAllListTab(m: TodoPageModel) {
  const {
    view,
    setView,
    setCurrentListId,
    t,
    isAllListsView,
  } = m;
  const active = view === "lists" && isAllListsView;
  return (
    <div
      key={TODO_ALL_LIST_ID}
      className={`tab tab-all ${active ? "active" : ""}`}
      data-list-id={TODO_ALL_LIST_ID}
      onClick={() => {
        setView("lists");
        setCurrentListId(TODO_ALL_LIST_ID);
        persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
      }}
    >
      <span className="tab-label">
        <span className="tab-name">{t("boardAll")}</span>
      </span>
    </div>
  );
}

export function renderSyncSourceIcons(opts: {
  basecamp: boolean;
  reminders: boolean;
  github?: boolean;
}) {
  return (
    <span className="sync-source-stack" aria-hidden="true">
      {opts.basecamp ? (
        <img
          src="/todo/basecamp-logo.png"
          alt=""
          className="sync-source-icon basecamp-icon"
        />
      ) : null}
      {opts.reminders ? (
        <svg
          className="sync-source-icon reminders-icon"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      ) : null}
      {opts.github ? (
        <svg
          className="sync-source-icon github-icon"
          width="20"
          height="20"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      ) : null}
    </span>
  );
}

export function renderSyncControls(
  m: TodoPageModel,
  opts: {
    basecamp: boolean;
    reminders: boolean;
    github?: boolean;
    stopPropagation?: boolean;
  }
) {
  const {
    syncing,
    doSync,
  } = m;
  const sources = [
    opts.basecamp ? "Basecamp" : null,
    opts.reminders ? "Apple Reminders" : null,
    opts.github ? "GitHub" : null,
  ].filter(Boolean);
  const title =
    sources.length > 0
      ? `Sync with ${sources.join(" + ")}`
      : "Sync";
  return (
    <button
      type="button"
      className={`sync-controls${syncing ? " spinning" : ""}`}
      title={title}
      aria-label={title}
      disabled={syncing}
      style={syncing ? { opacity: 0.5 } : undefined}
      onClick={(e) => {
        if (opts.stopPropagation) e.stopPropagation();
        void doSync();
      }}
    >
      {renderSyncSourceIcons(opts)}
      <span className="sync-btn" aria-hidden="true">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
        </svg>
      </span>
    </button>
  );
}

export function renderListTab(m: TodoPageModel, list: TodoList) {
  const {
    view,
    setView,
    setCurrentListId,
    draggingListId,
    taskDropListId,
    tabDragRef,
    suppressTabClickUntil,
    lists,
    isAllListsView,
    activeList,
    openRenameListModal,
    removeList,
  } = m;
  const active =
    view === "lists" && !isAllListsView && activeList?.id === list.id;
  let className = `tab ${active ? "active" : ""} ${
    draggingListId === list.id ? "dragging" : ""
  }${taskDropListId === list.id ? " task-drop-target" : ""}`;
  const style: React.CSSProperties & Record<string, string> = {};
  const activeColor = resolveTabColorHex(list.colour);
  const tabIconId = resolveListIconId(list.emoji);
  if (activeColor) {
    const inactiveColor = hexToRgba(activeColor, 0.45);
    if (inactiveColor) {
      className += " tab-colorized";
      style["--tab-color-active"] = activeColor;
      style["--tab-color-inactive"] = inactiveColor;
    }
  }
  return (
    <div
      key={list.id}
      className={className}
      style={style}
      data-list-id={list.id}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (isInteractiveDragTarget(e.target)) return;
        tabDragRef.current = {
          listId: list.id,
          startX: e.clientX,
          startY: e.clientY,
          started: false,
        };
      }}
      onClick={() => {
        if (Date.now() < suppressTabClickUntil.current) return;
        if (active) {
          openRenameListModal(list);
        } else {
          setView("lists");
          setCurrentListId(list.id);
          persistPref(TODO_CURRENT_LIST_KEY, list.id);
        }
      }}
    >
      <span className="tab-label">
        {tabIconId ? (
          <span className="tab-icon" aria-hidden="true">
            <ListIcon id={tabIconId} size={14} />
          </span>
        ) : null}
        <span className="tab-name">{list.name}</span>
      </span>
      {lists.length > 1 ? (
        <button
          className="tab-close"
          title="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            removeList(list);
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
