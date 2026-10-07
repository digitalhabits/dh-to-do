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
  List,
  ListChecks,
  User,
} from "lucide-react";

import { DuePopover } from "@/components/todo/DuePopover";
import { DurationPopover } from "@/components/todo/DurationPopover";
import { MenuKeys } from "@/components/todo/MenuKeys";
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
import { isInteractiveDragTarget } from "@/components/todo/use-pointer-drag";
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
  dueDatePatch,
  isUnlistedTask,
  listOriginLetters,
  timeSpentLabel,
} from "@/lib/todo/task-helpers";
import { type TodoPerson, type TodoTask } from "@/lib/todo/types";

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
            ...dueDatePatch(dueOn, task),
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

/** The chip of the duration, and its popover. */
function cardDurationChip(
  m: TodoPageModel,
  task: TodoTask,
  {
    hasDuration,
    durationPopoverOpen,
    openDurationPopover,
  }: {
    hasDuration: boolean;
    durationPopoverOpen: boolean;
    openDurationPopover: (anchor: HTMLElement) => void;
  }
) {
  const {
    setDurationPopoverTaskId,
    durationPopoverAnchor,
    setDurationPopoverAnchor,
    t,
    mutateTask,
  } = m;
  const closeDurationPopover = () => {
    durationPopoverAnchor?.focus();
    setDurationPopoverTaskId(null);
    setDurationPopoverAnchor(null);
  };
  return (
    <span className="task-chip-wrap">
      <button
        type="button"
        className={`task-chip task-chip-duration${
          hasDuration ? " is-set" : " is-icon is-ghost"
        }${durationPopoverOpen ? " is-on" : ""}`}
        title={hasDuration ? "Click to edit duration" : t("addDuration")}
        aria-haspopup="dialog"
        aria-expanded={durationPopoverOpen}
        onClick={(e) => {
          e.stopPropagation();
          if (durationPopoverOpen) closeDurationPopover();
          else openDurationPopover(e.currentTarget);
        }}
      >
        <ClockIcon size={13} />
        {hasDuration && task.expectedDurationMinutes != null ? (
          <span className="task-chip-label">
            {formatDurationShort(
              task.expectedDurationMinutes,
              t("minutes"),
              t("hoursShort")
            )}
          </span>
        ) : null}
      </button>
      {durationPopoverOpen ? (
      <DurationPopover
        open={durationPopoverOpen}
        anchorEl={durationPopoverOpen ? durationPopoverAnchor : null}
        minutes={task.expectedDurationMinutes}
        onPick={(minutes) => {
          closeDurationPopover();
          void mutateTask(task.id, { expectedDurationMinutes: minutes });
        }}
        onClose={closeDurationPopover}
        t={t}
      />
      ) : null}
    </span>
  );
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
    lists,
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
        }${unlisted ? " is-unassigned" : ""}`}
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
        disabled={lists.length === 0}
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
          listOriginLetters(taskList)
        )}
      </button>
      <MenuPortal
        open={listPickerOpen}
        anchorEl={listPickerOpen ? listPickerAnchorEl : null}
        className="task-list-picker"
        role="menu"
        ariaLabel="Move to list"
      >
        <MenuKeys
          onClose={(reason) => {
            const anchor = listPickerAnchorEl;
            setOpenListPickerTaskId(null);
            setListPickerAnchorEl(null);
            if (reason === "escape") anchor?.focus();
          }}
        >
        {lists.map((l) => {
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
                {iconId ? (
                  <ListIcon id={iconId} size={14} />
                ) : (
                  listOriginLetters(l)
                )}
              </span>
              <span className="task-list-picker-name">{l.name}</span>
            </button>
          );
        })}
        </MenuKeys>
      </MenuPortal>
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
  }
) {
  const {
    setOpenMenuTaskId,
    menuAnchorEl,
    setMenuAnchorEl,
    menuShowsMoveTargets,
    setMenuShowsMoveTargets,
    setOpenListPickerTaskId,
    setOpenAssignTaskId,
    t,
    lists,
    runEdges,
    foldPillActions,
    mutateTask,
    moveTaskToEdge,
    removeTask,
    toggleNotes,
  } = m;
  /* The "…" menu: in the meta row of an open card, in the hover pill of
     a done row. */
  return (
        <div
          className={`task-menu-wrap ${menuOpen ? "has-open-menu" : ""}`}
        >
          <button
            className="task-menu-btn is-ghost"
            title="Task options"
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
            <MenuDotsIcon />
          </button>
          <MenuPortal
            open={menuOpen}
            anchorEl={menuOpen ? menuAnchorEl : null}
            className="task-menu"
            role="menu"
            ariaLabel="Task options"
          >
            {/* The caret goes to the first offer, the arrows and Tab
                walk them, and Escape gives it back to the button. The
                menu is put away by the next click anywhere, so it does
                not close on its own caret when Move to redraws it —
                which is also why that redraw is a fresh key. */}
            <MenuKeys
              key={menuShowsMoveTargets ? "move" : "offers"}
              closeOnBlur={false}
              onClose={() => {
                const anchor = menuAnchorEl;
                setOpenMenuTaskId(null);
                setMenuShowsMoveTargets(false);
                setMenuAnchorEl(null);
                anchor?.focus();
              }}
            >
            {menuShowsMoveTargets ? (
              lists
                .filter((l) => l.id !== task.listId)
                .map((l) => {
                  // Each list under its own icon, as the tabs draw them.
                  const iconId = resolveListIconId(l.emoji);
                  return (
                    <button
                      key={l.id}
                      role="menuitem"
                      className="task-menu-item"
                      onClick={() => {
                        setOpenMenuTaskId(null);
                        setMenuShowsMoveTargets(false);
                        void mutateTask(task.id, { listId: l.id });
                      }}
                    >
                      <span
                        className={`task-list-picker-icon${
                          iconId ? " has-icon" : ""
                        }`}
                      >
                        {iconId ? (
                          <ListIcon id={iconId} size={14} />
                        ) : (
                          listOriginLetters(l)
                        )}
                      </span>
                      {l.name}
                    </button>
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
                {lists.length > 1 ||
                (unlisted && lists.length > 0) ? (
                  <button
                    role="menuitem"
                    className="task-menu-item move-task-item"
                    onClick={() => setMenuShowsMoveTargets(true)}
                  >
                    <MoveIcon />
                    {t("moveTo")}
                  </button>
                ) : null}
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
                {foldPillActions && !task.notesHtml ? (
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
                <button
                  role="menuitem"
                  className="task-menu-item delete-task-item"
                  onClick={() => {
                    setOpenMenuTaskId(null);
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
        </div>
  );
}

/** The chip of the task's steps. */
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
    </button>
  ) : task.completed ? null : (
    // No steps yet: a ghost, in the add row's slot for them. It opens
    // the expanded card, where the first step is written.
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

/** The chip of the task's note. */
function cardNotesChip(
  m: TodoPageModel,
  task: TodoTask
) {
  const {
    openNotesTaskId,
    t,
    toggleNotes,
  } = m;
  return (
    <button
      type="button"
      className={`task-chip is-icon task-chip-notes${
        task.notesHtml ? " is-set" : " is-ghost"
      }${openNotesTaskId === task.id ? " is-on" : ""}`}
      title={t("fieldNotes")}
      aria-label={t("fieldNotes")}
      onClick={(e) => {
        e.stopPropagation();
        toggleNotes(task);
      }}
    >
      <NotesIcon />
    </button>
  );
}

/** The heart that makes the task a favourite. */
function cardFavouriteButton(
  m: TodoPageModel,
  task: TodoTask
) {
  const {
    kanbanEnabled,
    toggleFavourite,
  } = m;
  return !kanbanEnabled ? (
    <button
      className={`fav-btn${task.isFavourite ? " active" : " is-ghost"}`}
      title="Toggle Favourite"
      onClick={(e) => {
        e.stopPropagation();
        toggleFavourite(task);
      }}
    >
      <HeartIcon size={18} filled={task.isFavourite} />
    </button>
  ) : null;
}

/** The button that opens the task's focus window. */
function cardFocusButton(
  m: TodoPageModel,
  task: TodoTask,
  { isFocused }: { isFocused: boolean }
) {
  const {
    nativeShell,
    toggleTaskFocusPopout,
  } = m;
  return (
    nativeShell && !task.completed ? (
      <button
        className={`focus-btn ${isFocused ? "active-focus" : "is-ghost"}`}
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

/**
 * An open task's controls, as the board card draws them: the corner pill
 * (menu, expand, favourite, focus) and the row under the words (person,
 * date, duration, notes, subtasks, and the list on the right). The Today
 * session draws the same two on the task in hand, so a task has the same
 * controls in the same places wherever it is.
 */
export function taskCardChrome(m: TodoPageModel, task: TodoTask, where: "board" | "session" = "board") {
  const {
    sessionIds,
    view,
    durationPopoverTaskId,
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
    foldPillActions,
    openTaskOverlay,
    peopleById,
  } = m;
  /*
    While the Today session is open, a task in it is drawn twice: on the
    board behind and in the session. Its menus open in the session only.
    Two copies of the list picker took the caret from each other, and the
    blur closed both before anything could be picked.
  */
  const here = where === "session" || !sessionIds;
  const menuOpen = here && openMenuTaskId === task.id;
  const assignOpen = here && openAssignTaskId === task.id;
  const assignees = task.assigneeIds
    .map((id) => peopleById.get(id))
    .filter((p): p is TodoPerson => Boolean(p));
  const unlisted = isUnlistedTask(task);
  const listPickerOpen = here && openListPickerTaskId === task.id;
  const hasDuration = task.completed
    ? task.timeSpentSeconds > 0
    : task.expectedDurationMinutes != null;
  const isFocused = activeFocusTaskIds.has(task.id);
  const duePopoverOpen = here && duePopoverTaskId === task.id;
  const durationPopoverOpen = here && durationPopoverTaskId === task.id;
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
  const expandBtn = (
    <button
      type="button"
      className="task-expand-btn is-inline is-ghost"
      title={t("expandTask")}
      aria-label={t("expandTask")}
      onClick={(e) => {
        e.stopPropagation();
        openTaskOverlay(task);
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    </button>
  );
  const heartAtRest = task.isFavourite && view !== "favourites";
  const pillShowsState = isFocused || heartAtRest;
  const utilityPill = (
    <div className={`task-utility-pill${pillShowsState ? " has-state" : ""}`}>
      {cardMenu(m, task, { menuOpen, unlisted, hasDuration, openDurationPopover })}
      {expandBtn}
      {cardFavouriteButton(m, task)}
      {cardFocusButton(m, task, { isFocused })}
    </div>
  );
  const metaRow = (
    <div className="task-meta-row">
      <div className="task-meta-chips">
        {cardAssignChip(m, task, { assignOpen, assignees })}
        {cardDueChip(m, task, { duePopoverOpen })}
        {/* On a slim tile the two unset ones live in the menu. */}
        {foldPillActions && !hasDuration
          ? null
          : cardDurationChip(m, task, { hasDuration, durationPopoverOpen, openDurationPopover })}
        {foldPillActions && !task.notesHtml ? null : cardNotesChip(m, task)}
        {cardSubtaskChip(m, task)}
        <span className="task-meta-spacer" />
        <div className="task-chip-actions">
          {cardOriginPicker(m, task, { unlisted, showListOrigin: isAllListsView, listPickerOpen })}
        </div>
      </div>
    </div>
  );
  /** A menu or picker of the task's is open: its controls stay on screen. */
  const anyOpen = menuOpen || assignOpen || durationPopoverOpen || duePopoverOpen || listPickerOpen;
  return { utilityPill, metaRow, anyOpen };
}

export function renderTask(m: TodoPageModel, task: TodoTask) {
  const {
    view,
    justAddedTaskId,
    editingTaskId,
    setEditingTaskId,
    editingTextRef,
    editingDurationTaskId,
    durationPopoverTaskId,
    setDurationPopoverTaskId,
    setDurationPopoverAnchor,
    duePopoverTaskId,
    openMenuTaskId,
    setOpenMenuTaskId,
    openListPickerTaskId,
    openAssignTaskId,
    setOpenAssignTaskId,
    animHiddenTargets,
    draggingTaskId,
    setDraggingTaskId,
    taskDropListId,
    taskDragRef,
    lang,
    isAllListsView,
    navigateToList,
    isSearching,
    showBoard,
    foldPillActions,
    toggleTaskCompleted,
    editInputRef,
    resizeEditTextarea,
    startEditTask,
    caretAfterEditRef,
    commitEditTask,
    toggleNotes,
  } = m;
  const editing = editingTaskId === task.id;
  const menuOpen = openMenuTaskId === task.id;
  const assignOpen = openAssignTaskId === task.id;
  const unlisted = isUnlistedTask(task);
  const showListOrigin = isAllListsView;
  const listPickerOpen = openListPickerTaskId === task.id;
  const editingDur = editingDurationTaskId === task.id;
  const hasDuration = task.completed
    ? task.timeSpentSeconds > 0
    : task.expectedDurationMinutes != null;



  const { metaAlways, metaHover } = cardDurationMeta(m, task, { editingDur, hasDuration });


  /*
    Favourite and focus, drawn the way notesBtn already is.

    A button that carries state goes in `.always-actions` and one that
    does not goes in `.hover-actions`, so the row is the same width
    whether the pointer is on it or not. The two used to sit together in
    `.always-actions` under a `hover-only` class that only hid them —
    which still took the width the moment the pointer arrived, and
    re-wrapped the task under it.
  */
  const duePopoverOpen = duePopoverTaskId === task.id;
  /* The clock opens the same popover the add row uses, on the chip. */
  const durationPopoverOpen = durationPopoverTaskId === task.id;
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
  const favBtn = cardFavouriteButton(m, task);
  const notesBtn = (
    <button
      className={`notes-btn ${task.notesHtml ? "has-notes" : ""}`}
      title="Add/Edit Notes"
      onClick={(e) => {
        e.stopPropagation();
        toggleNotes(task);
      }}
    >
      <NotesIcon />
    </button>
  );

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
      onChange={(e) => toggleTaskCompleted(task, e)}
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
  const menuWrap = cardMenu(m, task, { menuOpen, unlisted, hasDuration, openDurationPopover });
  /*
    The open row's utilities, in a pill of their own in the card's
    top-right corner: the menu, expand, favourite and focus. They used to
    share the chip row with the properties, and on a narrow card the two
    fought for one line and the last of them fell off it. Out of the
    flow, over the words on hover, they cost the row nothing. A button
    carrying state — a favourite, a running focus — keeps the pill on
    screen at rest, so the state shows.
  */
  /*
    On the Favourites view every task is a favourite, so a heart on each
    card says nothing: it is what the view is. There the pill waits for the
    pointer, as on a task with no state. A running focus still keeps it on
    screen, because that is news on any view.
  */
  const heartAtRest = task.isFavourite && view !== "favourites";
  /* A done row keeps its hover pill: the time it took, its note, its
     menu. An open row lays its marks out as chips instead — below. */
  const actionsCluster = (
    <div className="task-actions">
      <div className="hover-actions">
        {menuWrap}
        {/* Folded into the menu on a slim tile — but a duration being
            typed stays where it is typed. */}
        {foldPillActions && !editingDur ? null : metaHover}
        {!task.notesHtml && !foldPillActions ? notesBtn : null}
        {!heartAtRest ? favBtn : null}
      </div>
      <div className="always-actions">
        {heartAtRest ? favBtn : null}
        {metaAlways}
        {task.notesHtml ? notesBtn : null}
      </div>
    </div>
  );
  const chrome = task.completed ? null : taskCardChrome(m, task);

  return (
    <div
      key={task.id}
      className={`task-item ${task.completed ? "completed-task" : ""} ${
        showBoard && !task.completed && task.isBacklog ? "backlog-task" : ""
      } ${draggingTaskId === task.id ? "dragging" : ""}${
        draggingTaskId === task.id && taskDropListId ? " drag-over-tab" : ""
      }${
        menuOpen || assignOpen || durationPopoverOpen || duePopoverOpen
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
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (task.completed) return;
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
      <div
        className={`task-main-row${
          task.completed && showListOrigin ? " task-main-row-all" : ""
        }`}
      >
        {task.completed && showListOrigin ? (
          <div className="task-leading">
            {checkboxEl}
            {originPicker}
          </div>
        ) : (
          checkboxEl
        )}
        {editing ? (
          <textarea
            ref={editInputRef}
            autoFocus
            className="task-edit-input"
            defaultValue={editingTextRef.current}
            rows={1}
            onChange={(e) => {
              editingTextRef.current = e.target.value;
              resizeEditTextarea(e.currentTarget);
            }}
            onBlur={commitEditTask}
            onKeyDown={(e) => {
              /*
                Plain Enter saves; Shift+Enter inserts a newline. Either
                way the caret goes back to the title it came from, so
                the walk over the card carries on from there.
              */
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                caretAfterEditRef.current = { taskId: task.id, step: 0 };
                commitEditTask();
              }
              if (e.key === "Escape") {
                caretAfterEditRef.current = { taskId: task.id, step: 0 };
                setEditingTaskId(null);
              }
              /*
                Tab saves and walks on. The card's own walk is held back
                here: it would move the caret onto a control that the
                editor closing is about to redraw, and the caret was
                lost in the swap.
              */
              if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                caretAfterEditRef.current = {
                  taskId: task.id,
                  step: e.shiftKey ? -1 : 1,
                };
                commitEditTask();
              }
            }}
          />
        ) : (
          <span
            className={`task-text ${task.completed ? "completed" : ""}`}
            /*
              The title is a stop of its own, so the keyboard alone can
              open a task for editing: Enter or Space does what a click
              does. A finished task's title is not edited, and stays
              out of the walk.
            */
            role={task.completed ? undefined : "button"}
            tabIndex={task.completed ? undefined : 0}
            onClick={() => (task.completed ? undefined : startEditTask(task))}
            onKeyDown={(e) => {
              if (task.completed) return;
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              startEditTask(task);
            }}
          >
            {task.text}
          </span>
        )}
        {/* When it was finished, as the mail list stamps a message:
            the hour today and yesterday, the day before that. */}
        {task.completed && task.completedAt ? (
          <DoneStamp completedAt={task.completedAt} lang={lang} />
        ) : null}
        {task.completed ? actionsCluster : null}
      </div>
      {/* The corner pill and the row under the words: see taskCardChrome. */}
      {chrome ? chrome.utilityPill : null}
      {chrome ? chrome.metaRow : null}
      {renderNotesEditor(m, task)}
    </div>
  );
}
