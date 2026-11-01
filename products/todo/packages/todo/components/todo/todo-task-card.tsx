"use client";

/*
 * A task's card: its row on the board and in a list, with its chips, its
 * menus and its hover pill.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) first and reads the names it
 * needs from it. The JSX is TodoPage's own, word for word.
 */

import * as React from "react";

import {
  Calendar,
  Check,
  Columns3,
  CornerDownRight,
  List,
  ListChecks,
  User,
} from "lucide-react";

import { DuePopover } from "@/components/todo/DuePopover";
import { MenuKeys } from "@/components/todo/MenuKeys";
import { SearchableListMenu } from "@/components/todo/SearchableListMenu";
import { MenuPortal } from "@/components/todo/MenuPortal";
import { TaskAssignMenu, TaskAssigneeStack } from "@/components/todo/TodoPeopleEditor";
import {
  ClockIcon,
  FocusIcon,
  HeartIcon,
  MenuDotsIcon,
  MoveIcon,
  MoveToBottomIcon,
  MoveToTopIcon,
  NotesIcon,
  TrashIcon,
} from "@/components/todo/task-icons";
import { renderNotesEditor } from "@/components/todo/todo-task-overlay";
import { TaskGithubItem, TaskGithubLink } from "@/components/todo/task-github-item";
import { isCardClickSkip, isInteractiveDragTarget, lastTaskDragEnd } from "@/components/todo/use-pointer-drag";
import { TaskInfoMenuItem } from "@/components/todo/task-details-info";
import { MakeSubtaskItem, ParentPickerItems } from "@/components/todo/task-menu-parent";
import { ColumnPickerItems } from "@/components/todo/task-menu-columns";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { DoneStamp } from "@/components/todo/DoneStamp";
import { formatDurationShort } from "@/lib/todo/duration";
import { walkArrowStops, walkTabStops } from "@/lib/todo/focus-walk";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import { shortPersonName } from "@/lib/todo/people";
import {
  daysUntilDue,
  formatDueOn,
  formatDueOnShort,
} from "@/lib/todo/task-draft";
import {
  animTargetKey,
  columnEnd, dueDatePatch,
  isUnlistedTask,
  timeSpentLabel,
} from "@/lib/todo/task-helpers";
import { boardColumnOf, type TodoPerson, type TodoTask } from "@/lib/todo/types";
import { nudgeIntoView } from "@/lib/todo/hover-nudge";
import { NotesChip } from "@/components/todo/notes-chip";
import { randomSubtaskPartyEmoji, spawnCompletionParty } from "@/lib/todo/task-celebration";
import { earliestStepDue } from "@/lib/todo/step-due";
import { StepListMark } from "@/components/todo/step-list-mark";
import { flashSubtaskRow } from "@/components/todo/use-notes-card";

/** How long a finger holds a card before the card is carried, not the list scrolled. */
const TOUCH_DRAG_HOLD_MS = 320;


/** The chip of the people on the task, and their menu. */
function cardAssignChip(
  m: TodoPageModel,
  task: TodoTask,
  { assignOpen, assignees }: { assignOpen: boolean; assignees: TodoPerson[] }
) {
  const {
    state,
    assignEnabled,
    setOpenMenuTaskId,
    setOpenAssignTaskId,
    assignAnchorEl,
    setAssignAnchorEl,
    setPeopleEditorOpen,
    t,
    toggleTaskAssignee,
    closeAssignMenu,
  } = m;
  /*
    The same split as favourite and focus: with somebody on it this is
    state and stays on the row, with nobody on it it is a control and
    rides in the pill. It was `hover-only` inside `.always-actions`,
    which widened the row on hover and moved the words with it.
  */
  return assignEnabled && !task.completed ? (
    <div
      className={`assign-menu-wrap task-chip-wrap ${
        assignOpen ? "has-open-menu" : ""
      }`}
    >
      <button
        type="button"
        className={`task-chip task-chip-assign${
          assignees.length > 0 ? " is-set" : " is-icon is-ghost"
        }`}
        title={
          assignees.length > 0
            ? assignees.map((p) => shortPersonName(p.name)).join(", ")
            : t("assignPerson")
        }
        onClick={(e) => {
          e.stopPropagation();
          setOpenMenuTaskId(null);
          if (assignOpen) {
            closeAssignMenu();
          } else {
            setAssignAnchorEl(e.currentTarget);
            setOpenAssignTaskId(task.id);
          }
        }}
      >
        {assignees.length > 0 ? (
          <TaskAssigneeStack people={assignees} size={20} />
        ) : (
          // The icon alone: the word is for the add row, where nothing is
          // known yet. On a card the ghost is one of a row of icons.
          <User size={13} strokeWidth={2} aria-hidden />
        )}
      </button>
      <TaskAssignMenu
        open={assignOpen}
        anchorEl={assignOpen ? assignAnchorEl : null}
        people={state.people}
        assigneeIds={task.assigneeIds}
        t={t}
        onToggle={(personId) => toggleTaskAssignee(task.id, personId)}
        onEditPeople={() => {
          closeAssignMenu();
          setPeopleEditorOpen(true);
        }}
        onClose={closeAssignMenu}
      />
    </div>
  ) : null;
}

/** The chip of the due date, and its popover. */
function cardDueChip(
  m: TodoPageModel,
  task: TodoTask,
  { duePopoverOpen }: { duePopoverOpen: boolean }
) {
  const {
    view,
    dueCalendarWanted,
    setDueCalendarWanted,
    setDuePopoverTaskId,
    duePopoverAnchor,
    setDuePopoverAnchor,
    setOpenMenuTaskId,
    setOpenAssignTaskId,
    planEnabled,
    lang,
    t,
    navigateToList,
    mutateTask,
  } = m;
  /*
    The due date, the duration and the note as chips of the meta row —
    the same three the add row draws. Set, a chip is filled; unset, it is
    a ghost that arrives with the pointer, in the same place, so a card
    and the add row read as one vocabulary.
  */
  const dueDays = task.dueOn ? daysUntilDue(task.dueOn) : null;
  const closeDuePopover = () => {
    // The caret goes back to the chip, so Tab carries on along the row.
    duePopoverAnchor?.focus();
    setDuePopoverTaskId(null);
    setDuePopoverAnchor(null);
  };
  return !task.completed ? (
    <span className="task-chip-wrap">
      <button
        type="button"
        /* `is-icon` with no date: a chip with a label has more room on the
           right, for the words. With the icon alone that room stayed, and
           the icon sat left of the middle. */
        className={`task-chip task-chip-due${task.dueOn ? " is-set" : " is-icon is-ghost"}${
          dueDays != null && dueDays < 0
            ? " is-overdue"
            : dueDays === 0
              ? " is-due-today"
              : ""
        }${duePopoverOpen ? " is-on" : ""}`}
        title={
          task.dueOn
            ? `${t("fieldDue")}: ${formatDueOn(task.dueOn, lang, t)}`
            : t("composerDue")
        }
        aria-haspopup="dialog"
        aria-expanded={duePopoverOpen}
        onClick={(e) => {
          e.stopPropagation();
          if (duePopoverOpen) {
            closeDuePopover();
            return;
          }
          if (view === "favourites") {
            if (task.listId) navigateToList(task.listId);
            return;
          }
          setOpenMenuTaskId(null);
          setOpenAssignTaskId(null);
          setDuePopoverAnchor(e.currentTarget);
          setDuePopoverTaskId(task.id);
          setDueCalendarWanted(task.showOnCalendar);
        }}
      >
        <Calendar size={13} strokeWidth={2} aria-hidden />
        {task.dueOn ? (
          <span className="task-chip-label">
            {formatDueOnShort(task.dueOn, lang, t)}
          </span>
        ) : null}
      </button>
      {duePopoverOpen ? (
      <DuePopover
        open={duePopoverOpen}
        anchorEl={duePopoverOpen ? duePopoverAnchor : null}
        value={task.dueOn}
        onPick={(dueOn) => {
          closeDuePopover();
          // Only a dated task can be on the Calendar: a day taken away
          // takes the task off it, and a first day puts it on when the
          // box was ticked before the day was picked.
          void mutateTask(task.id, {
            ...dueDatePatch(dueOn, task, columnEnd(m.boardColumns.week)),
            showOnCalendar: dueOn ? dueCalendarWanted : false,
          });
        }}
        onClose={closeDuePopover}
        calendar={
          planEnabled
            ? {
                checked: dueCalendarWanted,
                onChange: (checked) => {
                  setDueCalendarWanted(checked);
                  if (task.dueOn) {
                    void mutateTask(task.id, { showOnCalendar: checked });
                  }
                },
              }
            : undefined
        }
        lang={lang}
        t={t}
      />
      ) : null}
    </span>
  ) : null;
}


/** The duration on the row: said, or offered, or typed in. */
function cardDurationMeta(
  m: TodoPageModel,
  task: TodoTask,
  { editingDur, hasDuration }: { editingDur: boolean; hasDuration: boolean }
) {
  const {
    view,
    setEditingDurationTaskId,
    editingDuration,
    setEditingDuration,
    t,
    navigateToList,
    commitEditDuration,
  } = m;
  const durationEditor = (
    <input
      autoFocus
      /* A done task's time takes words ("1.5h", "1h 15m"), as a duration
         does in its popover; see parseSpentText. */
      type={task.completed ? "text" : "number"}
      min={task.completed ? undefined : 0}
      max={task.completed ? undefined : 999}
      className="task-duration-input"
      style={{ width: task.completed ? 64 : 52 }}
      value={editingDuration}
      onChange={(e) => setEditingDuration(e.target.value)}
      onBlur={() => commitEditDuration(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitEditDuration(task);
        if (e.key === "Escape") setEditingDurationTaskId(null);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
  const startDurationEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (view === "favourites") {
      if (task.listId) navigateToList(task.listId);
      return;
    }
    setEditingDurationTaskId(task.id);
    setEditingDuration(
      task.completed
        ? task.timeSpentSeconds >= 60
          ? formatDurationShort(
              Math.round(task.timeSpentSeconds / 60),
              t("minutes"),
              t("hoursShort")
            )
          : ""
        : task.expectedDurationMinutes
          ? String(task.expectedDurationMinutes)
          : ""
    );
  };
  const metaAlways = hasDuration ? (
    editingDur ? (
      durationEditor
    ) : (
      <span
        className={`task-meta ${task.completed ? "actual-time" : ""}`}
        title={task.completed ? undefined : "Click to edit duration"}
        onClick={startDurationEdit}
      >
        {task.completed
          ? timeSpentLabel(task.timeSpentSeconds, t("minutes"), t("hoursShort"))
          : `${task.expectedDurationMinutes}${t("minutes")}`}
      </span>
    )
  ) : null;
  const metaHover = !hasDuration ? (
    editingDur ? (
      durationEditor
    ) : (
      <span
        className="task-meta add-time"
        title="Add duration"
        onClick={startDurationEdit}
      >
        <ClockIcon />
      </span>
    )
  ) : null;
  return { metaAlways, metaHover };
}

/** The chip of the task's list on the All tab, and the picker that moves it. */
function cardOriginPicker(
  m: TodoPageModel,
  task: TodoTask,
  {
    unlisted,
    showListOrigin,
    listPickerOpen,
  }: {
    unlisted: boolean;
    showListOrigin: boolean;
    listPickerOpen: boolean;
  }
) {
  const {
    setOpenMenuTaskId,
    setMenuShowsMoveTargets,
    setOpenListPickerTaskId,
    listPickerAnchorEl,
    setListPickerAnchorEl,
    setOpenAssignTaskId,
    listOfTask,
    moveTargets,
    mutateTask,
  } = m;
  const taskList = listOfTask(task);
  const listOriginIconId = resolveListIconId(taskList?.emoji);
  return showListOrigin ? (
    <div
      className={`task-list-origin-wrap${
        listPickerOpen ? " is-open" : ""
      }`}
    >
      <button
        type="button"
        className={`task-list-origin${
          listOriginIconId || unlisted ? " has-icon" : ""
        }${unlisted ? " is-unassigned" : ""}${!listOriginIconId && !unlisted ? " has-name" : ""}`}
        title={
          unlisted
            ? "Assign to a list"
            : taskList
              ? `List: ${taskList.name}. Change list`
              : "Assign to a list"
        }
        aria-label={
          unlisted
            ? "Assign to a list"
            : taskList
              ? `Change list from ${taskList.name}`
              : "Assign to a list"
        }
        aria-haspopup="menu"
        aria-expanded={listPickerOpen}
        disabled={moveTargets.lists.length === 0}
        onClick={(e) => {
          e.stopPropagation();
          setOpenMenuTaskId(null);
          setMenuShowsMoveTargets(false);
          setOpenAssignTaskId(null);
          setListPickerAnchorEl(listPickerOpen ? null : e.currentTarget);
          setOpenListPickerTaskId(
            listPickerOpen ? null : task.id
          );
        }}
      >
        {listOriginIconId ? (
          <ListIcon id={listOriginIconId} size={14} />
        ) : unlisted ? (
          <List size={14} strokeWidth={1.75} aria-hidden />
        ) : (
          <span className="task-list-origin-name">{taskList?.name ?? "?"}</span>
        )}
      </button>
      {/* Built only while open: every card has one, and a closed menu's
          contents were drawn again on every redraw of the board. */}
      {listPickerOpen ? (
      <MenuPortal
        open={listPickerOpen}
        anchorEl={listPickerOpen ? listPickerAnchorEl : null}
        className="task-list-picker"
        role="menu"
        ariaLabel="Move to list"
      >
        <SearchableListMenu
          lists={moveTargets.lists}
          headingOf={moveTargets.headingOf}
          t={m.t}
          onClose={(reason) => {
            const anchor = listPickerAnchorEl;
            setOpenListPickerTaskId(null);
            setListPickerAnchorEl(null);
            if (reason === "escape") anchor?.focus();
          }}
          renderItem={(l) => {
          const iconId = resolveListIconId(l.emoji);
          const selected = !unlisted && l.id === task.listId;
          return (
            <button
              key={l.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              className={`task-list-picker-item${
                selected ? " is-current" : ""
              }`}
              onClick={() => {
                setOpenListPickerTaskId(null);
                if (selected) return;
                void mutateTask(task.id, { listId: l.id });
              }}
            >
              <span
                className={`task-list-picker-icon${
                  iconId ? " has-icon" : ""
                }`}
              >
                {/* No icon: the slot stays empty, so the names line up. */}
                  {iconId ? <ListIcon id={iconId} size={14} /> : null}
              </span>
              <span className="task-list-picker-name">{l.name}</span>
            </button>
          );
        }}
        />
      </MenuPortal>
      ) : null}
    </div>
  ) : null;
}

/** The "…" menu of the card. */
function cardMenu(
  m: TodoPageModel,
  task: TodoTask,
  {
    menuOpen,
    unlisted,
    hasDuration,
    openDurationPopover,
  }: {
    menuOpen: boolean;
    unlisted: boolean;
    hasDuration: boolean;
    openDurationPopover: (anchor: HTMLElement) => void;
  },
  /** "card": the full menu. "details": in task details, beside Back.
      "row": the ⋮ a task row shows on hover. The last two leave out what
      details already offer (time, notes, favourite). */
  variant: "card" | "details" | "row" = "card"
) {
  const trimmed = variant !== "card";
  const inDetails = variant === "details";
  /* Board View: an open task can be moved to another column from here,
     as by a drag. A subtask is not on the board. */
  const currentColumn = boardColumnOf(task, m.somedayEnabled);
  const canMoveColumn = m.showBoard && !task.completed && !task.parentTaskId;
  const {
    setOpenMenuTaskId,
    menuAnchorEl,
    setMenuAnchorEl,
    menuShowsMoveTargets,
    setMenuShowsMoveTargets,
    menuShowsColumns,
    setMenuShowsColumns,
    menuShowsParents,
    setMenuShowsParents,
    boardColumnLabel,
    setOpenListPickerTaskId,
    setOpenAssignTaskId,
    t,
    lists,
    moveTargets,
    runEdges,
    foldPillActions,
    mutateTask,
    moveTaskToEdge,
    removeTask,
    toggleNotes,
    kanbanEnabled,
    toggleFavourite,
    setEditingDurationTaskId,
    setEditingDuration,
  } = m;
  // Open only where its ⋮ was pressed: details and the card behind them
  // share the task, and both menus opened, one over the other.
  menuOpen = menuOpen && (!menuAnchorEl || menuAnchorEl.classList.contains("task-details-more") === inDetails);
  /* The "…" menu: in the meta row of an open card, in the hover pill of
     a done row. */
  return (
        <div
          className={`task-menu-wrap ${menuOpen ? "has-open-menu" : ""}`}
        >
          <button
            type="button"
            className={inDetails ? "task-menu-btn task-details-more" : variant === "row" ? "task-menu-btn task-row-more" : "task-menu-btn is-ghost"}
            title={trimmed ? t("taskMore") : "Task options"}
            aria-label={trimmed ? t("taskMore") : undefined}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setOpenAssignTaskId(null);
              setOpenListPickerTaskId(null);
              setMenuShowsMoveTargets(false);
              setMenuAnchorEl(menuOpen ? null : e.currentTarget);
              setOpenMenuTaskId(menuOpen ? null : task.id);
            }}
          >
            {inDetails ? <MenuDotsIcon size={20} strokeWidth={2.5} /> : <MenuDotsIcon size={variant === "row" ? 16 : 14} />}
          </button>
          {/* Built only while open, as the list picker is. */}
          {menuOpen ? (
          <MenuPortal
            open={menuOpen}
            anchorEl={menuOpen ? menuAnchorEl : null}
            className={trimmed ? "task-menu task-details-menu" : "task-menu"}
            role="menu"
            ariaLabel="Task options"
          >
            {/* The caret goes to the first offer, the arrows and Tab
                walk them, and Escape gives it back to the button. The
                menu is put away by the next click anywhere, so it does
                not close on its own caret when Move to redraws it —
                which is also why that redraw is a fresh key. */}
            <MenuKeys
              key={menuShowsMoveTargets ? "move" : menuShowsColumns ? "columns" : menuShowsParents ? "parents" : "offers"}
              closeOnBlur={false}
              focusOnOpen={!menuShowsParents}
              onClose={() => {
                const anchor = menuAnchorEl;
                setOpenMenuTaskId(null);
                setMenuShowsMoveTargets(false);
                setMenuAnchorEl(null);
                anchor?.focus();
              }}
            >
            {menuShowsParents ? (
              <ParentPickerItems m={m} task={task} inDetails={inDetails} close={() => setOpenMenuTaskId(null)} />
            ) : menuShowsColumns ? (
              <ColumnPickerItems
                m={m}
                task={task}
                close={() => {
                  setOpenMenuTaskId(null);
                  setMenuShowsColumns(false);
                }}
              />
            ) : menuShowsMoveTargets ? (
              // Every list, the task's own among them, ticked (the caret starts there).
              moveTargets.lists.map((l, i, shown) => {
                  // Each list under its own icon, as the tabs draw them,
                  // and another group's lists under that group's name.
                  const iconId = resolveListIconId(l.emoji);
                  const heading = moveTargets.headingOf(l);
                  const startsGroup =
                    heading !== null &&
                    (i === 0 || moveTargets.headingOf(shown[i - 1]) !== heading);
                  return (
                    <React.Fragment key={l.id}>
                    {startsGroup ? (
                      <div className="list-menu-heading" role="presentation">
                        {heading}
                      </div>
                    ) : null}
                    <button
                      role="menuitemradio"
                      aria-checked={l.id === task.listId}
                      className={`task-menu-item${l.id === task.listId ? " board-sort-item is-current" : ""}`}
                      onClick={() => {
                        setOpenMenuTaskId(null);
                        setMenuShowsMoveTargets(false);
                        if (l.id !== task.listId) void mutateTask(task.id, { listId: l.id });
                      }}
                    >
                      <span
                        className={`task-list-picker-icon${
                          iconId ? " has-icon" : ""
                        }`}
                      >
                        {/* No icon: the slot stays empty, so the names line up. */}
                          {iconId ? <ListIcon id={iconId} size={14} /> : null}
                      </span>
                      {l.name}
                      {l.id === task.listId ? <Check size={14} strokeWidth={2.5} className="board-sort-item-arrow" aria-hidden /> : null}
                    </button>
                    </React.Fragment>
                  );
                })
            ) : (
              <>
                {/* Done tasks sit in the order they were finished, and
                    an end the task already holds is left out. */}
                {!task.completed && !runEdges.first.has(task.id) ? (
                  <button
                    role="menuitem"
                    className="task-menu-item"
                    onClick={() => {
                      setOpenMenuTaskId(null);
                      moveTaskToEdge(task, "top");
                    }}
                  >
                    <MoveToTopIcon />
                    {t("moveToTop")}
                  </button>
                ) : null}
                {!task.completed && !runEdges.last.has(task.id) ? (
                  <button
                    role="menuitem"
                    className="task-menu-item"
                    onClick={() => {
                      setOpenMenuTaskId(null);
                      moveTaskToEdge(task, "bottom");
                    }}
                  >
                    <MoveToBottomIcon />
                    {t("moveToBottom")}
                  </button>
                ) : null}
                {moveTargets.lists.length > 1 ||
                (unlisted && moveTargets.lists.length > 0) ? (
                  <button
                    role="menuitem"
                    className="task-menu-item move-task-item"
                    onClick={() => setMenuShowsMoveTargets(true)}
                  >
                    <MoveIcon />
                    {t("moveTo")}
                  </button>
                ) : null}
                {canMoveColumn ? (
                  <button
                    role="menuitem"
                    className="task-menu-item move-task-item"
                    onClick={() => setMenuShowsColumns(true)}
                  >
                    <Columns3 size={16} strokeWidth={2} aria-hidden />
                    {t("moveToColumn")}
                    <span className="task-menu-item-aside">{boardColumnLabel(currentColumn)}</span>
                  </button>
                ) : null}
                <MakeSubtaskItem m={m} task={task} onOpen={() => setMenuShowsParents(true)} />
                {/* The pill's offers, when the tile is too slim to hold
                    them there — see PILL_FOLD_MAX. */}
                {foldPillActions && !hasDuration && !task.completed ? (
                  <button
                    role="menuitem"
                    className="task-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      // The chip is folded away, so the popover hangs
                      // off the menu button, which stays.
                      openDurationPopover(
                        (menuAnchorEl as HTMLElement | null) ?? e.currentTarget
                      );
                    }}
                  >
                    <ClockIcon />
                    {t("addDuration")}
                  </button>
                ) : null}
                {/* A done row shows only this menu on hover: the time,
                    the note and the heart it has not got are here. */}
                {!trimmed && task.completed && !hasDuration ? (
                  <button
                    role="menuitem"
                    className="task-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuTaskId(null);
                      setEditingDuration("");
                      setEditingDurationTaskId(task.id);
                    }}
                  >
                    <ClockIcon />
                    {t("addTimeSpent")}
                  </button>
                ) : null}
                {!trimmed && (foldPillActions || task.completed) && !task.notesHtml ? (
                  <button
                    role="menuitem"
                    className="task-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuTaskId(null);
                      toggleNotes(task);
                    }}
                  >
                    <NotesIcon />
                    {t("fieldNotes")}
                  </button>
                ) : null}
                {!trimmed && task.completed && !task.isFavourite && !kanbanEnabled ? (
                  <button
                    role="menuitem"
                    className="task-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuTaskId(null);
                      toggleFavourite(task);
                    }}
                  >
                    <HeartIcon size={14} />
                    {t("addToFavourites")}
                  </button>
                ) : null}
                <TaskGithubItem
                  task={task}
                  list={lists.find((l) => l.id === task.listId)}
                  t={t}
                  mutateTask={mutateTask}
                  closeMenu={() => setOpenMenuTaskId(null)}
                />
                {inDetails ? <TaskInfoMenuItem t={t} closeMenu={() => setOpenMenuTaskId(null)} /> : null}
                <button
                  role="menuitem"
                  className="task-menu-item delete-task-item"
                  onClick={() => {
                    setOpenMenuTaskId(null);
                    if (inDetails) {
                      m.setOpenNotesTaskId(null);
                      m.setNotesExpanded(false);
                    }
                    void removeTask(task.id);
                  }}
                >
                  <TrashIcon />
                  {t("delete")}
                </button>
              </>
            )}
            </MenuKeys>
          </MenuPortal>
          ) : null}
        </div>
  );
}

/** The chip of the task's subtasks. */
function cardSubtaskChip(
  m: TodoPageModel,
  task: TodoTask
) {
  const {
    t,
    openTaskOverlay,
    subtasksByTask,
  } = m;
  const mySubtasks = subtasksByTask.get(task.id) ?? [];
  const subtasksDone = mySubtasks.filter((st) => st.completed).length;
  // "✓ 2/6 · Tue": a step due before the task is, coral when it is soon.
  const stepDue = task.completed ? null : earliestStepDue(mySubtasks, task.dueOn ?? null);
  const stepDays = stepDue ? daysUntilDue(stepDue) : null;
  return mySubtasks.length ? (
    <button
      type="button"
      className={`task-subtask-chip${
        subtasksDone === mySubtasks.length ? " all-done" : ""
      }`}
      title={t("subtasks")}
      onClick={(e) => {
        e.stopPropagation();
        openTaskOverlay(task, { focusSubtask: true });
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {subtasksDone}/{mySubtasks.length}
      {stepDue ? (
        <span
          className={`task-subtask-chip-due${stepDays != null && stepDays <= 1 ? " is-soon" : ""}`}
          title={t("fieldDue")}
        >
          {" · "}
          {formatDueOnShort(stepDue, m.lang, t)}
        </span>
      ) : null}
    </button>
  ) : task.completed ? null : (
    // No subtasks yet: open details to add the first one.
    <button
      type="button"
      className="task-chip is-icon task-chip-subtasks is-ghost"
      title={t("subtasks")}
      aria-label={t("subtasks")}
      onClick={(e) => {
        e.stopPropagation();
        openTaskOverlay(task, { focusSubtask: true });
      }}
    >
      <ListChecks size={13} strokeWidth={2} aria-hidden />
    </button>
  );
}



/** The button that opens the task's focus window. */
function cardFocusButton(
  m: TodoPageModel,
  task: TodoTask,
  { isFocused, row = false }: { isFocused: boolean; row?: boolean }
) {
  const {
    nativeShell,
    toggleTaskFocusPopout,
  } = m;
  return (
    nativeShell && !task.completed ? (
      <button
        type="button"
        className={`focus-btn${row ? " task-row-focus" : ""} ${isFocused ? "active-focus" : "is-ghost"}`}
        aria-pressed={isFocused}
        aria-label={m.t(isFocused ? "taskStopFocus" : "taskFocus")}
        title={isFocused ? "Exit focus mode" : "Focus on this task"}
        onClick={(e) => {
          e.stopPropagation();
          toggleTaskFocusPopout(task);
        }}
      >
        <FocusIcon />
      </button>
    ) : null
  );
}

/** Lists show existing information; the Today session retains its quick controls. */
/** The people on a card's row: their chip, or, on a done task drawn as a
    card, their faces with nothing to change. */
function chromePeople(m: TodoPageModel, task: TodoTask, doneRow: boolean, assignees: TodoPerson[], assignOpen: boolean) {
  if (!m.assignEnabled || !assignees.length) return null;
  if (task.completed && !doneRow) {
    return (
      <span className="task-summary-value">
        <TaskAssigneeStack people={assignees} size={22} />
      </span>
    );
  }
  return cardAssignChip(m, task, { assignOpen, assignees });
}

/** The day on a card's row: the Done pile's "Due: Oct 19", a done card's
    day with nothing to change it with, or the open card's chip. */
function chromeDue(m: TodoPageModel, task: TodoTask, doneRow: boolean, duePopoverOpen: boolean) {
  if (!task.dueOn) return null;
  if (doneRow) {
    return <span className="task-summary-value">{m.t("fieldDue")}: {formatDueOnShort(task.dueOn, m.lang, m.t)}</span>;
  }
  if (task.completed) {
    return (
      <span className="task-summary-value">
        <Calendar size={13} strokeWidth={2} aria-hidden />
        {formatDueOnShort(task.dueOn, m.lang, m.t)}
      </span>
    );
  }
  return cardDueChip(m, task, { duePopoverOpen });
}

/** Where a card's chrome is drawn: the board, a waiting card in the Today
    session, or the session's task in hand ("now"), whose steps are listed
    under it and whose list is named in words. */
export function taskCardChrome(m: TodoPageModel, task: TodoTask, where: "board" | "session" | "now" = "board", asBoard = false) {
  /** A done task as the Done pile's row; asked for as a card, as an open one. */
  const doneRow = task.completed && !asBoard;
  const {
    sessionIds,
    view,
    setDurationPopoverTaskId,
    setDurationPopoverAnchor,
    duePopoverTaskId,
    openMenuTaskId,
    setOpenMenuTaskId,
    openListPickerTaskId,
    openAssignTaskId,
    setOpenAssignTaskId,
    activeFocusTaskIds,
    t,
    isAllListsView,
    navigateToList,
    peopleById,
  } = m;
  /*
    While the Today session is open, a task in it is drawn twice: on the
    board behind and in the session. Its menus open in the session only.
    Two copies of the list picker took the caret from each other, and the
    blur closed both before anything could be picked.
  */
  const inSession = where !== "board";
  const here = inSession || !sessionIds;
  const menuOpen = here && openMenuTaskId === task.id;
  const assignOpen = here && openAssignTaskId === task.id;
  const assignees = task.assigneeIds
    .map((id) => peopleById.get(id))
    .filter((p): p is TodoPerson => Boolean(p));
  const unlisted = isUnlistedTask(task);
  const listPickerOpen = here && openListPickerTaskId === task.id;
  const hasDuration = doneRow
    ? task.timeSpentSeconds > 0
    : task.expectedDurationMinutes != null;
  const isFocused = activeFocusTaskIds.has(task.id);
  const duePopoverOpen = here && duePopoverTaskId === task.id;
  const openDurationPopover = (anchor: HTMLElement) => {
    if (view === "favourites") {
      if (task.listId) navigateToList(task.listId);
      return;
    }
    setOpenMenuTaskId(null);
    setOpenAssignTaskId(null);
    setDurationPopoverAnchor(anchor);
    setDurationPopoverTaskId(task.id);
  };
  /* The board card and the Today session's cards are the same: the details
     row under the name, and on the session's cards the row's Focus and ⋮
     in the corner, as a board row has them beside its name. */
  {
    // The task in hand lists its steps under it: no count of them here.
    const subtaskCount = where === "now" ? 0 : m.subtasksByTask.get(task.id)?.length ?? 0;
    const listName = where === "now" && task.listId
      ? m.state.lists.find((l) => l.id === task.listId)?.name ?? null
      : null;
    const hasMeta = task.dueOn || hasDuration || task.notesHtml || subtaskCount ||
      (m.assignEnabled && assignees.length) || task.isFavourite ||
      isAllListsView || task.githubNumber || listName;
    const controls = where !== "board" ? (
      <div className="task-session-controls">
        {cardFocusButton(m, task, { isFocused, row: true })}
        {cardMenu({ ...m, foldPillActions: false }, task, { menuOpen, unlisted, hasDuration, openDurationPopover }, "row")}
      </div>
    ) : null;
    return {
      utilityPill: controls,
      anyOpen: inSession && (menuOpen || assignOpen || duePopoverOpen || listPickerOpen),
      metaRow: hasMeta ? (
        <div className="task-meta-row task-summary-row">
          {/* The people, as avatars, the due date, how long, then the notes
             and steps: the order the add-task box asks in. */}
          {chromePeople(m, task, doneRow, assignees, assignOpen)}
          {chromeDue(m, task, doneRow, duePopoverOpen)}
          {doneRow ? cardDurationMeta(m, task, {
            hasDuration,
            editingDur: m.editingDurationTaskId === task.id && !m.notesExpanded,
          }).metaAlways : hasDuration ? (
            <span className="task-summary-value">
              <ClockIcon size={13} />
              {formatDurationShort(task.expectedDurationMinutes!, t("minutes"), t("hoursShort"))}
            </span>
          ) : null}
          {task.notesHtml && where === "now" ? (
            // The task in hand, in the Today session: a peek on hover,
            // and its note opens in place there (NotesChip).
            <NotesChip
              html={task.notesHtml}
              open={m.openNotesTaskId === task.id && !m.notesExpanded}
              onToggle={() => m.toggleNotes(task)}
              t={t}
              className="task-summary-value task-summary-notes"
            />
          ) : task.notesHtml ? (
            <button
              type="button"
              className="task-summary-value task-summary-notes"
              title={t("fieldNotes")}
              onClick={(e) => {
                e.stopPropagation();
                m.openTaskOverlay(task, { scrollTo: "notes" });
              }}
            >
              <NotesIcon />{t("fieldNotes")}
            </button>
          ) : null}
          {subtaskCount ? cardSubtaskChip(m, task) : null}
          {/* The heart alone on a card; details spell the word out. */}
          {task.isFavourite ? (
            <span className="task-summary-value" title={t("taskFavourite")} role="img" aria-label={t("taskFavourite")}>
              <HeartIcon size={13} filled />
            </span>
          ) : null}
          <div className="task-chip-actions">
            <TaskGithubLink task={task} t={t} />
            {/* Whose step it is, when the Planner says it here: a client
                or collaborator, by name, before its list's icon. */}
            {doneRow ? null : m.boardExtension?.renderListLabel?.(task) ?? null}
            {/* The list's icon at the right. A done task shows it by its checkbox.
                The task in hand names its list in words. */}
            {listName ? (
              <span className="task-summary-list">{listName}</span>
            ) : isAllListsView && !doneRow
              ? task.parentTaskId
                ? <StepListMark m={m} step={task} />
                : cardOriginPicker(m, task, { unlisted, showListOrigin: true, listPickerOpen })
              : null}
          </div>
        </div>
      ) : null,
    };
  }
}
/** How long the pointer rests on a cut-off card before it is brought into view. */
const HOVER_NUDGE_MS = 250;
const hoverNudges = new WeakMap<HTMLElement, number>();

/**
 * A card's details: its own, or, for a step on the board, its parent's,
 * at the steps, with this step lit up for a moment.
 */
function openCardDetails(m: TodoPageModel, task: TodoTask) {
  const parent = task.parentTaskId ? m.state.tasks.find((t) => t.id === task.parentTaskId) : null;
  if (parent) { m.openTaskOverlay(parent, { scrollTo: "subtasks" }); flashSubtaskRow(task.id); }
  else m.openTaskOverlay(task);
}

/** "↳ Parent task", above a step on the board: a click opens the parent. */
export function stepParentLine(m: TodoPageModel, step: TodoTask) {
  const parent = m.state.tasks.find((t) => t.id === step.parentTaskId);
  if (!parent) return null;
  return (
    <button
      type="button"
      className="task-step-parent"
      title={parent.text}
      onClick={(e) => {
        e.stopPropagation();
        m.openTaskOverlay(parent, { scrollTo: "subtasks" });
      }}
    >
      <CornerDownRight size={12} strokeWidth={2} aria-hidden />
      <span>{parent.text}</span>
    </button>
  );
}

/** One card, drawn. Called only from TaskCard below, which decides when. */
function renderTaskBody(m: TodoPageModel, task: TodoTask, asBoard = false) {
  /** Drawn as the Done pile's row: done, and not asked for as a card. */
  const doneRow = task.completed && !asBoard;
  const {
    justAddedTaskId, animHiddenTargets, draggingTaskId, setDraggingTaskId,
    taskDropListId, taskDragRef, lang, isAllListsView, isSearching,
    showBoard, toggleTaskCompleted,
  } = m;
  const showListOrigin = isAllListsView;
  const unlisted = isUnlistedTask(task);
  const listPickerOpen = m.openListPickerTaskId === task.id;
  const menuOpen = m.openMenuTaskId === task.id;
  const assignOpen = m.openAssignTaskId === task.id;
  const durationPopoverTaskId = m.durationPopoverTaskId;
  const duePopoverTaskId = m.duePopoverTaskId;

  const hideForAnim = animHiddenTargets.has(
    animTargetKey(task.id, task.completed)
  );

  /* The checkbox, and the list-origin picker, each once: the done row
     keeps them stacked in a leading column, an open row shows the origin
     in the meta row below the words. */
  const checkboxEl = (
    <input
      type="checkbox"
      className="task-checkbox"
      checked={task.completed}
      onChange={(e) => {
        // A step on the board (due today, see stepsDueToday) is ticked as
        // a step: its own cheer, and it leaves the column.
        if (task.parentTaskId) {
          spawnCompletionParty(e.currentTarget.closest(".task-item") ?? e.currentTarget, {
            emoji: randomSubtaskPartyEmoji(),
          });
          m.toggleSubtaskDone(task);
          return;
        }
        toggleTaskCompleted(task, e);
      }}
      /*
        Space is the box's own key, and a browser gives Enter to the
        form around it — there is none here, so on a card Enter did
        nothing at all. It ticks the task off, as everywhere else.
      */
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.currentTarget.click();
      }}
    />
  );
  const originPicker = cardOriginPicker(m, task, { unlisted, showListOrigin, listPickerOpen });

  const chrome = taskCardChrome(m, task, "board", asBoard);

  return (
    <div
      key={task.id}
      className={`task-item${m.notesExpanded && m.openNotesTaskId === task.id ? " is-selected" : ""} ${task.completed ? "completed-task" : ""} ${
        showBoard && !task.completed && task.isBacklog ? "backlog-task" : ""
      } ${draggingTaskId === task.id ? "dragging" : ""}${
        draggingTaskId === task.id && taskDropListId ? " drag-over-tab" : ""
      }${
        menuOpen || assignOpen || durationPopoverTaskId === task.id || duePopoverTaskId === task.id
          ? " has-open-menu"
          : ""
      }${showListOrigin ? " task-item-all" : ""}${
        listPickerOpen ? " has-open-list-picker" : ""
      }${hideForAnim ? " animation-target-hidden" : ""}${
        justAddedTaskId === task.id ? " just-added" : ""
      }`}
      data-task-id={task.id}
      /*
        The caret walks the card: Tab from one of its controls to the
        next, Left and Right the same way and round again. Without it
        the Mac app's web view sent Tab to the next text box on the
        page, past every chip on the card. See `focus-walk`.
      */
      onKeyDown={(e) => {
        if (walkArrowStops(e, e.currentTarget, { wrap: true })) return;
        walkTabStops(e, e.currentTarget);
      }}
      // A card cut off at the edge of its list comes fully into view once
      // the pointer rests on it: its hover controls would show off-screen.
      onPointerEnter={(e) => {
        // Not with a button held: a drag (of the divider, a card) passing
        // over is not a pointer resting here, and each check reads layout.
        if (e.pointerType === "touch" || draggingTaskId || e.buttons) return;
        const card = e.currentTarget;
        window.clearTimeout(hoverNudges.get(card));
        hoverNudges.set(card, window.setTimeout(() => {
          nudgeIntoView(card);
          // Again once that has settled: the hover chips can grow the card.
          hoverNudges.set(card, window.setTimeout(() => nudgeIntoView(card), 400));
        }, HOVER_NUDGE_MS));
      }}
      onPointerLeave={(e) => window.clearTimeout(hoverNudges.get(e.currentTarget))}
      /* A click anywhere on the card opens its details, as on its words: not on a
         control, menu or note, nor the click that ends a drag or a selection. */
      onClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest) return;
        if (target.closest(".task-text")) return; // it opens details itself
        if (isInteractiveDragTarget(target) || isCardClickSkip(target)) return;
        if (Date.now() - lastTaskDragEnd.at < 300) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        openCardDetails(m, task);
      }}
      onPointerDown={(e) => {
        window.clearTimeout(hoverNudges.get(e.currentTarget));
        if (e.button !== 0) return;
        if (task.completed) return;
        // A step on the board stays where it is: it has no column to move to.
        if (task.parentTaskId) return;
        // Filtering hides rows, so the order on screen is not the order of
        // the list — which is why a search used to stop a drag before it
        // began. The board knows better now: a drop there is placed in the
        // whole column, hidden rows and all (see placeInColumn). A plain
        // list still has no way to tell where a drop belongs among what it
        // is not showing, so there it stands.
        if (isSearching && !showBoard) return;
        if (isInteractiveDragTarget(e.target)) return;
        // The card over the Calendar has no list under it to be carried in.
        if ((e.target as HTMLElement).closest?.(".calendar-task-popover")) return;
        const drag = {
          taskId: task.id,
          startX: e.clientX,
          startY: e.clientY,
          started: false,
          pointerType: e.pointerType,
          holdTimer: null as number | null,
        };
        if (e.pointerType === "touch") {
          // On a phone a card is lifted by holding it, not by moving it:
          // moving is how the list scrolls. A short hold, a nudge from
          // the phone where it can give one, and the card is carried.
          drag.holdTimer = window.setTimeout(() => {
            const current = taskDragRef.current;
            if (current !== drag || current.started) return;
            current.holdTimer = null;
            current.started = true;
            window.getSelection()?.removeAllRanges();
            setDraggingTaskId(current.taskId);
            try {
              navigator.vibrate?.(12);
            } catch {
              /* a phone that will not */
            }
          }, TOUCH_DRAG_HOLD_MS);
        }
        taskDragRef.current = drag;
      }}
    >
      {/* Whose step it is, when the Planner says (its CRM next steps). */}
      {m.boardExtension?.renderTaskHeader(task) ?? null}
      {task.parentTaskId ? stepParentLine(m, task) : null}
      <div
        className={`task-main-row${
          doneRow && showListOrigin ? " task-main-row-all" : ""
        }`}
      >
        {doneRow && showListOrigin ? (
          <div className="task-leading">
            {checkboxEl}
            {originPicker}
          </div>
        ) : (
          checkboxEl
        )}
          <span
            className={`task-text ${task.completed ? "completed" : ""}`}
            /* One entry point for details, on open and completed tasks. */
            role="button"
            tabIndex={0}
            aria-expanded={m.notesExpanded && m.openNotesTaskId === task.id}
            onClick={(event) => { event.currentTarget.focus(); openCardDetails(m, task); }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              openCardDetails(m, task);
            }}
          >
            {/* A title being written in details shows here as it is typed. */}
            {m.titleDraft?.taskId === task.id ? m.titleDraft.text : task.text}
          </span>
        {/* When it was finished, as the mail list stamps a message:
            the hour today and yesterday, the day before that. */}
        {doneRow && task.completedAt ? (
          <DoneStamp completedAt={task.completedAt} lang={lang} />
        ) : null}
        {cardFocusButton(m, task, { isFocused: m.activeFocusTaskIds.has(task.id), row: true })}
        {/* The row's ⋮, beside Focus on hover: move, change list, delete.
            Not on a step: moving one to a column or list means nothing. */}
        {task.parentTaskId ? null : cardMenu({ ...m, foldPillActions: false }, task, {
          // While the Today session is up, its own copy of the menu opens.
          menuOpen: !m.sessionIds && m.openMenuTaskId === task.id,
          unlisted: isUnlistedTask(task),
          hasDuration: task.completed ? task.timeSpentSeconds > 0 : task.expectedDurationMinutes != null,
          openDurationPopover: () => {},
        }, "row")}
      </div>
      {/* The corner pill and the row under the words: see taskCardChrome. */}
      {chrome ? chrome.utilityPill : null}
      {chrome ? chrome.metaRow : null}
      {renderNotesEditor(m, task)}
    </div>
  );
}

export function TaskDetailsActions({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  const isFocused = m.activeFocusTaskIds.has(task.id);
  return (
    <div className="task-details-actions">
      {m.nativeShell && !task.completed ? (
        <button
          type="button"
          className={`task-details-focus${isFocused ? " active-focus" : ""}`}
          onClick={() => m.toggleTaskFocusPopout(task)}
        >
          <FocusIcon />{m.t(isFocused ? "taskStopFocus" : "taskFocus")}
        </button>
      ) : null}
      {!m.kanbanEnabled ? (
        <button
          type="button"
          className="task-details-favourite"
          aria-pressed={task.isFavourite}
          onClick={() => m.toggleFavourite(task)}
        >
          <HeartIcon size={16} filled={task.isFavourite} />{m.t("taskFavourite")}
        </button>
      ) : null}
    </div>
  );
}

/** The More menu of task details, at the right of the top bar, opposite Back. */
export function TaskDetailsMenu({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  return cardMenu({ ...m, foldPillActions: false }, task, {
    menuOpen: m.openMenuTaskId === task.id,
    unlisted: isUnlistedTask(task),
    hasDuration: task.completed ? task.timeSpentSeconds > 0 : task.expectedDurationMinutes != null,
    openDurationPopover: () => {},
  }, "details");
}

/*
  Cards that are drawn only when something about them changed.

  A card used to be drawn by a plain function that took the whole page
  model, so any change on the page (a picker opened, a menu, task details)
  drew every card again: about 170 ms for a board of 244 cards in the dev
  app. Now each card is a memoised component. It is drawn again only when
  its task changes or its signature does: the page-wide values every card
  reads, and the card's own state (its menu or a picker open, dragged,
  focused, and so on).

  A card that is skipped keeps the handlers of its last drawing. So that
  those never act on old state, a card reads the model through a stand-in
  that always answers with the newest one (liveModel). If a card shows
  something new from the model, add what it reads to pageSignature or
  cardSignature, or the card will not show the change.
*/

type LiveEntry = { ref: { current: TodoPageModel }; proxy: TodoPageModel };
/* One stand-in per page, keyed on a ref the page keeps for its whole life. */
const liveModels = new WeakMap<object, LiveEntry>();

/** The page model, as a stand-in that always reads the newest model. */
function liveModel(m: TodoPageModel): TodoPageModel {
  let entry = liveModels.get(m.taskDragRef);
  if (!entry) {
    const ref = { current: m };
    const read = (key: string | symbol) => (ref.current as unknown as Record<string | symbol, unknown>)[key];
    const proxy = new Proxy({} as TodoPageModel, {
      get: (_target, key) => read(key),
      has: (_target, key) => key in ref.current,
      ownKeys: () => Reflect.ownKeys(ref.current),
      getOwnPropertyDescriptor: (_target, key) =>
        key in ref.current ? { value: read(key), enumerable: true, configurable: true } : undefined,
    });
    entry = { ref, proxy };
    liveModels.set(m.taskDragRef, entry);
  }
  // Set while the page draws, before its cards do: a card drawn now reads
  // this model, and a handler run later reads the newest.
  entry.ref.current = m;
  return entry.proxy;
}

/* The page-wide part, worked out once per drawing of the page. */
const pageSignatures = new WeakMap<TodoPageModel, unknown[]>();

/** What every card reads from the page. A change draws every card again. */
function pageSignature(m: TodoPageModel): unknown[] {
  let sig = pageSignatures.get(m);
  if (!sig) {
    sig = [
      m.view, m.showBoard, m.isAllListsView, m.isSearching, m.assignEnabled,
      m.kanbanEnabled, m.foldPillActions, m.nativeShell, m.planEnabled, m.lang,
      m.lists, m.state.lists, m.state.people, m.peopleById, m.boardExtension,
      m.sessionIds, m.moveTargets.lists.length > 0, m.draggingTaskId != null,
      // "Today", "Yesterday" and the done stamps change at midnight.
      new Date().toDateString(),
    ];
    pageSignatures.set(m, sig);
  }
  return sig;
}

/** What one card reads that is its own: its menus and pickers, its marks. */
function cardSignature(m: TodoPageModel, task: TodoTask): unknown[] {
  const id = task.id;
  const subtasks = m.subtasksByTask.get(id) ?? [];
  const menuOpen = m.openMenuTaskId === id;
  const assignOpen = m.openAssignTaskId === id;
  const dueOpen = m.duePopoverTaskId === id;
  const durationOpen = m.durationPopoverTaskId === id;
  const pickerOpen = m.openListPickerTaskId === id;
  const durationEditing = m.editingDurationTaskId === id;
  const notesOpen = m.openNotesTaskId === id;
  const anyOpen = menuOpen || assignOpen || dueOpen || durationOpen || pickerOpen || durationEditing || notesOpen;
  return [
    m.justAddedTaskId === id,
    m.animHiddenTargets.has(animTargetKey(id, task.completed)),
    m.draggingTaskId === id,
    m.draggingTaskId === id ? m.taskDropListId : null,
    m.activeFocusTaskIds.has(id),
    subtasks.length,
    subtasks.filter((st) => st.completed).length,
    // The step's day on the counter: a change to one redraws the card.
    subtasks.map((st) => (st.completed ? "" : st.dueOn ?? "")).join(),
    m.listOfTask(task),
    m.runEdges.first.has(id),
    m.runEdges.last.has(id),
    menuOpen, assignOpen, dueOpen, durationOpen, pickerOpen, durationEditing, notesOpen,
    m.titleDraft?.taskId === id ? m.titleDraft.text : null,
    notesOpen && m.notesExpanded,
    // The rest only matters while one of this card's own things is open.
    ...(anyOpen
      ? [
          m.menuAnchorEl, m.menuShowsMoveTargets, m.moveTargets, m.assignAnchorEl,
          m.duePopoverAnchor, m.dueCalendarWanted, m.durationPopoverAnchor,
          m.listPickerAnchorEl, m.editingDuration, m.notesDraft, m.state.people,
          m.menuShowsColumns, m.menuShowsParents,
        ]
      : []),
  ];
}

function sameValues(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

type TaskCardProps = { m: TodoPageModel; task: TodoTask; page: unknown[]; own: unknown[] };

/**
 * Cards drawn as the board's columns draw them, done ones too: a done task
 * is otherwise drawn as the Done pile's row (the box with the list's mark
 * under it, "Due: Oct 19", the time it was done). The Calendar's list of a
 * day says so, as it shows done and open tasks together.
 */
export const CardAsBoardContext = React.createContext(false);

const TaskCard = React.memo(
  function TaskCard({ m, task }: TaskCardProps) {
    // Tests count drawings here (mounted-card-draws); nothing else sets it.
    (globalThis as { __todoCardDrawn?: (id: string) => void }).__todoCardDrawn?.(task.id);
    const asBoard = React.useContext(CardAsBoardContext);
    return renderTaskBody(m, task, asBoard);
  },
  (a, b) => a.task === b.task && a.m === b.m && sameValues(a.page, b.page) && sameValues(a.own, b.own)
);

/** A task's card. Drawn again only when it changed: see TaskCard. */
export function renderTask(m: TodoPageModel, task: TodoTask) {
  return (
    <TaskCard
      key={task.id}
      m={liveModel(m)}
      task={task}
      page={pageSignature(m)}
      own={cardSignature(m, task)}
    />
  );
}
