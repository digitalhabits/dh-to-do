"use client";

import * as React from "react";

/** The undo toast's offer: what it says, and what Undo does. */
export type UndoState = { message: string; restore: () => void } | null;

/**
 * What can be taken back: the toast's offer, and the last change Cmd+Z
 * takes back.
 *
 * The toast is a six-second offer beside a delete; the key is the same
 * offer under a key, and it outlives the toast. Ticking a task off
 * registers with the key alone — the flight to Done already says what
 * happened, and Cmd+Z is how it is taken back.
 */
export function useUndoState() {
  const [undoState, setUndoState] = React.useState<UndoState>(null);
  const undoTimer = React.useRef<number | null>(null);
  /** The last thing Cmd+Z takes back. */
  const lastUndoRef = React.useRef<(() => void) | null>(null);

  function registerUndo(restore: () => void) {
    lastUndoRef.current = restore;
  }

  function showUndo(message: string, restore: () => void) {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndoState({ message, restore });
    registerUndo(restore);
    undoTimer.current = window.setTimeout(() => setUndoState(null), 6000);
  }

  return { undoState, setUndoState, undoTimer, lastUndoRef, registerUndo, showUndo };
}

/**
 * Cmd+Z takes back the last change. A box being typed in keeps its own
 * undo: there the key belongs to the words, not to the board.
 *
 * Its own hook, apart from the state, so the page can bind it where it
 * always did: after the key handlers bound before it.
 */
export function useUndoKey({
  lastUndoRef,
  undoTimer,
  setUndoState,
}: {
  lastUndoRef: React.MutableRefObject<(() => void) | null>;
  undoTimer: React.MutableRefObject<number | null>;
  setUndoState: React.Dispatch<React.SetStateAction<UndoState>>;
}) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      if (event.key !== "z" && event.key !== "Z") return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable ||
          active.closest("trix-editor"))
      ) {
        return;
      }
      const restore = lastUndoRef.current;
      if (!restore) return;
      event.preventDefault();
      lastUndoRef.current = null;
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      setUndoState(null);
      restore();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lastUndoRef, setUndoState, undoTimer]);
}
