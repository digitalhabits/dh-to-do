"use client";

import {
  composerAssignChip,
  composerDueChip,
  composerDurationChip,
  composerListChip,
  composerNotesChip,
  composerNotesSection,
  composerSubtasksChip,
  composerSubtasksSection,
  keepFocus,
} from "@/components/todo/add-task-composer-parts";
import {
  type AddTaskComposerProps,
  useAddTaskComposer,
} from "@/components/todo/use-add-task-composer";
import { walkArrowStops, walkTabStops } from "@/lib/todo/focus-walk";

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
export function AddTaskComposer(props: AddTaskComposerProps) {
  const c = useAddTaskComposer(props);
  const {
    inputId,
    placeholder,
    addLabel,
    assignEnabled,
    textRef,
    wrapperRef,
    draft,
    patch,
    hasText,
    open,
    targetList,
    dismiss,
    submit,
  } = c;

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
            // Cmd+Enter is the row's own key (see the row's onKeyDown). Taken
            // here as well, it added the task twice.
            if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) submit();
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
          {assignEnabled ? composerAssignChip(c) : null}
          {composerDueChip(c)}
          {composerDurationChip(c)}
          {composerNotesChip(c)}
          {/* A task on no list has no server row for a step to hang from. */}
          {targetList ? composerSubtasksChip(c) : null}
          {composerListChip(c)}
        </div>
      ) : null}
      {composerNotesSection(c)}
      {composerSubtasksSection(c)}
    </div>
  );
}
