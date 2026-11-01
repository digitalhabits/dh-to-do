"use client";

/**
 * "Show more details" in task details: who made the task, and when.
 *
 * The ⋮ menu in details offers it; the answer is two more rows under the
 * task's fields (and when it was done, for a done task). Shown or hidden
 * for every task at once, and remembered on this computer, so a reader who
 * wants it always does not ask for it on each task.
 */

import * as React from "react";
import { Info } from "lucide-react";

import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { THIS_DEVICE_MAKER } from "@/lib/todo/people-scope";
import type { TodoPerson, TodoTask } from "@/lib/todo/types";

const STORAGE_KEY = "redd-plan-todo-details-info";
const listeners = new Set<() => void>();
let shown = readShown();

function readShown(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setShown(next: boolean) {
  shown = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* a private window: shown until the page closes */
  }
  listeners.forEach((listener) => listener());
}

function useShown(): boolean {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
    () => false
  );
}

/** The company's two domains are one person's two spellings. */
function addressKey(email: string): string {
  return email.trim().toLowerCase().replace(/@reddfocus\.org$/, "@digitalhabits.org");
}

/**
 * Who made the task and when, as one line: "Created by Dr Vera Vinter on
 * 18 Oct 2026 at 14:35". The maker is a name from the roster where there
 * is one; with no maker recorded the line says only when.
 */
export function createdLine(
  task: Pick<TodoTask, "createdBy" | "basecampId" | "createdAt">,
  people: readonly TodoPerson[],
  t: (key: string) => string,
  lang: string
): string {
  const at = when(task.createdAt, lang) ?? "";
  const fill = (key: string, who = "") => t(key).replace("{who}", who).replace("{when}", at);
  const maker = task.createdBy;
  if (!maker) return fill(task.basecampId ? "createdInBasecampOn" : "createdOn");
  if (maker === THIS_DEVICE_MAKER) return fill("createdHereOn");
  if (!maker.includes("@")) return fill("createdOn");
  const key = addressKey(maker);
  const person = people.find((p) => p.email && addressKey(p.email) === key);
  return fill("createdByOn", person?.name ?? maker);
}

function when(iso: string | null | undefined, lang: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(lang === "da" ? "da-DK" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The ⋮ menu's offer, in task details only. */
export function TaskInfoMenuItem({ t, closeMenu }: { t: (key: string) => string; closeMenu: () => void }) {
  const open = useShown();
  return (
    <button
      role="menuitem"
      className="task-menu-item task-info-item"
      onClick={(event) => {
        event.stopPropagation();
        closeMenu();
        setShown(!open);
      }}
    >
      <Info size={14} strokeWidth={2} aria-hidden />
      {t(open ? "taskHideMoreDetails" : "taskShowMoreDetails")}
    </button>
  );
}

/** The line itself, first among the task's fields, while asked for. */
export function TaskDetailsInfo({ m, task }: { m: TodoPageModel; task: TodoTask }) {
  const open = useShown();
  if (!open) return null;
  const done = task.completed ? when(task.completedAt, m.lang) : null;
  return (
    <p className="task-details-info">
      {createdLine(task, m.state.people, m.t, m.lang)}
      {done ? ` · ${m.t("doneOn").replace("{when}", done)}` : null}
    </p>
  );
}
