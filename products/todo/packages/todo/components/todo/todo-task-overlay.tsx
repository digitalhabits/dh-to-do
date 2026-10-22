"use client";

/*
 * A task's note: the box under its row, and the whole card over the window.
 *
 * Part of TodoPage's markup, moved out of TodoPage.tsx. Each function takes
 * the page's model (`m`, from useTodoPage) first and reads the names it
 * needs from it. The JSX is TodoPage's own, word for word.
 */

import * as React from "react";

import { Plus, User } from "lucide-react";

import { TaskAssignMenu, TaskAssigneeStack } from "@/components/todo/TodoPeopleEditor";
import { TaskOverlayChips, TaskOverlayHead } from "@/components/todo/task-overlay-chips";
import { TrixNotesEditor } from "@/components/todo/TrixNotesEditor";
import { ClockIcon, FocusIcon, NotesIcon } from "@/components/todo/task-icons";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { resolveBasecampImage } from "@/lib/todo/basecamp-image";
import { minutesFromTyped } from "@/lib/todo/duration-input";
import { popCheck } from "@/lib/todo/list-flip";
import { spawnCompletionParty, randomSubtaskPartyEmoji } from "@/lib/todo/task-celebration";
import { notesHtmlIsEmpty } from "@/lib/todo/task-draft";
import { toggleId } from "@/lib/todo/task-helpers";
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

/**
 * The task's words at the top of the open card. A click opens them for
 * changing, in the same type. Enter or a click elsewhere saves; Escape
 * puts the words back. Empty words are not saved.
 */
function OverlayTitle({ text, onSave }: { text: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const boxRef = React.useRef<HTMLTextAreaElement | null>(null);
  React.useLayoutEffect(() => {
    const box = boxRef.current;
    if (draft === null || !box) return;
    box.style.height = "0px";
    box.style.height = `${box.scrollHeight}px`;
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
    overlayMoreBelow,
    updateOverlayFade,
    setOverlayFieldsNode,
    notesUploading,
    notesReadCurrent,
    notesDraft,
    setNotesDraft,
    nativeShell,
    activeFocusTaskIds,
    t,
    toggleTaskFocusPopout,
    mutateTask,
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
        className={`notes-overlay-card task-overlay-card${task.completed ? " is-done" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={task.text}
      >
        <TaskOverlayHead
          m={m}
          task={task}
          title={
            <OverlayTitle
              key={task.id}
              text={task.text}
              onSave={(text) => void mutateTask(task.id, { text })}
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
          <TaskOverlayChips m={m} task={task} />
          <div className="task-overlay-subtasks" aria-label={t("subtasks")}>
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
                          className={`task-subtask-action task-subtask-focus${
                            activeFocusTaskIds.has(subtask.id)
                              ? " is-focusing"
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
