"use client";

import { ArrowDownUp, ArrowUp, Check } from "lucide-react";

import { MenuKeys } from "@/components/todo/MenuKeys";
import { MenuPortal } from "@/components/todo/MenuPortal";
import type { TodoPageModel } from "@/components/todo/use-todo-page";
import { COLUMN_SORTS, SORT_LABEL_KEY, type SortTarget } from "@/lib/todo/column-sort";

/**
 * The "⇅" order of a board column, or of the list when Board View is off:
 * a glyph with the order's name, and a menu of orders. Picking the order in
 * use again turns it the other way. Kept per device (use-column-sorts).
 */
export function SortControl({ m, target }: { m: TodoPageModel; target: SortTarget }) {
  const {
    t,
    assignEnabled,
    columnSorts,
    pickColumnSort,
    columnSortMenu,
    setColumnSortMenu,
    columnSortAnchor,
    setColumnSortAnchor,
  } = m;
  return (
      <span
        className={`board-sort-wrap${
          columnSortMenu === target ? " is-open" : ""
        }`}
      >
        <button
          type="button"
          className="board-sort-btn"
          title={t("sortBy")}
          aria-label={`${t("sortBy")}: ${t(
            SORT_LABEL_KEY[columnSorts[target].sort]
          )}`}
          aria-haspopup="menu"
          aria-expanded={columnSortMenu === target}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (columnSortMenu === target) {
              setColumnSortMenu(null);
              setColumnSortAnchor(null);
            } else {
              setColumnSortAnchor(event.currentTarget);
              setColumnSortMenu(target);
            }
          }}
        >
          {/* The direction, as an arrow that turns; ⇅ where there
              is none (manual). */}
          {columnSorts[target].sort === "manual" ? (
            <ArrowDownUp size={13} strokeWidth={2} aria-hidden />
          ) : (
            <ArrowUp
              size={13}
              strokeWidth={2}
              aria-hidden
              className={`board-sort-arrow${
                columnSorts[target].desc ? " is-desc" : ""
              }`}
            />
          )}
          <span className="board-sort-label">
            {t(SORT_LABEL_KEY[columnSorts[target].sort])}
          </span>
        </button>
        <MenuPortal
          open={columnSortMenu === target}
          anchorEl={columnSortMenu === target ? columnSortAnchor : null}
          className="task-menu board-sort-menu"
          align="right"
          role="menu"
          ariaLabel={t("sortBy")}
        >
          <MenuKeys
            onClose={(reason) => {
              const glyph = columnSortAnchor;
              setColumnSortMenu(null);
              setColumnSortAnchor(null);
              if (reason === "escape") glyph?.focus();
            }}
          >
          {/* The active row carries its arrow: pick it again and
              the order runs the other way. */}
          {COLUMN_SORTS.filter(
            (sort) => assignEnabled || sort !== "assignee"
          ).map((sort) => {
            const active = columnSorts[target].sort === sort;
            return (
              <button
                key={sort}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`task-menu-item board-sort-item${
                  active ? " is-current" : ""
                }`}
                onClick={() => {
                  pickColumnSort(target, sort);
                  setColumnSortMenu(null);
                  setColumnSortAnchor(null);
                }}
              >
                <span className="board-sort-check" aria-hidden>
                  {active ? <Check size={14} strokeWidth={2.5} /> : null}
                </span>
                {t(SORT_LABEL_KEY[sort])}
                {active && sort !== "manual" ? (
                  <ArrowUp
                    size={13}
                    strokeWidth={2}
                    aria-hidden
                    className={`board-sort-arrow board-sort-item-arrow${
                      columnSorts[target].desc ? " is-desc" : ""
                    }`}
                  />
                ) : null}
              </button>
            );
          })}
          </MenuKeys>
        </MenuPortal>
      </span>
  );
}
