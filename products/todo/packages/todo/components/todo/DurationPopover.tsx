"use client";

import * as React from "react";
import { Trash2, X } from "lucide-react";

import { MenuPortal } from "@/components/todo/MenuPortal";
import {
  formatDurationLong,
  formatDurationShort,
  parseDurationText,
} from "@/lib/todo/duration";
import { markWalked, walkTabStops } from "@/lib/todo/focus-walk";

/** Six presets, as pills; Up and Down jump a row of this many. */
const PRESETS: readonly number[] = [5, 15, 25, 45, 60, 120];
const COLUMNS = 3;

/**
 * The duration picker: six presets as pills, and a "Custom" box under them
 * that takes anything ("45", "1.5h"), with Set. Enter commits the box,
 * Escape closes, and so does the x in the corner. Where a value has no x
 * of its own, a quiet "Remove estimate" row sits at the foot. The same
 * popover serves the add row, task details and a step's duration.
 *
 * From the keyboard it opens on a preset — the task's own, or 15m — so
 * Enter alone sets the common case. The arrows walk the grid, Down from
 * its last row goes to the field and Up comes back, and a digit typed on
 * a preset goes into the field. A value that is no preset opens in the
 * field, ready to change.
 */
export function DurationPopover({
  open,
  anchorEl,
  minutes,
  onPick,
  onClose,
  t,
  removeRow = false,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  /** The value the field starts with. */
  minutes: number | null;
  /** A number of minutes, or null from the Remove row. */
  onPick: (minutes: number | null) => void;
  onClose: () => void;
  t: (key: string) => string;
  /** The "Remove estimate" row, for a value with no × of its own to clear it. */
  removeRow?: boolean;
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const presetRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [text, setText] = React.useState("");
  /* Enter on words it cannot read marks the box red and shows a hint.
     Typing again takes both away. */
  const [unread, setUnread] = React.useState(false);
  const read = text.trim() ? parseDurationText(text) : null;
  const minuteUnit = t("minutes");
  const hourUnit = t("hoursShort");

  /* A fresh field each time it opens, holding what the task has now. */
  React.useEffect(() => {
    if (!open) return;
    setText(minutes == null ? "" : formatDurationShort(minutes, minuteUnit, hourUnit));
    setUnread(false);
    const at = minutes == null ? Math.max(0, PRESETS.indexOf(15)) : PRESETS.indexOf(minutes as number);
    const frame = requestAnimationFrame(() => {
      if (at === -1) {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        focusPreset(at);
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* A click anywhere else puts it away. MenuPortal swallows its own. */
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (anchorEl?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, anchorEl, onClose]);

  /** WebKit shows no ring for a focus a script moved: mark it. */
  function focusPreset(index: number) {
    const el = presetRefs.current[index];
    if (!el) return;
    el.focus();
    markWalked(el);
  }

  function onPresetKey(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = PRESETS.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(last, index + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (e.key === "ArrowUp") next = Math.max(0, index - COLUMNS);
    else if (e.key === "ArrowDown") {
      if (index + COLUMNS > last) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      next = index + COLUMNS;
    } else if (/^[0-9.,]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // The number goes into the field: the key lands where the caret now is.
      setText("");
      inputRef.current?.focus();
      return;
    }
    if (next == null) return;
    e.preventDefault();
    focusPreset(next);
  }

  function commitText() {
    const parsed = parseDurationText(text);
    if (parsed == null) {
      if (text.trim()) setUnread(true);
      return;
    }
    onPick(parsed);
  }

  const input = (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      className="duration-popover-input"
      aria-label={t("fieldDuration")}
      placeholder={t("durationCustom")}
      value={text}
      aria-invalid={unread || undefined}
      aria-describedby={unread ? "duration-popover-try" : undefined}
      onChange={(e) => {
        setText(e.target.value);
        setUnread(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitText();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          focusPreset(Math.max(0, PRESETS.length - COLUMNS));
        } else if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    />
  );

  return (
    <MenuPortal
      open={open}
      anchorEl={open ? anchorEl : null}
      className="duration-popover is-pills"
      role="dialog"
      ariaLabel={t("fieldDuration")}
    >
      <div
        ref={rootRef}
        onKeyDown={(e) => {
          // Tab stays in the popover: WebKit would take it to the next
          // text box on the page (see focus-walk).
          walkTabStops(e, rootRef.current, { wrap: true });
        }}
      >
      {/* No title: the chip it opens from says what it is for. */}
      <button
        type="button"
        className="duration-popover-close"
        aria-label={t("close")}
        title={t("close")}
        onClick={onClose}
      >
        <X size={16} strokeWidth={2} aria-hidden />
      </button>
      <div
        className="duration-popover-presets"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {PRESETS.map((preset, index) => (
          <button
            key={preset}
            ref={(el) => {
              presetRefs.current[index] = el;
            }}
            type="button"
            className={`duration-popover-preset${
              minutes === preset ? " is-current" : ""
            }`}
            onClick={() => onPick(preset)}
            onKeyDown={(e) => onPresetKey(e, index)}
          >
            {formatDurationShort(preset, minuteUnit, hourUnit)}
          </button>
        ))}
      </div>
      <div className={`duration-popover-field${unread ? " is-unread" : ""}`}>
        <span className="duration-popover-box">
          {input}
          {read != null ? (
            <span className="duration-popover-read" aria-live="polite">
              = {formatDurationLong(read, hourUnit)}
            </span>
          ) : null}
        </span>
        {/* Set does what Enter does; it waits until the words can be read. */}
        <button
          type="button"
          className="duration-popover-set"
          disabled={read == null}
          onClick={commitText}
        >
          {t("durationSet")}
        </button>
      </div>
      {unread ? (
        <p id="duration-popover-try" className="duration-popover-try" role="alert">
          {t("durationTry")}
        </p>
      ) : null}
      {minutes != null && removeRow ? (
        <button
          type="button"
          className="popover-remove-row"
          onClick={() => onPick(null)}
        >
          <Trash2 size={14} strokeWidth={2} aria-hidden />
          {t("removeEstimate")}
        </button>
      ) : null}
      </div>
    </MenuPortal>
  );
}
