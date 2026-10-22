"use client";

/*
 * The items of a "which list" menu: the card's list button, the add row's
 * list chip, and the List row of the expanded card. With more than six
 * lists a search box comes first, and typing keeps only the lists whose
 * names hold what was typed. Enter picks the first one left; the arrows
 * walk down into the lists as before. A menu that moves a task offers the
 * lists of every group, each other group under its name.
 */

import * as React from "react";
import { Search } from "lucide-react";

import { MenuKeys } from "@/components/todo/MenuKeys";

/** More lists than this, and the menu has a search box. */
export const LIST_MENU_SEARCH_AFTER = 6;

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The lists whose names hold the query, in their own order. */
export function listsMatching<L extends { name: string }>(lists: L[], query: string): L[] {
  const q = fold(query.trim());
  return q ? lists.filter((list) => fold(list.name).includes(q)) : lists;
}

export function SearchableListMenu<L extends { id: string; name: string }>({
  lists,
  className,
  onClose,
  before,
  renderItem,
  headingOf,
  t,
}: {
  lists: L[];
  className?: string;
  onClose: (reason: "escape" | "blur") => void;
  /** Shown above the lists, but not while a search is typed ("No list"). */
  before?: React.ReactNode;
  renderItem: (list: L) => React.ReactNode;
  /** The group a list is in, when it is not the open one: a heading goes
   *  above the first list of each such group. "" is a line with no name. */
  headingOf?: (list: L) => string | null;
  t: (key: string) => string;
}) {
  const searchable = lists.length > LIST_MENU_SEARCH_AFTER;
  const [query, setQuery] = React.useState("");
  const shown = searchable ? listsMatching(lists, query) : lists;
  const holder = React.useRef<HTMLDivElement | null>(null);
  const box = React.useRef<HTMLInputElement | null>(null);
  // A frame after it opens, as MenuKeys does for its items: before that the
  // menu is not yet placed, and the field that opened it keeps the caret.
  React.useEffect(() => {
    if (!searchable) return;
    const frame = requestAnimationFrame(() => box.current?.focus());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <MenuKeys className={className} onClose={onClose} focusOnOpen={!searchable}>
      <div ref={holder} className="list-menu-items">
        {searchable ? (
          <label className="list-menu-search">
            <Search size={13} strokeWidth={2} aria-hidden />
            <input
              ref={box}
              type="text"
              value={query}
              placeholder={t("searchLists")}
              aria-label={t("searchLists")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // The caret's own keys in the box, not the menu's.
                if (e.key === "Home" || e.key === "End") e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  holder.current
                    ?.querySelector<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')
                    ?.click();
                }
              }}
            />
          </label>
        ) : null}
        {query.trim() ? null : before}
        {shown.map((list, i) => {
          const heading = headingOf?.(list) ?? null;
          const startsGroup =
            heading !== null && (i === 0 || headingOf?.(shown[i - 1]) !== heading);
          return startsGroup ? (
            <React.Fragment key={list.id}>
              <div className="list-menu-heading" role="presentation">
                {heading}
              </div>
              {renderItem(list)}
            </React.Fragment>
          ) : (
            renderItem(list)
          );
        })}
        {shown.length === 0 ? <div className="list-menu-none">{t("noListsMatch")}</div> : null}
      </div>
    </MenuKeys>
  );
}
