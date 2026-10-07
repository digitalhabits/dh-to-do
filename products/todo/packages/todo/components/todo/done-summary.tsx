"use client";

/**
 * The Done row: how much was done in a day, a week, a month or ever, as a
 * count and the time spent, with a sparkline that splits the period into its
 * parts (the hours of today, the days of the week, the days of the month,
 * the months since the first task). The part now is teal; parts still to
 * come are faint stubs. And the pile's top edge, which can be dragged to
 * make the pile taller or shorter.
 *
 * The period and the height are this device's choices, kept in localStorage.
 * The list under the summary is the whole pile, as before.
 */

import * as React from "react";

import { fillText } from "@/lib/todo/i18n";
import { timeSpentLabel } from "@/lib/todo/task-helpers";
import type { TodoTask } from "@/lib/todo/types";

export type DonePeriod = "day" | "week" | "month" | "all";
const PERIODS: DonePeriod[] = ["day", "week", "month", "all"];
const PERIOD_KEY = "redd-do-done-period";
const HEIGHT_KEY = "redd-do-done-height";
export const DONE_DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;

type Bar = {
  key: string;
  label: string;
  count: number;
  seconds: number;
  current: boolean;
  /** A part of the period still to come: a faint stub. */
  future: boolean;
};
type Stats = { count: number; seconds: number; bars: Bar[]; from: string; to: string };
type T = (key: string) => string;

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private window: the choice lasts this visit */
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday of the week the day is in. */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function locale(lang: string): string {
  return lang === "da" ? "da-DK" : "en-GB";
}

type Slot = { start: Date; end: Date; label: string };

function fmt(lang: string, opts: Intl.DateTimeFormatOptions, d: Date): string {
  return new Intl.DateTimeFormat(locale(lang), opts).format(d);
}

/** The hours of today, from 8:00 to 22:00, and wider when tasks were done outside them. */
function hourSlots(now: Date, times: Date[]): Slot[] {
  const day = startOfDay(now);
  const today = times.filter((d) => d >= day && d.getTime() < day.getTime() + 86400_000).map((d) => d.getHours());
  const first = Math.min(8, ...today);
  const last = Math.max(22, ...today);
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), first + i);
    return { start, end: new Date(start.getTime() + 3600_000), label: `${first + i}:00` };
  });
}

function daySlots(first: Date, days: number, label: (d: Date) => string): Slot[] {
  return Array.from({ length: days }, (_, i) => {
    const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return { start, end, label: label(start) };
  });
}

/** The months since the first task was done, this one last; at most two years. */
function monthSlots(now: Date, times: Date[], lang: string): Slot[] {
  const earliest = times.reduce((min, d) => (d < min ? d : min), now);
  const span = (now.getFullYear() - earliest.getFullYear()) * 12 + now.getMonth() - earliest.getMonth();
  const months = Math.min(24, Math.max(1, span + 1));
  return Array.from({ length: months }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
    return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1), label: fmt(lang, { month: "short" }, start) };
  });
}

/** The parts a period is broken into, oldest first. */
function slots(period: DonePeriod, now: Date, times: Date[], lang: string): Slot[] {
  if (period === "day") return hourSlots(now, times);
  if (period === "week") return daySlots(startOfWeek(now), 7, (d) => fmt(lang, { weekday: "short" }, d));
  if (period === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return daySlots(first, days, (d) => fmt(lang, { day: "numeric", month: "short" }, d));
  }
  return monthSlots(now, times, lang);
}

/** When the period began: none for All. */
function periodStart(period: DonePeriod, now: Date): Date | null {
  if (period === "day") return startOfDay(now);
  if (period === "week") return startOfWeek(now);
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

export function doneStats(tasks: TodoTask[], period: DonePeriod, now: Date, lang: string): Stats {
  const from = periodStart(period, now);
  const done = tasks
    .map((task) => ({ task, at: task.completedAt ? new Date(task.completedAt) : null }))
    .filter((d): d is { task: TodoTask; at: Date } => d.at !== null && !Number.isNaN(d.at.getTime()));
  const seconds = (list: typeof done) => list.reduce((sum, { task }) => sum + (task.timeSpentSeconds || 0), 0);
  const inPeriod = done.filter(({ at }) => !from || at >= from);
  const parts = slots(period, now, done.map(({ at }) => at), lang);
  const bars = parts.map((slot) => {
    const hits = done.filter(({ at }) => at >= slot.start && at < slot.end);
    return {
      key: slot.start.toISOString(),
      label: slot.label,
      count: hits.length,
      seconds: seconds(hits),
      current: now >= slot.start && now < slot.end,
      future: slot.start > now,
    };
  });
  return {
    count: inPeriod.length,
    seconds: seconds(inPeriod),
    bars,
    from: parts[0]?.label ?? "",
    to: parts[parts.length - 1]?.label ?? "",
  };
}

function usePeriod(): [DonePeriod, (p: DonePeriod) => void] {
  const [period, setPeriod] = React.useState<DonePeriod>(() => {
    const saved = typeof window === "undefined" ? null : readPref(PERIOD_KEY);
    return PERIODS.includes(saved as DonePeriod) ? (saved as DonePeriod) : "week";
  });
  const pick = React.useCallback((p: DonePeriod) => {
    setPeriod(p);
    writePref(PERIOD_KEY, p);
  }, []);
  return [period, pick];
}

function PeriodSwitch({ period, onPick, t }: { period: DonePeriod; onPick: (p: DonePeriod) => void; t: T }) {
  return (
    <div className="done-period-switch" role="group" aria-label={t("donePeriod")}>
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={period === p}
          className={period === p ? "is-on" : undefined}
          onClick={() => onPick(p)}
        >
          {t(`donePeriod_${p}`)}
        </button>
      ))}
    </div>
  );
}

/** The period, part by part: 18px tall, the height a part's count, now in teal. */
function Sparkline({ stats, t }: { stats: Stats; t: T }) {
  const most = Math.max(1, ...stats.bars.map((b) => b.count));
  const time = (s: number) => (s > 0 ? ` · ${timeSpentLabel(s, t("minutes"), t("hoursShort"))}` : "");
  const tip = (bar: Bar) =>
    `${bar.label}: ${fillText(t(bar.count === 1 ? "doneTasksOne" : "doneTasksMany"), { count: bar.count })}${time(bar.seconds)}`;
  return (
    <div className="done-sparkline">
      <div className={`done-spark-bars${stats.bars.length > 16 ? " is-dense" : ""}`}>
        {stats.bars.map((bar) => (
          <span
            key={bar.key}
            className={`done-spark-bar${bar.current ? " is-current" : ""}${bar.future ? " is-future" : ""}${bar.count ? "" : " is-empty"}`}
            style={bar.count ? { height: `${Math.max(25, (bar.count / most) * 100)}%` } : undefined}
            title={bar.future ? bar.label : tip(bar)}
          />
        ))}
      </div>
      <div className="done-spark-ends" aria-hidden>
        <span>{stats.from}</span>
        <span>{stats.to}</span>
      </div>
    </div>
  );
}

/** The switcher, the count, the time and the sparkline, on the Done row. */
export function DoneSummary({ tasks, lang, t }: { tasks: TodoTask[]; lang: string; t: T }) {
  const [period, setPeriod] = usePeriod();
  const stats = React.useMemo(() => doneStats(tasks, period, new Date(), lang), [tasks, period, lang]);
  return (
    <div className="done-overview">
      <PeriodSwitch period={period} onPick={setPeriod} t={t} />
      <span className="done-overview-count">
        {fillText(t(stats.count === 1 ? "doneTasksOne" : "doneTasksMany"), { count: stats.count })}
      </span>
      {stats.seconds > 0 ? (
        <span className="done-overview-time">{timeSpentLabel(stats.seconds, t("minutes"), t("hoursShort"))}</span>
      ) : null}
      <Sparkline stats={stats} t={t} />
    </div>
  );
}

/** The pile's height, and a setter that keeps it for the next visit. */
export function useDoneHeight(): [number, (h: number, keep: boolean) => void] {
  const [height, setHeight] = React.useState<number>(() => {
    const saved = typeof window === "undefined" ? NaN : Number(readPref(HEIGHT_KEY));
    return Number.isFinite(saved) && saved >= MIN_HEIGHT ? saved : DONE_DEFAULT_HEIGHT;
  });
  const set = React.useCallback((h: number, keep: boolean) => {
    setHeight(h);
    if (keep) writePref(HEIGHT_KEY, String(Math.round(h)));
  }, []);
  return [height, set];
}

/**
 * The top edge of the pile. Dragged up, the pile grows and the open tasks
 * above have less room; down, it shrinks. Never under MIN_HEIGHT, and never
 * so tall that the open tasks are gone: it stops at four fifths of the
 * column it is in. A double click puts it back to the usual height.
 */
export function DoneResizer({ height, onChange, t }: { height: number; onChange: (h: number, keep: boolean) => void; t: T }) {
  const [dragging, setDragging] = React.useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const column = handle.closest(".done-container")?.parentElement;
    const max = Math.max(MIN_HEIGHT, (column?.getBoundingClientRect().height ?? 800) * 0.8);
    const startY = e.clientY;
    const startH = height;
    const clamp = (h: number) => Math.min(max, Math.max(MIN_HEIGHT, h));
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => onChange(clamp(startH + (startY - ev.clientY)), false);
    const up = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragging(false);
      onChange(clamp(startH + (startY - ev.clientY)), true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  return (
    <div
      className={`done-resizer${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      title={t("doneResize")}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(DONE_DEFAULT_HEIGHT, true)}
    />
  );
}

/** The pile's box, at the height the reader left it, with its top edge to drag. */
export function DoneBox({
  collapsed,
  t,
  children,
}: {
  collapsed: boolean;
  t: T;
  children: React.ReactNode;
}) {
  const [height, setHeight] = useDoneHeight();
  return (
    <div
      className={`done-container ${collapsed ? "collapsed" : ""}`}
      id="done-container"
      style={{
        display: "flex",
        // Collapsed, the box holds the heading row alone and takes
        // the height that row needs (see .done-container.collapsed
        // in todo-shell.css). No cap, so nothing is cut off.
        maxHeight: collapsed ? undefined : height,
        position: "relative",
      }}
    >
      {collapsed ? null : <DoneResizer height={height} onChange={setHeight} t={t} />}
      {children}
    </div>
  );
}
