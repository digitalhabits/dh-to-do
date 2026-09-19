"use client";

import * as React from "react";

import { walkTabStops } from "@/lib/todo/focus-walk";

/**
 * The keyboard for a menu of items.
 *
 * On mount the caret lands on the checked item, or the first. The arrows
 * walk the items and wrap, Home and End jump to the ends, and Escape
 * closes. Enter and Space are the buttons' own. Wrap the items of a
 * MenuPortal in this and the menu can be worked from the keyboard as well
 * as pointed at.
 *
 * Tab walks the menu's own controls and wraps at the ends, so an open menu
 * keeps the caret: in WebKit Tab out of a menu went to the next text box
 * on the page, which is nowhere near the menu (see `focus-walk`).
 */
export function MenuKeys({
  onClose,
  className,
  closeOnBlur = true,
  children,
}: {
  /** Called on Escape, and when the caret leaves the menu. */
  onClose: () => void;
  className?: string;
  /**
   * The caret leaving the menu closes it. Off for a menu that is put away
   * some other way — the card menu goes on the next click anywhere — so a
   * menu that redraws in place does not close under its own caret.
   */
  closeOnBlur?: boolean;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  /*
    Whether a pointer is pressing inside the menu right now.

    WebKit does not give a button the caret on a click. The press takes the
    caret off the focused item and puts it on the page, which reads as the
    caret leaving the menu, and the menu closed on that blur before the
    click could reach the item. Every menu built on this stopped answering
    to the pointer in Safari and in the Mac apps' web view, while the
    keyboard still worked. So a press inside the menu is remembered for the
    length of that event, and the blur it causes is not a reason to close.
  */
  const pressing = React.useRef(false);

  function items(): HTMLElement[] {
    return Array.from(
      ref.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])'
      ) ?? []
    );
  }

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const all = items();
      const current =
        all.find((el) => el.getAttribute("aria-checked") === "true") ?? all[0];
      current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Tab keeps the caret in the menu, items and anything else it holds.
    if (walkTabStops(e, ref.current, { wrap: true })) return;
    const all = items();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      e.preventDefault();
      all[(index + all.length) % all.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        go(at + 1);
        break;
      case "ArrowUp":
        go(at - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(all.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      default:
    }
  }

  return (
    <div
      ref={ref}
      className={className}
      onKeyDown={onKeyDown}
      onPointerDownCapture={() => {
        pressing.current = true;
        // The blur the press causes fires before the next frame.
        requestAnimationFrame(() => {
          pressing.current = false;
        });
      }}
      onBlur={(e) => {
        if (!closeOnBlur) return;
        if (pressing.current) return;
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}
