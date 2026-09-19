"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * A pop-up menu rendered on `document.body`.
 *
 * Board columns scroll, so they clip anything a card draws outside itself. An
 * absolutely positioned menu inside a card disappears behind the column edge.
 * Rendering to the body and placing the menu by viewport coordinates is the
 * only reliable way out; `TodoPeopleEditor` solves the same problem the same
 * way for the person picker.
 */
export function MenuPortal({
  open,
  anchorEl,
  className,
  align = "left",
  role,
  ariaLabel,
  children,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  /** Class for the menu box itself, so callers keep their own look. */
  className: string;
  /** Which edge of the menu lines up with the same edge of the anchor. */
  align?: "left" | "right";
  /** ARIA role for the menu box, when the caller's items need a parent role. */
  role?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setCoords(null);
      return;
    }
    const place = () => {
      const menu = menuRef.current;
      if (!menu || !anchorEl.isConnected) return;
      const rect = anchorEl.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const gap = 4;
      const pad = 8;
      // Below the anchor, or above it when the bottom of the window is close.
      let top = rect.bottom + gap;
      if (top + menuRect.height > window.innerHeight - pad) {
        top = rect.top - menuRect.height - gap;
      }
      top = Math.max(
        pad,
        Math.min(top, window.innerHeight - menuRect.height - pad)
      );
      let left = align === "right" ? rect.right - menuRect.width : rect.left;
      left = Math.max(
        pad,
        Math.min(left, window.innerWidth - menuRect.width - pad)
      );
      setCoords({ top, left });
    };
    place();
    // Again after the first paint, when the real height is known.
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorEl, align, children]);

  if (!mounted || !open) return null;

  const shell = document.querySelector(".todo-shell");
  const theme = shell?.getAttribute("data-theme");

  return createPortal(
    <div
      className="todo-shell todo-menu-portal-root"
      data-theme={theme || undefined}
    >
      <div
        ref={menuRef}
        className={`${className} todo-menu-portal`}
        role={role}
        aria-label={ariaLabel}
        style={
          // Placed off-screen for the measuring pass, so it never flashes.
          coords
            ? { top: coords.top, left: coords.left }
            : { top: 0, left: 0, visibility: "hidden" }
        }
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
