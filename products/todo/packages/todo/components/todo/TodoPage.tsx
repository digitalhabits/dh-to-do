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
import { AddTaskComposer } from "@/components/todo/AddTaskComposer";
import { renderTask } from "@/components/todo/todo-task-card";
import { resolveBasecampImage } from "@/lib/todo/basecamp-image";
import { renderNotesOverlay } from "@/components/todo/todo-task-overlay";
import { useTodoPage, type TodoPageProps } from "@/components/todo/use-todo-page";

export type { TodoPageSnapshot } from "@/components/todo/use-board-reads";

export function TodoPage(props: TodoPageProps) {
  const m = useTodoPage(props);
  /* Tasks added in the embedded add row show at once, before the page
     around it has heard of them. */
  const [embedAdded, setEmbedAdded] = React.useState<string[]>([]);
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
      }${boardAccordion || boardPills || m.embedTaskIds ? " todo-tile-compact" : ""}${
        boardPills ? " todo-tile-pills" : ""
      } ${
        searchRevealed ? "list-search-open" : ""
      }${
        openMenuTaskId || openListPickerTaskId || openAssignTaskId
          ? " task-menu-open"
          : ""
      }${focusMode ? " focus-mode" : ""}${macWindow ? " mac-window" : ""}${
        m.calendarOnly ? " todo-calendar-only" : ""
      }${
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
        {m.embedTaskIds ? (
          /* Only the cards asked for, as cards of a list: see embedTaskIds. */
          <div className="task-area list-column todo-embed">
            {m.state.tasks
              .filter(
                (task) =>
                  !task.parentTaskId &&
                  (m.embedTaskIds!.includes(task.id) || embedAdded.includes(task.id))
              )
              .map((task) => renderTask(m, task))}
            {m.embedComposer ? (
              <div className="board-column-add">
                <AddTaskComposer
                  placeholder={m.embedComposer.placeholder}
                  addLabel={m.t("addTask")}
                  minutesLabel={m.t("minutes")}
                  onSubmit={async (draft) => {
                    const composer = m.embedComposer!;
                    const id = await m.addTask("week", {
                      ...draft,
                      listId: draft.listId ?? composer.listId,
                    });
                    if (!id) return;
                    setEmbedAdded((ids) => [...ids, id]);
                    composer.onAdded(id);
                  }}
                  uploadImageForList={m.uploaderForList}
                  resolveImageSrc={resolveBasecampImage}
                  people={m.state.people}
                  assignEnabled={m.assignEnabled}
                  calendarEnabled={m.planEnabled}
                  onEditPeople={() => m.setPeopleEditorOpen(true)}
                  lists={m.lists}
                  defaultList={m.state.lists.find((l) => l.id === m.embedComposer!.listId) ?? null}
                  lang={m.lang}
                  t={m.t}
                />
              </div>
            ) : null}
          </div>
        ) : (
        <>
        {/* The Calendar tab is the calendar alone: no lists, no switch to
            them, no footer. See `calendarOnly`. */}
        {m.calendarOnly ? null : renderTitleBar(m)}

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
        {m.calendarOnly ? null : renderFooter(m)}
        </>
        )}
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
