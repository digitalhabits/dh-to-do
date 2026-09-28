"use client";

/*
 * The task area: the tasks or the board, the add-task box, the Done pile, the Planner View and the footer.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) and reads the names it needs
 * from it. The JSX is TodoPage's own, word for word.
 */

import * as React from "react";

import { AddTaskComposer } from "@/components/todo/AddTaskComposer";
import { BoardViewNudge } from "@/components/todo/BoardViewNudge";
import { TodoPlannerView } from "@/components/todo/TodoPlannerView";
import { DoneChevron, HeartIcon } from "@/components/todo/task-icons";
import { renderBoardColumn, renderBoardPills } from "@/components/todo/todo-board-view";
import { renderSyncControls } from "@/components/todo/todo-list-chrome";
import { renderTask } from "@/components/todo/todo-task-card";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { resolveBasecampImage } from "@/lib/todo/basecamp-image";
import { groupDoneTasks } from "@/lib/todo/done-groups";
import { dueDatePatch, timeSpentLabel } from "@/lib/todo/task-helpers";
import { type TodoBoardColumn } from "@/lib/todo/types";

export function renderTaskList(m: TodoPageModel) {
  const {
    visibleColumnOrder,
    boardLoadedRef,
    boardHadTask,
    view,
    boardStacked,
    somedayExpanded,
    somedayEnabled,
    tasksContainerRef,
    t,
    isSearching,
    searchGroups,
    openTasks,
    boardTasks,
    showBoard,
    flatListTasks,
    boardPills,
    boardAccordion,
    openStackColumn,
    showTodayRail,
    boardOpenColumns,
  } = m;
  return (
    <div
      className={`tasks-container ${showBoard ? "board-mode" : ""}`}
      ref={tasksContainerRef}
    >
      {/* Behind the Calendar the board is not on screen, and it is
          drawn again at each change of the page: every card of every
          task, for nothing. With some hundred tasks that was half a
          second for each click on the Calendar. So no cards there. */}
      {!boardHadTask && boardLoadedRef.current && !isSearching && !showBoard && view === "lists" ? (
        <div className="list-search-empty">{t("addTaskBelow")}</div>
      ) : null}
      {view === "plan" ? null : isSearching &&
      searchGroups.length === 0 &&
      (!showBoard || boardTasks.length === 0) ? (
        <div className="list-search-empty">{t("listSearchNoMatches")}</div>
      ) : showBoard ? (
        <div
          className={`list-board${
            !somedayEnabled
              ? " someday-off"
              : somedayExpanded
                ? " someday-expanded"
                : " someday-collapsed"
          }`}
        >
          {boardPills ? (
            (() => {
              /* Someday last, as the board reads it. The open one is
                 remembered across sessions with the accordion's, since
                 both answer the same question: which section is this
                 tile showing. */
              const sections: TodoBoardColumn[] = [
                ...visibleColumnOrder,
                ...(somedayEnabled ? (["someday"] as const) : []),
              ];
              const active = sections.includes(openStackColumn)
                ? openStackColumn
                : "today";
              return (
                <>
                  {renderBoardPills(m, sections, active)}
                  {renderBoardColumn(m, active)}
                </>
              );
            })()
          ) : boardAccordion ? (
            (() => {
              // Someday goes last: the maybe-work sits under the
              // real columns. A remembered section that is not on
              // this board any more falls back to Today.
              const sections: TodoBoardColumn[] = [
                ...visibleColumnOrder,
                ...(somedayEnabled ? (["someday"] as const) : []),
              ];
              const open = sections.includes(openStackColumn)
                ? openStackColumn
                : "today";
              return sections.map((column) =>
                renderBoardColumn(m, column, false, column !== open)
              );
            })()
          ) : (
            <>
              {/* Someday leads a wide board and follows a stacked one.
                  Across, it is the rail on the left, before the work
                  proper. Down, first means at the top — the maybe-work
                  above everything being done today, which is not what
                  a rail on the left says at all. */}
              {somedayEnabled && !boardStacked
                ? renderBoardColumn(m, "someday", !somedayExpanded)
                : null}
              {boardOpenColumns.map((column) =>
                renderBoardColumn(m, column, false)
              )}
              {showTodayRail ? renderBoardColumn(m, "today", true) : null}
              {somedayEnabled && boardStacked
                ? renderBoardColumn(m, "someday", !somedayExpanded)
                : null}
            </>
          )}
        </div>
      ) : view === "favourites" && openTasks.length === 0 ? (
        <div className="favourites-empty">
          <HeartIcon size={22} />
          <p className="favourites-empty-title">{t("noFavouritesTitle")}</p>
          <p className="favourites-empty-hint">{t("noFavouritesHint")}</p>
        </div>
      ) : (
        (view === "lists" ? flatListTasks : openTasks).map((task) => renderTask(m, task))
      )}
    </div>
  );
}

export function renderAddTask(m: TodoPageModel) {
  const {
    state,
    view,
    assignEnabled,
    setPeopleEditorOpen,
    lang,
    t,
    lists,
    isAllListsView,
    activeList,
    addTargetList,
    showBoard,
    flatListTasks,
    boardNudgeOpen,
    addedInListViewRef,
    answerBoardNudge,
    addTask,
    uploaderForList,
  } = m;
  return (
    view === "lists" &&
    !showBoard &&
    (activeList || isAllListsView) ? (
      <div className="add-task-container" id="add-task-container">
        {boardNudgeOpen ? (
          <BoardViewNudge
            count={flatListTasks.length}
            lang={lang}
            t={t}
            onTry={() => answerBoardNudge(true)}
            onDecline={() => answerBoardNudge(false)}
          />
        ) : null}
        <AddTaskComposer
          inputId="new-task-input"
          placeholder={t("addTaskPlaceholder")}
          addLabel={t("addTask")}
          minutesLabel={t("minutes")}
          onSubmit={(draft) => {
            addedInListViewRef.current = true;
            void addTask("week", draft);
          }}
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
    ) : null
  );
}

export function renderDonePile(m: TodoPageModel) {
  const {
    view,
    focusMode,
    doneCollapsed,
    setDoneCollapsed,
    remindersConnected,
    doneTasksRef,
    doneHeadingRowRef,
    t,
    lists,
    isAllListsView,
    activeList,
    isSearching,
    filteredDoneTasks,
    clearDone,
  } = m;
  if (focusMode) return null;
  const syncBasecamp = isAllListsView
    ? lists.some((l) => Boolean(l.basecampListId))
    : Boolean(activeList?.basecampListId);
  const syncReminders = isAllListsView
    ? lists.some(
        (l) => Boolean(l.remindersListId) && remindersConnected
      )
    : Boolean(activeList?.remindersListId && remindersConnected);
  const canSync =
    view === "lists" && (syncBasecamp || syncReminders);
  const showDone = filteredDoneTasks.length > 0 && !isSearching;
  const filteredDoneSeconds = filteredDoneTasks.reduce(
    (sum, t) => sum + (t.timeSpentSeconds || 0),
    0
  );
  if (!canSync && !showDone) return null;
  const syncBtn = canSync
    ? renderSyncControls(m, {
        basecamp: syncBasecamp,
        reminders: syncReminders,
        stopPropagation: true,
      })
    : null;
  if (!showDone) {
    return <div className="done-heading-row">{syncBtn}</div>;
  }
  return (
    <div
      className={`done-container ${doneCollapsed ? "collapsed" : ""}`}
      id="done-container"
      style={{
        display: "flex",
        // Collapsed, the box holds the heading row alone and takes
        // the height that row needs (see .done-container.collapsed
        // in todo-shell.css). No cap, so nothing is cut off.
        maxHeight: doneCollapsed ? undefined : 260,
      }}
    >
      <div className="done-heading-row" ref={doneHeadingRowRef}>
        {syncBtn}
        <div
          className="done-heading"
          id="done-heading"
          onClick={() => setDoneCollapsed((v) => !v)}
        >
          <div className="done-toggle">
            <span>{t("done")}</span>
            <DoneChevron />
          </div>
        </div>
      </div>
      <div className="done-summary">
        <span className="done-task-count">
          {filteredDoneTasks.length}{" "}
          {filteredDoneTasks.length === 1 ? "task" : "tasks"}
        </span>
        {filteredDoneSeconds > 0 ? (
          <span className="done-time-spent">
            {timeSpentLabel(filteredDoneSeconds, t("minutes"), t("hoursShort"))}
          </span>
        ) : null}
        {!doneCollapsed ? (
          <button
            className="delete-all-btn"
            title={t("deleteAllCompleted")}
            onClick={clearDone}
          >
            {t("clearAll")}
          </button>
        ) : null}
      </div>
      {/* The pile reads as the mail list does: a heading per
          stretch of days, newest first, and none for a stretch
          with nothing in it. */}
      <div className="done-tasks" ref={doneTasksRef}>
        {(view === "plan" ? [] : groupDoneTasks(filteredDoneTasks)).map((group) => (
          <React.Fragment key={group.bucket}>
            <div className="done-day-heading">{t(group.bucket)}</div>
            {group.tasks.map((task) => renderTask(m, task))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function renderPlanner(m: TodoPageModel) {
  const {
    state,
    view,
    setPeopleEditorOpen,
    planEnabled,
    lang,
    t,
    mePersonIds,
    mutateTask,
    openCalendarTask,
    openCalendarNewTask,
    addBoardPerson,
  } = m;
  return (
    planEnabled && view === "plan" ? (
      <TodoPlannerView
        lang={lang}
        people={state.people}
        onAddPerson={(name) => addBoardPerson({ name })}
        tasks={state.tasks}
        lists={state.lists}
        mePersonId={mePersonIds[0] ?? null}
        t={t}
        onEditPeople={() => setPeopleEditorOpen(true)}
        onTaskDueChange={(taskId, dueOn) => mutateTask(taskId, dueDatePatch(dueOn))}
        onTaskOpen={openCalendarTask}
        onTaskCreate={openCalendarNewTask}
      />
    ) : null
  );
}

export function renderFooter(m: TodoPageModel) {
  const {
    focusMode,
    standalone,
    t,
  } = m;
  return (
    !focusMode && standalone ? (
      <div className="footer">
        <span className="footer-text">
          {t("madeWith")} <span className="heart">♥</span> {t("by")}{" "}
          <a
            href="https://digitalhabits.org"
            target="_blank"
            rel="noreferrer"
          >
            digitalhabits.org
          </a>
        </span>
      </div>
    ) : null
  );
}
