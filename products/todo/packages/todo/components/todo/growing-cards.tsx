"use client";

import * as React from "react";

import { renderTask } from "@/components/todo/todo-task-card";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { scrollParent } from "@/lib/todo/hover-nudge";
import type { TodoTask } from "@/lib/todo/types";

/** Cards drawn at first, and added each time the end comes near. */
const STEP = 40;
/** A card's height, near enough, for the room kept for the ones not drawn yet. */
const CARD_GUESS_PX = 90;

/**
 * A column's cards, drawn as they come near the screen.
 *
 * A board of 600 tasks was 23,000 elements on the page, and every change
 * to it (opening details, moving the divider, a switch of people) made the
 * browser restyle and lay out all of them, though some 20 cards can be
 * seen. So a column draws its first cards, keeps room for the rest (the
 * scrollbar stays true), and draws more as that room comes within 800px
 * of view. The card open in details, or carried, is drawn wherever it is.
 *
 * Without IntersectionObserver (the tests' page) every card is drawn.
 */
export function GrowingCards({ m, tasks }: { m: TodoPageModel; tasks: TodoTask[] }) {
  const [limit, setLimit] = React.useState(() =>
    typeof IntersectionObserver === "undefined" ? Infinity : STEP
  );
  const roomRef = React.useRef<HTMLDivElement | null>(null);
  // The open card and the carried one are drawn wherever they are.
  const keep = Math.max(
    tasks.findIndex((task) => task.id === m.openNotesTaskId),
    tasks.findIndex((task) => task.id === m.draggingTaskId)
  );
  const drawn = Math.min(tasks.length, Math.max(limit, keep + 1));
  const rest = tasks.length - drawn;

  React.useEffect(() => {
    const room = roomRef.current;
    if (!room || rest <= 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLimit(drawn + STEP);
      },
      { root: scrollParent(room), rootMargin: "800px 0px" }
    );
    observer.observe(room);
    return () => observer.disconnect();
  }, [rest, drawn]);

  return (
    <>
      {tasks.slice(0, drawn).map((task) => renderTask(m, task))}
      {rest > 0 ? (
        <div
          ref={roomRef}
          className="cards-not-drawn"
          aria-hidden
          style={{ height: rest * CARD_GUESS_PX }}
        />
      ) : null}
    </>
  );
}
