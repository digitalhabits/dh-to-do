"use client";

import * as React from "react";
import { Calendar, ChevronDown, List, ListChecks, User, X } from "lucide-react";

import { MenuKeys } from "@/components/todo/MenuKeys";
import { MenuPortal } from "@/components/todo/MenuPortal";
import {
  TaskAssignMenu,
  TaskAssigneeStack,
} from "@/components/todo/TodoPeopleEditor";
import { DuePopover } from "@/components/todo/DuePopover";
import { DurationPopover } from "@/components/todo/DurationPopover";
import { ClockIcon, NotesIcon } from "@/components/todo/task-icons";
import { formatDurationShort } from "@/lib/todo/duration";
import { walkArrowStops, walkTabStops } from "@/lib/todo/focus-walk";
import type { TodoLang } from "@/lib/todo/i18n";
import { ListIcon, listInitials, resolveListIconId } from "@/lib/todo/list-icons";
import {
  EMPTY_TASK_DRAFT,
  draftHasExtras,
  formatDueOn,
  newDraftKey,
  notesHtmlIsEmpty,
  type SubtaskDraft,
  type TaskDraft,
} from "@/lib/todo/task-draft";
import type { TodoList, TodoPerson } from "@/lib/todo/types";
import { TrixNotesEditor, type UploadImage } from "@/components/todo/TrixNotesEditor";
import {
  pendingAttachments,
  type ImageSrcResolver,
} from "@/lib/todo/basecamp-richtext";

/** The first name, as the assign menu shows it. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Keep focus where it is: a chip is a tool, not a place to land. */
function keepFocus(event: React.MouseEvent) {
  event.preventDefault();
}

/**
 * The add-task row: a title, an Add button, and a row of chips under it
 * (the design's "2c"). Assign and Due keep their labels; duration, notes
 * and subtasks are icons until they hold something. The list chip sits on
 * the right, filled with the list the tab is on.
 *
 * Notes and subtasks are section toggles: the chip fills and the section
 * unfolds inside the row. Everything typed here goes onto the task in one
 * Add, so the row is the expanded card in miniature.
 *
 * The chips stay out of the way until the title is being typed, or until
 * one of them holds a value.
 */
export function AddTaskComposer({
  inputId,
  placeholder,
  addLabel,
  minutesLabel,
  onSubmit,
  people,
  onEditPeople,
  assignEnabled = true,
  lists,
  defaultList,
  lang,
  t,
  uploadImageForList,
  resolveImageSrc,
  initialDraft,
  autoFocus = false,
}: {
  inputId?: string;
  placeholder: string;
  addLabel: string;
  minutesLabel: string;
  /** The draft to add. A subtask still being typed is folded into it. */
  onSubmit: (draft: TaskDraft) => void;
  /** People the new task can go to. */
  people: TodoPerson[];
  onEditPeople: () => void;
  /** Off, the row has no assign chip. The setting is in TodoSettingsModal. */
  assignEnabled?: boolean;
  /** The lists the chip can pick from. */
  lists: TodoList[];
  /** The list the tab is on, or null on the All tab. */
  defaultList: TodoList | null;
  lang: TodoLang;
  t: (key: string) => string;
  /**
   * Where a picture pasted into the note goes, for the list the task will
   * be on. The same choice a task's own note makes. Left out, a picture is
   * refused rather than half kept.
   */
  uploadImageForList?: (listId: string | null) => UploadImage;
  /** Where a Basecamp picture in the note is read from. */
  resolveImageSrc?: ImageSrcResolver;
  /** What the box starts with: the Calendar gives the due day of the day that was clicked. */
  initialDraft?: Partial<TaskDraft>;
  /** Put the caret in the box when it shows. */
  autoFocus?: boolean;
}) {
  const textRef = React.useRef<HTMLInputElement | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const assignRef = React.useRef<HTMLButtonElement | null>(null);
  const listRef = React.useRef<HTMLButtonElement | null>(null);
  const durationChipRef = React.useRef<HTMLButtonElement | null>(null);
  const dueChipRef = React.useRef<HTMLButtonElement | null>(null);
  const notesChipRef = React.useRef<HTMLButtonElement | null>(null);
  const subtasksChipRef = React.useRef<HTMLButtonElement | null>(null);
  /** Pictures in the note still on their way up. Adding waits for them. */
  const notesUploading = React.useRef(0);
  /** Reads the note straight from the editor, pictures included. */
  const notesReadCurrent = React.useRef<(() => string) | null>(null);
  /** Add was pressed while a picture was still uploading. */
  const [notesWait, setNotesWait] = React.useState(false);
  const newSubtaskRef = React.useRef<HTMLInputElement | null>(null);
  const subtaskRefs = React.useRef(new Map<string, HTMLInputElement>());
  const subtaskAssignRefs = React.useRef(new Map<string, HTMLButtonElement>());

  const [assignOpen, setAssignOpen] = React.useState(false);
  const [listOpen, setListOpen] = React.useState(false);
  const [durationOpen, setDurationOpen] = React.useState(false);
  const [dueOpen, setDueOpen] = React.useState(false);
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [subtasksOpen, setSubtasksOpen] = React.useState(false);
  /** The subtask row whose assign menu is up, by draft key. */
  const [subtaskAssignKey, setSubtaskAssignKey] = React.useState<string | null>(
    null
  );
  /** The subtask row still being typed, below the committed ones. */
  const [pendingSubtask, setPendingSubtask] = React.useState("");

  /*
    The draft lives here, not on the page. A keystroke then redraws this
    row and nothing else — held on the page it redrew every card on the
    board, which is what made typing a title feel slow.
  */
  const [draft, onDraftChange] = React.useState<TaskDraft>(() => ({
    ...EMPTY_TASK_DRAFT,
    ...initialDraft,
  }));
  React.useEffect(() => {
    if (autoFocus) textRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const patch = React.useCallback(
    (fields: Partial<TaskDraft>) =>
      onDraftChange((current) => ({ ...current, ...fields })),
    []
  );

  const hasText = draft.text.trim().length > 0;
  const hasDuration = draft.duration !== "";
  const hasNotes = !notesHtmlIsEmpty(draft.notes);
  const anyMenuOpen = assignOpen || listOpen || subtaskAssignKey !== null;
  /*
    The chips wait for the first letter. A focused, empty row stays a plain
    box — the row is for typing, and the chips are for what is typed.
    Once one holds a value, or a section or menu is up, they stay.
  */
  const open =
    hasText ||
    anyMenuOpen ||
    notesOpen ||
    subtasksOpen ||
    durationOpen ||
    dueOpen ||
    draftHasExtras(draft);

  const assignees = people.filter((person) =>
    draft.assigneeIds.includes(person.id)
  );
  const pickedList = draft.listId
    ? (lists.find((list) => list.id === draft.listId) ?? null)
    : null;
  const targetList = pickedList ?? defaultList;
  const targetIconId = resolveListIconId(targetList?.emoji);

  /**
   * Put the row away: what the chips held goes, and the row is a plain
   * box again. Only ever with no title typed — a title is work, and a
   * stray click must not lose it.
   */
  const dismiss = React.useCallback(() => {
    onDraftChange(EMPTY_TASK_DRAFT);
    setPendingSubtask("");
    setNotesOpen(false);
    setNotesWait(false);
    setSubtasksOpen(false);
    setDurationOpen(false);
    setDueOpen(false);
    setAssignOpen(false);
    setListOpen(false);
    setSubtaskAssignKey(null);
  }, []);

  /* A click anywhere else, with nothing typed, puts the row away. The
     pickers live in portals outside the row; a click in one is not
     "elsewhere". */
  React.useEffect(() => {
    if (!open || hasText) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target)) return;
      if (
        (target as Element).closest?.(
          ".todo-menu-portal-root, .assign-menu-portal-root"
        )
      ) {
        return;
      }
      dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, hasText, dismiss]);

  /* Focus follows a section the moment it opens. */
  React.useEffect(() => {
    if (subtasksOpen) newSubtaskRef.current?.focus();
  }, [subtasksOpen]);

  /* The list menu closes on a click anywhere else, or on Escape. */
  React.useEffect(() => {
    if (!listOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (listRef.current?.contains(event.target as Node)) return;
      setListOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setListOpen(false);
        listRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [listOpen]);

  /*
    A picker hands the caret back to its own chip, not to the title: Tab
    then carries on to the next chip, so a task can be dressed from the
    keyboard in one pass. Cmd+Enter adds it from anywhere in the row.
  */
  function closeAssign() {
    setAssignOpen(false);
    assignRef.current?.focus();
  }

  function closeSubtaskAssign() {
    const key = subtaskAssignKey;
    setSubtaskAssignKey(null);
    if (key) subtaskRefs.current.get(key)?.focus();
  }

  function submit() {
    /*
      The note as the editor holds it, read from the editor itself: a
      picture that has just finished uploading may not have reached the
      draft through React yet, and a task added from the draft alone would
      go without it. And not at all while one is still uploading — it has
      nowhere to land once the row is cleared.
    */
    const notes = notesOpen
      ? (notesReadCurrent.current?.() ?? draft.notes)
      : draft.notes;
    if (notesUploading.current > 0 || pendingAttachments(notes) > 0) {
      setNotesOpen(true);
      setNotesWait(true);
      return;
    }
    setNotesWait(false);
    const base: TaskDraft = { ...draft, notes };
    const pending = pendingSubtask.trim();
    const final: TaskDraft = pending
      ? {
          ...base,
          subtasks: [
            ...base.subtasks,
            { key: newDraftKey(), text: pending, assigneeIds: [] },
          ],
        }
      : base;
    if (!final.text.trim()) return;
    setPendingSubtask("");
    setDurationOpen(false);
    setDueOpen(false);
    setNotesOpen(false);
    setSubtasksOpen(false);
    setAssignOpen(false);
    setListOpen(false);
    setSubtaskAssignKey(null);
    onDraftChange(EMPTY_TASK_DRAFT);
    onSubmit(final);
    textRef.current?.focus();
  }

  /* ----------------------------------------------------------- duration */

  const durationMinutes = hasDuration
    ? Number.parseInt(draft.duration, 10) || null
    : null;

  function closeDuration() {
    setDurationOpen(false);
    durationChipRef.current?.focus();
  }

  function closeDue() {
    setDueOpen(false);
    dueChipRef.current?.focus();
  }

  /* ----------------------------------------------------------- subtasks */

  function updateSubtask(key: string, fields: Partial<SubtaskDraft>) {
    onDraftChange((current) => ({
      ...current,
      subtasks: current.subtasks.map((row) =>
        row.key === key ? { ...row, ...fields } : row
      ),
    }));
  }

  function removeSubtask(key: string) {
    const index = draft.subtasks.findIndex((row) => row.key === key);
    onDraftChange((current) => ({
      ...current,
      subtasks: current.subtasks.filter((row) => row.key !== key),
    }));
    const previous = draft.subtasks[index - 1];
    if (previous) subtaskRefs.current.get(previous.key)?.focus();
    else textRef.current?.focus();
  }

  /** Enter on the new row: keep it, and start the next. */
  function commitPendingSubtask() {
    const text = pendingSubtask.trim();
    if (!text) return;
    onDraftChange((current) => ({
      ...current,
      subtasks: [
        ...current.subtasks,
        { key: newDraftKey(), text, assigneeIds: [] },
      ],
    }));
    setPendingSubtask("");
  }

  const subtaskCount =
    draft.subtasks.length + (pendingSubtask.trim() ? 1 : 0);

  /* --------------------------------------------------------------- chips */

  const assignChip = (
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

  const dueChip = (
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

  const durationChip = (
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

  const notesChip = (
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

  const subtasksChip = (
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

  const listChip = (
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
          onClose={() => {
            setListOpen(false);
            listRef.current?.focus();
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

  /* ------------------------------------------------------------ sections */

  /*
    The note is written in the editor a task's own note uses.

    It was a plain text box, so a picture pasted into a task being added
    had nowhere to go, and the note had to be opened again after the task
    was made before a picture would take. The editor uploads a picture the
    way the task's note does, for the list the task will go on.

    Cmd+Enter adds the task through the row's own key handler, so the
    editor is given no Done of its own: two would add the task twice.
  */
  const notesSection = notesOpen ? (
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

  function renderSubtaskAssign(row: SubtaskDraft) {
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

  const subtasksSection = subtasksOpen ? (
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
          {assignEnabled ? renderSubtaskAssign(row) : null}
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
              else submit();
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

  return (
    <div
      ref={wrapperRef}
      className={`input-wrapper task-composer${open ? " is-open" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
        /*
          Tab walks the row itself: title, chips, then whatever section is
          open. At either end the row lets go and the page carries on.
          Left and Right step between the chips, and stay the text's own
          in the title and in a step being typed.
        */
        if (walkArrowStops(e, wrapperRef.current, { wrap: true })) return;
        walkTabStops(e, wrapperRef.current);
      }}
    >
      <div className="composer-main">
        <input
          ref={textRef}
          type="text"
          id={inputId}
          className="task-composer-input"
          placeholder={placeholder}
          maxLength={100}
          value={draft.text}
          onChange={(e) => patch({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            // Escape in an empty title puts the row away, values and all.
            if (e.key === "Escape" && !hasText && open) {
              e.preventDefault();
              dismiss();
            }
          }}
        />
        <button
          type="button"
          className={`add-task-btn${hasText ? "" : " hidden"}`}
          disabled={!hasText}
          // Not a Tab stop: Tab goes from the title straight to the chips,
          // and Enter in the title or Cmd+Enter anywhere adds the task.
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={submit}
        >
          {addLabel}
        </button>
      </div>
      {open ? (
        <div className="composer-chips">
          {assignEnabled ? assignChip : null}
          {dueChip}
          {durationChip}
          {notesChip}
          {/* A task on no list has no server row for a step to hang from. */}
          {targetList ? subtasksChip : null}
          {listChip}
        </div>
      ) : null}
      {notesSection}
      {subtasksSection}
    </div>
  );
}
