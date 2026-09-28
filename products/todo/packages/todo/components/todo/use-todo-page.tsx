"use client";

/*
 * Everything TodoPage knows and does, apart from what it draws.
 *
 * TodoPage calls this once, at its top, and draws from what it returns.
 * The statements here are TodoPage's own, in the order they ran, so the
 * hooks run in the same order as before. The markup, which calls no hook,
 * stayed in TodoPage.tsx.
 *
 * New logic for the page goes in a hook of its own (see the use-*.ts files
 * beside this one) and is called from here. `TodoPageModel` is what the
 * markup can read.
 */

import * as React from "react";
import { toast } from "sonner";

import { useTodoOffline } from "@/lib/offline/use-todo-offline";
import { listenOpenSettings } from "@/lib/native-shell";
import { useWriteTracking } from "@/components/todo/use-write-tracking";
import { useZoomKeys } from "@/components/todo/use-zoom-keys";
import { useUndoKey, useUndoState } from "@/components/todo/use-undo";
import { useFocusChannel, useFocusWindowState } from "@/components/todo/use-focus-windows";
import {
  useSearchField,
  useSearchResults,
  useSearchState,
} from "@/components/todo/use-search";
import { useColumnSorts } from "@/components/todo/use-column-sorts";
import { usePeopleFilter, usePeopleScopeState } from "@/components/todo/use-people-scope";
import { useBoardLayout, useColumnDrag, useShellSize } from "@/components/todo/use-board-layout";
import { useIntegrationStatus, useSync, useSyncState } from "@/components/todo/use-sync";
import { usePointerDrag, useDragState } from "@/components/todo/use-pointer-drag";
import {
  useListDialogActions,
  useListDialogLinks,
  useListDialogState,
} from "@/components/todo/use-list-dialog";
import {
  useTaskActions,
  type ConfirmModalState,
} from "@/components/todo/use-task-actions";
import { useNotesCard, useNotesCardState } from "@/components/todo/use-notes-card";
import { useSubtasks } from "@/components/todo/use-subtasks";
import { useBoardPeople } from "@/components/todo/use-board-people";
import { useBackup } from "@/components/todo/use-backup";
import { useSavedPrefs } from "@/components/todo/use-saved-prefs";
import { EMPTY_STATE, useBoardReads } from "@/components/todo/use-board-reads";
import { useGroupsAndLists } from "@/components/todo/use-groups";
import { useTitleEdit } from "@/components/todo/use-title-edit";
import { useCalendarCard, useCalendarCardState } from "@/components/todo/use-calendar-card";
import { useCardMenusClose, useCardMenusState } from "@/components/todo/use-card-menus";
import { useBoardNudge } from "@/components/todo/use-board-nudge";
import { rescueBrowserTasks } from "@/lib/todo/browser-tasks-rescue";
import {
  addStarterList,
  carryLegacySettings,
  importLegacyBoard,
} from "@/lib/todo/legacy-import";
import { byPosition, sortColumnTasks } from "@/lib/todo/column-sort";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import { type UploadImage } from "@/components/todo/TrixNotesEditor";
import { makeT, type TodoLang } from "@/lib/todo/i18n";
import {
  CURRENT_GROUP_KEY,
  DEFAULT_COLUMN_ORDER,
  HAD_TASK_KEY,
  KANBAN_KEY,
  LANG_KEY,
  VIEW_KEY,
  persistPref,
} from "@/lib/todo/saved-prefs";
import {
  activeGroupOf,
  byPositionOrder,
  favKey,
  inPreviewOrder,
  listScopeOf,
  listsInScope,
} from "@/lib/todo/list-scope";
import { normalizeTaskAssignees } from "@/lib/todo/task-helpers";
import { uploaderForListOn, uploaderForTaskOn } from "@/lib/todo/note-uploads";
import {
  TODO_ALL_LIST_ID,
  TODO_CURRENT_LIST_KEY,
  boardColumnOf,
  emptyBoardColumns,
  TODO_BOARD_COLUMNS,
  type TodoBoardColumn,
  type TodoList,
  type TodoState,
  type TodoTask,
} from "@/lib/todo/types";

import { boardViewIsOn } from "@/lib/todo/board-view-default";
import { settingsActions } from "@/components/todo/settings-actions";
import { useViewTasks } from "@/components/todo/use-view-tasks";
export type { TodoPageSnapshot } from "@/components/todo/use-board-reads";

/** How long a task ticked from the focus window stands ticked before it goes. */
const FOCUS_COMPLETE_HOLD_MS = 500;


export type TodoPageProps = {
  initialState: TodoState | null;
  appVersion?: string;
  /**
   * The reader's addresses, for "My tasks": the roster rows with one of
   * them are the reader. Left out, or matching nobody, the board has no
   * "mine" and shows everyone — the desktop app, with no login, is so.
   */
  viewerEmails?: string[];
  /**
   * The keys the reader's own tasks carry as their maker, for "My tasks":
   * a task with nobody on it is the reader's when they made it. The
   * desktop app has no login and uses THIS_DEVICE_MAKER instead.
   */
  viewerKeys?: string[];
};

export function useTodoPage({
  initialState,
  appVersion,
  viewerEmails = [],
  viewerKeys = [],
}: TodoPageProps) {
  const refreshRef = React.useRef<() => Promise<void>>(async () => {});
  const {
    api: offlineApi,
    isOffline,
    pendingOpsCount,
    isSyncing,
    syncOfflineOps,
    lastError: syncError,
  } = useTodoOffline({
    onSynced: () => {
      void refreshRef.current();
    },
  });

  const { api, mutationSeqRef, inFlightWritesRef } = useWriteTracking(offlineApi);

  /**
   * The tasks the server sent, and only those, for the first render.
   *
   * Local-only tasks live in this browser — the ones made on the All tab,
   * which never went to the server. Reading them here would make the first
   * render on the reader's machine hold more tasks than the HTML the server
   * sent, and React would refuse the mismatch: "Text content did not match.
   * Server: 3, Client: 6", one number per task the server never saw. They
   * are merged in the moment after, below.
   */
  const [state, setState] = React.useState<TodoState>(() => {
    if (!initialState) return { ...EMPTY_STATE };
    return {
      ...EMPTY_STATE,
      ...initialState,
      people: initialState.people ?? [],
      tasks: (initialState.tasks ?? []).map(normalizeTaskAssignees),
    };
  });

  /**
   * True when the board on the screen came from the store, and not from the
   * empty start. The desktop app starts empty and reads its board a moment
   * later. "No lists" means something only after that read.
   */
  const boardLoadedRef = React.useRef(Boolean(initialState));

  /*
    A new reader's board, until its first task: the empty list says where to
    add one. Once the board has held a task, a mark keeps the words away for
    good, also when every task is gone again. Not before the board is read,
    so the words never flash up for a reader whose tasks are on their way.
    The desktop app only; the planner's board is the team's.
  */
  const [boardHadTask, setBoardHadTask] = React.useState(() => {
    if (!isStandaloneTodo()) return true;
    try {
      return localStorage.getItem(HAD_TASK_KEY) === "1";
    } catch {
      return true;
    }
  });
  if (!boardHadTask && state.tasks.length > 0) setBoardHadTask(true);
  React.useEffect(() => {
    if (!boardHadTask || !isStandaloneTodo()) return;
    try {
      localStorage.setItem(HAD_TASK_KEY, "1");
    } catch {
      /* private mode: the words may come back on an empty board */
    }
  }, [boardHadTask]);

  /*
    Tasks this browser kept on its own, from before a task could be on no
    list. Each goes to the server as the reader's own and leaves the
    browser. See browser-tasks-rescue.ts.
  */
  const rescued = React.useRef(false);
  React.useEffect(() => {
    if (rescued.current) return;
    rescued.current = true;
    void rescueBrowserTasks(api).then((count) => {
      if (!count) return;
      toast.success(`${count} tasks from this browser are now on the board`);
      void refresh();
    });
    // Once, on mount: the store is read and emptied as it goes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /*
    The board of version 2, at the first start of the desktop app after an
    update. Version 2 kept it in this web view's localStorage, and it is still
    there. See legacy-import.ts for when this does nothing, which is nearly
    always.
  */
  const legacyImported = React.useRef(false);
  React.useEffect(() => {
    if (legacyImported.current || !isStandaloneTodo()) return;
    legacyImported.current = true;
    // Before the board: this is synchronous, and the effect further down
    // that reads the language and the theme must find them copied.
    carryLegacySettings(window.localStorage);
    void importLegacyBoard(api, window.localStorage).then((result) => {
      if (result.outcome === "failed") {
        console.error("[todo] version 2 import failed:", result.error);
        toast.error(t("legacyImportFailed"));
        return;
      }
      if (result.outcome !== "imported") {
        // Nothing came over: a new reader starts with one list. The name is
        // read from the saved language, which `t` may not have yet.
        let lang: TodoLang = "en";
        try {
          if (localStorage.getItem(LANG_KEY) === "da") lang = "da";
        } catch {
          /* English */
        }
        void addStarterList(
          api,
          window.localStorage,
          result,
          makeT(lang)("starterListName")
        ).then((made) => {
          if (made) void refresh();
        });
        return;
      }
      toast.success(
        t("legacyImportDone")
          .replace("{lists}", String(result.lists))
          .replace("{tasks}", String(result.tasks))
      );
      if (result.basecamp === "again") toast.message(t("legacyImportBasecampAgain"));
      void refresh();
    });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [view, setView] = React.useState<"lists" | "favourites" | "plan">(
    "lists"
  );
  /**
   * The app opens on the view the reader left it on, as it opens on the
   * list they left it on. This is before the effect that reads the settings,
   * and that order matters: on the first pass the saved view is not read
   * yet, and "lists" must not go over it.
   */
  const calendarCardState = useCalendarCardState({ view });

  const viewRestoredRef = React.useRef(false);
  React.useEffect(() => {
    if (viewRestoredRef.current) persistPref(VIEW_KEY, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  /** Hides list/group tabs and the footer for a quieter board. */
  const [focusMode, setFocusMode] = React.useState(false);
  const [currentListId, setCurrentListId] = React.useState<string | null>(
    TODO_ALL_LIST_ID
  );
  /** The task just added, marked on the board until JUST_ADDED_MS is up. */
  const [justAddedTaskId, setJustAddedTaskId] = React.useState<string | null>(
    null
  );
  const justAddedTimer = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (justAddedTimer.current) window.clearTimeout(justAddedTimer.current);
    },
    []
  );
  /**
   * The order of the three columns, left to right on a wide board. Stacked in
   * one column the board reads it the other way up, so Today, the work in
   * hand, is at the top and the Backlog at the foot.
   */
  const [columnOrder, setColumnOrder] =
    React.useState<TodoBoardColumn[]>(DEFAULT_COLUMN_ORDER);
  const [boardStacked, setBoardStacked] = React.useState(false);
  const [draggingColumn, setDraggingColumn] =
    React.useState<TodoBoardColumn | null>(null);

  /** Someday starts as a rail. Open it and Today becomes the rail. */
  const [somedayExpanded, setSomedayExpanded] = React.useState(false);
  /** Opened by hand while the backlog is folded to a rail for want of width. */
  /** Off by default. Someday tasks sit in Backlog until this is on. */
  const [somedayEnabled, setSomedayEnabled] = React.useState(false);
  /**
   * Off, the board has no assign controls, no avatars and no people
   * filters, and it shows every task. The assignees stay on the tasks.
   */
  const [assignEnabled, setAssignEnabled] = React.useState(false);
  const [focusTimerAlways, setFocusTimerAlways] = React.useState(true);
  const [editingTaskId, setEditingTaskId] = React.useState<string | null>(null);
  /**
   * The words in the title box that is open. A ref, not state: as state,
   * each letter drew every card of the board again, and on a board of some
   * hundred tasks a letter took longer than the next one came. The box
   * keeps its own text, and this follows it for the save.
   */
  const editingTextRef = React.useRef("");
  const [editingDurationTaskId, setEditingDurationTaskId] = React.useState<string | null>(null);
  const cardMenus = useCardMenusState();
  const {
    duePopoverTaskId,
    editingDuration,
    openMenuTaskId,
    openListPickerTaskId,
    openAssignTaskId,
    setOpenAssignTaskId,
    assignAnchorEl,
    setAssignAnchorEl,
  } = cardMenus;
  const {
    assigneeFilterIds,
    setAssigneeFilterIds,
    peopleScope,
    markedMeId,
    markMe,
    choosePeopleScope,
  } = usePeopleScopeState();
  const [peopleEditorOpen, setPeopleEditorOpen] = React.useState(false);
  const notesCard = useNotesCardState();
  const {
    openNotesTaskId,
    notesExpanded,
  } = notesCard;
  const [doneCollapsed, setDoneCollapsed] = React.useState(true);
  const listDialog = useListDialogState();
  const {
    listModal,
  } = listDialog;
  // Integration linking (Basecamp project/list, Apple Reminders list)
  const {
    bcConnected,
    setBcConnected,
    remindersConnected,
    setRemindersConnected,
    syncing,
    setSyncing,
    suppressAutoSyncListIdsRef,
    autoSyncKeyRef,
    syncChainRef,
    remindersConnectedRef,
  } = useSyncState();
  const listsRef = React.useRef<TodoList[]>([]);
  const tasksRef = React.useRef<TodoTask[]>([]);
  const [confirmModal, setConfirmModal] = React.useState<ConfirmModalState>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const { undoState, setUndoState, undoTimer, lastUndoRef, registerUndo, showUndo } =
    useUndoState();

  const {
    searchRevealed,
    setSearchRevealed,
    searchQuery,
    setSearchQuery,
    searchListId,
    setSearchListId,
    searchInputRef,
    listSearchRef,
  } = useSearchState();
  const tasksContainerRef = React.useRef<HTMLDivElement | null>(null);
  const doneTasksRef = React.useRef<HTMLDivElement | null>(null);
  /** The Done bar. A task completed while Done is shut flies to it. */
  const doneHeadingRowRef = React.useRef<HTMLDivElement | null>(null);
  /**
   * The rows a flight is carrying right now. A row here is not painted, so
   * the card is on screen once, as the ghost. A set, not one slot: tick two
   * tasks in a row and the first flight must keep its row hidden while the
   * second one starts.
   */
  const [animHiddenTargets, setAnimHiddenTargets] = React.useState<Set<string>>(
    () => new Set()
  );
  const dropAnimTarget = React.useCallback((key: string) => {
    setAnimHiddenTargets((keys) => {
      if (!keys.has(key)) return keys;
      const next = new Set(keys);
      next.delete(key);
      return next;
    });
  }, []);

  /**
   * The Today session: the ids it works through, in its own order. Null when
   * no session is running. New tasks join the end, and Skip moves one there.
   */
  const [sessionIds, setSessionIds] = React.useState<string[] | null>(null);

  // Kanban board (default on). Off = single list, Today → Soon (-ish) → Backlog.
  /**
   * The desktop app has no server page, so it can read the choice for the
   * first paint: a new reader does not see an empty board for a moment. In
   * the planner the server and the browser must paint the same first page,
   * and the choice is read after it, below.
   */
  const [kanbanEnabled, setKanbanEnabled] = React.useState(() => {
    if (!isStandaloneTodo()) return true;
    try {
      return boardViewIsOn({
        stored: localStorage.getItem(KANBAN_KEY),
        savedCurrentList: localStorage.getItem(TODO_CURRENT_LIST_KEY),
      });
    } catch {
      return false;
    }
  });
  // Planner View — the calendar surface, toggled in settings (default off).
  const [planEnabled, setPlanEnabled] = React.useState(false);
  // Tab groups (feature-flagged like redd-do's enableGroups, default off)
  const [groupsEnabled, setGroupsEnabled] = React.useState(false);
  const [currentGroupId, setCurrentGroupId] = React.useState<string | null>(null);

  // Floating always-on-top focus windows — desktop shell only.
  /**
   * The focus window's tick, applied here. The row is found on the page so
   * the tick can play as the board's own does; a row not on screen — another
   * list, another tab — is completed without the flight.
   */
  function completeFromFocus(taskId: string, timeSpentSeconds?: number) {
    const existing = tasksRef.current.find((t) => t.id === taskId);
    if (!existing || existing.completed) return;
    // The window's time goes with the tick, in the board's own write. The
    // window says the task is done before it saves its time, so the
    // answer to a write without it would put the old time back; and a
    // task only the board holds is not found by the window's save at all.
    const extra =
      typeof timeSpentSeconds === "number" &&
      timeSpentSeconds >= existing.timeSpentSeconds
        ? { timeSpentSeconds }
        : {};
    const row = document.querySelector<HTMLElement>(
      `.task-item[data-task-id="${CSS.escape(taskId)}"]`
    );
    const box = row?.querySelector<HTMLInputElement>("input.task-checkbox") ?? null;
    // Ticked, then half a second standing so, then away — as redd-do does
    // it: the focus window has just closed, and the eye arrives after.
    completeTaskWithFlight(existing, true, box, row, FOCUS_COMPLETE_HOLD_MS, extra);
  }
  const {
    nativeShell,
    activeFocusTaskIds,
    setActiveFocusTaskIds,
    focusChannelRef,
    focusEndWaitersRef,
    completeFromFocusRef,
  } = useFocusWindowState({ completeFromFocus, tasksLoaded: state.tasks.length > 0 });

  // Pointer-based drag reorder (ported from redd-do: 4px threshold, live preview)
  const drag = useDragState();
  const {
    boardDragHover,
    suppressRailClickRef,
    taskPreviewIds,
    listPreviewIds,
    groupPreviewIds,
    personPreviewIds,
  } = drag;

  /**
   * The open tasks this view holds, as the board itself works them out.
   *
   * The window-level drag builds its preview from this rather than working
   * the same thing out a second time. It had its own copy of the rule and
   * the copy was wrong: it dropped every task with no list of its own — the
   * ones made on the All tab, which is where they live — so they fell off
   * the screen for as long as a drag lasted, and out of the order the drop
   * was written from. One rule, in one place, and the preview cannot be a
   * different set of tasks from the one on screen.
   */
  const boardScopeRef = React.useRef<TodoTask[]>([]);

  // Latest-value mirrors for window-level event handlers.
  const liveRef = React.useRef({
    view,
    searchRevealed,
    searchQuery,
    assigneeFilterIds,
    taskPreviewIds,
    listPreviewIds,
    groupPreviewIds,
    personPreviewIds,
    state,
    currentListId,
    currentGroupId,
    groupsEnabled,
    somedayEnabled,
    modalOpen: false,
  });
  liveRef.current = {
    view,
    searchRevealed,
    searchQuery,
    assigneeFilterIds,
    taskPreviewIds,
    listPreviewIds,
    groupPreviewIds,
    personPreviewIds,
    state,
    currentListId,
    currentGroupId,
    groupsEnabled,
    somedayEnabled,
    modalOpen: Boolean(
      listModal ||
        confirmModal ||
        settingsOpen ||
        openMenuTaskId ||
        openListPickerTaskId ||
        openAssignTaskId ||
        peopleEditorOpen
    ),
  };

  // Preferences (persisted like redd-do's theme/language/zoom, planner-scoped keys)
  const { lang, setLang, theme, setTheme, zoom, setZoom, systemDark } = useSavedPrefs({
    setKanbanEnabled,
    setPlanEnabled,
    setColumnOrder,
    setSomedayExpanded,
    setSomedayEnabled,
    setAssignEnabled,
    setFocusTimerAlways,
    setGroupsEnabled,
    setCurrentGroupId,
    setCurrentListId,
    setFocusMode,
    setView,
    viewRestoredRef,
  });

  /**
   * The board is the lists view. It has no favourites, and no switch to leave
   * it by, so a session that sat in favourites when the board came on must
   * not stay there.
   */
  React.useEffect(() => {
    if (kanbanEnabled && view === "favourites") setView("lists");
  }, [kanbanEnabled, view]);

  /** Same rule for the Planner View: its toggle off means the view goes. */
  React.useEffect(() => {
    if (!planEnabled && view === "plan") setView("lists");
  }, [planEnabled, view]);

  /** The store app, or the planner's To-Do tab. Fixed for this page. */
  const standalone = React.useMemo(() => isStandaloneTodo(), []);

  const { shellRef, shellWidth, shellHeight, shellWidthClasses } =
    useShellSize({ setBoardStacked });


  const t = React.useMemo(() => makeT(lang), [lang]);
  const effectiveDark = theme === "dark" || (theme === "system" && systemDark);

  const { refresh } = useBoardReads({
    state,
    setState,
    api,
    inFlightWritesRef,
    mutationSeqRef,
    boardLoadedRef,
    refreshRef,
    editingTaskId,
    editingDurationTaskId,
    t,
  });

  useIntegrationStatus({ settingsOpen, api, setRemindersConnected, setBcConnected });

  const { selectBcProject, selectBcList, selectRemindersList } = useListDialogLinks({
    listDialog,
    api,
    bcConnected,
    remindersConnected,
  });

  function listOfTask(task: TodoTask): TodoList | undefined {
    return state.lists.find((l) => l.id === task.listId);
  }

  useCardMenusClose(cardMenus);

  const { toggleTaskFocusPopout } = useFocusChannel({
    nativeShell,
    refresh,
    standalone,
    activeFocusTaskIds,
    setActiveFocusTaskIds,
    focusChannelRef,
    focusEndWaitersRef,
    completeFromFocusRef,
    t,
  });

  // "Settings…" in the app menu of the desktop app, and Cmd+Comma.
  React.useEffect(() => {
    if (!isStandaloneTodo()) return;
    let off: (() => void) | null = null;
    let gone = false;
    void listenOpenSettings(() => setSettingsOpen(true)).then((unlisten) => {
      if (gone) unlisten();
      else off = unlisten;
    });
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  useZoomKeys(zoom, setZoom);

  const { revealSearch } = useSearchField({
    liveRef,
    searchInputRef,
    listSearchRef,
    setSearchRevealed,
    setSearchQuery,
    setSearchListId,
  });

  usePointerDrag({
    drag,
    api,
    refresh,
    setState,
    // mutateTask comes from useTaskActions, further down; a drop calls it
    // long after this render.
    mutateTask: (id, patch) => mutateTask(id, patch),
    liveRef,
    boardScopeRef,
    tasksContainerRef,
    // The column sorts come from useColumnSorts, further down; a drop reads
    // them long after this render.
    isManualColumn: (column) => columnSorts[column].sort === "manual",
    setManualColumn: (column) => pickColumnSort(column, "manual"),
    t,
  });

  const listsSorted = React.useMemo(() => byPositionOrder(state.lists), [state.lists]);

  const groupsSorted = React.useMemo(() => byPositionOrder(state.groups), [state.groups]);
  /**
   * People in the order their positions put them, as lists and groups are.
   *
   * The server sends them ordered, so reading them in the order they arrived
   * looked the same and needed no sort — until a drag moved one. A drop
   * writes a new position and nothing else: the array it came in still holds
   * the old order, so the chip the user let go of jumped back to where it
   * started and stayed there until the next reload, with the move already
   * saved. Sorting here is what makes the drop show.
   */
  const peopleSorted = React.useMemo(() => byPositionOrder(state.people), [state.people]);
  const groupsForRender = React.useMemo(
    () => inPreviewOrder(groupsSorted, groupPreviewIds),
    [groupsSorted, groupPreviewIds]
  );
  const activeGroup = activeGroupOf(groupsEnabled, groupsSorted, currentGroupId);

  const lists = React.useMemo(
    () => listsInScope(listsSorted, groupsEnabled, activeGroup, listPreviewIds),
    [listsSorted, listPreviewIds, groupsEnabled, activeGroup]
  );
  const { isAllListsView, activeList } = listScopeOf(lists, currentListId);
  /** Named list for creates; All-tab creates stay local (no list). */
  const addTargetList = activeList;

  listsRef.current = lists;
  tasksRef.current = state.tasks;
  remindersConnectedRef.current = remindersConnected;

  // All is virtual and only exists with 2+ lists. With one list, select it.
  React.useEffect(() => {
    if (lists.length > 1) return;
    if (lists.length === 1) {
      const onlyId = lists[0].id;
      if (currentListId !== onlyId) {
        setCurrentListId(onlyId);
        persistPref(TODO_CURRENT_LIST_KEY, onlyId);
      }
      return;
    }
    // Before the board is read there are no lists yet. The list the reader
    // left the app on must stay, so the app can open on it.
    if (!boardLoadedRef.current) return;
    if (currentListId !== null) {
      setCurrentListId(null);
      persistPref(TODO_CURRENT_LIST_KEY, "");
    }
  }, [lists, currentListId]);

  const { pushReminders, doSync } = useSync({
    api,
    refresh,
    view,
    currentListId,
    lists,
    isAllListsView,
    activeList,
    remindersConnected,
    remindersConnectedRef,
    listsRef,
    tasksRef,
    setSyncing,
    syncChainRef,
    suppressAutoSyncListIdsRef,
    autoSyncKeyRef,
    t,
  });
  const scopedListIds = React.useMemo(
    () => new Set(lists.map((l) => l.id)),
    [lists]
  );

  /** From favourites/search: open a task's home list (and its group). */
  function navigateToList(listId: string) {
    const list = state.lists.find((l) => l.id === listId);
    if (groupsEnabled && list?.groupId) {
      setCurrentGroupId(list.groupId);
      persistPref(CURRENT_GROUP_KEY, list.groupId);
    }
    setView("lists");
    setCurrentListId(listId);
    persistPref(TODO_CURRENT_LIST_KEY, listId);
  }

  /*
    The base order of a run is the drag order. Each board column then
    applies its own order on top — due date unless the reader picked
    another from the header — in `boardColumns` and `flatListTasks`.
    A drag still writes positions, and in a column sorted by anything
    but the drag order a dropped task goes back to its sorted place: the
    sort is the fact, the drag a preference, and the fact wins.
  */
  const byOrder = byPosition;

  /* Parents only, whatever the view: a subtask lives inside its parent's
     expanded card, never as a card of the board. */
  const parentTasks = React.useMemo(
    () => state.tasks.filter((t) => !t.parentTaskId),
    [state.tasks]
  );
  const { tasksForView, openTasksSorted, doneTasks } = useViewTasks({
    parentTasks,
    view,
    isAllListsView,
    scopedListIds,
    activeListId: activeList?.id ?? null,
  });

  // Search: incomplete tasks across every list, grouped per list, preferred
  // (current) list first — matching redd-do's getListSearchGroups.
  const {
    isSearching,
    searchGroups,
    selectedSearchGroup,
    otherListSearchHits,
    openTasks,
  } = useSearchResults({
    searchQuery,
    searchListId,
    view,
    activeList,
    isAllListsView,
    listsSorted,
    tasks: state.tasks,
    taskPreviewIds,
    openTasksSorted,
  });

  const {
    assigneeFilterPeople,
    mePersonIds,
    hasMe,
    scope,
    makerKeys,
    boardTasks,
    myOpenCount,
    filteredDoneTasks,
  } = usePeopleFilter({
    assignEnabled,
    view,
    tasksForView,
    peopleSorted,
    personPreviewIds,
    setAssigneeFilterIds,
    people: state.people,
    viewerEmails,
    markedMeId,
    peopleScope,
    viewerKeys,
    openTasks,
    doneTasks,
    assigneeFilterIds,
  });

  /** Board columns stay up while searching in lists; favourites stays a flat list. */
  const showBoard =
    kanbanEnabled &&
    view === "lists" &&
    (isAllListsView || Boolean(activeList));
  const boardWidth = showBoard;
  const {
    columnSorts,
    pickColumnSort,
    columnSortMenu,
    setColumnSortMenu,
    columnSortAnchor,
    setColumnSortAnchor,
    sortColumn,
  } = useColumnSorts({ assignEnabled, people: state.people, taskPreviewIds });
  /*
    What a drag starts from: each column in the order it shows, not in
    saved positions. A drag stops the sort so the card can follow the
    pointer; built from positions, a sorted column jumped to its last
    Manual order the moment a card was picked up. Built from the saved
    tasks, not the drag's preview, so it holds still while the card moves.
  */
  const dragScope = React.useMemo(() => {
    const byColumn = emptyBoardColumns<TodoTask>();
    for (const task of openTasksSorted) {
      byColumn[boardColumnOf(task, somedayEnabled)].push(task);
    }
    return TODO_BOARD_COLUMNS.flatMap((column) =>
      sortColumnTasks(columnSorts[column], byColumn[column], state.people, false)
    );
  }, [openTasksSorted, somedayEnabled, columnSorts, state.people]);
  boardScopeRef.current = dragScope;

  const boardColumns = React.useMemo(() => {
    const cols = emptyBoardColumns<TodoTask>();
    for (const task of boardTasks) {
      const col =
        boardDragHover?.taskId === task.id
          ? boardDragHover.column
          : boardColumnOf(task, somedayEnabled);
      cols[col].push(task);
    }
    for (const column of TODO_BOARD_COLUMNS) {
      cols[column] = sortColumn(column, cols[column]);
    }
    return cols;
  }, [boardTasks, boardDragHover, somedayEnabled, sortColumn]);

  /** Single-column lists view: Today, then Soon (-ish), then Backlog. */
  const flatListTasks = React.useMemo(() => {
    const order: TodoBoardColumn[] = ["today", "week", "backlog", "someday"];
    const byColumn = emptyBoardColumns<TodoTask>();
    for (const task of boardTasks) {
      // A card carried into another section is drawn there, as on the board.
      const column =
        boardDragHover?.taskId === task.id
          ? boardDragHover.column
          : boardColumnOf(task, somedayEnabled);
      byColumn[column].push(task);
    }
    return order.flatMap((column) => sortColumn(column, byColumn[column]));
  }, [boardTasks, boardDragHover, somedayEnabled, sortColumn]);

  const { boardNudgeOpen, addedInListViewRef, answerBoardNudge } = useBoardNudge({
    kanbanEnabled,
    setKanbanEnabled,
    flatListTasks,
    t,
  });

  /**
   * The first and last task of every run — each board column, or the
   * favourites list — so the menu can leave out a move that would change
   * nothing. The ends are the first and last card as the view shows them.
   */
  const runEdges = React.useMemo(() => {
    const first = new Set<string>();
    const last = new Set<string>();
    const mark = (run: TodoTask[]) => {
      if (run.length === 0) return;
      first.add(run[0].id);
      last.add(run[run.length - 1].id);
    };
    if (view === "favourites") {
      mark(
        state.tasks
          .filter((t) => t.isFavourite && !t.completed)
          .sort((a, b) => favKey(a) - favKey(b) || byOrder(a, b))
      );
    } else {
      for (const column of TODO_BOARD_COLUMNS) mark(boardColumns[column]);
    }
    return { first, last };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tasks, boardColumns, view]);

  useUndoKey({ lastUndoRef, undoTimer, setUndoState });

  const {
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
  } = useBoardLayout({
    boardStacked,
    columnOrder,
    setColumnOrder,
    setSomedayExpanded,
    somedayEnabled,
    somedayExpanded,
    shellWidth,
    shellHeight,
    suppressRailClickRef,
  });

  function boardColumnLabel(column: TodoBoardColumn): string {
    if (column === "someday") return t("boardSomeday");
    if (column === "backlog") return t("boardBacklog");
    if (column === "week") return t("boardThisWeek");
    return t("boardToday");
  }


  const { startColumnDrag } = useColumnDrag({
    boardStacked,
    columnOrder,
    setColumnOrder,
    setDraggingColumn,
    storeColumnOrder,
  });

  const {
    mutateTask,
    startTodaySession,
    uncompleteSessionTask,
    skipSessionTask,
    addSessionTask,
    moveTaskToEdge,
    toggleFavourite,
    toggleTaskCompleted,
    completeTaskWithFlight,
    addTask,
    recreateTask,
    removeTask,
    clearDone,
  } = useTaskActions({
    api,
    refresh,
    state,
    setState,
    t,
    view,
    lists,
    addTargetList,
    listOfTask,
    listsRef,
    tasksRef,
    openTasks,
    doneTasks,
    boardColumns,
    showBoard,
    isSearching,
    somedayEnabled,
    doneCollapsed,
    assigneeFilterIds,
    assigneeFilterPeople,
    makerKeys,
    pushReminders,
    focusChannelRef,
    registerUndo,
    showUndo,
    setConfirmModal,
    setSessionIds,
    setJustAddedTaskId,
    justAddedTimer,
    setAnimHiddenTargets,
    dropAnimTarget,
    tasksContainerRef,
    doneTasksRef,
    doneHeadingRowRef,
    columnSorts,
    sortColumn,
    pickColumnSort,
  });

  const {
    openCreateListModal,
    openRenameListModal,
    openCreateGroupModal,
    openRenameGroupModal,
    submitListModal,
  } = useListDialogActions({
    listDialog,
    api,
    refresh,
    setState,
    t,
    bcConnected,
    remindersConnected,
    suppressAutoSyncListIdsRef,
    groupsEnabled,
    activeGroup,
    setCurrentGroupId,
    setCurrentListId,
  });

  const { handleGroupsEnabledChange, switchToGroup, removeGroup, removeList } = useGroupsAndLists({
    state,
    setState,
    api,
    refresh,
    t,
    lists,
    currentListId,
    currentGroupId,
    setGroupsEnabled,
    setCurrentGroupId,
    setCurrentListId,
    setConfirmModal,
    showUndo,
    recreateTask,
  });

  const {
    editInputRef,
    resizeEditTextarea,
    startEditTask,
    caretAfterEditRef,
    commitEditTask,
    commitEditDuration,
  } = useTitleEdit({
    view,
    navigateToList,
    editingTextRef,
    editingTaskId,
    setEditingTaskId,
    editingDuration,
    setEditingDurationTaskId,
    mutateTask,
  });

  /** Where this task's note sends a picture: see uploaderForTaskOn. */
  function uploaderForTask(task: TodoTask): UploadImage {
    return uploaderForTaskOn(task, listsRef.current);
  }

  /** Where a note on this list sends a picture: see uploaderForListOn. */
  function uploaderForList(listId: string | null): UploadImage {
    return uploaderForListOn(listId, listsRef.current);
  }


  /*
    Escape takes the note back to the row rather than closing it.

    The draft is the same either way, so nothing typed is lost by leaving —
    and a reader who hit Escape meant "not full screen any more", not
    "throw this away".
  */
  /**
   * Between the small note and the full-window one, in either direction.
   *
   * Switching swaps one editor for the other, and the new one loads the
   * draft — so the leaving editor's document has to be carried into the
   * draft first, or whatever only it held is gone. That is how a picture
   * that had finished uploading vanished on collapse: the tick carried the
   * live document, and the collapse button did not.
   *
   * And not at all while a picture is still on its way up: the upload
   * belongs to the editor that is about to be torn down, and there is
   * nowhere for its sgid to land once that editor is gone.
   */
  const { toggleNotes, saveNotes, openTaskOverlay } = useNotesCard({
    notesCard,
    mutateTask,
    t,
  });

  /**
   * One task's notes, over the whole window.
   *
   * The box under a row is a few lines tall, which is right for a few lines
   * and cramped for a paragraph. This is the same editor on the same draft,
   * so expanding saves nothing and collapsing loses nothing.
   */
  /**
   * The card of a task, over the Calendar, beside the task there.
   *
   * It is `renderTask`, so it looks and works as the card in the lists view:
   * the tick, the words, the chips, the hover bubble, the button that opens
   * the full-screen card. The shell is zoomed by CSS, and a fixed box in it
   * counts in zoomed pixels, so the window's pixels are divided by the zoom.
   */
  const { calendarPopoverPlace, openCalendarTask, openCalendarNewTask } = useCalendarCard({
    calendarCardState,
    state,
    zoom,
    duePopoverTaskId,
    openMenuTaskId,
    openListPickerTaskId,
    openAssignTaskId,
    editingTaskId,
    openNotesTaskId,
  });


  const {
    subtasksByTask,
    toggleSubtaskDone,
    subtaskNotesId,
    setSubtaskNotesId,
    subtaskNotesDraft,
    setSubtaskNotesDraft,
    subtaskDurEditId,
    setSubtaskDurEditId,
    newSubtaskText,
    setNewSubtaskText,
    newSubtaskAssigneeIds,
    setNewSubtaskAssigneeIds,
    newSubtaskNotes,
    setNewSubtaskNotes,
    newSubtaskNotesOpen,
    setNewSubtaskNotesOpen,
    newSubtaskDuration,
    setNewSubtaskDuration,
    newSubtaskDurEditing,
    setNewSubtaskDurEditing,
    newSubtaskInputRef,
    submitNewSubtask,
    saveSubtaskNotes,
    subtaskDragId,
    subtaskPreview,
    subtaskListRef,
    subtaskHoldRef,
    startSubtaskDrag,
  } = useSubtasks({
    state,
    setState,
    api,
    makerKeys,
    mutateTask,
    openNotesTaskId,
    notesExpanded,
    focusSubtaskOnOpenRef: notesCard.focusSubtaskOnOpenRef,
    t,
  });

  const {
    peopleById,
    searchPeopleCandidates,
    addBoardPerson,
    setPersonPhoto,
    removeBoardPerson,
    toggleTaskAssignee,
    closeAssignMenu,
  } = useBoardPeople({
    state,
    setState,
    api,
    refresh,
    t,
    liveRef,
    subtasksByTask,
    mutateTask,
    setConfirmModal,
    assignAnchorEl,
    setOpenAssignTaskId,
    setAssignAnchorEl,
  });

  const { exportData, importData } = useBackup({
    state,
    api,
    refresh,
    t,
    setSettingsOpen,
    setConfirmModal,
  });

  const settings = settingsActions({
    setLang,
    setTheme,
    setZoom,
    setKanbanEnabled,
    setSomedayEnabled,
    setAssignEnabled,
    setFocusTimerAlways,
    setPlanEnabled,
    setAssigneeFilterIds,
    setPeopleEditorOpen,
    closeAssignMenu,
    tasksRef,
    focusChannelRef,
    mutateTask,
  });

  return {
    ...settings,
    ...calendarCardState,
    ...cardMenus,
    ...notesCard,
    ...listDialog,
    ...drag,
    appVersion,
    visibleColumnOrder,
    isOffline,
    pendingOpsCount,
    isSyncing,
    syncOfflineOps,
    syncError,
    state,
    boardLoadedRef,
    boardHadTask,
    view,
    setView,
    focusMode,
    setFocusMode,
    setCurrentListId,
    justAddedTaskId,
    boardStacked,
    draggingColumn,
    somedayExpanded,
    somedayEnabled,
    setSomedayEnabled,
    assignEnabled,
    setAssignEnabled,
    focusTimerAlways,
    setFocusTimerAlways,
    editingTaskId,
    setEditingTaskId,
    editingTextRef,
    editingDurationTaskId,
    setEditingDurationTaskId,
    assigneeFilterIds,
    setAssigneeFilterIds,
    markMe,
    choosePeopleScope,
    peopleEditorOpen,
    setPeopleEditorOpen,
    doneCollapsed,
    setDoneCollapsed,
    bcConnected,
    remindersConnected,
    syncing,
    tasksRef,
    confirmModal,
    setConfirmModal,
    settingsOpen,
    setSettingsOpen,
    undoState,
    setUndoState,
    lastUndoRef,
    searchRevealed,
    setSearchRevealed,
    searchQuery,
    setSearchQuery,
    setSearchListId,
    searchInputRef,
    listSearchRef,
    tasksContainerRef,
    doneTasksRef,
    doneHeadingRowRef,
    animHiddenTargets,
    sessionIds,
    setSessionIds,
    kanbanEnabled,
    setKanbanEnabled,
    planEnabled,
    setPlanEnabled,
    groupsEnabled,
    nativeShell,
    activeFocusTaskIds,
    focusChannelRef,
    lang,
    setLang,
    theme,
    setTheme,
    zoom,
    setZoom,
    standalone,
    shellRef,
    shellWidthClasses,
    t,
    effectiveDark,
    selectBcProject,
    selectBcList,
    selectRemindersList,
    listOfTask,
    toggleTaskFocusPopout,
    revealSearch,
    groupsSorted,
    groupsForRender,
    activeGroup,
    lists,
    isAllListsView,
    activeList,
    addTargetList,
    doSync,
    navigateToList,
    isSearching,
    searchGroups,
    selectedSearchGroup,
    otherListSearchHits,
    openTasks,
    assigneeFilterPeople,
    mePersonIds,
    hasMe,
    scope,
    boardTasks,
    myOpenCount,
    filteredDoneTasks,
    showBoard,
    boardWidth,
    columnSorts,
    pickColumnSort,
    columnSortMenu,
    setColumnSortMenu,
    columnSortAnchor,
    setColumnSortAnchor,
    boardColumns,
    flatListTasks,
    boardNudgeOpen,
    addedInListViewRef,
    answerBoardNudge,
    runEdges,
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
    boardColumnLabel,
    startColumnDrag,
    mutateTask,
    startTodaySession,
    uncompleteSessionTask,
    skipSessionTask,
    addSessionTask,
    moveTaskToEdge,
    toggleFavourite,
    toggleTaskCompleted,
    addTask,
    removeTask,
    clearDone,
    openCreateListModal,
    openRenameListModal,
    openCreateGroupModal,
    openRenameGroupModal,
    submitListModal,
    handleGroupsEnabledChange,
    switchToGroup,
    removeGroup,
    removeList,
    editInputRef,
    resizeEditTextarea,
    startEditTask,
    caretAfterEditRef,
    commitEditTask,
    commitEditDuration,
    uploaderForTask,
    uploaderForList,
    toggleNotes,
    saveNotes,
    openTaskOverlay,
    calendarPopoverPlace,
    openCalendarTask,
    openCalendarNewTask,
    subtasksByTask,
    toggleSubtaskDone,
    subtaskNotesId,
    setSubtaskNotesId,
    subtaskNotesDraft,
    setSubtaskNotesDraft,
    subtaskDurEditId,
    setSubtaskDurEditId,
    newSubtaskText,
    setNewSubtaskText,
    newSubtaskAssigneeIds,
    setNewSubtaskAssigneeIds,
    newSubtaskNotes,
    setNewSubtaskNotes,
    newSubtaskNotesOpen,
    setNewSubtaskNotesOpen,
    newSubtaskDuration,
    setNewSubtaskDuration,
    newSubtaskDurEditing,
    setNewSubtaskDurEditing,
    newSubtaskInputRef,
    submitNewSubtask,
    saveSubtaskNotes,
    subtaskDragId,
    subtaskPreview,
    subtaskListRef,
    subtaskHoldRef,
    startSubtaskDrag,
    peopleById,
    searchPeopleCandidates,
    addBoardPerson,
    setPersonPhoto,
    removeBoardPerson,
    toggleTaskAssignee,
    closeAssignMenu,
    exportData,
    importData,
  };
}

export type TodoPageModel = ReturnType<typeof useTodoPage>;
