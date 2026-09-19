"use client";

/**
 * A quiet note over the add-task box: "this list is long, try Board View".
 *
 * It shows one time, to a reader who has Board View off, when a task they
 * add makes more than eight open tasks in the list on the screen. The
 * reader says yes or no, and it does not come again. Nothing about the
 * tasks changes either way: Board View shows the same tasks in columns.
 */

import * as React from "react";

import type { TodoLang } from "@/lib/todo/i18n";

/** More open tasks than this in one list, and the note is offered. */
export const BOARD_NUDGE_OVER = 8;
/** Set when the reader has seen the note, whatever they said. Per device. */
export const BOARD_NUDGE_SEEN_KEY = "redd-plan-todo-board-nudge-seen";

const COUNT_WORDS: Record<TodoLang, Record<number, string>> = {
  en: { 9: "Nine", 10: "Ten", 11: "Eleven", 12: "Twelve" },
  da: { 9: "Ni", 10: "Ti", 11: "Elleve", 12: "Tolv" },
};

/** "Nine" for 9, and the number itself for a count with no short word. */
export function boardNudgeCount(count: number, lang: TodoLang): string {
  return COUNT_WORDS[lang]?.[count] ?? String(count);
}

/**
 * Whether the note is due. `added` is true when the reader added a task a
 * moment ago: the note answers that act, and does not come up by itself.
 */
export function boardNudgeIsDue(input: {
  added: boolean;
  boardViewOn: boolean;
  seen: boolean;
  openTasksInList: number;
}): boolean {
  return (
    input.added &&
    !input.boardViewOn &&
    !input.seen &&
    input.openTasksInList > BOARD_NUDGE_OVER
  );
}

/** Three columns of cards, one of them in the accent colour. */
function BoardPicture() {
  const card = (x: number, y: number, accent = false) => (
    <rect
      x={x}
      y={y}
      width="20"
      height="11"
      rx="2.5"
      fill={accent ? "rgba(42, 157, 143, 0.22)" : "none"}
      stroke={accent ? "var(--accent-primary, #2a9d8f)" : "currentColor"}
    />
  );
  return (
    <svg
      className="board-nudge-picture"
      width="104"
      height="72"
      viewBox="0 0 104 72"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="30" height="64" rx="4" />
      <rect x="37" y="4" width="30" height="64" rx="4" />
      <rect x="72" y="4" width="30" height="64" rx="4" />
      {card(7, 16)}
      {card(7, 31)}
      {card(42, 16)}
      {card(42, 31, true)}
      {card(77, 16)}
      {card(77, 31)}
      {card(77, 46)}
    </svg>
  );
}

export function BoardViewNudge({
  count,
  lang,
  t,
  onTry,
  onDecline,
}: {
  /** The open tasks in the list on the screen. */
  count: number;
  lang: TodoLang;
  t: (key: string) => string;
  onTry: () => void;
  onDecline: () => void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Escape, or a press anywhere else, is "no thanks": the note must not stay
  // in the way of the list.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDecline();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDecline();
    };
    window.addEventListener("keydown", onKey);
    // After this press: the press that added the task must not close it.
    const id = window.setTimeout(
      () => document.addEventListener("pointerdown", onPointerDown),
      0,
    );
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onDecline]);

  return (
    <div ref={ref} className="board-nudge" role="dialog" aria-labelledby="board-nudge-title">
      <BoardPicture />
      <div className="board-nudge-copy">
        <h3 id="board-nudge-title" className="board-nudge-title">
          {t("boardNudgeTitle").replace("{count}", boardNudgeCount(count, lang))}
        </h3>
        <p className="board-nudge-body">{t("boardNudgeBody")}</p>
        <div className="board-nudge-actions">
          <button type="button" className="board-nudge-try" onClick={onTry}>
            {t("boardNudgeTry")}
          </button>
          <button type="button" className="board-nudge-no" onClick={onDecline}>
            {t("boardNudgeNo")}
          </button>
        </div>
      </div>
    </div>
  );
}
