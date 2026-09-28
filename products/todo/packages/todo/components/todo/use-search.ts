"use client";

import * as React from "react";

import type { TodoView } from "@/lib/todo/list-scope";
import {
  openTasksShown,
  otherListHits,
  searchGroupsOf,
  searchQueryOf,
  selectedSearchGroupOf,
} from "@/lib/todo/search-groups";
import type { TodoList, TodoTask } from "@/lib/todo/types";

/**
 * Cross-list search (ported from redd-do's list search). The bar with the
 * people filters is always on screen; the search itself is an icon until
 * it is opened, and `searchRevealed` is that field being open.
 */
export function useSearchState() {
  const [searchRevealed, setSearchRevealed] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchListId, setSearchListId] = React.useState<string | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const listSearchRef = React.useRef<HTMLDivElement | null>(null);
  return {
    searchRevealed,
    setSearchRevealed,
    searchQuery,
    setSearchQuery,
    searchListId,
    setSearchListId,
    searchInputRef,
    listSearchRef,
  };
}

/**
 * The search field: opened by its icon and by Cmd+F, put away by Escape
 * and by a click outside it while it is empty. `liveRef` is the page's
 * mirror of its newest state, which the window's listeners read.
 */
export function useSearchField({
  liveRef,
  searchInputRef,
  listSearchRef,
  setSearchRevealed,
  setSearchQuery,
  setSearchListId,
}: {
  liveRef: React.MutableRefObject<{
    searchRevealed: boolean;
    searchQuery: string;
    modalOpen: boolean;
  }>;
  searchInputRef: React.MutableRefObject<HTMLInputElement | null>;
  listSearchRef: React.MutableRefObject<HTMLDivElement | null>;
  setSearchRevealed: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setSearchListId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const revealSearch = React.useCallback(() => {
    setSearchRevealed(true);
    requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }, [searchInputRef, setSearchRevealed]);

  /** Fold the field back to its icon. The people filters stay as they are. */
  const hideSearch = React.useCallback((clearQuery = false) => {
    setSearchRevealed(false);
    // The field is folded away but still in the tree. Focus must not stay in it.
    searchInputRef.current?.blur();
    if (clearQuery) {
      setSearchQuery("");
      setSearchListId(null);
    }
  }, [searchInputRef, setSearchListId, setSearchQuery, setSearchRevealed]);

  // Cmd/Ctrl+F opens search; Escape dismisses it (modals/menus own Escape).
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.isContentEditable || active.closest?.("trix-editor")))
          return;
        e.preventDefault();
        revealSearch();
        return;
      }
      if (e.key !== "Escape" || !liveRef.current.searchRevealed) return;
      if (liveRef.current.modalOpen) return;
      hideSearch(true);
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [revealSearch, hideSearch, liveRef]);

  // A click outside an empty search folds it back to its icon. A query
  // keeps the field open: the list is filtered, and the field says why.
  React.useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!liveRef.current.searchRevealed) return;
      if (liveRef.current.searchQuery) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (listSearchRef.current?.contains(target)) return;
      if (target.closest?.(".task-item, .task-menu, .modal-overlay")) return;
      hideSearch();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [hideSearch, listSearchRef, liveRef]);

  return { revealSearch, hideSearch };
}

/** What the search finds, and the open tasks the view shows with it. */
export function useSearchResults({
  searchQuery,
  searchListId,
  view,
  activeList,
  isAllListsView,
  listsSorted,
  tasks,
  taskPreviewIds,
  openTasksSorted,
}: {
  searchQuery: string;
  searchListId: string | null;
  view: TodoView;
  activeList: TodoList | null;
  isAllListsView: boolean;
  listsSorted: TodoList[];
  tasks: TodoTask[];
  taskPreviewIds: string[] | null;
  openTasksSorted: TodoTask[];
}) {
  const trimmedQuery = searchQueryOf(searchQuery);
  const isSearching = trimmedQuery.length > 0;
  const searchGroups = React.useMemo(() => {
    if (!isSearching) return [];
    const preferredId =
      (view === "lists" ? activeList?.id : searchListId) ?? null;
    return searchGroupsOf(listsSorted, tasks, trimmedQuery, preferredId);
  }, [isSearching, trimmedQuery, listsSorted, tasks, view, activeList?.id, searchListId]);
  const selectedSearchGroup = selectedSearchGroupOf(searchGroups, searchListId);

  /** On a specific list tab: hits in other lists (for jump chips). Hidden on All. */
  const otherListSearchHits = React.useMemo(() => {
    if (!isSearching || view !== "lists" || isAllListsView || !activeList) {
      return [];
    }
    return otherListHits(searchGroups, activeList.id);
  }, [isSearching, view, isAllListsView, activeList, searchGroups]);

  const openTasks = React.useMemo(
    () =>
      openTasksShown({
        isSearching,
        view,
        query: trimmedQuery,
        selectedGroup: selectedSearchGroup,
        previewIds: taskPreviewIds,
        openTasksSorted,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isSearching,
      view,
      trimmedQuery,
      selectedSearchGroup,
      taskPreviewIds,
      openTasksSorted,
    ]
  );

  return {
    trimmedQuery,
    isSearching,
    searchGroups,
    selectedSearchGroup,
    otherListSearchHits,
    openTasks,
  };
}
