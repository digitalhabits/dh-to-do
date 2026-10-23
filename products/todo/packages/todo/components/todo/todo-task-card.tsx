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
  columnEnd, dueDatePatch,
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
          listOriginLetters(taskList)
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
                {iconId ? (
                  <ListIcon id={iconId} size={14} />
                ) : (
                  listOriginLetters(l)
                )}
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
  labelled = false
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
            {labelled ? <span>{t("taskMore")}</span> : null}
          </button>
          {/* Built only while open, as the list picker is. */}
          {menuOpen ? (
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
              moveTargets.lists
                .filter((l) => l.id !== task.listId)
                .map((l, i, shown) => {
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
                {!labelled && task.completed && !hasDuration ? (
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
                {!labelled && (foldPillActions || task.completed) && !task.notesHtml ? (
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
                {!labelled && task.completed && !task.isFavourite && !kanbanEnabled ? (
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
                <button
                  role="menuitem"
                  className="task-menu-item delete-task-item"
                  onClick={() => {
                    setOpenMenuTaskId(null);
                    if (labelled) {
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
  { isFocused, labelled = false }: { isFocused: boolean; labelled?: boolean }
) {
  const {
    nativeShell,
    toggleTaskFocusPopout,
  } = m;
  return (
    nativeShell && !task.completed ? (
      <button
        type="button"
        className={labelled ? `task-row-focus${isFocused ? " active-focus" : ""}` : `focus-btn ${isFocused ? "active-focus" : "is-ghost"}`}
        aria-pressed={isFocused}
        title={isFocused ? "Exit focus mode" : "Focus on this task"}
        onClick={(e) => {
          e.stopPropagation();
          toggleTaskFocusPopout(task);
        }}
      >
        <FocusIcon />
        {labelled ? <span>{m.t(isFocused ? "taskStopFocus" : "taskFocus")}</span> : null}
      </button>
    ) : null
  );
}

/** Lists show existing information; the Today session retains its quick controls. */
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
    <button type="button" className="task-details-open-btn" onClick={() => openTaskOverlay(task)}>
      {t("taskDetails")}
    </button>
  );
  if (where === "board") {
    const subtaskCount = m.subtasksByTask.get(task.id)?.length ?? 0;
    const hasMeta = task.dueOn || hasDuration || task.notesHtml || subtaskCount ||
      (m.assignEnabled && assignees.length) || task.isFavourite ||
      isAllListsView || task.githubNumber;
    return {
      utilityPill: null,
      anyOpen: false,
      metaRow: hasMeta ? (
        <div className="task-meta-row task-summary-row">
          {task.dueOn ? task.completed ? (
            <span className="task-summary-value">{t("fieldDue")}: {formatDueOnShort(task.dueOn, m.lang, t)}</span>
          ) : cardDueChip(m, task, { duePopoverOpen }) : null}
          {task.completed ? cardDurationMeta(m, task, {
            hasDuration,
            editingDur: m.editingDurationTaskId === task.id && !m.notesExpanded,
          }).metaAlways : hasDuration ? (
            <span className="task-summary-value">
              <ClockIcon size={13} />
              {formatDurationShort(task.expectedDurationMinutes!, t("minutes"), t("hoursShort"))}
            </span>
          ) : null}
          {task.notesHtml ? <span className="task-summary-value"><NotesIcon />{t("fieldNotes")}</span> : null}
          {subtaskCount ? cardSubtaskChip(m, task) : null}
          {m.assignEnabled && assignees.length ? <span className="task-summary-value">{assignees.map(p => shortPersonName(p.name)).join(", ")}</span> : null}
          {task.isFavourite ? <span className="task-summary-value"><HeartIcon size={13} filled />{t("taskFavourite")}</span> : null}
          {isAllListsView ? <span className="task-summary-value">{m.listOfTask(task)?.name}</span> : null}
          <TaskGithubLink task={task} t={t} />
        </div>
      ) : null,
    };
  }
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
          <TaskGithubLink task={task} t={m.t} />
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

  const chrome = taskCardChrome(m, task);

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
          <span
            className={`task-text ${task.completed ? "completed" : ""}`}
            /* One entry point for details, on open and completed tasks. */
            role="button"
            tabIndex={0}
            aria-expanded={m.notesExpanded && m.openNotesTaskId === task.id}
            onClick={(event) => { event.currentTarget.focus(); m.openTaskOverlay(task); }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              m.openTaskOverlay(task);
            }}
          >
            {task.text}
          </span>
        {/* When it was finished, as the mail list stamps a message:
            the hour today and yesterday, the day before that. */}
        {task.completed && task.completedAt ? (
          <DoneStamp completedAt={task.completedAt} lang={lang} />
        ) : null}
        {cardFocusButton(m, task, { isFocused: m.activeFocusTaskIds.has(task.id), labelled: true })}
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
      {cardMenu({ ...m, foldPillActions: false }, task, {
        menuOpen: m.openMenuTaskId === task.id,
        unlisted: isUnlistedTask(task),
        hasDuration: task.completed ? task.timeSpentSeconds > 0 : task.expectedDurationMinutes != null,
        openDurationPopover: () => {},
      }, true)}
    </div>
  );
}
