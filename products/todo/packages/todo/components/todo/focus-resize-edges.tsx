"use client";

/**
 * Where the focus note is resized, on the Mac.
 *
 * The Mac panel is a clear window a little bigger than the note: room for
 * the shadow the page draws, because the window's own shadow is a square
 * round a rounded note (focus.rs). So the window's edge, where macOS offers
 * to resize, was 10px out from the note's sides and 16px below it, and the
 * resize arrows came only off the note, in clear air (2026-10-23).
 *
 * Strips along the note's left, right and bottom edges, and its lower
 * corners, carry the resize cursor, and a drag there sizes the window from
 * the page: Tauri cannot hand a press in the page to the system's own
 * resize on macOS (tao answers NotSupported), which is why a first try that
 * asked it to left the note unresizable. The window's own edges still
 * resize. Only where the note has that room (todo.css, html.focus-note-room):
 * elsewhere the window is the note.
 */

import * as React from "react";

import { readWindowBounds, setWindowBounds, type WindowBounds } from "@/lib/todo/native-bridge";

/** How far a strip reaches either side of the note's edge, in px. */
const REACH = 4;
/** The note's place in the window: `inset: 4px 10px 16px` on #focus-mode. */
const NOTE = { top: 4, side: 10, bottom: 16 };
/** The shells' own limits for the panel's width, in points (focus.rs, lib.rs). */
const MIN_WIDTH = 200;
/** The widest before the page has measured itself. */
const MAX_WIDTH = 720;
/** What a measured panel keeps clear of the screen's sides (FOCUS_POPOUT_SCREEN_MARGIN). */
const SCREEN_MARGIN = 40;
/** The width the panel opens at, which a short name may still have. */
const OPEN_WIDTH = 320;

export type SizeLimits = { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number };

/**
 * The sizes the window may have now. The panel works them out as it fits
 * the window (TodoFocusPanel), the same way the shell does: as wide as the
 * name on one line plus air, and as tall as the content, up to a little
 * more. A drag keeps to them too. Past them, each size it set made the
 * panel fit again and the shell pull the window back, so it flickered and
 * jumped narrower (2026-10-23).
 */
const limits: SizeLimits = { minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH, minHeight: 0, maxHeight: Infinity };

/** The panel's fit: the height its content needs, and the width its name does. */
export function setFocusSizeLimits(fit: {
  height: number;
  maxHeight: number;
  naturalWidth?: number;
  /** The screen's width, in points: the widest a long name may draw it. */
  screenWidth?: number;
}): void {
  limits.maxWidth = widestFor(fit.naturalWidth, fit.screenWidth);
  limits.minHeight = fit.height;
  limits.maxHeight = Math.max(fit.height, fit.maxHeight);
}

/**
 * The widest the panel may be: its name on one line plus air, however long,
 * up to the screen less a margin; never under the width it opens at. The
 * content decides, not a fixed cap (2026-10-23). The shell does the same.
 */
export function widestFor(naturalWidth: number | undefined, screenWidth: number | undefined): number {
  if (naturalWidth === undefined) return MAX_WIDTH;
  const screen = Math.max(MAX_WIDTH, (screenWidth ?? MAX_WIDTH + SCREEN_MARGIN) - SCREEN_MARGIN);
  return Math.max(Math.min(Math.max(naturalWidth, MIN_WIDTH), screen), OPEN_WIDTH);
}

/** Which way a strip resizes: its side, or its corner. */
export type ResizeEdge = { x: "left" | "right" | null; y: "bottom" | null };

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

/** The window's new place and size for a drag of (dx, dy) points from `start`. */
export function resizedBounds(
  start: WindowBounds,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  allowed: SizeLimits = limits
): WindowBounds {
  let { x, width, height } = start;
  if (edge.x) {
    width = clamp(edge.x === "right" ? start.width + dx : start.width - dx, allowed.minWidth, allowed.maxWidth);
    // The left edge moves the window too, so the right edge stays put.
    if (edge.x === "left") x = start.x + (start.width - width);
  }
  if (edge.y === "bottom") height = clamp(start.height + dy, allowed.minHeight, allowed.maxHeight);
  return { x, y: start.y, width, height };
}

const STRIPS: { key: string; edge: ResizeEdge; cursor: string; style: React.CSSProperties }[] = [
  {
    key: "left",
    edge: { x: "left", y: null },
    cursor: "ew-resize",
    style: { left: NOTE.side - REACH, top: NOTE.top, bottom: NOTE.bottom + REACH, width: REACH * 2 },
  },
  {
    key: "right",
    edge: { x: "right", y: null },
    cursor: "ew-resize",
    style: { right: NOTE.side - REACH, top: NOTE.top, bottom: NOTE.bottom + REACH, width: REACH * 2 },
  },
  {
    key: "bottom",
    edge: { x: null, y: "bottom" },
    cursor: "ns-resize",
    style: { left: NOTE.side + REACH, right: NOTE.side + REACH, bottom: NOTE.bottom - REACH, height: REACH * 2 },
  },
  {
    key: "bottom-left",
    edge: { x: "left", y: "bottom" },
    cursor: "nesw-resize",
    style: { left: NOTE.side - REACH, bottom: NOTE.bottom - REACH, width: REACH * 2, height: REACH * 2 },
  },
  {
    key: "bottom-right",
    edge: { x: "right", y: "bottom" },
    cursor: "nwse-resize",
    style: { right: NOTE.side - REACH, bottom: NOTE.bottom - REACH, width: REACH * 2, height: REACH * 2 },
  },
];

function Strip({ edge, cursor, style, name }: { edge: ResizeEdge; cursor: string; style: React.CSSProperties; name: string }) {
  const drag = React.useRef<{ pointerX: number; pointerY: number; start: WindowBounds } | null>(null);
  const frame = React.useRef(0);
  const latest = React.useRef({ dx: 0, dy: 0 });

  const apply = (dx: number, dy: number) => {
    latest.current = { dx, dy };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const d = drag.current;
      if (!d) return;
      const next = resizedBounds(d.start, edge, latest.current.dx, latest.current.dy);
      void setWindowBounds(next, edge.x === "left").catch(() => {});
    });
  };

  return (
    <div
      aria-hidden
      className="focus-resize-edge"
      data-focus-resize={name}
      style={{ position: "fixed", zIndex: 50, cursor, ...style }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        const { pointerId, screenX, screenY } = e;
        el.setPointerCapture(pointerId);
        void readWindowBounds().then((start) => {
          if (start && el.hasPointerCapture(pointerId)) {
            drag.current = { pointerX: screenX, pointerY: screenY, start };
          }
        });
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) apply(e.screenX - d.pointerX, e.screenY - d.pointerY);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}

export function FocusResizeEdges() {
  return (
    <>
      {STRIPS.map((s) => (
        <Strip key={s.key} name={s.key} edge={s.edge} cursor={s.cursor} style={s.style} />
      ))}
    </>
  );
}
