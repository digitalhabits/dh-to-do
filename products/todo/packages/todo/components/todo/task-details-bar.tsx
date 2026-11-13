"use client";

/**
 * The bar at the top of task details.
 *
 * Beside the list: Back, the task's list (its icon, when it has one), its
 * More menu, and a button that widens details over the whole window. Full
 * screen: the same, and the button puts details back beside the list. In a
 * slim window Back is its arrow alone. Where details already take the whole window (a
 * narrow window, the Today session) there is nothing to widen, and no button.
 */

import * as React from "react";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";

import { TaskDetailsListButton } from "@/components/todo/task-overlay-chips";
import { TaskDetailsMenu } from "@/components/todo/todo-task-card";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { beginNativeWindowDragOnMove } from "@/lib/todo/native-bridge";
import type { TodoTask } from "@/lib/todo/types";

export function TaskDetailsBar({
  m,
  task,
  canExpand,
  full,
}: {
  m: TodoPageModel;
  task: TodoTask;
  /** False where details take the whole window anyway. */
  canExpand: boolean;
  /** Laid out as a widened document. */
  full: boolean;
}) {
  const widened = canExpand && m.detailsFull;
  const barRef = React.useRef<HTMLDivElement>(null);
  useLineUpWithTabs(barRef, full);
  return (
    /* Over the window's title bar when details take the whole window, so
       in the Mac app the window is dragged by this bar's empty space. A
       press that does not move still clicks. */
    <div
      ref={barRef}
      className="task-details-navigation"
      onPointerDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, input, textarea, a, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]")) return;
        beginNativeWindowDragOnMove(event);
      }}
    >
      <button type="button" className="task-details-back" aria-label={m.t("backToTasks")} onClick={() => m.saveNotes(task.id)}>
        <ArrowLeft size={16} aria-hidden /><span className="task-details-back-label">{m.t("backToTasks")}</span>
      </button>
      <div className="task-details-bar-end">
        <TaskDetailsListButton m={m} task={task} iconOnly />
        <TaskDetailsMenu m={m} task={task} />
        {canExpand ? (
          <button
            type="button"
            className="task-details-expand"
            aria-label={m.t(widened ? "detailsCollapse" : "detailsExpand")}
            title={m.t(widened ? "detailsCollapse" : "detailsExpand")}
            onClick={() => m.setDetailsFull(!widened)}
          >
            {widened ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Beside the list, the bar's bottom line is level with the line under the
 * list's tabs. The tabs' height depends on the top bar, the groups row, the
 * zoom and the platform, so the bar measures it and takes the same height.
 *
 * Where the window draws its own buttons in a row at the top (the Windows
 * app sets `--win-controls-h` on <html>, see apps/todo/src/standalone.css),
 * the bar's buttons are centred on that row, in every layout. With no tabs
 * line to match (details take the whole window), the bar is then as tall as
 * the row; elsewhere it keeps its own height.
 */
function useLineUpWithTabs(barRef: React.RefObject<HTMLDivElement | null>, full: boolean) {
  React.useLayoutEffect(() => {
    const bar = barRef.current;
    const shell = bar?.closest<HTMLElement>(".todo-shell");
    if (!bar || !shell) return;
    const reset = () => {
      bar.style.paddingTop = "";
      bar.style.paddingBottom = "";
    };
    const fit = () => {
      reset();
      if (bar.offsetHeight === 0) return;
      const barBox = bar.getBoundingClientRect();
      // The shell can carry a CSS zoom. Boxes are in screen pixels, a style
      // is in CSS pixels, so divide by the scale.
      const scale = barBox.height / bar.offsetHeight;
      // Keep the buttons as they are and change only the room above and
      // below them, so the line can move up as well as down.
      const style = getComputedStyle(bar);
      const border = parseFloat(style.borderBottomWidth) || 0;
      const content =
        bar.offsetHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom) -
        border;

      // The bottom line: level with the tabs line, beside the list.
      const tabs = shell.querySelector<HTMLElement>(".tabs-container");
      const besideList =
        tabs &&
        !shell.classList.contains("task-details-replace") &&
        !shell.classList.contains("task-details-full");
      const tabsBox = besideList ? tabs.getBoundingClientRect() : null;
      const lineAt =
        tabsBox && tabsBox.height > 0 ? (tabsBox.bottom - barBox.top) / scale : null;

      // The window's own row of buttons, when it draws one.
      const rowPx = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--win-controls-h")
      );
      // The row's foot, measured from the bar's top. The row is on the
      // unzoomed page; a bar below it (none of it under the row) skips this.
      const row = rowPx > barBox.top ? (rowPx - barBox.top) / scale : null;

      let top: number;
      let bottom: number;
      if (row != null && row >= content) {
        // Centred on the window's row; the line under the row, or at the
        // tabs line beside the list.
        top = (row - content) / 2;
        bottom = (lineAt ?? row + border) - content - border - top;
        if (bottom < 0) bottom = top;
      } else if (lineAt != null) {
        top = bottom = (lineAt - content - border) / 2;
      } else {
        return;
      }
      if (top < 0 || bottom < 0) return;
      bar.style.paddingTop = `${top}px`;
      bar.style.paddingBottom = `${bottom}px`;
    };
    fit();
    // A resize of the window, a groups row shown or hidden, a zoom change:
    // each moves the tabs line.
    const observer = new ResizeObserver(fit);
    observer.observe(shell);
    const column = shell.querySelector<HTMLElement>(".content-column");
    if (column) observer.observe(column);
    const tabs = shell.querySelector<HTMLElement>(".tabs-container");
    if (tabs) observer.observe(tabs);
    return () => {
      observer.disconnect();
      reset();
    };
  }, [barRef, full]);
}
