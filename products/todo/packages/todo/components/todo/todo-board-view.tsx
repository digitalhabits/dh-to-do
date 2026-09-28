"use client";

/*
 * The board: its columns, and on a short tile the row of pills that names them.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) first and reads the names it
 * needs from it. The JSX is TodoPage's own, word for word.
 */

import * as React from "react";

import {
  ArrowDownUp,
  ArrowUp,
  Check,
  ChevronLeft,
  History,
} from "lucide-react";

import { AddTaskComposer } from "@/components/todo/AddTaskComposer";
import { MenuKeys } from "@/components/todo/MenuKeys";
import { MenuPortal } from "@/components/todo/MenuPortal";
import { renderTask } from "@/components/todo/todo-task-card";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { resolveBasecampImage } from "@/lib/todo/basecamp-image";
import { COLUMN_SORTS, SORT_LABEL_KEY } from "@/lib/todo/column-sort";
import { type TodoBoardColumn } from "@/lib/todo/types";

/**
 * A column's name as drawn. The headers are set in capitals, but an
 * aside in brackets at the end — "Soon (-ish)" — stays in small letters
 * and a shade lighter: it is a wink, not part of the name.
 */
export function boardColumnName(
  m: TodoPageModel,
  column: TodoBoardColumn
): React.ReactNode {
  const {
    boardColumnLabel,
  } = m;
  const label = boardColumnLabel(column);
  const aside = label.match(/^(.*?)\s*(\([^)]*\))$/);
  if (!aside) return label;
  return (
    <>
      {aside[1]} <span className="board-label-aside">{aside[2]}</span>
    </>
  );
}

/**
 * The sections as a row of pills, for a tile too short to stack them.
 *
 * Each pill carries `data-board-column`, which is what the drag already
 * looks for under the pointer — so a task dragged onto a pill lands in
 * that section, and the pill lights up on the way, without the drag
 * knowing anything about pills.
 *
 * At most three are named. The rest live behind "…", and whichever is
 * open is always one of the named, so the row never hides the section
 * the reader is looking at.
 */
export function renderBoardPills(
  m: TodoPageModel,
  sections: TodoBoardColumn[],
  active: TodoBoardColumn
) {
  const {
    boardDragHover,
    t,
    boardColumns,
    pillMenuOpen,
    setPillMenuOpen,
    openStackSection,
    startTodaySession,
  } = m;
  const shown = sections.slice(0, 3);
  const rest = sections.slice(3);
  if (!shown.includes(active) && rest.includes(active)) {
    shown[shown.length - 1] = active;
  }
  const hidden = sections.filter((column) => !shown.includes(column));
  const pill = (column: TodoBoardColumn) => (
    <button
      key={column}
      type="button"
      data-board-column={column}
      className={`board-pill${column === active ? " is-active" : ""}${
        boardDragHover?.column === column ? " is-drop-target" : ""
      }`}
      onClick={() => openStackSection(column)}
    >
      {boardColumnName(m, column)}
      <span className="board-pill-count">{boardColumns[column].length}</span>
    </button>
  );
  return (
    <div className="board-pills">
      {shown.map(pill)}
      {hidden.length ? (
        <div className="board-pill-more-wrap">
          <button
            type="button"
            className="board-pill board-pill-more"
            title={t("boardMoreSections")}
            aria-label={t("boardMoreSections")}
            onClick={(event) => {
              event.stopPropagation();
              setPillMenuOpen((open) => !open);
            }}
          >
            …
          </button>
          {pillMenuOpen ? (
            <div
              className="board-pill-menu"
              onClick={(event) => event.stopPropagation()}
            >
              {hidden.map((column) => (
                <button
                  key={column}
                  type="button"
                  data-board-column={column}
                  className="board-pill-menu-item"
                  onClick={() => {
                    openStackSection(column);
                    setPillMenuOpen(false);
                  }}
                >
                  {boardColumnName(m, column)}
                  <span className="board-pill-count">
                    {boardColumns[column].length}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {boardColumns.today.some((task) => !task.completed) ? (
        <button
          type="button"
          className="board-start-btn board-pills-start"
          title={t("sessionStart")}
          onClick={startTodaySession}
        >
          <span aria-hidden="true">▶</span> {t("sessionStart")}
        </button>
      ) : null}
    </div>
  );
}

export function renderBoardColumn(
  m: TodoPageModel,
  column: TodoBoardColumn,
  asRail = false,
  folded = false
) {
  const {
    state,
    draggingColumn,
    assignEnabled,
    setPeopleEditorOpen,
    boardDragHover,
    lang,
    t,
    lists,
    addTargetList,
    columnSorts,
    pickColumnSort,
    columnSortMenu,
    setColumnSortMenu,
    columnSortAnchor,
    setColumnSortAnchor,
    boardColumns,
    storeSomedayExpanded,
    openStackSection,
    onRailActivate,
    boardColumnLabel,
    startColumnDrag,
    startTodaySession,
    addTask,
    uploaderForList,
  } = m;
  const label = boardColumnLabel(column);
  return (
    <section
      key={column}
      className={`board-column board-column-${column}${
        asRail ? " is-rail" : ""
      }${folded ? " is-folded" : ""}${
        boardDragHover?.column === column
          ? " board-column-drop-target"
          : ""
      }${draggingColumn === column ? " is-dragging-column" : ""}`}
      data-board-column={column}
      role={asRail ? "button" : undefined}
      tabIndex={asRail ? 0 : undefined}
      title={asRail ? t("expandColumn").replace("{name}", label) : undefined}
      aria-label={
        asRail
          ? `${t("expandColumn").replace("{name}", label)} (${
              boardColumns[column].length
            })`
          : undefined
      }
      onClick={asRail ? () => onRailActivate(column) : undefined}
      onKeyDown={
        asRail
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onRailActivate(column);
              }
            }
          : undefined
      }
    >
      {(column === "someday" || column === "today" || column === "backlog") && (
        <div className="board-rail-face" aria-hidden={!asRail}>
          {column === "someday" ? (
            <History className="board-rail-icon" aria-hidden="true" />
          ) : null}
          <span className="board-rail-text">
            <span className="board-rail-label">{boardColumnName(m, column)}</span>
            <span className="board-rail-count">
              {boardColumns[column].length}
            </span>
          </span>
        </div>
      )}
      <div className="board-column-body">
        <header
          className="board-column-header"
          onPointerDown={(event) => {
            if (asRail || folded) return;
            startColumnDrag(event, column);
          }}
          onClick={folded ? () => openStackSection(column) : undefined}
          role={folded ? "button" : undefined}
          tabIndex={folded ? 0 : undefined}
          onKeyDown={
            folded
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openStackSection(column);
                  }
                }
              : undefined
          }
        >
          <span className="board-column-title">{boardColumnName(m, column)}</span>
          <span className="board-column-count">
            {boardColumns[column].length}
          </span>
          {/* The order, on hover: a glyph, and the order's name when it
              is not the default. One click opens the choice. */}
          {asRail || folded ? null : (
            <span
              className={`board-sort-wrap${
                columnSortMenu === column ? " is-open" : ""
              }`}
            >
              <button
                type="button"
                className="board-sort-btn"
                title={t("sortBy")}
                aria-label={`${t("sortBy")}: ${t(
                  SORT_LABEL_KEY[columnSorts[column].sort]
                )}`}
                aria-haspopup="menu"
                aria-expanded={columnSortMenu === column}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (columnSortMenu === column) {
                    setColumnSortMenu(null);
                    setColumnSortAnchor(null);
                  } else {
                    setColumnSortAnchor(event.currentTarget);
                    setColumnSortMenu(column);
                  }
                }}
              >
                {/* The direction, as an arrow that turns; ⇅ where there
                    is none (manual). */}
                {columnSorts[column].sort === "manual" ? (
                  <ArrowDownUp size={13} strokeWidth={2} aria-hidden />
                ) : (
                  <ArrowUp
                    size={13}
                    strokeWidth={2}
                    aria-hidden
                    className={`board-sort-arrow${
                      columnSorts[column].desc ? " is-desc" : ""
                    }`}
                  />
                )}
                <span className="board-sort-label">
                  {t(SORT_LABEL_KEY[columnSorts[column].sort])}
                </span>
              </button>
              <MenuPortal
                open={columnSortMenu === column}
                anchorEl={columnSortMenu === column ? columnSortAnchor : null}
                className="task-menu board-sort-menu"
                align="right"
                role="menu"
                ariaLabel={t("sortBy")}
              >
                <MenuKeys
                  onClose={(reason) => {
                    const glyph = columnSortAnchor;
                    setColumnSortMenu(null);
                    setColumnSortAnchor(null);
                    if (reason === "escape") glyph?.focus();
                  }}
                >
                {/* The active row carries its arrow: pick it again and
                    the order runs the other way. */}
                {COLUMN_SORTS.filter(
                  (sort) => assignEnabled || sort !== "assignee"
                ).map((sort) => {
                  const active = columnSorts[column].sort === sort;
                  return (
                    <button
                      key={sort}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={`task-menu-item board-sort-item${
                        active ? " is-current" : ""
                      }`}
                      onClick={() => {
                        pickColumnSort(column, sort);
                        setColumnSortMenu(null);
                        setColumnSortAnchor(null);
                      }}
                    >
                      <span className="board-sort-check" aria-hidden>
                        {active ? <Check size={14} strokeWidth={2.5} /> : null}
                      </span>
                      {t(SORT_LABEL_KEY[sort])}
                      {active && sort !== "manual" ? (
                        <ArrowUp
                          size={13}
                          strokeWidth={2}
                          aria-hidden
                          className={`board-sort-arrow board-sort-item-arrow${
                            columnSorts[column].desc ? " is-desc" : ""
                          }`}
                        />
                      ) : null}
                    </button>
                  );
                })}
                </MenuKeys>
              </MenuPortal>
            </span>
          )}
          {column === "someday" ? (
            <button
              type="button"
              className="board-column-collapse"
              title={t("collapseSomeday")}
              aria-label={t("collapseSomeday")}
              onClick={() => storeSomedayExpanded(false)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
          ) : null}
          {column === "today" &&
          boardColumns.today.some((task) => !task.completed) ? (
            <button
              type="button"
              className="board-start-btn"
              title={t("sessionStart")}
              onClick={startTodaySession}
            >
              <span aria-hidden="true">▶</span> {t("sessionStart")}
            </button>
          ) : null}
        </header>
        <div className="board-column-tasks">
          {folded ? null : boardColumns[column].map((task) => renderTask(m, task))}
        </div>
        {folded ? null : (
        <div className="board-column-add">
          <AddTaskComposer
            placeholder={t("addTaskPlaceholder")}
            addLabel={t("addTask")}
            minutesLabel={t("minutes")}
            onSubmit={(draft) => void addTask(column, draft)}
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
        )}
      </div>
    </section>
  );
}
