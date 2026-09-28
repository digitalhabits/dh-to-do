"use client";

import * as React from "react";

import { isInteractiveDragTarget } from "@/components/todo/use-pointer-drag";
import {
  COLUMN_ORDER_KEY,
  persistPref,
  SOMEDAY_EXPANDED_KEY,
  TILE_OPEN_COLUMN_KEY,
} from "@/lib/todo/saved-prefs";
import { isTodoBoardColumn, type TodoBoardColumn } from "@/lib/todo/types";

/**
 * The widths the layout answers to, measured on the shell itself.
 *
 * Not the window. The planner's split view gives this page one pane of a
 * wide window, and a media query reads the window — so a board squeezed
 * into a third of the screen kept its three columns, and the settings
 * sheet kept the shape it takes when there is room for it. The classes
 * these become are what todo.css keys its narrow rules off.
 */
const SHELL_WIDTHS: { max: number; className: string }[] = [
  /** Below this the board is one column, and the order turns over. */
  { max: 900, className: "todo-w-stack" },
  /** Below this the settings panel is a sheet over the whole shell. */
  { max: 718, className: "todo-w-narrow" },
  { max: 640, className: "todo-w-tight" },
];
/*
  Two widths, not three.

  Wide, the columns stand side by side. Below that the columns stack and
  become an accordion — the same width where todo.css stacks them, and it
  must stay the same width. There used to be a band between the two where
  the CSS had already stacked the board but this number had not: every
  section stood open down a single column, each squeezed to a header and
  a task, with the backlog folded to a rail meant for columns standing
  side by side. Three layouts where the reader expects two, and the
  middle one the worst of both.
*/
const BOARD_STACK_MAX = 900;
/**
 * And below this, not even that: the headers are the tile.
 *
 * Four folded headers and one open section still spends most of a short
 * square tile saying the names of things. Under this height the sections
 * become a row of pills under the tabs, and the whole of the rest is one
 * section's tasks.
 */
const BOARD_PILLS_MAX = 500;
/**
 * Slimmer than this, the hover pill does not fit across a card.
 *
 * The pill hangs off the right end of a row and reaches left over the
 * words; on a very slim tile it reached past the card's own edge and its
 * first buttons were cut off. Under this width the two controls that are
 * only offers — add a duration, add notes — leave the pill for the "…"
 * menu, and what stays fits.
 */
const PILL_FOLD_MAX = 340;

/**
 * How big the shell is, and the classes its widths give. Sets the board
 * stacked below BOARD_STACK_MAX.
 */
export function useShellSize({
  setBoardStacked,
}: {
  setBoardStacked: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  /**
   * How wide this page actually is, watched.
   *
   * `offsetWidth`, not the bounding rect: the shell carries the reader's
   * zoom, and the rules keyed off these widths are drawn inside it, so
   * the width that matters is the one its own children see.
   */
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const [shellWidth, setShellWidth] = React.useState<number | null>(null);
  const [shellHeight, setShellHeight] = React.useState<number | null>(null);
  React.useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const read = () => {
      setShellWidth(el.offsetWidth);
      setShellHeight(el.offsetHeight);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  /* Until it has been measured, the wide board — what it has always
     opened as, and one frame later the measurement settles it. */
  React.useEffect(() => {
    if (shellWidth == null) return;
    setBoardStacked(shellWidth <= BOARD_STACK_MAX);
  }, [shellWidth, setBoardStacked]);
  const shellWidthClasses =
    shellWidth == null
      ? ""
      : SHELL_WIDTHS.filter((w) => shellWidth <= w.max)
          .map((w) => w.className)
          .join(" ");

  return { shellRef, shellWidth, shellHeight, shellWidthClasses };
}

/**
 * How the board stands in the space it has: the column order as seen,
 * the Someday and Today rails, and on a small tile the one open section,
 * as pills or as an accordion.
 */
export function useBoardLayout({
  boardStacked,
  columnOrder,
  setColumnOrder,
  setSomedayExpanded,
  somedayEnabled,
  somedayExpanded,
  shellWidth,
  shellHeight,
  suppressRailClickRef,
}: {
  boardStacked: boolean;
  columnOrder: TodoBoardColumn[];
  setColumnOrder: React.Dispatch<React.SetStateAction<TodoBoardColumn[]>>;
  setSomedayExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  somedayEnabled: boolean;
  somedayExpanded: boolean;
  shellWidth: number | null;
  shellHeight: number | null;
  suppressRailClickRef: React.RefObject<boolean>;
}) {
  /** The columns in the order the reader sees them. */
  const visibleColumnOrder = React.useMemo(
    () => (boardStacked ? [...columnOrder].reverse() : columnOrder),
    [boardStacked, columnOrder]
  );

  function storeColumnOrder(seen: TodoBoardColumn[]) {
    const stored = boardStacked ? [...seen].reverse() : seen;
    setColumnOrder(stored);
    persistPref(COLUMN_ORDER_KEY, stored.join(","));
  }

  function storeSomedayExpanded(open: boolean) {
    setSomedayExpanded(open);
    persistPref(SOMEDAY_EXPANDED_KEY, open ? "1" : "0");
  }

  /**
   * Wide board: Someday is a rail, or Today is a rail. Never both open.
   * One-column board: Today stays a column. Someday is a rail or a column.
   */
  /*
    A small tile: the board is stacked for want of width AND short of
    height. Four stacked sections in six hundred pixels were four headers
    and no tasks — so exactly one section is open, with the rest folded to
    their name and count, and the open one takes the room and scrolls.
  */
  /*
    Two answers to a short tile, and the shorter one wins. Pills spend one
    line on every section; the accordion spends a line on each and a whole
    open section besides, which is the right trade until there is no room
    for it.
  */
  const boardPills =
    boardStacked && shellHeight != null && shellHeight <= BOARD_PILLS_MAX;
  /*
    One column is one section at a time, whatever the height.

    Stacked, the sections run down the tile rather than across it, and all
    of them open means scrolling past three headers to reach the third —
    on a tall tile as much as a short one, because the tile is narrow and
    the rows are tall. The height only decides how the sections are named:
    folded headers while there is room for them, pills when there is not.
  */
  const boardAccordion = boardStacked && !boardPills;
  /** See PILL_FOLD_MAX: duration and notes go to the menu on a slim tile. */
  const foldPillActions = shellWidth != null && shellWidth <= PILL_FOLD_MAX;
  const [openStackColumn, setOpenStackColumn] = React.useState<TodoBoardColumn>(
    () => {
      try {
        const stored = localStorage.getItem(TILE_OPEN_COLUMN_KEY) ?? undefined;
        return isTodoBoardColumn(stored) ? stored : "today";
      } catch {
        return "today";
      }
    }
  );
  /** The "…" pill's menu, holding the sections the row had no room for. */
  const [pillMenuOpen, setPillMenuOpen] = React.useState(false);
  React.useEffect(() => {
    if (!pillMenuOpen) return;
    const close = () => setPillMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [pillMenuOpen]);

  const openStackSection = (column: TodoBoardColumn) => {
    setOpenStackColumn(column);
    persistPref(TILE_OPEN_COLUMN_KEY, column);
  };

  const showTodayRail = somedayEnabled && somedayExpanded && !boardStacked;
  const boardOpenColumns = React.useMemo(
    () =>
      showTodayRail
        ? visibleColumnOrder.filter((column) => column !== "today")
        : visibleColumnOrder,
    [showTodayRail, visibleColumnOrder]
  );

  function onRailActivate(column: TodoBoardColumn) {
    if (suppressRailClickRef.current) {
      suppressRailClickRef.current = false;
      return;
    }
    storeSomedayExpanded(column === "someday");
  }

  return {
    visibleColumnOrder,
    storeColumnOrder,
    storeSomedayExpanded,
    boardPills,
    boardAccordion,
    foldPillActions,
    openStackColumn,
    pillMenuOpen,
    setPillMenuOpen,
    openStackSection,
    showTodayRail,
    boardOpenColumns,
    onRailActivate,
  };
}

/** Carrying a column of the board by its heading. */
export function useColumnDrag({
  boardStacked,
  columnOrder,
  setColumnOrder,
  setDraggingColumn,
  storeColumnOrder,
}: {
  boardStacked: boolean;
  columnOrder: TodoBoardColumn[];
  setColumnOrder: React.Dispatch<React.SetStateAction<TodoBoardColumn[]>>;
  setDraggingColumn: React.Dispatch<React.SetStateAction<TodoBoardColumn | null>>;
  storeColumnOrder: (seen: TodoBoardColumn[]) => void;
}) {
  /**
   * Drag a column's heading to put the column somewhere else. The order is
   * kept as the wide board reads it, left to right, and one column turns it
   * over, so a column moved to the top of a stack is the last of a row.
   */
  function startColumnDrag(event: React.PointerEvent, column: TodoBoardColumn) {
    if (event.button !== 0) return;
    if (column === "someday") return;
    if (isInteractiveDragTarget(event.target)) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    let seen = boardStacked ? [...columnOrder].reverse() : [...columnOrder];

    const onMove = (move: PointerEvent) => {
      if (!started) {
        if (
          Math.abs(move.clientX - startX) < 4 &&
          Math.abs(move.clientY - startY) < 4
        ) {
          return;
        }
        started = true;
        setDraggingColumn(column);
      }
      const under = document
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>("[data-board-column]");
      const over = under?.dataset.boardColumn as TodoBoardColumn | undefined;
      if (!over || over === column || over === "someday") return;
      const from = seen.indexOf(column);
      const to = seen.indexOf(over);
      if (from < 0 || to < 0) return;
      seen = [...seen];
      seen.splice(from, 1);
      seen.splice(to, 0, column);
      setColumnOrder(boardStacked ? [...seen].reverse() : seen);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDraggingColumn(null);
      if (started) storeColumnOrder(seen);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return { startColumnDrag };
}
