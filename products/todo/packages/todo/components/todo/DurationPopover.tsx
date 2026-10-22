"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { MenuPortal } from "@/components/todo/MenuPortal";
import {
  DURATION_PRESETS,
  formatDurationShort,
  parseDurationText,
} from "@/lib/todo/duration";
import { markWalked, walkTabStops } from "@/lib/todo/focus-walk";

/** The presets stand in a grid this many wide. Up and Down jump a row. */
const PRESET_COLUMNS = 2;

/**
 * The duration picker (design "7a"): four presets for most tasks, and a
 * field under them that takes anything ("45", "1.5h") for the rest.
 * Enter commits the field, Escape closes. With a value set, a quiet
 * "Remove estimate" row sits at the foot: one popover for set, change
 * and clear. The same popover serves the add row and the card's chip.
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
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  /** The value the field starts with. */
  minutes: number | null;
  /** A number of minutes, or null from the Remove row. */
  onPick: (minutes: number | null) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const presetRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [text, setText] = React.useState("");
  const minuteUnit = t("minutes");
  const hourUnit = t("hoursShort");

  /* A fresh field each time it opens, holding what the task has now. */
  React.useEffect(() => {
    if (!open) return;
    setText(minutes == null ? "" : formatDurationShort(minutes, minuteUnit, hourUnit));
    const at = minutes == null ? 0 : DURATION_PRESETS.indexOf(minutes as never);
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
    const last = DURATION_PRESETS.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(last, index + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (e.key === "ArrowUp") next = Math.max(0, index - PRESET_COLUMNS);
    else if (e.key === "ArrowDown") {
      if (index + PRESET_COLUMNS > last) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      next = index + PRESET_COLUMNS;
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
    if (parsed == null) return;
    onPick(parsed);
  }

  return (
    <MenuPortal
      open={open}
      anchorEl={open ? anchorEl : null}
      className="duration-popover"
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
      <div
        className="duration-popover-presets"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {DURATION_PRESETS.map((preset, index) => (
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
      <div className="duration-popover-field">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className="duration-popover-input"
          aria-label={t("fieldDuration")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              focusPreset(DURATION_PRESETS.length - PRESET_COLUMNS);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <span className="duration-popover-hint" aria-hidden>
          — {t("durationHint")}
        </span>
      </div>
      {minutes != null ? (
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
