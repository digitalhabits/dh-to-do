"use client";

/*
 * A task's note: the box under its row, and the whole card over the window.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) first and reads the names it
 * needs from it. The JSX is TodoPage's own, word for word.
 */

import * as React from "react";

import { Calendar, Clock, CornerLeftUp, Pencil, Plus, User } from "lucide-react";

import { TaskDetailsActions } from "@/components/todo/todo-task-card";
import { TaskDetailsBar } from "@/components/todo/task-details-bar";
import { TaskDetailsInfo } from "@/components/todo/task-details-info";
import { TaskAssignMenu, TaskAssigneeStack } from "@/components/todo/TodoPeopleEditor";
import { TaskOverlayChips, TaskOverlayHead } from "@/components/todo/task-overlay-chips";
import { TrixNotesEditor } from "@/components/todo/TrixNotesEditor";
import { DurationPopover } from "@/components/todo/DurationPopover";
import { DuePopover } from "@/components/todo/DuePopover";
import { ClockIcon, FocusIcon, MenuDotsIcon, MoveToBottomIcon, MoveToTopIcon, NotesIcon, TrashIcon } from "@/components/todo/task-icons";
import { MenuPortal } from "@/components/todo/MenuPortal";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import type { TodoLang } from "@/lib/todo/i18n";
import { resolveBasecampImage } from "@/lib/todo/basecamp-image";
import { formatDurationShort } from "@/lib/todo/duration";
import { DETAILS_MIN, DETAILS_STEP, LIST_MIN, clampDetailsWidth } from "@/lib/todo/details-width";
import { boardLayoutKey } from "@/components/todo/use-board-layout";
import { popCheck } from "@/lib/todo/list-flip";
import { spawnCompletionParty, randomSubtaskPartyEmoji } from "@/lib/todo/task-celebration";
import { daysUntilDue, formatDueOnShort, notesHtmlIsEmpty } from "@/lib/todo/task-draft";
import { toggleId } from "@/lib/todo/task-helpers";
import { EMPTY_TASK_DRAFT } from "@/lib/todo/task-draft";
import { boardColumnOf } from "@/lib/todo/types";
import { type TodoPerson, type TodoTask } from "@/lib/todo/types";

/** The assign menu's key for the subtask still being written, which has no id yet. */
const NEW_SUBTASK_ASSIGN_ID = "__new-subtask__";


/**
 * The notes editor the board opens under a row. The Today session shows the
 * same one, so notes are written in one place and one way.
 */
/** `chevron`: opened from a "Notes ▾" chip, which also puts it away, so
    the note has no ✓ of its own. */
export function renderNotesEditor(m: TodoPageModel, task: TodoTask, { chevron = false }: { chevron?: boolean } = {}) {
  const {
    openNotesTaskId,
    notesExpanded,
    notesUploading,
    notesReadCurrent,
    notesDraft,
    setNotesDraft,
    uploaderForTask,
    saveNotes,
  } = m;
  if (openNotesTaskId !== task.id) return null;
  // Details own the only live editor; the list stays compact.
  if (notesExpanded) return null;

  return (
    <div className={`notes-container open${chevron ? " is-chevron" : ""}`} style={{ display: "block" }}>
      <div className="notes-editor-wrapper active">
        {/* The notes button opens this box to be written in, so the
            caret starts here rather than after a second click. */}
        <TrixNotesEditor
          value={notesDraft}
          onChange={setNotesDraft}
          placeholder="Add notes..."
          resolveImageSrc={resolveBasecampImage}
          uploadImage={uploaderForTask(task)}
          onPendingChange={(n) => (notesUploading.current = n)}
          readCurrentRef={notesReadCurrent}
          onDone={() => saveNotes(task.id)}
          autoFocus
        />
        {chevron ? null : (
          <button
            className="notes-done-btn"
            title="Done editing"
            onClick={() => saveNotes(task.id)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The task's words at the top of the open card. A click opens them for
 * changing, in the same type. Enter or a click elsewhere saves; Escape
 * puts the words back. Empty words are not saved.
 */
/**
 * A subtask's ⋮ menu: Move to top and Move to bottom (an open subtask not
 * already there), Convert to task (an open one), and Delete.
 *
 * Convert makes a new task from the subtask, in its parent's list and
 * column, then deletes the subtask. It does not clear the parent: in
 * Basecamp a subtask is a "step" of its parent to-do, and a task still
 * linked to a step would confuse the next sync. Made and deleted through
 * the app's own actions, both changes sync as any other.
 */
function SubtaskMenu({
  m,
  parent,
  subtask,
  openIds,
  adds = [],
}: {
  m: TodoPageModel;
  parent: TodoTask;
  subtask: TodoTask;
  /** The parent's open subtasks, in the order shown. */
  openIds: string[];
  /** What the step has not got yet, offered at the top: each opens its
      picker, or the notes, from the ⋮. */
  adds?: { label: string; icon: React.ReactNode; run: (anchor: HTMLElement) => void }[];
}) {
  const { t } = m;
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const close = React.useCallback(() => setAnchor(null), []);
  /* A click anywhere else, or Escape, puts it away. MenuPortal keeps its
     own clicks to itself. */
  React.useEffect(() => {
    if (!anchor) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!anchor.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      anchor.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, close]);

  const at = openIds.indexOf(subtask.id);
  const canMoveUp = !subtask.completed && at > 0;
  const canMoveDown = !subtask.completed && at >= 0 && at < openIds.length - 1;
  /* The order the move leaves: open subtasks only, as the ticked ones keep
     their own place below them. */
  const moveTo = (edge: "top" | "bottom") => {
    const rest = openIds.filter((id) => id !== subtask.id);
    const order = edge === "top" ? [subtask.id, ...rest] : [...rest, subtask.id];
    m.reorderSubtasks(parent.id, order, subtask.id);
  };
  const convert = async () => {
    const id = await m.addTask(boardColumnOf(parent, m.somedayEnabled), {
      ...EMPTY_TASK_DRAFT,
      text: subtask.text,
      duration: subtask.expectedDurationMinutes == null ? "" : String(subtask.expectedDurationMinutes),
      assigneeIds: subtask.assigneeIds,
      dueOn: subtask.dueOn ?? null,
      notes: subtask.notesHtml ?? "",
      listId: parent.listId,
    });
    // Only once the task is made: a failed add keeps the subtask.
    if (id) await m.removeTask(subtask.id, { undo: false });
  };
  const item = (label: string, icon: React.ReactNode, run: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={`task-menu-item${danger ? " delete-task-item" : ""}`}
      onClick={() => {
        close();
        run();
      }}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <>
      <button
        type="button"
        className="task-subtask-action task-subtask-more"
        title={t("subtaskOptions")}
        aria-label={t("subtaskOptions")}
        aria-haspopup="menu"
        aria-expanded={anchor != null}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <MenuDotsIcon />
      </button>
      <MenuPortal
        open={anchor != null}
        anchorEl={anchor}
        align="right"
        className="task-menu task-details-menu"
        role="menu"
        ariaLabel={t("subtaskOptions")}
      >
        {adds.map((add) => (
          <React.Fragment key={add.label}>
            {item(add.label, add.icon, () => anchor && add.run(anchor))}
          </React.Fragment>
        ))}
        {canMoveUp ? item(t("moveToTop"), <MoveToTopIcon />, () => moveTo("top")) : null}
        {canMoveDown ? item(t("moveToBottom"), <MoveToBottomIcon />, () => moveTo("bottom")) : null}
        {subtask.completed ? null : item(t("convertToTask"), <CornerLeftUp size={16} strokeWidth={2} aria-hidden />, () => void convert())}
        {item(t("delete"), <TrashIcon />, () => void m.removeTask(subtask.id), true)}
      </MenuPortal>
    </>
  );
}

/**
 * The rest of a step's row (design "20c/20d"), in the row's grid: a
 * second line with its day, time and notes, each only when set and each
 * a button to change it; who it is for on the right of the first line
 * (a ghost on hover when nobody); and Focus and ⋮, which float over the
 * right end on hover so the words wrap as at rest. What is not set yet is
 * added from the ⋮.
 */
function SubtaskTail({
  m,
  parent,
  subtask,
  openIds,
}: {
  m: TodoPageModel;
  parent: TodoTask;
  subtask: TodoTask;
  openIds: string[];
}) {
  const {
    t, lang, mutateTask, assignEnabled, nativeShell, activeFocusTaskIds, toggleTaskFocusPopout,
    subtaskNotesId, setSubtaskNotesId, setSubtaskNotesDraft, saveSubtaskNotes,
    openAssignTaskId, setOpenAssignTaskId, assignAnchorEl, setAssignAnchorEl, closeAssignMenu,
    toggleTaskAssignee, peopleById, state, setPeopleEditorOpen,
  } = m;
  const [picker, setPicker] = React.useState<{ kind: "due" | "duration"; anchor: HTMLElement } | null>(null);
  const close = React.useCallback(() => setPicker(null), []);
  const dueOn = subtask.dueOn ?? null;
  const minutes = subtask.expectedDurationMinutes ?? null;
  const days = dueOn ? daysUntilDue(dueOn) : null;
  const toggleNotes = () => {
    if (subtaskNotesId === subtask.id) {
      saveSubtaskNotes(subtask);
    } else {
      setSubtaskNotesId(subtask.id);
      setSubtaskNotesDraft(subtask.notesHtml ?? "");
    }
  };
  const people = subtask.assigneeIds
    .map((pid) => peopleById.get(pid))
    .filter((p): p is TodoPerson => Boolean(p));
  const adds = [
    ...(dueOn ? [] : [{ label: t("addDueDate"), icon: <Calendar size={16} strokeWidth={2} aria-hidden />, run: (anchor: HTMLElement) => setPicker({ kind: "due", anchor }) }]),
    ...(minutes != null ? [] : [{ label: t("addDuration"), icon: <ClockIcon />, run: (anchor: HTMLElement) => setPicker({ kind: "duration", anchor }) }]),
    ...(subtask.notesHtml ? [] : [{ label: t("addNotes"), icon: <Pencil size={16} strokeWidth={2} aria-hidden />, run: () => toggleNotes() }]),
  ];
  return (
    <>
      {dueOn || minutes != null || subtask.notesHtml ? (
        <div className="task-subtask-meta">
          {dueOn ? (
            <button
              type="button"
              className={`task-subtask-meta-item task-subtask-due${days != null && days <= 1 ? " is-soon" : ""}`}
              title={t("fieldDue")}
              onClick={(e) => setPicker({ kind: "due", anchor: e.currentTarget })}
            >
              <Calendar size={13} strokeWidth={2} aria-hidden />
              {formatDueOnShort(dueOn, lang, t)}
            </button>
          ) : null}
          {minutes != null ? (
            <button
              type="button"
              className="task-subtask-meta-item"
              title={t("fieldDuration")}
              onClick={(e) => setPicker({ kind: "duration", anchor: e.currentTarget })}
            >
              <Clock size={13} strokeWidth={2} aria-hidden />
              {formatDurationShort(minutes, t("minutes"), t("hoursShort"))}
            </button>
          ) : null}
          {subtask.notesHtml ? (
            <button
              type="button"
              className={`task-subtask-meta-item${subtaskNotesId === subtask.id ? " is-active" : ""}`}
              onClick={toggleNotes}
            >
              <Pencil size={13} strokeWidth={2} aria-hidden />
              {t("fieldNotes")}
            </button>
          ) : null}
        </div>
      ) : null}
      <span className="task-subtask-float">
        {!subtask.completed && nativeShell ? (
          <button
            type="button"
            className={`task-subtask-action task-subtask-focus${activeFocusTaskIds.has(subtask.id) ? " is-focusing" : ""}`}
            title={activeFocusTaskIds.has(subtask.id) ? "Exit focus mode" : "Focus on this task"}
            aria-label={t(activeFocusTaskIds.has(subtask.id) ? "taskStopFocus" : "taskFocus")}
            onClick={() => toggleTaskFocusPopout(subtask)}
          >
            <FocusIcon />
          </button>
        ) : null}
        <SubtaskMenu m={m} parent={parent} subtask={subtask} openIds={openIds} adds={adds} />
      </span>
      {assignEnabled ? (
        <span className="task-subtask-who assign-menu-wrap">
          <button
            type="button"
            className={`task-subtask-action${people.length ? " has-value" : ""}`}
            title={people.map((p) => p.name).join(", ") || t("assignPerson")}
            aria-label={t("assignPerson")}
            onClick={(e) => {
              e.stopPropagation();
              if (openAssignTaskId === subtask.id) {
                closeAssignMenu();
              } else {
                setAssignAnchorEl(e.currentTarget);
                setOpenAssignTaskId(subtask.id);
              }
            }}
          >
            {people.length ? <TaskAssigneeStack people={people} size={22} /> : <User size={14} strokeWidth={2} />}
          </button>
          <TaskAssignMenu
            open={openAssignTaskId === subtask.id}
            anchorEl={openAssignTaskId === subtask.id ? assignAnchorEl : null}
            people={state.people}
            assigneeIds={subtask.assigneeIds}
            t={t}
            onToggle={(personId) => toggleTaskAssignee(subtask.id, personId)}
            onEditPeople={() => {
              closeAssignMenu();
              setPeopleEditorOpen(true);
            }}
            onClose={closeAssignMenu}
          />
        </span>
      ) : null}
      <DuePopover
        open={picker?.kind === "due"}
        anchorEl={picker?.kind === "due" ? picker.anchor : null}
        value={dueOn}
        lang={lang}
        t={t}
        onClose={close}
        onPick={(next) => {
          close();
          if (next !== dueOn) void mutateTask(subtask.id, { dueOn: next });
        }}
      />
      <DurationPopover
        open={picker?.kind === "duration"}
        anchorEl={picker?.kind === "duration" ? picker.anchor : null}
        minutes={minutes}
        removeRow
        t={t}
        onClose={close}
        onPick={(next) => {
          close();
          if (next !== minutes) void mutateTask(subtask.id, { expectedDurationMinutes: next });
        }}
      />
    </>
  );
}

/**
 * A subtask's time: the clock, and the value once there is one. A click
 * opens the same picker as the task's own duration.
 */
function SubtaskDurationButton({
  minutes,
  onPick,
  t,
}: {
  minutes: number | null;
  onPick: (minutes: number | null) => void;
  t: (key: string) => string;
}) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const close = React.useCallback(() => setAnchor(null), []);
  return (
    <>
      <button
        type="button"
        className={`task-subtask-action task-subtask-dur${minutes != null ? " has-value" : ""}`}
        title={t("estimateTime")}
        aria-label={t("fieldDuration")}
        aria-haspopup="dialog"
        aria-expanded={anchor != null}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <ClockIcon />
        {minutes != null ? (
          <span>{formatDurationShort(minutes, t("minutes"), t("hoursShort"))}</span>
        ) : null}
      </button>
      <DurationPopover
        open={anchor != null}
        anchorEl={anchor}
        minutes={minutes}
        removeRow
        t={t}
        onClose={close}
        onPick={(next) => {
          setAnchor(null);
          onPick(next);
        }}
      />
    </>
  );
}

/**
 * A subtask's due date: the calendar, and the day once there is one, in
 * coral when it is today, tomorrow or past. A click opens the same picker
 * as the task's own date.
 */
function SubtaskDueButton({
  dueOn,
  onPick,
  lang,
  t,
}: {
  dueOn: string | null;
  onPick: (dueOn: string | null) => void;
  lang: TodoLang;
  t: (key: string) => string;
}) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const close = React.useCallback(() => setAnchor(null), []);
  const days = dueOn ? daysUntilDue(dueOn) : null;
  return (
    <>
      <button
        type="button"
        className={`task-subtask-action task-subtask-due${dueOn ? " has-value" : ""}${
          days != null && days <= 1 ? " is-soon" : ""
        }`}
        title={t("fieldDue")}
        aria-label={dueOn ? `${t("fieldDue")}: ${formatDueOnShort(dueOn, lang, t)}` : t("fieldDue")}
        aria-haspopup="dialog"
        aria-expanded={anchor != null}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <Calendar size={14} strokeWidth={2} aria-hidden />
        {dueOn ? <span>{formatDueOnShort(dueOn, lang, t)}</span> : null}
      </button>
      <DuePopover
        open={anchor != null}
        anchorEl={anchor}
        value={dueOn}
        lang={lang}
        t={t}
        onClose={close}
        onPick={(next) => {
          setAnchor(null);
          onPick(next);
        }}
      />
    </>
  );
}

/**
 * The line between the list and task details, beside the list only: drag
 * it, or press the arrow keys on it, to make details wider or narrower.
 * A double-click goes back to the standard width. While dragging, only the
 * width on the shell moves; the board lays itself out again on release.
 */
function DetailsResizer({ m }: { m: TodoPageModel }) {
  const { t, detailsWidth, setDetailsWidth, shellWidth } = m;
  /* The width as last set, before the page has drawn it: a held arrow key
     repeats faster than that, and each press must move on from the last. */
  const widthRef = React.useRef(detailsWidth);
  widthRef.current = detailsWidth;
  if (detailsWidth == null || shellWidth == null) return null;
  const set = (width: number | null) => {
    const next = width == null ? null : clampDetailsWidth(width, shellWidth);
    widthRef.current = next;
    setDetailsWidth(next);
  };
  const by = (step: number) => set((widthRef.current ?? detailsWidth) + step);
  return (
    <div
      className="task-details-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("detailsResize")}
      title={t("detailsResizeHint")}
      aria-valuenow={detailsWidth}
      aria-valuemin={DETAILS_MIN}
      aria-valuemax={Math.max(DETAILS_MIN, shellWidth - LIST_MIN)}
      tabIndex={0}
      onDoubleClick={() => set(null)}
      onKeyDown={(e) => {
        // The line moves the way the arrow points: left makes details wider.
        if (e.key === "ArrowLeft") by(DETAILS_STEP);
        else if (e.key === "ArrowRight") by(-DETAILS_STEP);
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const shell = e.currentTarget.closest<HTMLElement>(".todo-shell");
        if (!shell) return;
        e.preventDefault();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        // The shell may be zoomed: the pointer moves in screen pixels,
        // the width is in the shell's own.
        const scale = shell.getBoundingClientRect().width / shell.offsetWidth || 1;
        const startX = e.clientX;
        let width = detailsWidth;
        let layout = boardLayoutKey(shellWidth - width);
        shell.classList.add("is-resizing-details");
        const onMove = (ev: PointerEvent) => {
          width = clampDetailsWidth(detailsWidth + (startX - ev.clientX) / scale, shellWidth);
          shell.style.setProperty("--task-details-width", `${width}px`);
          // The board lays itself out again as the line goes, but only
          // when its room crosses a breakpoint (columns to one, and so on):
          // between them the width alone moves, which is cheap.
          const next = boardLayoutKey(shellWidth - width);
          if (next !== layout) {
            layout = next;
            setDetailsWidth(width, false);
          }
        };
        const onUp = () => {
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
          handle.removeEventListener("pointercancel", onUp);
          shell.classList.remove("is-resizing-details");
          setDetailsWidth(width);
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
      }}
    />
  );
}

function OverlayTitle({
  text,
  onSave,
  onDraft,
}: {
  text: string;
  onSave: (text: string) => void;
  /** The words as typed, for the card; null when the box closes. */
  onDraft?: (draft: string | null) => void;
}) {
  const [draft, setDraftState] = React.useState<string | null>(null);
  /* The card shows the words as typed, but the page hears of them only
     when typing pauses: told on every key, the whole page drew again and
     the box's growing then laid out all of it, ~20ms a letter on a big
     board. Closing tells it at once. */
  const draftTimer = React.useRef<number | undefined>(undefined);
  const setDraft = (next: string | null) => {
    setDraftState(next);
    window.clearTimeout(draftTimer.current);
    if (next === null) onDraft?.(null);
    else draftTimer.current = window.setTimeout(() => onDraft?.(next), 150);
  };
  React.useEffect(() => () => window.clearTimeout(draftTimer.current), []);
  // A box closed by the task going away leaves no words on its card.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => () => onDraft?.(null), []);
  const boxRef = React.useRef<HTMLTextAreaElement | null>(null);
  /* The box is as tall as its words. Each change of its height restyles
     the page (~8ms on a big board), so it is touched only when needed:
     grown when the words overflow it, and measured from nothing only
     when words are taken away (or the box has just opened). */
  const lengthRef = React.useRef(-1);
  React.useLayoutEffect(() => {
    const box = boxRef.current;
    if (draft === null || !box) {
      lengthRef.current = -1;
      return;
    }
    if (lengthRef.current < 0 || draft.length < lengthRef.current) {
      box.style.height = "0px";
      box.style.height = `${box.scrollHeight}px`;
    } else if (box.scrollHeight > box.clientHeight) {
      box.style.height = `${box.scrollHeight}px`;
    }
    lengthRef.current = draft.length;
  }, [draft]);
  React.useEffect(() => {
    const box = boxRef.current;
    if (draft === null || !box || document.activeElement === box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    // Only as the box opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft === null]);
  if (draft === null) {
    return (
      <h2
        className="notes-overlay-title is-editable"
        tabIndex={0}
        title="Click to change"
        onClick={() => setDraft(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setDraft(text);
          }
        }}
      >
        {text}
      </h2>
    );
  }
  const commit = () => {
    const next = draft.replace(/\s+/g, " ").trim();
    setDraft(null);
    if (next && next !== text) onSave(next);
  };
  return (
    <textarea
      ref={boxRef}
      className="notes-overlay-title notes-overlay-title-input"
      value={draft}
      rows={1}
      aria-label="Task name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
        }
      }}
    />
  );
}

/**
 * Task details. `canExpand`: whether they can widen over the whole window
 * (false where they take it anyway: a narrow window, the Today session).
 * `full`: they are laid out as a widened document.
 */
export function renderNotesOverlay(
  m: TodoPageModel,
  { canExpand = false, full = false }: { canExpand?: boolean; full?: boolean } = {}
) {
  const {
    state,
    assignEnabled,
    openAssignTaskId,
    setOpenAssignTaskId,
    assignAnchorEl,
    setAssignAnchorEl,
    setPeopleEditorOpen,
    openNotesTaskId,
    notesExpanded,
    overlayMoreBelow,
    updateOverlayFade,
    setOverlayFieldsNode,
    notesUploading,
    notesReadCurrent,
    notesDraft,
    setNotesDraft,
    t,
    mutateTask,
    resizeEditTextarea,
    uploaderForTask,
    saveNotes,
    subtasksByTask,
    toggleSubtaskDone,
    subtaskNotesId,
    subtaskNotesDraft,
    setSubtaskNotesDraft,
    newSubtaskText,
    setNewSubtaskText,
    newSubtaskAssigneeIds,
    setNewSubtaskAssigneeIds,
    newSubtaskNotes,
    setNewSubtaskNotes,
    newSubtaskNotesOpen,
    setNewSubtaskNotesOpen,
    newSubtaskDuration,
    setNewSubtaskDuration,
    newSubtaskDue,
    setNewSubtaskDue,
    newSubtaskInputRef,
    submitNewSubtask,
    saveSubtaskNotes,
    subtaskDragId,
    subtaskPreview,
    subtaskListRef,
    subtaskHoldRef,
    startSubtaskDrag,
    peopleById,
    closeAssignMenu,
  } = m;
  if (!openNotesTaskId || !notesExpanded) return null;
  const task = state.tasks.find((t) => t.id === openNotesTaskId);
  if (!task) return null;
  const mySubtasks = subtasksByTask.get(task.id) ?? [];
  /* While a row is carried, the list is drawn in the order the pointer
     is making, and the stored order takes over again on the drop. */
  const orderedSubtasks = subtaskPreview
    ? subtaskPreview
        .map((id) => mySubtasks.find((st) => st.id === id))
        .filter((st): st is TodoTask => Boolean(st))
    : mySubtasks;
  /*
    The row that adds a subtask. It is drawn after the last step
    still to do, not under the done pile, so a new step lands where
    it is read — and when every step is done, at the top.
  */
  const lastOpenSubtaskId =
    [...orderedSubtasks].reverse().find((st) => !st.completed)?.id ?? null;
  const addSubtaskRow = (
    <>
    {/*
      The new subtask, as the add-task row is for a task: type
      the words, Tab on to its time, notes and people, and
      Enter adds it with all of them.
    */}
    <div
      className={`task-subtask-row task-subtask-add-row${
        newSubtaskText.trim() ||
        newSubtaskAssigneeIds.length ||
        newSubtaskNotesOpen ||
        newSubtaskDuration != null ||
        newSubtaskDue != null
          ? " is-drafting"
          : ""
      }`}
    >
      {/* Where the check circle stands on the rows above, so
          the words start where theirs do. */}
      <span
        className="task-subtask-check task-subtask-check-ghost"
        aria-hidden
        onClick={() => newSubtaskInputRef.current?.focus()}
      >
        <Plus size={16} strokeWidth={1.75} />
      </span>
      <input
        ref={newSubtaskInputRef}
        type="text"
        className="task-subtask-add"
        placeholder={t("addSubtask")}
        value={newSubtaskText}
        onChange={(e) => setNewSubtaskText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          submitNewSubtask(task);
        }}
      />
      <span className="task-subtask-actions">
        <SubtaskDueButton
          dueOn={newSubtaskDue}
          lang={m.lang}
          t={t}
          onPick={(next) => {
            setNewSubtaskDue(next);
            newSubtaskInputRef.current?.focus();
          }}
        />
        <SubtaskDurationButton
          minutes={newSubtaskDuration}
          t={t}
          onPick={(next) => {
            setNewSubtaskDuration(next);
            newSubtaskInputRef.current?.focus();
          }}
        />
        {/* As in the add-task box: open, the field below is the notes,
            and the button steps aside. */}
        {newSubtaskNotesOpen ? null : (
          <button
            type="button"
            className={`task-subtask-action${
              notesHtmlIsEmpty(newSubtaskNotes) ? "" : " has-value"
            }`}
            title={t("notes")}
            onClick={() => setNewSubtaskNotesOpen(true)}
          >
            <NotesIcon />
          </button>
        )}
        {assignEnabled ? (
          <span className="task-subtask-who assign-menu-wrap">
            <button
              type="button"
              className={`task-subtask-action${
                newSubtaskAssigneeIds.length ? " has-value" : ""
              }`}
              title={t("assignPerson")}
              onClick={(e) => {
                e.stopPropagation();
                if (openAssignTaskId === NEW_SUBTASK_ASSIGN_ID) {
                  closeAssignMenu();
                } else {
                  setAssignAnchorEl(e.currentTarget);
                  setOpenAssignTaskId(NEW_SUBTASK_ASSIGN_ID);
                }
              }}
            >
              {newSubtaskAssigneeIds.length ? (
                <TaskAssigneeStack
                  people={newSubtaskAssigneeIds
                    .map((pid) => peopleById.get(pid))
                    .filter((p): p is TodoPerson => Boolean(p))}
                  size={18}
                />
              ) : (
                <User size={14} strokeWidth={2} />
              )}
            </button>
            <TaskAssignMenu
              open={openAssignTaskId === NEW_SUBTASK_ASSIGN_ID}
              anchorEl={
                openAssignTaskId === NEW_SUBTASK_ASSIGN_ID ? assignAnchorEl : null
              }
              people={state.people}
              assigneeIds={newSubtaskAssigneeIds}
              t={t}
              onToggle={(personId) =>
                setNewSubtaskAssigneeIds((ids) => toggleId(ids, personId))
              }
              onEditPeople={() => {
                closeAssignMenu();
                setPeopleEditorOpen(true);
              }}
              onClose={closeAssignMenu}
            />
          </span>
        ) : null}
      </span>
    </div>
    {newSubtaskNotesOpen ? (
      <div
        className="task-subtask-notes task-subtask-new-notes"
        onBlur={(e) => {
          // Left empty, the field is put away, as in the add-task box.
          // Moving between the editor and its own toolbar is not leaving.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          if (notesHtmlIsEmpty(newSubtaskNotes)) setNewSubtaskNotesOpen(false);
        }}
      >
        <TrixNotesEditor
          value={newSubtaskNotes}
          onChange={setNewSubtaskNotes}
          placeholder="Add notes..."
          resolveImageSrc={resolveBasecampImage}
          uploadImage={uploaderForTask(task)}
          onDone={() => {
            setNewSubtaskNotesOpen(false);
            newSubtaskInputRef.current?.focus();
          }}
          autoFocus
        />
      </div>
    ) : null}
    </>
  );
  return (
    <div
      className="notes-overlay task-details-panel"
    >
      <div
        key={task.id}
        className={`notes-overlay-card task-overlay-card${task.completed ? " is-done" : ""}`}
        role="region"
        aria-label={task.text}
      >
        <DetailsResizer m={m} />
        <TaskDetailsBar m={m} task={task} canExpand={canExpand} full={full} />
        <TaskOverlayHead
          m={m}
          task={task}
          title={
            <OverlayTitle
              key={task.id}
              text={task.text}
              onSave={(text) => void mutateTask(task.id, { text })}
              onDraft={(draft) => m.setTitleDraft(draft === null ? null : { taskId: task.id, text: draft })}
            />
          }
        />
        <div className="task-overlay-scroll">
        <div
          className="task-overlay-fields"
          ref={setOverlayFieldsNode}
          onScroll={updateOverlayFade}
        >
        {/* The task's own facts and steps, on the card's white. The notes
            follow on the page's cream, as a band of their own. */}
        <div className="task-overlay-top">
          {/* Full screen, who made the task stands beside Focus, and the
              fields below go across in columns (task-details.css). */}
          {full ? (
            <div className="task-details-lead">
              <TaskDetailsActions m={m} task={task} />
              <TaskDetailsInfo m={m} task={task} />
            </div>
          ) : <TaskDetailsActions m={m} task={task} />}
          <TaskOverlayChips m={m} task={task} withInfo={!full} />
          <div className="task-overlay-subtasks" aria-label={t("subtasks")}>
              <h3 className="task-details-subtasks-heading">{t("subtasks")}</h3>
              <div className="task-subtask-list" ref={subtaskListRef}>
                {/* One flat list, the add row keyed in it like a row. It
                    moves down as steps are added, and React keeps it:
                    the same input, with the caret still in it, so the
                    next step can be typed at once. Drawn inside a row's
                    fragment, it was a new input after each Enter. */}
                {[
                  ...(lastOpenSubtaskId === null
                    ? [<React.Fragment key="add-subtask">{addSubtaskRow}</React.Fragment>]
                    : []),
                  ...orderedSubtasks.flatMap((subtask) => [
                  <React.Fragment key={subtask.id}>
                  <div
                    data-subtask-id={subtask.id}
                    className={`task-subtask-row${subtask.completed ? " is-done" : ""}${
                      subtaskDragId === subtask.id ? " is-dragging" : ""
                    }`}
                  >
                    <span
                      className="task-subtask-grip"
                      title={t("dragToReorder")}
                      aria-hidden
                      onPointerDown={(e) =>
                        startSubtaskDrag(e, task.id, subtask.id)
                      }
                    >
                      <svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
                        <circle cx="2.5" cy="3" r="1.4" />
                        <circle cx="7.5" cy="3" r="1.4" />
                        <circle cx="2.5" cy="8" r="1.4" />
                        <circle cx="7.5" cy="8" r="1.4" />
                        <circle cx="2.5" cy="13" r="1.4" />
                        <circle cx="7.5" cy="13" r="1.4" />
                      </svg>
                    </span>
                    <button
                      type="button"
                      className={`task-subtask-check${
                        subtask.completed ? " is-checked" : ""
                      }`}
                      aria-label={subtask.text}
                      aria-pressed={subtask.completed}
                      onClick={(e) => {
                        const completing = !subtask.completed;
                        // The tick lands, then the row goes to the pile.
                        subtaskHoldRef.current = true;
                        if (completing) popCheck(e.currentTarget);
                        if (completing) {
                          spawnCompletionParty(e.currentTarget, {
                            emoji: randomSubtaskPartyEmoji(),
                          });
                        }
                        toggleSubtaskDone(subtask);
                      }}
                    >
                      {subtask.completed ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </button>
                    {/* A textarea, not an input: a long step wraps
                        instead of clipping. Auto-grown to its text; a
                        step stays one logical line (Enter commits, and
                        pasted newlines collapse to spaces). */}
                    <textarea
                      rows={1}
                      className="task-subtask-text"
                      defaultValue={subtask.text}
                      ref={resizeEditTextarea}
                      onInput={(e) => resizeEditTextarea(e.currentTarget)}
                      onBlur={(e) => {
                        const text = e.target.value
                          .replace(/\s*\n\s*/g, " ")
                          .trim();
                        if (!text || text === subtask.text) {
                          e.target.value = subtask.text;
                          resizeEditTextarea(e.target);
                          return;
                        }
                        void mutateTask(subtask.id, { text });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                    {/* What it carries, on a second line when set; who
                        it is for on the right; Focus and ⋮ over the right
                        end on hover (design "20c/20d"). */}
                    <SubtaskTail
                      m={m}
                      parent={task}
                      subtask={subtask}
                      openIds={orderedSubtasks.filter((st) => !st.completed).map((st) => st.id)}
                    />
                  </div>
                  {subtaskNotesId === subtask.id ? (
                    <div className="task-subtask-notes">
                      <TrixNotesEditor
                        value={subtaskNotesDraft}
                        onChange={setSubtaskNotesDraft}
                        placeholder="Add notes..."
                        resolveImageSrc={resolveBasecampImage}
                        uploadImage={uploaderForTask(subtask)}
                        onDone={() => saveSubtaskNotes(subtask)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="notes-done-btn"
                        title="Done editing"
                        onClick={() => saveSubtaskNotes(subtask)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                    </div>
                  ) : null}
                  </React.Fragment>,
                  ...(subtask.id === lastOpenSubtaskId
                    ? [<React.Fragment key="add-subtask">{addSubtaskRow}</React.Fragment>]
                    : []),
                ]),
                ]}
              </div>
          </div>
        </div>
        <div className="task-overlay-notes-band">
          <span className="task-overlay-band-label">{t("fieldNotes")}</span>
          <div className="notes-overlay-body">
            <TrixNotesEditor
              value={notesDraft}
              onChange={setNotesDraft}
              placeholder="Add notes..."
              resolveImageSrc={resolveBasecampImage}
              uploadImage={uploaderForTask(task)}
              onPendingChange={(n) => (notesUploading.current = n)}
              readCurrentRef={notesReadCurrent}
              className="notes-overlay-editor"
              /* The full-window note has no tick of its own — the same
                 save puts it away, so the key means one thing in both. */
              onDone={() => saveNotes(task.id)}
            />
          </div>
        </div>
        </div>
        {/* More below the fold. Gone at the bottom, so the last row is
            never read through a veil. */}
        {overlayMoreBelow ? <div className="task-overlay-fade" aria-hidden /> : null}
        </div>
      </div>
    </div>
  );
}
