"use client";

/**
 * The switch between the views: Lists, Favourites, Calendar.
 *
 * The reader can put the buttons in the order they like: press a button,
 * move it along the switch, and let go. The order is a setting of this
 * device, kept with the other settings. A view that is off keeps its place
 * in the order, so it comes back where it was.
 *
 * The drag is made from pointer events, as the other drags on the board
 * are. The Mac web view does not give HTML5 drags reliably.
 */

import * as React from "react";

export type TodoViewId = "lists" | "favourites" | "plan";

export type ViewSwitcherItem = {
  id: TodoViewId;
  title: string;
  icon: React.ReactNode;
};

const VIEW_ORDER_KEY = "redd-plan-todo-view-order";
const DEFAULT_ORDER: TodoViewId[] = ["lists", "favourites", "plan"];
/** A press that moves less than this is a click, not a drag. */
const DRAG_START_PX = 4;

/** A saved order, made whole: each view one time, unknown values dropped. */
export function normaliseViewOrder(saved: unknown): TodoViewId[] {
  const known = Array.isArray(saved)
    ? saved.filter((v): v is TodoViewId => DEFAULT_ORDER.includes(v as TodoViewId))
    : [];
  const order = [...new Set(known)];
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  return order;
}

function readOrder(): TodoViewId[] {
  try {
    return normaliseViewOrder(JSON.parse(localStorage.getItem(VIEW_ORDER_KEY) ?? "null"));
  } catch {
    return DEFAULT_ORDER;
  }
}

/**
 * Put `moved` at `index` among the shown views, and keep each view that is
 * not shown directly after the shown view it followed before.
 */
export function moveView(
  order: TodoViewId[],
  shown: TodoViewId[],
  moved: TodoViewId,
  index: number,
): TodoViewId[] {
  const shownNow = order.filter((id) => shown.includes(id) && id !== moved);
  shownNow.splice(Math.max(0, Math.min(index, shownNow.length)), 0, moved);
  const next: TodoViewId[] = [];
  const hiddenAfter = new Map<TodoViewId | null, TodoViewId[]>();
  let last: TodoViewId | null = null;
  for (const id of order) {
    if (shown.includes(id)) last = id;
    else hiddenAfter.set(last, [...(hiddenAfter.get(last) ?? []), id]);
  }
  next.push(...(hiddenAfter.get(null) ?? []));
  for (const id of shownNow) next.push(id, ...(hiddenAfter.get(id) ?? []));
  return next;
}

export function ViewSwitcher({
  items,
  active,
  onSelect,
}: {
  /** The views that are on. Their order here does not matter. */
  items: ViewSwitcherItem[];
  active: TodoViewId;
  onSelect: (id: TodoViewId) => void;
}) {
  const [order, setOrder] = React.useState<TodoViewId[]>(DEFAULT_ORDER);
  const [draggingId, setDraggingId] = React.useState<TodoViewId | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const orderRef = React.useRef(order);
  orderRef.current = order;
  const suppressClickUntil = React.useRef(0);
  const stopDragRef = React.useRef<(() => void) | null>(null);

  // After the first paint, as the other settings are read: the server page
  // and the first client page must be the same.
  React.useEffect(() => setOrder(readOrder()), []);
  React.useEffect(() => () => stopDragRef.current?.(), []);

  const shown = items.map((item) => item.id);
  const shownRef = React.useRef(shown);
  shownRef.current = shown;
  const ordered = order
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is ViewSwitcherItem => Boolean(item));

  function startPress(id: TodoViewId, e: React.PointerEvent) {
    if (e.button !== 0 || shownRef.current.length < 2) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (
          Math.abs(ev.clientX - startX) < DRAG_START_PX &&
          Math.abs(ev.clientY - startY) < DRAG_START_PX
        )
          return;
        started = true;
        setDraggingId(id);
      }
      ev.preventDefault();
      const others = Array.from(
        rowRef.current?.querySelectorAll<HTMLElement>(".view-btn") ?? [],
      ).filter((el) => el.dataset.viewId !== id);
      let index = others.length;
      for (let i = 0; i < others.length; i++) {
        const rect = others[i].getBoundingClientRect();
        if (ev.clientX < rect.left + rect.width / 2) {
          index = i;
          break;
        }
      }
      const next = moveView(orderRef.current, shownRef.current, id, index);
      if (next.some((v, i) => v !== orderRef.current[i])) setOrder(next);
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      stopDragRef.current = null;
      if (!started) return;
      // The release is also a click on the button. It must not change the view.
      suppressClickUntil.current = Date.now() + 250;
      setDraggingId(null);
      try {
        localStorage.setItem(VIEW_ORDER_KEY, JSON.stringify(orderRef.current));
      } catch {
        /* The order holds for this visit. */
      }
    };
    stopDragRef.current?.();
    stopDragRef.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  return (
    <div
      ref={rowRef}
      className={`view-switcher${draggingId ? " is-reordering" : ""}`}
      // A press in the space between two buttons must not move the window.
      data-tauri-drag-region="false"
    >
      {ordered.map((item) => (
        <button
          key={item.id}
          type="button"
          data-view-id={item.id}
          className={`view-btn${active === item.id ? " active" : ""}${
            draggingId === item.id ? " is-dragging" : ""
          }`}
          title={item.title}
          aria-pressed={active === item.id}
          onPointerDown={(e) => startPress(item.id, e)}
          onClick={() => {
            if (Date.now() < suppressClickUntil.current) return;
            onSelect(item.id);
          }}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}
