"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { MenuPortal } from "@/components/todo/MenuPortal";
import {
  DURATION_PRESETS,
  formatDurationShort,
  parseDurationText,
} from "@/lib/todo/duration";

/**
 * The duration picker (design "7a"): four presets for most tasks, and a
 * field under them that takes anything ("45", "1.5h") for the rest.
 * Enter commits the field, Escape closes. With a value set, a quiet
 * "Remove estimate" row sits at the foot: one popover for set, change
 * and clear. The same popover serves the add row and the card's chip.
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
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [text, setText] = React.useState("");
  const minuteUnit = t("minutes");
  const hourUnit = t("hoursShort");

  /* A fresh field each time it opens, holding what the task has now. */
  React.useEffect(() => {
    if (!open) return;
    setText(minutes == null ? "" : formatDurationShort(minutes, minuteUnit, hourUnit));
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
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
        className="duration-popover-presets"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {DURATION_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`duration-popover-preset${
              minutes === preset ? " is-current" : ""
            }`}
            onClick={() => onPick(preset)}
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
    </MenuPortal>
  );
}
