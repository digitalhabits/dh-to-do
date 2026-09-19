"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

import { MenuPortal } from "@/components/todo/MenuPortal";
import type { TodoLang } from "@/lib/todo/i18n";
import { dateToDueOn, dueOnToDate, todayDueOn } from "@/lib/todo/task-draft";

function localeOf(lang: TodoLang): string {
  return lang === "da" ? "da-DK" : "en-US";
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Monday of the week the date is in. */
function startOfWeek(date: Date): Date {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

/**
 * The six weeks a month view shows, Monday first, padded with the days of
 * the months either side.
 */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * The due date picker (design "8b"): three preset pills on top, and a
 * mini month under them, so a common pick is one click and a specific one
 * is two. Today is ringed, the chosen day is filled.
 *
 * Keyboard: the arrows walk the days, Page Up and Down turn the month,
 * Enter picks, Escape closes. The same popover serves the add row and the
 * card's chip.
 */
export function DuePopover({
  open,
  anchorEl,
  value,
  onPick,
  onClose,
  calendar,
  lang,
  t,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  /** "YYYY-MM-DD", or null. */
  value: string | null;
  onPick: (dueOn: string | null) => void;
  onClose: () => void;
  /**
   * The "Show on the Calendar" box. Given only when the Calendar view is on:
   * with no calendar there is nothing to show the task on. Ticking it does
   * not close the popover, because the day may still be to pick.
   */
  calendar?: { checked: boolean; onChange: (checked: boolean) => void };
  lang: TodoLang;
  t: (key: string) => string;
}) {
  const locale = localeOf(lang);
  const today = todayDueOn();
  const todayDate = dueOnToDate(today) as Date;
  const selected = value ? dueOnToDate(value) : null;

  /** The day the arrows are on, and the month on show follows it. */
  const [cursor, setCursor] = React.useState<Date>(selected ?? todayDate);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const [focusCursor, setFocusCursor] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCursor(selected ?? todayDate);
    setFocusCursor(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* The caret lands on the cursor's day once the grid is drawn. */
  React.useEffect(() => {
    if (!open || !focusCursor) return;
    const frame = requestAnimationFrame(() => {
      const el = gridRef.current?.querySelector<HTMLButtonElement>(
        `[data-due="${dateToDueOn(cursor)}"]`
      );
      el?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focusCursor, cursor]);

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

  /* The Friday ahead: the end of this week, or of next when the week is
     already past it. */
  const daysToFriday = (5 - todayDate.getDay() + 7) % 7 || 7;
  const friday = addDays(todayDate, daysToFriday);
  // On a Thursday the Friday ahead is tomorrow: one day, offered once,
  // under the name that comes first. Two presets on one day were also two
  // children with one key.
  const presets = [
    { label: t("dueToday"), dueOn: today },
    { label: t("dueTomorrow"), dueOn: dateToDueOn(addDays(todayDate, 1)) },
    {
      label: friday.toLocaleDateString(locale, { weekday: "short" }),
      dueOn: dateToDueOn(friday),
    },
  ].filter(
    (preset, index, all) =>
      all.findIndex((other) => other.dueOn === preset.dueOn) === index
  );

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const days = monthGrid(year, month);
  const weekdayNames = days
    .slice(0, 7)
    .map((d) => d.toLocaleDateString(locale, { weekday: "narrow" }));

  function move(days: number) {
    setCursor((c) => addDays(c, days));
    setFocusCursor(true);
  }
  function turnMonth(step: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + step, 1));
    setFocusCursor(false);
  }
  /* Back to this month, with the caret on today — nothing chosen. */
  const onThisMonth =
    year === todayDate.getFullYear() && month === todayDate.getMonth();
  function showThisMonth() {
    if (onThisMonth) return;
    setCursor(todayDate);
    setFocusCursor(true);
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        move(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-7);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(7);
        break;
      case "PageUp":
        e.preventDefault();
        setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, c.getDate()));
        setFocusCursor(true);
        break;
      case "PageDown":
        e.preventDefault();
        setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, c.getDate()));
        setFocusCursor(true);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      default:
    }
  }

  return (
    <MenuPortal
      open={open}
      anchorEl={open ? anchorEl : null}
      className="due-popover"
      role="dialog"
      ariaLabel={t("fieldDue")}
    >
      <div
        className="due-popover-presets"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {presets.map((preset) => (
          <button
            key={preset.dueOn}
            type="button"
            className={`due-popover-preset${
              value === preset.dueOn ? " is-current" : ""
            }`}
            onClick={() => onPick(preset.dueOn)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="due-popover-head">
        <button
          type="button"
          className="due-popover-turn"
          aria-label={t("duePrevMonth")}
          onClick={() => turnMonth(-1)}
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        </button>
        {/* The month's name, and the way back to this month from any
            other: a due date months off puts the grid there, and the
            Today preset chooses rather than shows. */}
        <button
          type="button"
          className={`due-popover-month${onThisMonth ? "" : " is-away"}`}
          aria-live="polite"
          aria-label={onThisMonth ? undefined : t("dueShowThisMonth")}
          title={onThisMonth ? undefined : t("dueShowThisMonth")}
          disabled={onThisMonth}
          onClick={showThisMonth}
        >
          {new Date(year, month, 1).toLocaleDateString(locale, {
            month: "long",
            year: "numeric",
          })}
        </button>
        <button
          type="button"
          className="due-popover-turn"
          aria-label={t("dueNextMonth")}
          onClick={() => turnMonth(1)}
        >
          <ChevronRight size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <div
        ref={gridRef}
        className="due-popover-grid"
        role="grid"
        onKeyDown={onGridKeyDown}
      >
        {weekdayNames.map((name, i) => (
          <span key={i} className="due-popover-weekday" aria-hidden>
            {name}
          </span>
        ))}
        {days.map((day) => {
          const dueOn = dateToDueOn(day);
          const inMonth = day.getMonth() === month;
          const isCursor = dateToDueOn(cursor) === dueOn;
          return (
            <button
              key={dueOn}
              type="button"
              role="gridcell"
              data-due={dueOn}
              tabIndex={isCursor ? 0 : -1}
              aria-selected={value === dueOn}
              aria-label={day.toLocaleDateString(locale, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              className={`due-popover-day${inMonth ? "" : " is-outside"}${
                dueOn === today ? " is-today" : ""
              }${value === dueOn ? " is-selected" : ""}`}
              onClick={() => onPick(dueOn)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      {calendar ? (
        <label
          className="popover-check-row"
          /* Escape closes from here too, as from the days and the presets.
             Without this the box kept the focus and the popover stayed. */
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
        >
          <input
            type="checkbox"
            checked={calendar.checked}
            onChange={(e) => calendar.onChange(e.target.checked)}
          />
          <span>{t("showOnCalendar")}</span>
        </label>
      ) : null}
      {value ? (
        <button
          type="button"
          className="popover-remove-row"
          onClick={() => onPick(null)}
        >
          <Trash2 size={14} strokeWidth={2} aria-hidden />
          {t("removeDueDate")}
        </button>
      ) : null}
    </MenuPortal>
  );
}
