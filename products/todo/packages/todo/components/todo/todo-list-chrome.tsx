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
  } ${draggingGroupId === group.id ? "dragging" : ""}`;
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
      {groupsSorted.length > 1 && active ? (
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
}) {
  return (
    <span className="sync-source-stack" aria-hidden="true">
      {opts.basecamp ? (
        // eslint-disable-next-line @next/next/no-img-element
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
    </span>
  );
}

export function renderSyncControls(
  m: TodoPageModel,
  opts: {
    basecamp: boolean;
    reminders: boolean;
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
      {lists.length > 1 && active ? (
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
