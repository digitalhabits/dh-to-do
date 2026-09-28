"use client";

import * as React from "react";

import { renderCalendarCard } from "@/components/todo/todo-calendar-popover";
import {
  renderGroupsRow,
  renderListSearch,
  renderTabsRow,
  renderTitleBar,
} from "@/components/todo/todo-page-chrome";
import {
  renderConfirmDialog,
  renderListDialog,
  renderPeopleEditor,
  renderSettings,
  renderTodaySession,
  renderUndoNote,
} from "@/components/todo/todo-page-overlays";
import {
  renderAddTask,
  renderDonePile,
  renderFooter,
  renderPlanner,
  renderTaskList,
} from "@/components/todo/todo-task-area";
import { renderNotesOverlay } from "@/components/todo/todo-task-overlay";
import { useTodoPage, type TodoPageProps } from "@/components/todo/use-todo-page";

export type { TodoPageSnapshot } from "@/components/todo/use-board-reads";

export function TodoPage(props: TodoPageProps) {
  const m = useTodoPage(props);
  const {
    view,
    focusMode,
    openMenuTaskId,
    openListPickerTaskId,
    openAssignTaskId,
    searchRevealed,
    draggingTaskId,
    draggingListId,
    draggingGroupId,
    nativeShell,
    standalone,
    zoom,
    shellRef,
    shellWidthClasses,
    effectiveDark,
    showBoard,
    boardWidth,
    boardPills,
    boardAccordion,
  } = m;
  /*
    The Mac store app draws its own title bar: the window's buttons float
    over the page. `navigator.platform`, not the user agent: the app sends a
    Mac user agent on every system, and Windows has a title bar of its own.
  */
  const macWindow =
    nativeShell &&
    standalone &&
    typeof navigator !== "undefined" &&
    /^Mac/i.test(navigator.platform);

  return (
    <div
      ref={shellRef}
      className={`todo-shell ${
        draggingTaskId || draggingListId || draggingGroupId ? "is-reordering" : ""
      }${boardAccordion || boardPills ? " todo-tile-compact" : ""}${
        boardPills ? " todo-tile-pills" : ""
      } ${
        searchRevealed ? "list-search-open" : ""
      }${
        openMenuTaskId || openListPickerTaskId || openAssignTaskId
          ? " task-menu-open"
          : ""
      }${focusMode ? " focus-mode" : ""}${macWindow ? " mac-window" : ""}${
        shellWidthClasses ? ` ${shellWidthClasses}` : ""
      }`}
      data-theme={effectiveDark ? "dark" : undefined}
      style={
        {
          ["--todo-zoom"]: String(zoom / 100),
          ...(zoom !== 100 ? { zoom: zoom / 100 } : {}),
        } as React.CSSProperties
      }
    >
      {macWindow ? (
        /* See .dialog-title-strip: the window's own bar while a dialog is open. */
        <div className="dialog-title-strip" data-tauri-drag-region aria-hidden="true" />
      ) : null}
      <div id="normal-mode">
        {renderTitleBar(m)}

        <div
          className={`content-column${boardWidth ? " board-layout" : ""}`}
          style={view === "plan" ? { display: "none" } : undefined}
        >
          {renderGroupsRow(m)}
          {renderTabsRow(m)}

          {renderListSearch(m)}

          {/* Off the board, the list sits in one column like a board
              column, with the add-task box at its foot. On the board the
              wrapper steps out of the layout. Focus mode keeps the column:
              it hides the tabs, the Done section and the footer, and
              leaves the tasks as they are. */}
          <div
            className={`task-area${
              !showBoard && view !== "plan" ? " list-column" : ""
            }`}
          >
          {renderTaskList(m)}

          {renderAddTask(m)}
          </div>

          {renderDonePile(m)}
        </div>

        {renderPlanner(m)}

        {/* The line belongs to the store app. Inside the planner the board is
            one tab of the user's own tool, and it says nothing there. */}
        {renderFooter(m)}
      </div>

      {renderCalendarCard(m)}
      {renderNotesOverlay(m)}

      {renderListDialog(m)}

      {renderPeopleEditor(m)}

      {renderConfirmDialog(m)}

      {renderSettings(m)}

      {renderTodaySession(m)}

      {renderUndoNote(m)}
    </div>
  );
}
