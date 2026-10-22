"use client";

/*
 * A row that knows where the pointer is: `data-hover` on the row while the
 * pointer is on it, for the + that adds a list or a group, and on the tab
 * under the pointer, for its × and its hover colour.
 *
 * Not CSS :hover, and not the event's target. In the Mac app's web view
 * (WebKit) the page can stop getting pointer moves once the pointer leaves
 * the tabs, so :hover stayed on the last tab and the + never went away.
 * Here the place comes from each move the page gets. While the row is lit
 * in the desktop app, the window system is asked every quarter second
 * whether the pointer moved: if it moved and the page heard nothing, the
 * pointer has left, and the row goes out. Only whether it moved, not where
 * to: a screen place turned into a page place was off with a zoom or a
 * scaled display, and put the row out under the pointer, so it flickered.
 * Leaving the window or the app turns it off too.
 */

import * as React from "react";

import { nativePointer } from "@/lib/todo/native-bridge";

const ITEMS = ".tab, .group-tab";
const NATIVE_CHECK_MS = 250;
/** How long one question to the window system may take. */
const NATIVE_WAIT_MS = 600;

type Point = { x: number; y: number } | null;

function inside(el: Element, point: Point): boolean {
  if (!point) return false;
  const r = el.getBoundingClientRect();
  return point.x >= r.left && point.x < r.right && point.y >= r.top && point.y < r.bottom;
}

function mark(el: Element, on: boolean) {
  if (on === el.hasAttribute("data-hover")) return;
  if (on) el.setAttribute("data-hover", "");
  else el.removeAttribute("data-hover");
}

export function HoverRow({
  className,
  style,
  children,
}: {
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let timer: number | null = null;
    let checking = false;
    // Counts the page's own pointer moves, so a native answer that took a
    // while can tell that a move came after it was asked.
    let moves = 0;

    // Set straight on the elements, not through React state: the tabs
    // are drawn by their own code, and this changes on every move.
    const place = (point: Point) => {
      const row = ref.current;
      if (!row) return;
      const on = inside(row, point);
      mark(row, on);
      row.querySelectorAll(ITEMS).forEach((item) => mark(item, on && inside(item, point)));
      if (on && timer == null) {
        timer = window.setInterval(checkNative, NATIVE_CHECK_MS);
      } else if (!on && timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    // The pointer on the screen at the last question, and the page's moves then.
    let last: Point = null;
    let movesThen = -1;
    const checkNative = async () => {
      if (checking) return;
      checking = true;
      try {
        // An answer that never comes must not stop the asking for good.
        const point = await Promise.race([
          nativePointer(),
          new Promise<null>((done) => window.setTimeout(() => done(null), NATIVE_WAIT_MS)),
        ]);
        // Null: no window system to ask. The page's own moves stand.
        if (!point) return;
        const moved = last && (Math.abs(point.x - last.x) > 1 || Math.abs(point.y - last.y) > 1);
        if (moved && moves === movesThen) place(null);
        last = point;
        movesThen = moves;
      } finally {
        checking = false;
      }
    };

    const onMove = (e: MouseEvent) => {
      moves += 1;
      place({ x: e.clientX, y: e.clientY });
    };
    const off = () => place(null);
    // Both: a web view that sends only one of the two still says where
    // the pointer is.
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", off);
    window.addEventListener("blur", off);
    return () => {
      if (timer != null) window.clearInterval(timer);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("pointerleave", off);
      window.removeEventListener("blur", off);
    };
  }, []);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
