"use client";

import * as React from "react";

/*
 * Settings as a page: its sections, which one is being read, and whether
 * the page is wide enough for the sections beside it.
 *
 * The page's own width decides, not the board's: with a task's details
 * open the board is narrower, and Settings opened as a small dialog then,
 * a full page otherwise.
 */

export type SettingsSection = "general" | "features" | "integrations" | "data" | "admin";

/** Each section's name, as a key of i18n. */
export const SECTION_TITLE: Record<SettingsSection, string> = {
  general: "settingsGeneral",
  features: "settingsFeatures",
  integrations: "integrations",
  data: "settingsData",
  admin: "settingsAdmin",
};

/** Narrower than this, the sections are one column and there is no sidebar. */
const SIDEBAR_FROM = 640;

export function useSettingsPage(onClose: () => void, withAdmin: boolean) {
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [wide, setWide] = React.useState(true);
  const [current, setCurrent] = React.useState<SettingsSection>("general");
  // The section last picked in the sidebar: at the page's foot, it stays
  // marked if it shows, rather than the last section.
  const pickedRef = React.useRef<SettingsSection | null>(null);
  const sections = React.useMemo<SettingsSection[]>(
    () => ["general", "features", "integrations", "data", ...(withAdmin ? (["admin"] as const) : [])],
    [withAdmin]
  );

  // The page's width, as it changes.
  React.useLayoutEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const measure = () => setWide(el.offsetWidth >= SIDEBAR_FROM);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The section being read: the last whose heading has reached the top.
  React.useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const onScroll = () => {
      const top = box.getBoundingClientRect().top + 48;
      let seen: SettingsSection = sections[0];
      for (const id of sections) {
        const el = box.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
        if (el && el.getBoundingClientRect().top <= top) seen = id;
      }
      // At the foot, a section whose heading never reaches the top is
      // still read: the one picked, if it shows, else the last.
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) {
        const picked = pickedRef.current;
        const pickedEl = picked && box.querySelector<HTMLElement>(`[data-settings-section="${picked}"]`);
        const boxRect = box.getBoundingClientRect();
        const shows = pickedEl && pickedEl.getBoundingClientRect().top < boxRect.bottom;
        seen = picked && shows ? picked : sections[sections.length - 1];
      }
      setCurrent(seen);
    };
    onScroll();
    // A scroll by the reader, not by a pick: the pick no longer holds.
    const forget = () => { pickedRef.current = null; };
    box.addEventListener("scroll", onScroll, { passive: true });
    box.addEventListener("wheel", forget, { passive: true });
    box.addEventListener("touchmove", forget, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      box.removeEventListener("wheel", forget);
      box.removeEventListener("touchmove", forget);
    };
  }, [sections]);

  // Escape goes back, as the back button does (not when a menu in the page
  // took it first).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const goTo = React.useCallback((id: SettingsSection) => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
    if (!box || !el) return;
    const at = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    pickedRef.current = id;
    box.scrollTo({ top: Math.max(0, at - 24), behavior: "smooth" });
    setCurrent(id);
  }, []);

  return { overlayRef, scrollRef, wide, current, sections, goTo };
}
