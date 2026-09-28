"use client";

/*
 * The add-task row's chips (assign, due, duration, notes, steps, list) and
 * its note and steps sections.
 *
 * Part of AddTaskComposer's markup, moved out of AddTaskComposer.tsx. Each
 * function takes the composer (`c`, from useAddTaskComposer) and reads the
 * names it needs from it. The JSX is the composer's own.
 */

import * as React from "react";

import { Calendar, ChevronDown, List, ListChecks, User, X } from "lucide-react";

import { DuePopover } from "@/components/todo/DuePopover";
import { DurationPopover } from "@/components/todo/DurationPopover";
import { MenuKeys } from "@/components/todo/MenuKeys";
import { MenuPortal } from "@/components/todo/MenuPortal";
import {
  TaskAssignMenu,
  TaskAssigneeStack,
} from "@/components/todo/TodoPeopleEditor";
import { TrixNotesEditor } from "@/components/todo/TrixNotesEditor";
import { ClockIcon, NotesIcon } from "@/components/todo/task-icons";
import type { AddTaskComposerModel } from "@/components/todo/use-add-task-composer";
import { pendingAttachments } from "@/lib/todo/basecamp-richtext";
import { formatDurationShort } from "@/lib/todo/duration";
import { ListIcon, listInitials, resolveListIconId } from "@/lib/todo/list-icons";
import { formatDueOn, notesHtmlIsEmpty, type SubtaskDraft } from "@/lib/todo/task-draft";

/** The first name, as the assign menu shows it. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Keep focus where it is: a chip is a tool, not a place to land. */
export function keepFocus(event: React.MouseEvent) {
  event.preventDefault();
}

export function composerAssignChip(c: AddTaskComposerModel) {
  const {
    people,
    onEditPeople,
    t,
    assignRef,
    assignOpen,
    setAssignOpen,
    draft,
    onDraftChange,
    patch,
    assignees,
    closeAssign,
  } = c;
  return (
    <span className="composer-chip-wrap">
      <button
        ref={assignRef}
        type="button"
        className={`composer-chip${assignees.length ? " is-set" : ""}`}
        title={t("assignPerson")}
        aria-haspopup="listbox"
        aria-expanded={assignOpen}
        onMouseDown={keepFocus}
        onClick={() => setAssignOpen((v) => !v)}
      >
        {assignees.length ? (
          <>
            <TaskAssigneeStack people={assignees} size={18} />
            <span className="composer-chip-label">
              {assignees.map((person) => firstName(person.name)).join(", ")}
            </span>
          </>
        ) : (
          <>
            <User size={14} strokeWidth={2} aria-hidden />
            <span className="composer-chip-label">{t("composerAssign")}</span>
          </>
        )}
      </button>
      {assignees.length ? (
        <button
          type="button"
          className="composer-chip-clear"
          title={t("composerClear")}
          aria-label={t("composerClear")}
          onMouseDown={keepFocus}
          onClick={() => patch({ assigneeIds: [] })}
        >
          <X size={12} strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
      <TaskAssignMenu
        open={assignOpen}
        anchorEl={assignOpen ? assignRef.current : null}
        people={people}
        assigneeIds={draft.assigneeIds}
        t={t}
        onToggle={(personId) =>
          onDraftChange((current) => ({
            ...current,
            assigneeIds: current.assigneeIds.includes(personId)
              ? current.assigneeIds.filter((id) => id !== personId)
              : [...current.assigneeIds, personId],
          }))
        }
        onEditPeople={() => {
          setAssignOpen(false);
          onEditPeople();
        }}
        onClose={closeAssign}
      />
    </span>
  );
}

export function composerDueChip(c: AddTaskComposerModel) {
  const {
    lang,
    t,
    dueChipRef,
    dueOpen,
    setDueOpen,
    draft,
    patch,
    closeDue,
  } = c;
  return (
    <span className="composer-chip-wrap">
      <button
        ref={dueChipRef}
        type="button"
        className={`composer-chip composer-chip-due${draft.dueOn ? " is-set" : ""}${
          dueOpen ? " is-on" : ""
        }`}
        title={t("fieldDue")}
        aria-haspopup="dialog"
        aria-expanded={dueOpen}
        onMouseDown={keepFocus}
        onClick={() => setDueOpen((v) => !v)}
      >
        <Calendar size={14} strokeWidth={2} aria-hidden />
        <span className="composer-chip-label">
          {draft.dueOn ? formatDueOn(draft.dueOn, lang, t) : t("composerDue")}
        </span>
      </button>
      {draft.dueOn ? (
        <button
          type="button"
          className="composer-chip-clear"
          title={t("composerClear")}
          aria-label={t("composerClear")}
          onMouseDown={keepFocus}
          onClick={() => patch({ dueOn: null })}
        >
          <X size={12} strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
      {dueOpen ? (
      <DuePopover
        open={dueOpen}
        anchorEl={dueOpen ? dueChipRef.current : null}
        value={draft.dueOn}
        onPick={(dueOn) => {
          patch({ dueOn });
          closeDue();
        }}
        onClose={closeDue}
        lang={lang}
        t={t}
      />
      ) : null}
    </span>
  );
}

export function composerDurationChip(c: AddTaskComposerModel) {
  const {
    minutesLabel,
    t,
    durationChipRef,
    durationOpen,
    setDurationOpen,
    patch,
    hasDuration,
    durationMinutes,
    closeDuration,
  } = c;
  return (
    <span className="composer-chip-wrap">
      <button
        ref={durationChipRef}
        type="button"
        className={`composer-chip${hasDuration ? " is-set" : " is-icon"}${
          durationOpen ? " is-on" : ""
        }`}
        title={t("addDuration")}
        aria-label={t("addDuration")}
        aria-haspopup="dialog"
        aria-expanded={durationOpen}
        onMouseDown={keepFocus}
        onClick={() => setDurationOpen((v) => !v)}
      >
        <ClockIcon size={14} />
        {durationMinutes != null ? (
          <span className="composer-chip-label">
            {formatDurationShort(durationMinutes, minutesLabel, t("hoursShort"))}
          </span>
        ) : null}
      </button>
      {hasDuration ? (
        <button
          type="button"
          className="composer-chip-clear"
          title={t("composerClear")}
          aria-label={t("composerClear")}
          onMouseDown={keepFocus}
          onClick={() => patch({ duration: "" })}
        >
          <X size={12} strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
      {durationOpen ? (
      <DurationPopover
        open={durationOpen}
        anchorEl={durationOpen ? durationChipRef.current : null}
        minutes={durationMinutes}
        onPick={(minutes) => {
          patch({ duration: minutes == null ? "" : String(minutes) });
          closeDuration();
        }}
        onClose={closeDuration}
        t={t}
      />
      ) : null}
    </span>
  );
}

export function composerNotesChip(c: AddTaskComposerModel) {
  const {
    t,
    notesChipRef,
    notesOpen,
    setNotesOpen,
    hasNotes,
  } = c;
  return (
    <button
      ref={notesChipRef}
      type="button"
      className={`composer-chip is-icon${notesOpen ? " is-on" : ""}${
        !notesOpen && hasNotes ? " is-set" : ""
      }`}
      title={t("fieldNotes")}
      aria-label={t("fieldNotes")}
      aria-pressed={notesOpen}
      onMouseDown={keepFocus}
      onClick={() => setNotesOpen((v) => !v)}
    >
      <NotesIcon />
    </button>
  );
}

export function composerSubtasksChip(c: AddTaskComposerModel) {
  const {
    t,
    subtasksChipRef,
    subtasksOpen,
    setSubtasksOpen,
    subtaskCount,
  } = c;
  return (
    <button
      ref={subtasksChipRef}
      type="button"
      className={`composer-chip is-icon${subtasksOpen ? " is-on" : ""}${
        !subtasksOpen && subtaskCount ? " is-set" : ""
      }`}
      title={t("subtasks")}
      aria-label={t("subtasks")}
      aria-pressed={subtasksOpen}
      onMouseDown={keepFocus}
      onClick={() => setSubtasksOpen((v) => !v)}
    >
      <ListChecks size={14} strokeWidth={2} aria-hidden />
      {!subtasksOpen && subtaskCount ? (
        <span className="composer-chip-label">{subtaskCount}</span>
      ) : null}
    </button>
  );
}

export function composerListChip(c: AddTaskComposerModel) {
  const {
    lists,
    defaultList,
    t,
    listRef,
    listOpen,
    setListOpen,
    patch,
    pickedList,
    targetList,
    targetIconId,
  } = c;
  return (
    <span className="composer-chip-wrap composer-chip-list-wrap">
      <button
        ref={listRef}
        type="button"
        className={`composer-chip composer-chip-list${
          targetList ? " is-set" : ""
        }`}
        title={t("fieldList")}
        aria-haspopup="menu"
        aria-expanded={listOpen}
        disabled={lists.length === 0}
        onMouseDown={keepFocus}
        onClick={() => setListOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setListOpen(true);
          }
        }}
      >
        {targetList ? (
          <span
            className={`composer-list-icon${targetIconId ? " has-icon" : ""}`}
          >
            {targetIconId ? (
              <ListIcon id={targetIconId} size={14} />
            ) : (
              listInitials(targetList.name)
            )}
          </span>
        ) : (
          <List size={14} strokeWidth={1.75} aria-hidden />
        )}
        <span className="composer-chip-label">
          {targetList ? targetList.name : t("composerNoList")}
        </span>
        <ChevronDown size={12} strokeWidth={2.25} aria-hidden />
      </button>
      <MenuPortal
        open={listOpen}
        anchorEl={listOpen ? listRef.current : null}
        className="task-list-picker"
        align="right"
        role="menu"
        ariaLabel={t("fieldList")}
      >
        <MenuKeys
          onClose={(reason) => {
            setListOpen(false);
            if (reason === "escape") listRef.current?.focus();
          }}
        >
        {defaultList ? null : (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!pickedList}
            className={`task-list-picker-item${!pickedList ? " is-current" : ""}`}
            onClick={() => {
              setListOpen(false);
              patch({ listId: null });
              listRef.current?.focus();
            }}
          >
            <span className="task-list-picker-icon has-icon">
              <List size={14} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="task-list-picker-name">{t("composerNoList")}</span>
          </button>
        )}
        {lists.map((list) => {
          const iconId = resolveListIconId(list.emoji);
          const selected = targetList?.id === list.id;
          return (
            <button
              key={list.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              className={`task-list-picker-item${selected ? " is-current" : ""}`}
              onClick={() => {
                setListOpen(false);
                patch({
                  listId: list.id === defaultList?.id ? null : list.id,
                });
                listRef.current?.focus();
              }}
            >
              <span
                className={`task-list-picker-icon${iconId ? " has-icon" : ""}`}
              >
                {iconId ? (
                  <ListIcon id={iconId} size={14} />
                ) : (
                  listInitials(list.name)
                )}
              </span>
              <span className="task-list-picker-name">{list.name}</span>
            </button>
          );
        })}
        </MenuKeys>
      </MenuPortal>
    </span>
  );
}

/*
  The note is written in the editor a task's own note uses.

  It was a plain text box, so a picture pasted into a task being added
  had nowhere to go, and the note had to be opened again after the task
  was made before a picture would take. The editor uploads a picture the
  way the task's note does, for the list the task will go on.

  Cmd+Enter adds the task through the row's own key handler, so the
  editor is given no Done of its own: two would add the task twice.
*/
export function composerNotesSection(c: AddTaskComposerModel) {
  const {
    t,
    uploadImageForList,
    resolveImageSrc,
    notesChipRef,
    notesUploading,
    notesReadCurrent,
    notesWait,
    setNotesWait,
    notesOpen,
    setNotesOpen,
    draft,
    patch,
    targetList,
  } = c;
  return notesOpen ? (
    <div
      className="composer-section composer-notes composer-notes-editor"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setNotesOpen(false);
          notesChipRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        // Leaving an empty note is how the section is put away. Moving
        // between the editor and its own toolbar is not leaving.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        const html = notesReadCurrent.current?.() ?? draft.notes;
        if (notesHtmlIsEmpty(html) && notesUploading.current === 0) {
          setNotesOpen(false);
        }
      }}
    >
      <TrixNotesEditor
        value={draft.notes}
        onChange={(html) => {
          patch({ notes: html });
          if (notesWait && pendingAttachments(html) === 0) setNotesWait(false);
        }}
        placeholder={t("composerNotesPlaceholder")}
        resolveImageSrc={resolveImageSrc}
        uploadImage={uploadImageForList?.(targetList?.id ?? null)}
        onPendingChange={(count) => {
          notesUploading.current = count;
          if (count === 0) setNotesWait(false);
        }}
        readCurrentRef={notesReadCurrent}
        autoFocus
      />
      {notesWait ? (
        <p className="composer-notes-wait" role="status">
          A picture is still uploading. Add the task when it is done.
        </p>
      ) : null}
    </div>
  ) : null;
}

export function composerSubtaskAssign(c: AddTaskComposerModel, row: SubtaskDraft) {
  const {
    people,
    onEditPeople,
    t,
    subtaskAssignRefs,
    subtaskAssignKey,
    setSubtaskAssignKey,
    closeSubtaskAssign,
    updateSubtask,
  } = c;
  const rowAssignees = people.filter((person) =>
    row.assigneeIds.includes(person.id)
  );
  const menuOpen = subtaskAssignKey === row.key;
  return (
    <span className="composer-subtask-assign-wrap">
      <button
        ref={(el) => {
          if (el) subtaskAssignRefs.current.set(row.key, el);
          else subtaskAssignRefs.current.delete(row.key);
        }}
        type="button"
        className={`composer-subtask-assign${
          rowAssignees.length ? " is-set" : ""
        }`}
        title={t("assignPerson")}
        aria-label={t("assignPerson")}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        onMouseDown={keepFocus}
        onClick={() => setSubtaskAssignKey(menuOpen ? null : row.key)}
      >
        {rowAssignees.length ? (
          <TaskAssigneeStack people={rowAssignees} size={20} />
        ) : null}
      </button>
      <TaskAssignMenu
        open={menuOpen}
        anchorEl={menuOpen ? subtaskAssignRefs.current.get(row.key) ?? null : null}
        people={people}
        assigneeIds={row.assigneeIds}
        t={t}
        onToggle={(personId) =>
          updateSubtask(row.key, {
            assigneeIds: row.assigneeIds.includes(personId)
              ? row.assigneeIds.filter((id) => id !== personId)
              : [...row.assigneeIds, personId],
          })
        }
        onEditPeople={() => {
          setSubtaskAssignKey(null);
          onEditPeople();
        }}
        onClose={closeSubtaskAssign}
      />
    </span>
  );

}

export function composerSubtasksSection(c: AddTaskComposerModel) {
  const {
    assignEnabled,
    t,
    subtasksChipRef,
    newSubtaskRef,
    subtaskRefs,
    subtasksOpen,
    setSubtasksOpen,
    pendingSubtask,
    setPendingSubtask,
    draft,
    submit,
    updateSubtask,
    removeSubtask,
    commitPendingSubtask,
  } = c;
  return subtasksOpen ? (
    <div className="composer-section composer-subtasks">
      {draft.subtasks.map((row) => (
        <div key={row.key} className="composer-subtask-row">
          <span className="composer-subtask-check" aria-hidden />
          <input
            ref={(el) => {
              if (el) subtaskRefs.current.set(row.key, el);
              else subtaskRefs.current.delete(row.key);
            }}
            type="text"
            className="composer-subtask-input"
            value={row.text}
            maxLength={2000}
            onChange={(e) => updateSubtask(row.key, { text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                newSubtaskRef.current?.focus();
              } else if (e.key === "Backspace" && row.text === "") {
                e.preventDefault();
                removeSubtask(row.key);
              } else if (e.key === "Escape") {
                setSubtasksOpen(false);
                subtasksChipRef.current?.focus();
              }
            }}
            onBlur={() => {
              if (!row.text.trim()) removeSubtask(row.key);
            }}
          />
          {assignEnabled ? composerSubtaskAssign(c, row) : null}
        </div>
      ))}
      <div className="composer-subtask-row is-new">
        <span className="composer-subtask-check" aria-hidden />
        <input
          ref={newSubtaskRef}
          type="text"
          className="composer-subtask-input"
          placeholder={t("composerSubtaskPlaceholder")}
          value={pendingSubtask}
          maxLength={2000}
          onChange={(e) => setPendingSubtask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (pendingSubtask.trim()) commitPendingSubtask();
              // Cmd+Enter: the row adds the task, once.
              else if (!(e.metaKey || e.ctrlKey)) submit();
            } else if (e.key === "Backspace" && pendingSubtask === "") {
              const last = draft.subtasks[draft.subtasks.length - 1];
              if (last) {
                e.preventDefault();
                subtaskRefs.current.get(last.key)?.focus();
              }
            } else if (e.key === "Escape") {
              setSubtasksOpen(false);
              subtasksChipRef.current?.focus();
            }
          }}
          onBlur={() => {
            // Nothing typed and nothing kept: the section is put away.
            if (!pendingSubtask.trim() && draft.subtasks.length === 0) {
              setSubtasksOpen(false);
            }
          }}
        />
        <span className="composer-subtask-assign is-ghost" aria-hidden />
      </div>
    </div>
  ) : null;
}
