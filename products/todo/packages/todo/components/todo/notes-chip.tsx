"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";

import { MenuPortal } from "@/components/todo/MenuPortal";
import { notesParagraphs } from "@/lib/todo/notes-text";

/** How long the pointer rests on the chip before the note shows. */
const PEEK_MS = 300;
/** How long the peek waits, once the pointer leaves, for it to come onto
    the peek (or back to the chip) across the gap between them. */
const LEAVE_MS = 200;

/**
 * "Notes ▾": a note, on the Today session's task in hand and its steps.
 * Resting the pointer on it shows the note in a popover, moving nothing,
 * which stays while the pointer is on it; a click on either opens the note
 * in place to read or change ("Notes ▴"), and again puts it away.
 */
export function NotesChip({
  html,
  open,
  onToggle,
  t,
  className = "",
}: {
  html: string;
  /** Whether the note is open in place. */
  open: boolean;
  onToggle: () => void;
  t: (key: string) => string;
  className?: string;
}) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const timer = React.useRef<number | undefined>(undefined);
  const [peek, setPeek] = React.useState(false);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  const stop = () => {
    window.clearTimeout(timer.current);
    setPeek(false);
  };
  const stay = () => window.clearTimeout(timer.current);
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(false), LEAVE_MS);
  };
  const paragraphs = peek ? notesParagraphs(html) : [];
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`notes-chip${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
        aria-expanded={open}
        onMouseEnter={() => {
          window.clearTimeout(timer.current);
          if (!peek) timer.current = window.setTimeout(() => setPeek(true), PEEK_MS);
        }}
        onMouseLeave={leave}
        onClick={(e) => {
          e.stopPropagation();
          stop();
          onToggle();
        }}
      >
        <Pencil size={13} strokeWidth={2} aria-hidden />
        {t("fieldNotes")}
        {open ? <ChevronUp size={13} strokeWidth={2.25} aria-hidden /> : <ChevronDown size={13} strokeWidth={2.25} aria-hidden />}
      </button>
      <MenuPortal
        open={peek && !open && paragraphs.length > 0}
        anchorEl={peek ? buttonRef.current : null}
        className="notes-peek"
        role="tooltip"
      >
        <div
          className="notes-peek-body"
          onMouseEnter={stay}
          onMouseLeave={leave}
          onClick={() => {
            stop();
            onToggle();
          }}
        >
          {paragraphs.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          <p className="notes-peek-hint">{t("notesPeekHint")}</p>
        </div>
      </MenuPortal>
    </>
  );
}
