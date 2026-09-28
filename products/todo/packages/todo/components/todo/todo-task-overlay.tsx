"use client";

/*
 * A task's note: the box under its row, and the whole card over the window.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) first and reads the names it
 * needs from it. The JSX is TodoPage's own, word for word.
 */

import * as React from "react";

import { Plus, User, X } from "lucide-react";

import { MenuKeys } from "@/components/todo/MenuKeys";
import { TaskAssignMenu, TaskAssigneeStack } from "@/components/todo/TodoPeopleEditor";
import { TrixNotesEditor } from "@/components/todo/TrixNotesEditor";
import { ClockIcon, FocusIcon, NotesIcon } from "@/components/todo/task-icons";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { resolveBasecampImage } from "@/lib/todo/basecamp-image";
import { minutesFromTyped } from "@/lib/todo/duration-input";
import { popCheck } from "@/lib/todo/list-flip";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import { shortPersonName } from "@/lib/todo/people";
import { spawnCompletionParty, randomSubtaskPartyEmoji } from "@/lib/todo/task-celebration";
import { formatDueOn, notesHtmlIsEmpty } from "@/lib/todo/task-draft";
import { dueDatePatch, listOriginLetters, toggleId } from "@/lib/todo/task-helpers";
import { type TodoPerson, type TodoTask } from "@/lib/todo/types";

/** The assign menu's key for the subtask still being written, which has no id yet. */
const NEW_SUBTASK_ASSIGN_ID = "__new-subtask__";


/**
 * The notes editor the board opens under a row. The Today session shows the
 * same one, so notes are written in one place and one way.
 */
export function renderNotesEditor(m: TodoPageModel, task: TodoTask) {
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
  /*
    One editor at a time.

    With the full-window note open, this one kept running underneath it:
    two live documents over one draft, and one slot for the save to read
    from. Which copy a save saw depended on which editor mounted last —
    the kind of difference between the expanded and the small note that
    has no business existing. The overlay covers this box anyway; when it
    closes, this editor comes back and loads the draft the overlay wrote.
  */
  if (notesExpanded) {
    return (
      <div className="notes-container open" style={{ display: "block" }}>
        <div className="notes-editor-wrapper active" />
      </div>
    );
  }
  return (
    <div className="notes-container open" style={{ display: "block" }}>
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
        <button
          className="notes-done-btn"
          title="Done editing"
          onClick={() => saveNotes(task.id)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function renderNotesOverlay(m: TodoPageModel) {
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
    overlayListOpen,
    setOverlayListOpen,
    overlayAssignAnchor,
    setOverlayAssignAnchor,
    overlayMoreBelow,
    updateOverlayFade,
    setOverlayFieldsNode,
    notesUploading,
    notesReadCurrent,
    notesDraft,
    setNotesDraft,
    nativeShell,
    activeFocusTaskIds,
    lang,
    t,
    toggleTaskFocusPopout,
    mutateTask,
    toggleTaskCompleted,
    removeTask,
    resizeEditTextarea,
    uploaderForTask,
    saveNotes,
    subtasksByTask,
    toggleSubtaskDone,
    subtaskNotesId,
    setSubtaskNotesId,
    subtaskNotesDraft,
    setSubtaskNotesDraft,
    subtaskDurEditId,
    setSubtaskDurEditId,
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
    newSubtaskDurEditing,
    setNewSubtaskDurEditing,
    newSubtaskInputRef,
    submitNewSubtask,
    saveSubtaskNotes,
    subtaskDragId,
    subtaskPreview,
    subtaskListRef,
    subtaskHoldRef,
    startSubtaskDrag,
    peopleById,
    toggleTaskAssignee,
    closeAssignMenu,
  } = m;
  if (!openNotesTaskId || !notesExpanded) return null;
  const task = state.tasks.find((t) => t.id === openNotesTaskId);
  if (!task) return null;
  const taskList = state.lists.find((l) => l.id === task.listId);
  const listIconId = resolveListIconId(taskList?.emoji);
  const assignees = task.assigneeIds
    .map((id) => peopleById.get(id))
    .filter((p): p is TodoPerson => Boolean(p));
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
        newSubtaskDuration != null
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
        <Plus size={12} strokeWidth={2.5} />
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
        {newSubtaskDurEditing ? (
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            className="task-subtask-dur-input"
            defaultValue={
              newSubtaskDuration == null ? "" : String(newSubtaskDuration)
            }
            placeholder="min"
            onBlur={(e) => {
              setNewSubtaskDurEditing(false);
              setNewSubtaskDuration(minutesFromTyped(e.target.value));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") setNewSubtaskDurEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            className={`task-subtask-action${
              newSubtaskDuration != null ? " has-value" : ""
            }`}
            title={t("estimateTime")}
            onClick={() => setNewSubtaskDurEditing(true)}
          >
            <ClockIcon />
            {newSubtaskDuration != null ? (
              <span>{newSubtaskDuration}m</span>
            ) : null}
          </button>
        )}
        <button
          type="button"
          className={`task-subtask-action${
            notesHtmlIsEmpty(newSubtaskNotes) ? "" : " has-value"
          }${newSubtaskNotesOpen ? " is-active" : ""}`}
          title={t("notes")}
          onClick={() => setNewSubtaskNotesOpen((open) => !open)}
        >
          <NotesIcon />
        </button>
        {assignEnabled ? (
          <span className="assign-menu-wrap">
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
        {/* The places of the focus button and the ×, which a
            subtask not yet added has no use for, so its
            controls line up with the rows above. */}
        {nativeShell ? (
          <span className="task-subtask-action task-subtask-slot" aria-hidden />
        ) : null}
        <span className="task-subtask-delete task-subtask-slot" aria-hidden />
      </span>
    </div>
    {newSubtaskNotesOpen ? (
      <div className="task-subtask-notes">
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
        <button
          type="button"
          className="notes-done-btn"
          title="Done editing"
          onClick={() => {
            setNewSubtaskNotesOpen(false);
            newSubtaskInputRef.current?.focus();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </div>
    ) : null}
    </>
  );
  return (
    <div
      className="modal-overlay notes-overlay"
      onClick={(event) => {
        // Only the ground behind the card. A click inside it is the task.
        if (event.target === event.currentTarget) saveNotes(task.id);
      }}
    >
      <div
        className="notes-overlay-card task-overlay-card"
        role="dialog"
        aria-modal="true"
        aria-label={task.text}
      >
        <div className="notes-overlay-head">
          <input
            type="checkbox"
            className="task-checkbox"
            checked={task.completed}
            onChange={(event) => toggleTaskCompleted(task, event)}
            aria-label={t("markDone")}
          />
          <h2 className="notes-overlay-title">{task.text}</h2>
          <button
            type="button"
            className="notes-collapse-btn"
            title={t("collapseTask")}
            aria-label={t("collapseTask")}
            onClick={() => saveNotes(task.id)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </div>
        <div className="task-overlay-scroll">
        <div
          className="task-overlay-fields"
          ref={setOverlayFieldsNode}
          onScroll={updateOverlayFade}
        >
          {/* The list it is on. The picker is the card's own, drawn here. */}
          <div className="task-overlay-row">
            <span className="task-overlay-label">{t("fieldList")}</span>
            <div className="task-overlay-value">
              <div
                className={`task-list-origin-wrap${overlayListOpen ? " is-open" : ""}`}
              >
                <button
                  type="button"
                  className="task-overlay-list-btn"
                  aria-haspopup="menu"
                  aria-expanded={overlayListOpen}
                  disabled={state.lists.length === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOverlayListOpen((v) => !v);
                  }}
                >
                  {listIconId ? (
                    <ListIcon id={listIconId} size={15} />
                  ) : null}
                  <span>{taskList?.name ?? "—"}</span>
                </button>
                {overlayListOpen ? (
                  <MenuKeys
                    className="task-list-picker"
                    onClose={() => setOverlayListOpen(false)}
                  >
                    {state.lists.map((l) => {
                      const iconId = resolveListIconId(l.emoji);
                      const selected = l.id === task.listId;
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
                            setOverlayListOpen(false);
                            if (!selected) void mutateTask(task.id, { listId: l.id });
                          }}
                        >
                          <span
                            className={`task-list-picker-icon${iconId ? " has-icon" : ""}`}
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
                ) : null}
              </div>
            </div>
          </div>
          {assignEnabled ? (
            <div className="task-overlay-row">
              <span className="task-overlay-label">{t("fieldAssignedTo")}</span>
              <div className="task-overlay-value">
                <button
                  type="button"
                  className="task-overlay-assign-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    const el = e.currentTarget;
                    setOverlayAssignAnchor((now) => (now ? null : el));
                  }}
                >
                  {assignees.length ? (
                    <>
                      <TaskAssigneeStack people={assignees} size={26} />
                      <span className="task-overlay-assign-names">
                        {assignees.map((p) => shortPersonName(p.name)).join(", ")}
                      </span>
                    </>
                  ) : (
                    <span className="task-overlay-placeholder">{t("assignPerson")}</span>
                  )}
                </button>
                <TaskAssignMenu
                  open={Boolean(overlayAssignAnchor)}
                  anchorEl={overlayAssignAnchor}
                  people={state.people}
                  assigneeIds={task.assigneeIds}
                  t={t}
                  onToggle={(personId) => toggleTaskAssignee(task.id, personId)}
                  onEditPeople={() => {
                    setOverlayAssignAnchor(null);
                    setPeopleEditorOpen(true);
                  }}
                  onClose={() => setOverlayAssignAnchor(null)}
                />
              </div>
            </div>
          ) : null}
          <div className="task-overlay-row">
            <span className="task-overlay-label">{t("fieldDuration")}</span>
            <div className="task-overlay-value">
              <input
                key={`${task.id}:${task.expectedDurationMinutes ?? ""}`}
                type="text"
                inputMode="numeric"
                className="task-overlay-duration"
                defaultValue={
                  task.expectedDurationMinutes == null
                    ? ""
                    : String(task.expectedDurationMinutes)
                }
                /* As wide as its number, so "min" sits right after it.
                   Empty, the inline width goes and the stylesheet's
                   width takes over — the placeholder needs the room.
                   The box has 8px of padding and a 1px border on each
                   side, and its width counts them. Two spare characters
                   were less than that, so "90" showed as "9". */
                style={
                  task.expectedDurationMinutes == null
                    ? undefined
                    : {
                        width: `calc(${String(task.expectedDurationMinutes).length}ch + 22px)`,
                      }
                }
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.width = el.value ? `calc(${el.value.length}ch + 22px)` : "";
                }}
                placeholder={t("estimateTime")}
                onBlur={(e) => {
                  const next = minutesFromTyped(e.target.value);
                  if (next === (task.expectedDurationMinutes ?? null)) return;
                  void mutateTask(task.id, { expectedDurationMinutes: next });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <span className="task-overlay-unit">min</span>
            </div>
          </div>
          <div className="task-overlay-row">
            <span className="task-overlay-label">{t("fieldDue")}</span>
            <div className="task-overlay-value task-overlay-due-value">
              <input
                type="date"
                className="task-overlay-due"
                aria-label={t("fieldDue")}
                value={task.dueOn ?? ""}
                onChange={(e) =>
                  void mutateTask(task.id, dueDatePatch(e.target.value || null))
                }
              />
              {task.dueOn ? (
                <>
                  <span className="task-overlay-due-said">
                    {formatDueOn(task.dueOn, lang, t)}
                  </span>
                  <button
                    type="button"
                    className="task-overlay-due-clear"
                    title={t("composerClear")}
                    aria-label={t("composerClear")}
                    onClick={() => void mutateTask(task.id, { dueOn: null })}
                  >
                    <X size={13} strokeWidth={2.5} aria-hidden />
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="task-overlay-row task-overlay-notes">
            <span className="task-overlay-label">{t("fieldNotes")}</span>
            <div className="task-overlay-value notes-overlay-body">
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
          {(
          <div className="task-overlay-row task-overlay-subtasks">
            <span className="task-overlay-label">{t("subtasks")}</span>
            <div className="task-overlay-value">
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
                    {/* What a subtask carries, and what can be done to
                        it — the card's own controls, on a smaller row.
                        Only making subtasks of subtasks is missing, on
                        purpose. */}
                    <span className="task-subtask-actions">
                      {subtaskDurEditId === subtask.id ? (
                        <input
                          autoFocus
                          type="text"
                          inputMode="numeric"
                          className="task-subtask-dur-input"
                          defaultValue={
                            subtask.expectedDurationMinutes == null
                              ? ""
                              : String(subtask.expectedDurationMinutes)
                          }
                          placeholder="min"
                          onBlur={(e) => {
                            setSubtaskDurEditId(null);
                            const next = minutesFromTyped(e.target.value);
                            if (next === (subtask.expectedDurationMinutes ?? null))
                              return;
                            void mutateTask(subtask.id, {
                              expectedDurationMinutes: next,
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setSubtaskDurEditId(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`task-subtask-action${
                            subtask.expectedDurationMinutes != null
                              ? " has-value"
                              : ""
                          }`}
                          title={t("estimateTime")}
                          onClick={() => setSubtaskDurEditId(subtask.id)}
                        >
                          <ClockIcon />
                          {subtask.expectedDurationMinutes != null ? (
                            <span>{subtask.expectedDurationMinutes}m</span>
                          ) : null}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`task-subtask-action${
                          subtask.notesHtml ? " has-value" : ""
                        }`}
                        title={t("notes")}
                        onClick={() => {
                          if (subtaskNotesId === subtask.id) {
                            saveSubtaskNotes(subtask);
                          } else {
                            setSubtaskNotesId(subtask.id);
                            setSubtaskNotesDraft(subtask.notesHtml ?? "");
                          }
                        }}
                      >
                        <NotesIcon />
                      </button>
                      {assignEnabled ? (
                        <span className="assign-menu-wrap">
                          <button
                            type="button"
                            className={`task-subtask-action${
                              subtask.assigneeIds.length ? " has-value" : ""
                            }`}
                            title={t("assignPerson")}
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
                            {subtask.assigneeIds.length ? (
                              <TaskAssigneeStack
                                people={subtask.assigneeIds
                                  .map((pid) => peopleById.get(pid))
                                  .filter((p): p is TodoPerson => Boolean(p))}
                                size={18}
                              />
                            ) : (
                              <User size={14} strokeWidth={2} />
                            )}
                          </button>
                          <TaskAssignMenu
                            open={openAssignTaskId === subtask.id}
                            anchorEl={
                              openAssignTaskId === subtask.id ? assignAnchorEl : null
                            }
                            people={state.people}
                            assigneeIds={subtask.assigneeIds}
                            t={t}
                            onToggle={(personId) =>
                              toggleTaskAssignee(subtask.id, personId)
                            }
                            onEditPeople={() => {
                              closeAssignMenu();
                              setPeopleEditorOpen(true);
                            }}
                            onClose={closeAssignMenu}
                          />
                        </span>
                      ) : null}
                      {nativeShell && !subtask.completed ? (
                        <button
                          type="button"
                          className={`task-subtask-action${
                            activeFocusTaskIds.has(subtask.id)
                              ? " is-active"
                              : ""
                          }`}
                          title={
                            activeFocusTaskIds.has(subtask.id)
                              ? "Exit focus mode"
                              : "Focus on this task"
                          }
                          onClick={() => toggleTaskFocusPopout(subtask)}
                        >
                          <FocusIcon />
                        </button>
                      ) : nativeShell ? (
                        /* A done step has no focus button. Its place is
                           kept, so every row's controls stand in the
                           same columns. */
                        <span className="task-subtask-action task-subtask-slot" aria-hidden />
                      ) : null}
                      <button
                        type="button"
                        className="task-subtask-delete"
                        title={t("deleteSubtask")}
                        aria-label={t("deleteSubtask")}
                        onClick={() => void removeTask(subtask.id)}
                      >
                        ×
                      </button>
                    </span>
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
          )}
        </div>
        {/* More below the fold. Gone at the bottom, so the last row is
            never read through a veil. */}
        {overlayMoreBelow ? <div className="task-overlay-fade" aria-hidden /> : null}
        </div>
      </div>
    </div>
  );
}
