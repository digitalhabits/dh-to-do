"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import {
  ArrowDownUp,
  ArrowUp,
  Calendar,
  Check,
  ChevronLeft,
  History,
  List,
  ListChecks,
  Plus,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PAGE_CACHE_KEYS, setPageSnapshot } from "@/lib/page-snapshot-cache";
import { isOfflineNow } from "@/lib/offline/todo-offline";
import { useTodoOffline } from "@/lib/offline/use-todo-offline";
import {
  createRemindersTask,
  deleteRemindersTask,
  fetchRemindersLists,
  isNativeShell,
  listenOpenSettings,
  updateRemindersDue,
  updateRemindersStatus,
  updateRemindersTitle,
  type RemindersList,
} from "@/lib/native-shell";
import { TodoOfflineStatusPill } from "@/components/todo/TodoOfflineStatusPill";
import {
  TodoPlannerView,
  type CalendarTaskAnchor,
  type CalendarTaskRequest,
} from "@/components/todo/TodoPlannerView";
import { buildTodoBackup, todoBackupFileName } from "@/lib/todo/backup";
import {
  backupMediaOf,
  base64ToBytes,
  boardMediaIds,
  bytesToBase64,
  withNewMediaIds,
  type BackupMedia,
} from "@/lib/todo/backup-media";
import { rescueBrowserTasks } from "@/lib/todo/browser-tasks-rescue";
import {
  FOCUS_TIMER_ALWAYS_KEY,
  FOCUS_TIMER_PREF_MESSAGE,
  readFocusTimerAlways,
} from "@/lib/todo/focus-time";
import { carryLegacySettings, importLegacyBoard } from "@/lib/todo/legacy-import";
import {
  ME_PERSON_KEY,
  PEOPLE_SCOPE_KEY,
  mePersonIds as mePersonIdsOf,
  tasksInScope,
  THIS_DEVICE_MAKER,
  type PeopleScope,
} from "@/lib/todo/people-scope";
import { describeError, isNetworkBlip } from "@/lib/todo/errors";
import { placeByPosition, placeInColumn } from "@/lib/todo/board-order";
import {
  COLUMN_SORTS,
  DEFAULT_COLUMN_ORDER as DEFAULT_SORT_ORDER,
  byPosition,
  columnComparator,
  isColumnSort,
  type ColumnOrder,
  type ColumnSort,
} from "@/lib/todo/column-sort";
import { openTodoFocusPopout } from "@/lib/todo/focus-popout";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import {
  pendingAttachments,
  trixToBasecamp,
} from "@/lib/todo/basecamp-richtext";
import { noteMediaSrc, resolveBasecampImage } from "@/lib/todo/basecamp-image";
import { todoMediaStore } from "@/lib/todo/media-store";
import { installTauriMediaStore } from "@/lib/todo/tauri-media";
import {
  loadTrix,
  TrixNotesEditor,
  type UploadImage,
} from "@/components/todo/TrixNotesEditor";
import { makeT, type TodoLang } from "@/lib/todo/i18n";
import {
  syncRemindersList,
  type RemindersSyncProgress,
} from "@/lib/todo/reminders-sync";
import { shortPersonName } from "@/lib/todo/people";
import { drainPendingFocusCompletes } from "@/lib/todo/focus-pending";
import {
  BOARD_TASK_CHANGED_MESSAGE,
  FOCUS_CHANNEL,
  TODO_ALL_LIST_ID,
  TODO_CURRENT_LIST_KEY,
  boardColumnOf,
  boardColumnPatch,
  emptyBoardColumns,
  isTodoBoardColumn,
  TODO_BOARD_COLUMNS,
  type TodoBoardColumn,
  type TodoGroup,
  type TodoList,
  type TodoPerson,
  type TodoPersonCandidate,
  type TodoState,
  type TodoTask,
  type TodoTaskPatch,
} from "@/lib/todo/types";
import {
  REMINDERS_CONNECTED_KEY,
  TodoSettingsModal,
  type TodoTheme,
} from "@/components/todo/TodoSettingsModal";
import { MenuKeys } from "@/components/todo/MenuKeys";
import { doneStamp, groupDoneTasks } from "@/lib/todo/done-groups";
import {
  focusStops,
  walkArrowStops,
  walkTabStops,
} from "@/lib/todo/focus-walk";
import { MenuPortal } from "@/components/todo/MenuPortal";
import { AddTaskComposer } from "@/components/todo/AddTaskComposer";
import { DuePopover } from "@/components/todo/DuePopover";
import { DurationPopover } from "@/components/todo/DurationPopover";
import { formatDurationShort } from "@/lib/todo/duration";
import { ClockIcon, NotesIcon } from "@/components/todo/task-icons";
import {
  EMPTY_TASK_DRAFT,
  daysUntilDue,
  formatDueOn,
  formatDueOnShort,
  notesHtmlIsEmpty,
  todayDueOn,
  type TaskDraft,
} from "@/lib/todo/task-draft";

/**
 * What setting a due date writes: the date, and a move to Today when the
 * date is today or already past. A later date waits its turn — the board
 * read puts it in Today on the day (see promoteDueTasks in the store).
 */
function dueDatePatch(dueOn: string | null): TodoTaskPatch {
  return dueOn && dueOn <= todayDueOn()
    ? { dueOn, ...boardColumnPatch("today") }
    : { dueOn };
}
import { TodayFocusSession } from "@/components/todo/TodayFocusSession";
import { TodoSelect } from "@/components/todo/TodoSelect";
import { ListAppearancePicker } from "@/components/todo/ListAppearancePicker";
import {
  TaskAssignMenu,
  TaskAssigneeStack,
  TodoPeopleEditor,
  TodoPersonAvatar,
} from "@/components/todo/TodoPeopleEditor";
import { ListIcon, resolveListIconId } from "@/lib/todo/list-icons";
import { ViewSwitcher } from "@/components/todo/ViewSwitcher";
import { focusToGiveWay } from "@/lib/todo/focus-windows";
import { boardViewIsOn } from "@/lib/todo/board-view-default";
import {
  BOARD_NUDGE_SEEN_KEY,
  BoardViewNudge,
  boardNudgeIsDue,
} from "@/components/todo/BoardViewNudge";
import {
  ROW_GLIDE_EASING,
  ROW_SLIDE_HOLD_MS,
  ROW_SLIDE_MS,
  holdRowsInPlace,
  measureRowBoxes,
  measureRowTops,
  popCheck,
  slideRowsIntoPlace,
} from "@/lib/todo/list-flip";
import { squareAvatarFile } from "@/lib/todo/avatar-image";
import {
  FLIGHT_GLIDE_EASING,
  FLIGHT_GLIDE_MS,
  FLIGHT_HOLD_MS,
  spawnCompletionParty,
  randomSubtaskPartyEmoji,
  spawnTaskGhost,
  waitAnimationFrames,
} from "@/lib/todo/task-celebration";
/**
 * The notes editor, which is a chunk of its own.
 *
 * The import is named so the warm-up below and the component share one module
 * promise: asking twice is asking once, and the second caller waits on the
 * fetch the first one started.
 */
/**
 * Give a picture to Basecamp, so a note can name it.
 *
 * The bytes go through the planner, which holds the token. What comes back
 * is the sgid, which is the only way rich text there can refer to a file,
 * and the blob id, so the picture can be drawn straight away instead of
 * after a sync.
 *
 * Sent with XMLHttpRequest rather than fetch, for the one thing fetch
 * cannot do: say how far a upload has got. A picture over a slow line took
 * twenty seconds here, and a bar frozen part-way through reads as broken
 * even while the bytes are moving.
 */
const uploadBasecampImage: UploadImage = async (file, onProgress) => {
  const res = await new Promise<{ ok: boolean; status: number; text: string }>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        "POST",
        `/api/todo/basecamp-attachment?name=${encodeURIComponent(file.name)}`
      );
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        // Up to 90: the bytes are there, but Basecamp has not answered yet.
        onProgress(Math.round((event.loaded / event.total) * 90));
      });
      xhr.addEventListener("load", () =>
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          text: xhr.responseText,
        })
      );
      xhr.addEventListener("error", () => reject(new Error("network")));
      xhr.addEventListener("abort", () => reject(new Error("aborted")));
      xhr.send(file);
    }
  );
  const body = ((): {
    sgid?: string;
    blobId?: string | null;
    contentType?: string;
    filename?: string;
    filesize?: number;
    width?: number | null;
    height?: number | null;
    error?: string;
  } => {
    try {
      return JSON.parse(res.text);
    } catch {
      return {};
    }
  })();
  if (!res.ok || !body.sgid) {
    toast.error(body.error ?? "The picture could not be added");
    throw new Error(body.error ?? "upload failed");
  }
  return {
    sgid: body.sgid,
    blobId: body.blobId ?? null,
    contentType: body.contentType,
    filename: body.filename,
    filesize: body.filesize,
    width: body.width,
    height: body.height,
  };
};

/** The picture's size, for the note to lay it out before it loads. */
async function imageSize(
  file: File
): Promise<{ width: number | null; height: number | null }> {
  if (typeof createImageBitmap !== "function") return { width: null, height: null };
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

/**
 * A picture into the app's own store, for a note Basecamp does not hold.
 *
 * The planner keeps it in its private bucket, through /api/todo/media; the
 * desktop app keeps it in its SQLite file. Either way the note names the
 * picture by the id that comes back and draws it from where this app can
 * read it. When the task reaches a Basecamp-linked list, the sync gives
 * the picture to Basecamp. See media-store.ts.
 */
const uploadLocalNoteImage: UploadImage = async (file, onProgress) => {
  const filename = file.name || "image";
  const size = await imageSize(file);
  let mediaId: string;
  if (isStandaloneTodo()) {
    installTauriMediaStore();
    onProgress(20);
    const stored = await todoMediaStore().write(
      {
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type,
        filename,
        ...size,
      },
      null
    );
    mediaId = stored.id;
  } else {
    const res = await new Promise<{ ok: boolean; text: string }>(
      (resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/todo/media?name=${encodeURIComponent(filename)}`);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          onProgress(Math.round((event.loaded / event.total) * 90));
        });
        xhr.addEventListener("load", () =>
          resolve({ ok: xhr.status >= 200 && xhr.status < 300, text: xhr.responseText })
        );
        xhr.addEventListener("error", () => reject(new Error("network")));
        xhr.addEventListener("abort", () => reject(new Error("aborted")));
        xhr.send(file);
      }
    );
    const body = ((): { mediaId?: string; error?: string } => {
      try {
        return JSON.parse(res.text);
      } catch {
        return {};
      }
    })();
    if (!res.ok || !body.mediaId) {
      toast.error(body.error ?? "The picture could not be added");
      throw new Error(body.error ?? "upload failed");
    }
    mediaId = body.mediaId;
  }
  return {
    mediaId,
    url: noteMediaSrc(mediaId),
    contentType: file.type,
    filename,
    filesize: file.size,
    width: size.width,
    height: size.height,
  };
};

export type TodoPageSnapshot = { state: TodoState };

const EMPTY_STATE: TodoState = {
  groups: [],
  lists: [],
  tasks: [],
  people: [],
};

/** Normalize task flags from API / older page-cache snapshots. */
function normalizeTaskAssignees(task: TodoTask): TodoTask {
  const legacyId = (task as TodoTask & { assigneeId?: string | null }).assigneeId;
  const assigneeIds = Array.isArray(task.assigneeIds)
    ? task.assigneeIds
    : legacyId
      ? [legacyId]
      : [];
  return {
    ...task,
    isBacklog: Boolean(task.isBacklog),
    isToday:
      typeof task.isToday === "boolean"
        ? task.isToday
        : Boolean(task.isFavourite && !task.isBacklog && !task.isSomeday),
    isSomeday: Boolean(task.isSomeday),
    assigneeIds,
  };
}

/** The assign menu's key for the subtask still being written, which has no id yet. */
const NEW_SUBTASK_ASSIGN_ID = "__new-subtask__";

const LANG_KEY = "redd-plan-todo-lang";
const THEME_KEY = "redd-plan-todo-theme";
const ZOOM_KEY = "redd-plan-todo-zoom";
const GROUPS_KEY = "redd-plan-todo-groups";
const KANBAN_KEY = "redd-plan-todo-kanban";
const PLAN_ENABLED_KEY = "redd-plan-todo-plan";
const COLUMN_ORDER_KEY = "redd-plan-todo-column-order";
const SOMEDAY_EXPANDED_KEY = "redd-plan-todo-someday-expanded";
const SOMEDAY_ENABLED_KEY = "redd-plan-todo-someday-enabled";
/**
 * Assigning tasks to people. Missing key = the default: on inside the
 * planner, where a team shares the board, and off in the standalone app.
 */
const ASSIGN_ENABLED_KEY = "redd-plan-todo-assign-enabled";
/** Left to right on a wide board. One column reads it the other way up. */
const DEFAULT_COLUMN_ORDER: TodoBoardColumn[] = ["backlog", "week", "today"];
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
const TILE_OPEN_COLUMN_KEY = "redd-plan-todo-tile-open-column";
/** Each column's order, kept per device. See lib/todo/column-sort. */
const COLUMN_SORT_KEY = "redd-plan-todo-column-sort";

const SORT_LABEL_KEY: Record<ColumnSort, string> = {
  manual: "sortManual",
  due: "sortDue",
  assignee: "sortAssignee",
  alpha: "sortAlpha",
  duration: "sortDuration",
  recent: "sortRecent",
};

function loadColumnSorts(): Record<TodoBoardColumn, ColumnOrder> {
  const sorts = {
    someday: DEFAULT_SORT_ORDER,
    backlog: DEFAULT_SORT_ORDER,
    week: DEFAULT_SORT_ORDER,
    today: DEFAULT_SORT_ORDER,
  };
  if (typeof window === "undefined") return sorts;
  try {
    const raw = localStorage.getItem(COLUMN_SORT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const column of TODO_BOARD_COLUMNS) {
      const value = parsed[column];
      // The first shape kept the sort's name alone.
      if (isColumnSort(value)) {
        sorts[column] = { sort: value, desc: false };
      } else if (value && typeof value === "object") {
        const { sort, desc } = value as { sort?: unknown; desc?: unknown };
        if (isColumnSort(sort)) sorts[column] = { sort, desc: desc === true };
      }
    }
  } catch {
    /* private mode, or an old shape */
  }
  return sorts;
}

const CURRENT_GROUP_KEY = "redd-plan-todo-current-group";
const FOCUS_MODE_KEY = "redd-plan-todo-focus-mode";
/** The view the reader left the app on: Lists, Favourites or Calendar. */
const VIEW_KEY = "redd-plan-todo-view";
/** How long a task ticked from the focus window stands ticked before it goes. */
const FOCUS_COMPLETE_HOLD_MS = 500;

/**
 * How long a task stays marked as the one just added.
 *
 * Long enough to find with the eye after the column has scrolled, short
 * enough to be gone before it reads as a state the task is in.
 */
const JUST_ADDED_MS = 1600;

/**
 * How long `refresh` waits before reading the board.
 *
 * One gesture can send several writes — a drag renumbers every task it moves
 * past — and each one asks for a read. Long enough to gather a gesture, short
 * enough that a colleague's change still feels immediate.
 */
const REFRESH_COALESCE_MS = 120;

/** A task on no list: the reader's own, shown on the All tab alone. */
function isUnlistedTask(task: Pick<TodoTask, "listId">): boolean {
  return task.listId === null;
}

/* Colour handling ported from redd-do app.js. Swatch display colours follow
   the redd-do modal markup; stored named colours resolve via TAB_COLOR_HEX. */
const TAB_COLOR_HEX: Record<string, string> = {
  red: "#FF9E9E",
  orange: "#FFC09F",
  yellow: "#FFEE93",
  green: "#ADF7B6",
  blue: "#81B1D1",
  purple: "#B19CD9",
  pink: "#FFD1DC",
  gray: "#A0CED9",
};

const COLOR_SWATCHES: { key: string; title: string; display: string }[] = [
  { key: "blue", title: "Sky", display: "#7da9c8" },
  { key: "gray", title: "Ice", display: "#8eb5b0" },
  { key: "green", title: "Mint", display: "#8cb89c" },
  { key: "yellow", title: "Buttercup", display: "#d4ba6a" },
  { key: "pink", title: "Blush", display: "#d4a5a8" },
  { key: "orange", title: "Apricot", display: "#d99a6c" },
  { key: "red", title: "Sunset", display: "#d4605a" },
  { key: "purple", title: "Lavender", display: "#a896c0" },
];

function normalizeHexColor(color: string): string | null {
  if (!color.startsWith("#")) return null;
  let hex = color.slice(1).trim();
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toLowerCase()}`;
}

function resolveTabColorHex(color: string | null): string | null {
  if (!color) return null;
  if (color.startsWith("#")) return normalizeHexColor(color);
  return TAB_COLOR_HEX[color] || null;
}

function hexToRgba(hex: string, alpha: number): string | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const raw = normalized.slice(1);
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Completed-task time label, matching redd-do (<1m under a minute). */
function timeSpentLabel(seconds: number): string {
  if (seconds < 60) return "<1m";
  return `${Math.round(seconds / 60)}m`;
}

/* SVGs copied verbatim from redd-do index.html / app.js */

function ListsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function HeartIcon({ size = 16, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

/**
 * The focus mode button's icon: the Lucide "focus" frame, with its own
 * centre. Off, the centre is a small ring. On, it is a larger filled dot, so
 * the two states tell apart at a glance with no background behind the icon.
 */
function FocusModeIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      {on ? (
        <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
      ) : (
        <circle cx="12" cy="12" r="3" />
      )}
    </svg>
  );
}

function PlanViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function SettingsGearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.16.1a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.2a2 2 0 0 1-1 1.73l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.16.09a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.16-.09a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.73v-.2a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.16-.1a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/* The focus session draws the same notes icon; it keeps importing it here. */
export { NotesIcon };

function FocusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function MenuDotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
    </svg>
  );
}

function MoveToTopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h14" />
      <path d="M12 20V8" />
      <path d="m7 13 5-5 5 5" />
    </svg>
  );
}

function MoveToBottomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 20h14" />
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
    </svg>
  );
}

function DoneChevron() {
  return (
    <svg className="done-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

type ListModalState =
  | { mode: "create"; kind: "list" }
  | { mode: "create"; kind: "group" }
  | { mode: "rename"; kind: "list"; list: TodoList }
  | { mode: "rename"; kind: "group"; group: TodoGroup }
  | null;

type ConfirmModalState = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
} | null;

type UndoState = { message: string; restore: () => void } | null;

/**
 * A position between two neighbors, or past the one neighbor there is.
 * Returns null when the two neighbors sit so close that a double cannot
 * hold a value between them. The caller then reindexes the run instead.
 */
function slotBetween(
  prev: number | undefined,
  next: number | undefined
): number | null {
  if (prev !== undefined && next !== undefined) {
    const mid = (prev + next) / 2;
    return mid > prev && mid < next ? mid : null;
  }
  if (prev !== undefined) return prev + 1;
  if (next !== undefined) return next - 1;
  return null;
}

/** One flight, keyed by the row it lands on. */
function animTargetKey(taskId: string, completed: boolean): string {
  return `${taskId}:${completed ? 1 : 0}`;
}

function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** How long a finger holds a card before the card is carried, not the list scrolled. */
const TOUCH_DRAG_HOLD_MS = 320;

export function TodoPage({
  initialState,
  appVersion,
  viewerEmails = [],
  viewerKeys = [],
}: {
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
}) {
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

  /**
   * Tracks the writes the page sends: a running count, and the set still in
   * flight. `refresh` uses both. A GET that overlaps a write can read the
   * board before that write commits, so its result is older than the board
   * on screen, and `refresh` drops it. Without this, a drop that lands
   * during a focus refresh snaps back to the old order until each PATCH
   * response arrives.
   */
  const mutationSeqRef = React.useRef(0);
  const inFlightWritesRef = React.useRef(new Set<Promise<unknown>>());
  const api = React.useCallback(
    (path: string, method: string, body?: unknown) => {
      if (method.toUpperCase() === "GET") return offlineApi(path, method, body);
      mutationSeqRef.current += 1;
      const write = offlineApi(path, method, body);
      const inFlight = inFlightWritesRef.current;
      inFlight.add(write);
      const settle = () => {
        inFlight.delete(write);
      };
      write.then(settle, settle);
      return write;
    },
    [offlineApi]
  );

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
      if (result.outcome !== "imported") return;
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
  /**
   * The task whose card shows over the Calendar, and where the task is
   * there. A click on a task in the Calendar opens it. The card is
   * the same card as in the lists view, so it is changed in the same way.
   */
  const [calendarCard, setCalendarCard] = React.useState<{
    taskId: string;
    anchor: CalendarTaskAnchor;
  } | null>(null);
  /** The card that a press put away a moment ago, so the click of that press does not bring it back. */
  const calendarCardClosedRef = React.useRef<{ taskId: string; at: number } | null>(null);
  /** A day of the Calendar was double-clicked: the add-task box shows beside it. */
  const [calendarNew, setCalendarNew] = React.useState<CalendarTaskRequest | null>(null);
  React.useEffect(() => {
    if (view !== "plan") {
      setCalendarCard(null);
      setCalendarNew(null);
    }
  }, [view]);

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
  /** The open card whose duration popover is up, and the chip it hangs off. */
  const [durationPopoverTaskId, setDurationPopoverTaskId] = React.useState<
    string | null
  >(null);
  const [durationPopoverAnchor, setDurationPopoverAnchor] =
    React.useState<HTMLElement | null>(null);
  /**
   * The "Show on the Calendar" box of the open due popover. Kept here and not
   * read from the task, because the box can be ticked before a day is picked,
   * when the task cannot hold it yet.
   */
  const [dueCalendarWanted, setDueCalendarWanted] = React.useState(false);
  const [duePopoverTaskId, setDuePopoverTaskId] = React.useState<
    string | null
  >(null);
  const [duePopoverAnchor, setDuePopoverAnchor] =
    React.useState<HTMLElement | null>(null);
  const [editingDuration, setEditingDuration] = React.useState("");
  const [openMenuTaskId, setOpenMenuTaskId] = React.useState<string | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<HTMLElement | null>(
    null
  );
  const [menuShowsMoveTargets, setMenuShowsMoveTargets] = React.useState(false);
  /** All/Favourites: list-origin chip opens a move-to-list picker. */
  const [openListPickerTaskId, setOpenListPickerTaskId] = React.useState<
    string | null
  >(null);
  /* The picker is portaled out of the card, so it is placed against this
     button rather than by the card's own box. See MenuPortal. */
  const [listPickerAnchorEl, setListPickerAnchorEl] =
    React.useState<HTMLElement | null>(null);
  const [openAssignTaskId, setOpenAssignTaskId] = React.useState<string | null>(
    null
  );
  const [assignAnchorEl, setAssignAnchorEl] =
    React.useState<HTMLElement | null>(null);
  /** All-tab only: show tasks assigned to any of these people (`[]` = everyone). */
  const [assigneeFilterIds, setAssigneeFilterIds] = React.useState<string[]>(
    []
  );
  /**
   * Mine, or everyone's — see people-scope.ts. Kept per device, and read
   * after mount so the server's and the browser's first render agree.
   */
  const [peopleScope, setPeopleScope] = React.useState<PeopleScope>("mine");
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(PEOPLE_SCOPE_KEY);
      if (saved === "everyone" || saved === "mine") setPeopleScope(saved);
    } catch {
      /* private mode */
    }
  }, []);
  /**
   * The person marked as "Me" in the People dialog. For the desktop app,
   * which has no login to say who the reader is. Kept per device.
   */
  const [markedMeId, setMarkedMeId] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      setMarkedMeId(localStorage.getItem(ME_PERSON_KEY) || null);
    } catch {
      /* private mode */
    }
  }, []);
  function markMe(personId: string | null) {
    setMarkedMeId(personId);
    try {
      if (personId) localStorage.setItem(ME_PERSON_KEY, personId);
      else localStorage.removeItem(ME_PERSON_KEY);
      // The first mark must not hide most of the board at once. The board
      // stays on everyone, and the reader goes to "My tasks" when they like.
      if (personId && !localStorage.getItem(PEOPLE_SCOPE_KEY)) {
        setPeopleScope("everyone");
        localStorage.setItem(PEOPLE_SCOPE_KEY, "everyone");
      }
    } catch {
      /* private mode */
    }
  }
  function choosePeopleScope(next: PeopleScope) {
    setPeopleScope(next);
    // A person pill is an "everyone" thing: mine has no need of one.
    if (next === "mine") setAssigneeFilterIds([]);
    try {
      localStorage.setItem(PEOPLE_SCOPE_KEY, next);
    } catch {
      /* private mode */
    }
  }
  const [peopleEditorOpen, setPeopleEditorOpen] = React.useState(false);
  const [openNotesTaskId, setOpenNotesTaskId] = React.useState<string | null>(null);
  /** The open note, over the whole window. See renderNotesOverlay. */
  const [notesExpanded, setNotesExpanded] = React.useState(false);
  /** The expanded card's own pickers, so the card's stay untouched. */
  const [overlayListOpen, setOverlayListOpen] = React.useState(false);
  const [overlayAssignAnchor, setOverlayAssignAnchor] =
    React.useState<HTMLElement | null>(null);
  /* A click anywhere else puts either picker away — the same window
     listener the cards' menus use. The menus stop their own clicks, so
     picking several people keeps the list open. */
  React.useEffect(() => {
    if (!overlayAssignAnchor) return;
    const close = () => setOverlayAssignAnchor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [overlayAssignAnchor]);
  React.useEffect(() => {
    if (!overlayListOpen) return;
    const close = () => setOverlayListOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [overlayListOpen]);
  /** Whether the expanded card has more below the fold, for the fade. */
  const [overlayMoreBelow, setOverlayMoreBelow] = React.useState(false);
  const overlayFieldsRef = React.useRef<HTMLDivElement | null>(null);
  const overlayFieldsResize = React.useRef<ResizeObserver | null>(null);
  const updateOverlayFade = React.useCallback(() => {
    const el = overlayFieldsRef.current;
    if (!el) return;
    setOverlayMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);
  /* A stable ref callback: the observer is made once per mount of the
     fields, not once per render, and content growing (a subtask added, a
     note typed) re-measures without a scroll. */
  const setOverlayFieldsNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      overlayFieldsResize.current?.disconnect();
      overlayFieldsResize.current = null;
      overlayFieldsRef.current = node;
      if (!node) return;
      const observer = new ResizeObserver(updateOverlayFade);
      observer.observe(node);
      for (const child of Array.from(node.children)) observer.observe(child);
      overlayFieldsResize.current = observer;
      updateOverlayFade();
    },
    [updateOverlayFade]
  );
  /** Pictures still on their way to Basecamp, from the open editor. */
  const notesUploading = React.useRef(0);
  /** The open editor's note, read at the moment of saving. */
  const notesReadCurrent = React.useRef<(() => string) | null>(null);
  const [notesDraft, setNotesDraft] = React.useState("");
  const [doneCollapsed, setDoneCollapsed] = React.useState(true);
  const [listModal, setListModal] = React.useState<ListModalState>(null);
  const [modalName, setModalName] = React.useState("");
  const [modalColour, setModalColour] = React.useState<string>("");
  const [modalEmoji, setModalEmoji] = React.useState("");

  // Integration linking (Basecamp project/list, Apple Reminders list)
  const [bcConnected, setBcConnected] = React.useState(false);
  const [remindersConnected, setRemindersConnected] = React.useState(false);
  const [bcProjects, setBcProjects] = React.useState<{ id: string; name: string }[]>([]);
  const [bcTodolists, setBcTodolists] = React.useState<{ id: string; name: string }[]>([]);
  const [remindersLists, setRemindersLists] = React.useState<RemindersList[]>([]);
  const [modalBcProjectId, setModalBcProjectId] = React.useState("");
  const [modalBcListId, setModalBcListId] = React.useState("");
  const [modalRemindersListId, setModalRemindersListId] = React.useState("");
  const [importingGroup, setImportingGroup] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  /** Skip enter-auto-sync while an explicit import/sync already covers this list. */
  const suppressAutoSyncListIdsRef = React.useRef(new Set<string>());
  const autoSyncKeyRef = React.useRef<string | null>(null);
  const syncChainRef = React.useRef(Promise.resolve());
  const listsRef = React.useRef<TodoList[]>([]);
  const tasksRef = React.useRef<TodoTask[]>([]);
  const remindersConnectedRef = React.useRef(false);
  const [confirmModal, setConfirmModal] = React.useState<ConfirmModalState>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [undoState, setUndoState] = React.useState<UndoState>(null);
  const undoTimer = React.useRef<number | null>(null);

  // Cross-list search (ported from redd-do's list search). The bar with the
  // people filters is always on screen; the search itself is an icon until
  // it is opened, and `searchRevealed` is that field being open.
  const [searchRevealed, setSearchRevealed] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchListId, setSearchListId] = React.useState<string | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const listSearchRef = React.useRef<HTMLDivElement | null>(null);
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
  // Start false so SSR / web never paints the control; native enables after mount.
  const [nativeShell, setNativeShell] = React.useState(false);
  const [activeFocusTaskIds, setActiveFocusTaskIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const focusChannelRef = React.useRef<BroadcastChannel | null>(null);
  /** Who waits for a focus window to say that it closed. See closeFocusWindowOf. */
  const focusEndWaitersRef = React.useRef(new Map<string, () => void>());
  /**
   * The focus window's tick, applied here. The row is found on the page so
   * the tick can play as the board's own does; a row not on screen — another
   * list, another tab — is completed without the flight.
   */
  function completeFromFocus(taskId: string, timeSpentSeconds?: number) {
    const existing = tasksRef.current.find((t) => t.id === taskId);
    if (!existing || existing.completed) return;
    if (
      typeof timeSpentSeconds === "number" &&
      timeSpentSeconds >= existing.timeSpentSeconds
    ) {
      patchTaskLocal(taskId, { timeSpentSeconds });
    }
    const row = document.querySelector<HTMLElement>(
      `.task-item[data-task-id="${CSS.escape(taskId)}"]`
    );
    const box = row?.querySelector<HTMLInputElement>("input.task-checkbox") ?? null;
    // Ticked, then half a second standing so, then away — as redd-do does
    // it: the focus window has just closed, and the eye arrives after.
    completeTaskWithFlight(existing, true, box, row, FOCUS_COMPLETE_HOLD_MS);
  }
  /** The current completeFromFocus, for the channel handler above it. */
  const completeFromFocusRef = React.useRef<typeof completeFromFocus>(
    completeFromFocus
  );
  completeFromFocusRef.current = completeFromFocus;

  /*
    A tick the focus window gave while no board was open. The planner kept
    it and opened this tile: see focus-pending. Taken up once there are
    tasks to find it among. A task the server already completed is skipped
    by completeFromFocus itself.
  */
  const tasksLoaded = state.tasks.length > 0;
  React.useEffect(() => {
    if (!tasksLoaded) return;
    for (const pending of drainPendingFocusCompletes()) {
      completeFromFocusRef.current(pending.taskId, pending.timeSpentSeconds);
    }
  }, [tasksLoaded]);

  React.useEffect(() => {
    setNativeShell(isNativeShell());
  }, []);

  // Pointer-based drag reorder (ported from redd-do: 4px threshold, live preview)
  const [draggingTaskId, setDraggingTaskId] = React.useState<string | null>(null);
  const [draggingListId, setDraggingListId] = React.useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = React.useState<string | null>(null);
  const [draggingPersonId, setDraggingPersonId] = React.useState<string | null>(
    null
  );
  /** While dragging on the board: which column the pointer is over. */
  const [boardDragHover, setBoardDragHover] = React.useState<{
    taskId: string;
    column: TodoBoardColumn;
  } | null>(null);
  const boardDragHoverRef = React.useRef<{
    taskId: string;
    column: TodoBoardColumn;
  } | null>(null);
  /** A drop on a rail must not also expand or collapse that column. */
  const suppressRailClickRef = React.useRef(false);
  const [taskPreviewIds, setTaskPreviewIds] = React.useState<string[] | null>(null);
  /** The list tab a dragged task is over, if any. Dropping there moves it. */
  const [taskDropListId, setTaskDropListId] = React.useState<string | null>(null);
  const taskDropListIdRef = React.useRef<string | null>(null);
  const [listPreviewIds, setListPreviewIds] = React.useState<string[] | null>(null);
  const [groupPreviewIds, setGroupPreviewIds] = React.useState<string[] | null>(null);
  const [personPreviewIds, setPersonPreviewIds] = React.useState<
    string[] | null
  >(null);
  const taskDragRef = React.useRef<{
    taskId: string;
    startX: number;
    startY: number;
    started: boolean;
    /** "touch" or "mouse"/"pen": a finger has to hold before it can drag. */
    pointerType: string;
    /** The hold that turns a still finger into a drag; null once it fired or went. */
    holdTimer: number | null;
  } | null>(null);
  /**
   * While a card is carried near the top or bottom of what scrolls, that
   * scrolls, so a card can go further than the screen shows — the only
   * way on a phone, where there is no wheel to turn mid-drag.
   */
  const dragAutoScrollRef = React.useRef<{ el: HTMLElement; dy: number } | null>(null);
  const dragAutoScrollFrameRef = React.useRef<number | null>(null);
  const tabDragRef = React.useRef<{
    listId: string;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const groupDragRef = React.useRef<{
    groupId: string;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const personDragRef = React.useRef<{
    personId: string;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const tabsRowRef = React.useRef<HTMLDivElement | null>(null);
  const groupsRowRef = React.useRef<HTMLDivElement | null>(null);
  const filterRowRef = React.useRef<HTMLDivElement | null>(null);
  const suppressTabClickUntil = React.useRef(0);
  const suppressGroupClickUntil = React.useRef(0);
  const suppressPersonClickUntil = React.useRef(0);

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
  const [lang, setLang] = React.useState<TodoLang>("en");
  const [theme, setTheme] = React.useState<TodoTheme>("system");
  const [zoom, setZoom] = React.useState(100);
  const [systemDark, setSystemDark] = React.useState(false);

  React.useEffect(() => {
    try {
      const l = localStorage.getItem(LANG_KEY);
      if (l === "da" || l === "en") setLang(l);
      const th = localStorage.getItem(THEME_KEY);
      if (th === "light" || th === "dark" || th === "system") setTheme(th);
      const z = Number(localStorage.getItem(ZOOM_KEY));
      if (Number.isFinite(z) && z >= 50 && z <= 170) setZoom(z);
      // A new reader starts with one list. See board-view-default.ts for
      // who keeps the board. The answer is saved, so it is decided one time.
      const boardOn = boardViewIsOn({
        stored: localStorage.getItem(KANBAN_KEY),
        savedCurrentList: localStorage.getItem(TODO_CURRENT_LIST_KEY),
      });
      setKanbanEnabled(boardOn);
      if (localStorage.getItem(KANBAN_KEY) === null) {
        localStorage.setItem(KANBAN_KEY, boardOn ? "1" : "0");
      }
      setPlanEnabled(localStorage.getItem(PLAN_ENABLED_KEY) === "1");
      const storedOrder = localStorage.getItem(COLUMN_ORDER_KEY);
      if (storedOrder) {
        const parsed = storedOrder.split(",") as TodoBoardColumn[];
        const complete =
          parsed.length === DEFAULT_COLUMN_ORDER.length &&
          DEFAULT_COLUMN_ORDER.every((column) => parsed.includes(column));
        if (complete) setColumnOrder(parsed);
      }
      setSomedayExpanded(localStorage.getItem(SOMEDAY_EXPANDED_KEY) === "1");
      setSomedayEnabled(localStorage.getItem(SOMEDAY_ENABLED_KEY) === "1");
      const assign = localStorage.getItem(ASSIGN_ENABLED_KEY);
      setAssignEnabled(assign === null ? !isStandaloneTodo() : assign === "1");
      setFocusTimerAlways(readFocusTimerAlways());
      setGroupsEnabled(localStorage.getItem(GROUPS_KEY) === "1");
      const g = localStorage.getItem(CURRENT_GROUP_KEY);
      if (g) setCurrentGroupId(g);
      const savedList = localStorage.getItem(TODO_CURRENT_LIST_KEY);
      if (savedList === TODO_ALL_LIST_ID || savedList) setCurrentListId(savedList);
      setFocusMode(localStorage.getItem(FOCUS_MODE_KEY) === "1");
      // A view that is off now is put right by the two effects below.
      const savedView = localStorage.getItem(VIEW_KEY);
      if (savedView === "favourites" || savedView === "plan") setView(savedView);
    } catch {
      /* private mode */
    }
    viewRestoredRef.current = true;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
  }, [shellWidth]);
  const shellWidthClasses =
    shellWidth == null
      ? ""
      : SHELL_WIDTHS.filter((w) => shellWidth <= w.max)
          .map((w) => w.className)
          .join(" ");

  const t = React.useMemo(() => makeT(lang), [lang]);
  const effectiveDark = theme === "dark" || (theme === "system" && systemDark);

  function persistPref(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  React.useEffect(() => {
    if (state !== EMPTY_STATE) {
      setPageSnapshot<TodoPageSnapshot>(PAGE_CACHE_KEYS.todo, { state });
    }
  }, [state]);

  /**
   * Reads the whole board once and puts it on screen.
   *
   * Returns false when the result arrived too late to use: a write that
   * started while the read was in the air makes the server's answer older
   * than the board the user is looking at, and showing it would snap a
   * dropped task back to where it came from. The caller reads again.
   */
  const readBoard = React.useCallback(async () => {
    const inFlight = inFlightWritesRef.current;
    if (inFlight.size) await Promise.allSettled([...inFlight]);
    const seqBefore = mutationSeqRef.current;
    // The reader's day goes along, so the tasks due by then are in Today.
    const json = await api(`/api/todo/state?today=${todayDueOn()}`, "GET");
    if (mutationSeqRef.current !== seqBefore) return false;
    const next = json.state as TodoState;
    boardLoadedRef.current = true;
    setState({
      ...EMPTY_STATE,
      ...next,
      people: next.people ?? [],
      tasks: (next.tasks ?? []).map(normalizeTaskAssignees),
    });
    return true;
  }, [api]);

  /**
   * One read of the board at a time, and one more after it if anything asked
   * while it was running.
   *
   * Almost every edit asks for a read, and an edit is rarely alone: ticking
   * off three tasks, or a drag that renumbers a column, asked for a full read
   * of the board each time. The board only ever shows the newest one, so the
   * reads in between were work nobody saw — and each one was a request that
   * could fail on its own.
   *
   * Asking during a read sets `again` rather than starting a second read, so
   * a burst costs one read, or two when the burst straddles one. The short
   * wait first lets the edits of a single gesture arrive together; the board
   * already shows them, so nobody is waiting on this.
   *
   * Three reads is the ceiling. Past that the writes are arriving faster than
   * the server can answer, and the board stays as it is until the next ask.
   */
  const refreshStateRef = React.useRef<{
    running: Promise<void> | null;
    again: boolean;
  }>({ running: null, again: false });

  /**
   * Fetch the editor before anybody opens a note.
   *
   * Otherwise the first note opened pays for the chunk, with the reader in
   * front of the box while it arrives. A moment after the board is up nobody
   * is waiting on anything, so the wait goes there instead. It is one fetch:
   * every later caller gets the same promise.
   */
  React.useEffect(() => {
    // The editor's own loader, so the warm-up and the first editor to open
    // share one fetch. See loadTrix for why it is not an import.
    const id = window.setTimeout(() => void loadTrix().catch(() => {}), 300);
    return () => window.clearTimeout(id);
  }, []);

  const refresh = React.useCallback((): Promise<void> => {
    const pending = refreshStateRef.current;
    if (pending.running) {
      pending.again = true;
      return pending.running;
    }
    const run = (async () => {
      try {
        await new Promise((resolve) =>
          setTimeout(resolve, REFRESH_COALESCE_MS)
        );
        for (let attempt = 0; attempt < 3; attempt += 1) {
          pending.again = false;
          const applied = await readBoard();
          if (applied && !pending.again) return;
        }
      } catch (err) {
        // Keep the cached snapshot when offline — do not clear the board.
        if (isOfflineNow()) return;
        if (isNetworkBlip(err)) {
          /*
            "Load failed", said by WebKit about a fetch that a reload
            killed or that lost a race with the shell coming up. The
            cached board is on screen; one quiet retry usually settles
            it, and only a second failure is worth a toast.
          */
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            await readBoard();
            return;
          } catch {
            toast.error("Failed to load tasks. Check the connection.");
            return;
          }
        }
        toast.error(describeError(err, "Failed to load tasks"));
      } finally {
        pending.running = null;
        pending.again = false;
      }
    })();
    pending.running = run;
    return run;
  }, [readBoard]);

  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * The board is shared, but it only loads on mount. A task that a colleague
   * adds — or that an agent adds through the MCP server — stays invisible
   * until the page reloads. Read the board again when the tab comes back to
   * the front. An edit in progress blocks the refresh, so the row under the
   * cursor does not move while the user types.
   */
  const lastRefreshAtRef = React.useRef(Date.now());
  React.useEffect(() => {
    const MIN_GAP_MS = 10_000;
    function refreshOnReturn() {
      if (document.visibilityState !== "visible") return;
      if (editingTaskId || editingDurationTaskId) return;
      if (isOfflineNow()) return;
      const now = Date.now();
      if (now - lastRefreshAtRef.current < MIN_GAP_MS) return;
      lastRefreshAtRef.current = now;
      void refreshRef.current();
    }
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [editingTaskId, editingDurationTaskId]);

  // Integration connection state (re-checked whenever settings closes).
  React.useEffect(() => {
    if (settingsOpen) return;
    try {
      setRemindersConnected(
        localStorage.getItem(REMINDERS_CONNECTED_KEY) === "1"
      );
    } catch {
      /* ignore */
    }
    void api("/api/todo/basecamp/status", "GET")
      .then((json: { connected?: boolean }) =>
        setBcConnected(Boolean(json.connected))
      )
      .catch(() => setBcConnected(false));
  }, [settingsOpen, api]);

  // Load link options when list/group dialogs open with integrations connected.
  const needsBcProjects =
    listModal?.kind === "list" ||
    (listModal?.kind === "group" && listModal.mode === "create");
  const listModalOpen = listModal?.kind === "list";
  React.useEffect(() => {
    if (!listModal || !needsBcProjects) return;
    if (bcConnected) {
      void api("/api/todo/basecamp/projects", "GET")
        .then((json) =>
          setBcProjects(json.projects as { id: string; name: string }[])
        )
        .catch(() => setBcProjects([]));
    }
    if (listModalOpen && remindersConnected && isNativeShell()) {
      void fetchRemindersLists()
        .then(setRemindersLists)
        .catch(() => setRemindersLists([]));
    }
  }, [listModal, needsBcProjects, listModalOpen, bcConnected, remindersConnected]);

  async function selectBcProject(projectId: string) {
    setModalBcProjectId(projectId);
    setModalBcListId("");
    setBcTodolists([]);
    // Group create: prefill empty name from the project (like redd-do).
    if (listModal?.kind === "group" && listModal.mode === "create") {
      if (projectId && !modalName.trim()) {
        const project = bcProjects.find((p) => p.id === projectId);
        if (project) setModalName(project.name);
      }
      return;
    }
    if (!projectId) return;
    try {
      const json = await api(
        `/api/todo/basecamp/todolists?projectId=${encodeURIComponent(projectId)}`,
        "GET"
      );
      setBcTodolists(json.todolists as { id: string; name: string }[]);
    } catch {
      setBcTodolists([]);
    }
  }

  function selectBcList(listId: string) {
    setModalBcListId(listId);
    if (!listId || modalName.trim()) return;
    const list = bcTodolists.find((l) => l.id === listId);
    if (!list) return;
    const project = bcProjects.find((p) => p.id === modalBcProjectId);
    const prefix = project?.name.trim().split(/\s+/)[0];
    setModalName(prefix ? `${prefix}: ${list.name}` : list.name);
  }

  function selectRemindersList(listId: string) {
    setModalRemindersListId(listId);
    if (!listId || modalName.trim()) return;
    const list = remindersLists.find((l) => l.id === listId);
    if (list) setModalName(list.name);
  }

  function listOfTask(task: TodoTask): TodoList | undefined {
    return state.lists.find((l) => l.id === task.listId);
  }

  /** Best-effort client-side push to Apple Reminders (EventKit is on this
   *  machine, so unlike Basecamp this can't run on the server). */
  function pushReminders(fn: () => Promise<unknown>) {
    if (!isNativeShell() || !remindersConnected) return;
    void fn().catch(() => {
      /* surfaces at the next explicit sync */
    });
  }

  function remindersProgressLabel(progress: RemindersSyncProgress): string {
    if (progress.phase === "reading") {
      return "Reading Apple Reminders…";
    }
    if (progress.total <= 0) {
      if (progress.phase === "importing") return "Importing from Apple Reminders…";
      if (progress.phase === "updating") return "Updating tasks from Apple Reminders…";
      if (progress.phase === "pushing") return "Pushing tasks to Apple Reminders…";
      if (progress.phase === "removing") return "Removing deleted Reminders tasks…";
      return "Syncing Apple Reminders…";
    }
    const count = `${progress.done}/${progress.total}`;
    if (progress.phase === "importing") {
      return `Importing from Apple Reminders… ${count}`;
    }
    if (progress.phase === "updating") {
      return `Updating from Apple Reminders… ${count}`;
    }
    if (progress.phase === "pushing") {
      return `Pushing to Apple Reminders… ${count}`;
    }
    if (progress.phase === "removing") {
      return `Removing deleted Reminders tasks… ${count}`;
    }
    return `Syncing Apple Reminders… ${count}`;
  }

  function formatSyncCounts(
    source: string,
    counts: {
      pulled: number;
      pushed: number;
      removed: number;
      updated: number;
    }
  ): string {
    const parts: string[] = [];
    if (counts.pulled)
      parts.push(
        `added ${counts.pulled} new task${counts.pulled === 1 ? "" : "s"} from ${source}`
      );
    if (counts.pushed)
      parts.push(
        `sent ${counts.pushed} task${counts.pushed === 1 ? "" : "s"} to ${source}`
      );
    if (counts.updated)
      parts.push(
        `updated ${counts.updated} task${counts.updated === 1 ? "" : "s"}`
      );
    if (counts.removed)
      parts.push(
        `removed ${counts.removed} task${counts.removed === 1 ? "" : "s"} deleted remotely`
      );
    if (!parts.length) return `${source}: already up to date`;
    return parts.join(" · ");
  }

  function listHasSyncLink(
    list: TodoList | null | undefined,
    remindersOk = remindersConnectedRef.current
  ): boolean {
    if (!list) return false;
    return Boolean(
      list.basecampListId ||
        (list.remindersListId && isNativeShell() && remindersOk)
    );
  }

  async function runSyncForLists(
    listsToSync: TodoList[],
    opts?: {
      silent?: boolean;
      toastId?: string | number;
    }
  ): Promise<string[]> {
    if (isOfflineNow()) {
      if (!opts?.silent) {
        toast.info("Basecamp and Reminders sync need a connection.");
      }
      return [];
    }
    const silent = Boolean(opts?.silent);
    const summaries: string[] = [];
    const blockedAssignees = new Set<string>();
    const nameLinkedPeople = new Set<string>();
    const ambiguousPeople = new Set<string>();
    for (const list of listsToSync) {
      if (list.basecampListId) {
        const json = await api("/api/todo/basecamp/sync", "POST", {
          listId: list.id,
        });
        const result = json.result as {
          pulled: number;
          pushed: number;
          removed: number;
          updated: number;
          unpushableAssignees?: string[];
          nameLinkedPeople?: string[];
          ambiguousPeople?: string[];
        };
        for (const name of result.unpushableAssignees ?? []) {
          blockedAssignees.add(name);
        }
        for (const name of result.nameLinkedPeople ?? []) {
          nameLinkedPeople.add(name);
        }
        for (const name of result.ambiguousPeople ?? []) {
          ambiguousPeople.add(name);
        }
        summaries.push(
          `${list.name}: ${formatSyncCounts("Basecamp", result)}`
        );
      }
      if (
        list.remindersListId &&
        isNativeShell() &&
        remindersConnectedRef.current
      ) {
        const result = await syncRemindersList(
          list,
          // Parents only: Reminders has no subtasks, and a child pushed
          // there would come back as a full task.
          tasksRef.current.filter((t) => t.listId === list.id && !t.parentTaskId),
          {
            // The page's api, which in the desktop app writes to SQLite.
            api,
            onProgress: silent
              ? undefined
              : (progress) => {
                  if (opts?.toastId == null) return;
                  toast.loading(
                    `Syncing “${list.name}”… ${remindersProgressLabel(progress)}`,
                    { id: opts.toastId }
                  );
                },
          }
        );
        summaries.push(
          `${list.name}: ${formatSyncCounts("Reminders", result)}`
        );
      }
    }
    // Basecamp only accepts people who are on the project, and matching by
    // name is a guess. Say both out loud — a quiet drop looks like data loss.
    if (!silent && blockedAssignees.size) {
      toast.warning("Some people were not sent to Basecamp", {
        description: `${[...blockedAssignees].join(", ")} — add them to the Basecamp project first.`,
        duration: 9000,
      });
    }
    if (!silent && nameLinkedPeople.size) {
      toast.message("Matched people to Basecamp by name", {
        description: `${[...nameLinkedPeople].join(", ")} — no email to match on. Check this is right.`,
        duration: 9000,
      });
    }
    if (!silent && ambiguousPeople.size) {
      toast.warning("Added a second person with the same name", {
        description: `${[...ambiguousPeople].join(", ")} — the board has more than one. Merge them by hand.`,
        duration: 9000,
      });
    }
    await refresh();
    return summaries;
  }

  function enqueueSync(
    listsToSync: TodoList[],
    opts?: { silent?: boolean; toastId?: string | number }
  ): Promise<string[]> {
    const job = syncChainRef.current.then(async () => {
      setSyncing(true);
      try {
        return await runSyncForLists(listsToSync, opts);
      } finally {
        setSyncing(false);
      }
    });
    syncChainRef.current = job.then(
      () => undefined,
      () => undefined
    );
    return job;
  }

  async function doSync() {
    const listsToSync = isAllListsView
      ? lists.filter((l) => listHasSyncLink(l, remindersConnected))
      : activeList && listHasSyncLink(activeList, remindersConnected)
        ? [activeList]
        : [];
    if (!listsToSync.length) {
      toast.message("Nothing to sync", {
        description: "No linked Basecamp or Apple Reminders lists here.",
      });
      return;
    }

    const label = isAllListsView
      ? listsToSync.length === 1
        ? listsToSync[0].name
        : `${listsToSync.length} lists`
      : listsToSync[0].name;
    const syncSources = [
      listsToSync.some((l) => l.basecampListId) ? "Basecamp" : null,
      listsToSync.some(
        (l) => l.remindersListId && isNativeShell() && remindersConnected
      )
        ? "Apple Reminders"
        : null,
    ].filter(Boolean);
    const toastId = toast.loading(
      `Syncing “${label}” with ${syncSources.join(" + ")}…`
    );
    try {
      const summaries = await enqueueSync(listsToSync, { toastId });
      const allQuiet = summaries.every((s) => s.includes("already up to date"));
      toast.success(allQuiet ? `“${label}” is up to date` : `Synced “${label}”`, {
        id: toastId,
        description: summaries.join(" · "),
        duration: allQuiet ? 3500 : 7000,
      });
    } catch (err) {
      toast.error(describeError(err, "Sync failed"), {
        id: toastId,
      });
    }
  }

  function autoSyncList(list: TodoList | null | undefined) {
    if (!listHasSyncLink(list)) return;
    if (suppressAutoSyncListIdsRef.current.has(list!.id)) return;
    void enqueueSync([list!], { silent: true }).catch(() => {
      /* silent auto-sync: surface faults on the next manual sync */
    });
  }

  React.useEffect(() => {
    if (!openMenuTaskId) return;
    const close = () => {
      setOpenMenuTaskId(null);
      setMenuShowsMoveTargets(false);
      setMenuAnchorEl(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuTaskId]);

  React.useEffect(() => {
    if (!openListPickerTaskId) return;
    const close = () => setOpenListPickerTaskId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openListPickerTaskId]);

  React.useEffect(() => {
    if (!openAssignTaskId) return;
    const close = () => {
      setOpenAssignTaskId(null);
      setAssignAnchorEl(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openAssignTaskId]);

  // Focus-window sync: track which tasks have live focus panels, refresh on
  // their writes, and route exit requests (mirrors redd-do's Tauri events).
  // Skip on the web — the floating panel is desktop-only.
  React.useEffect(() => {
    if (!nativeShell) return;
    const channel = new BroadcastChannel(FOCUS_CHANNEL);
    focusChannelRef.current = channel;
    channel.onmessage = (e) => {
      const msg = e.data as { type: string; taskId?: string };
      if (msg.type === "focus-started" && msg.taskId) {
        setActiveFocusTaskIds((prev) => new Set(prev).add(msg.taskId as string));
      } else if (msg.type === "focus-ended" && msg.taskId) {
        setActiveFocusTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.taskId as string);
          return next;
        });
        focusEndWaitersRef.current.get(msg.taskId)?.();
      } else if (msg.type === "task-updated") {
        void refresh();
      } else if (msg.type === "task-complete" && msg.taskId) {
        // The focus window's tick. The board completes the task the way
        // its own checkbox does: the party and the flight to Done.
        const done = msg as { taskId: string; timeSpentSeconds?: number };
        completeFromFocusRef.current(done.taskId, done.timeSpentSeconds);
      }
    };
    return () => {
      channel.close();
      focusChannelRef.current = null;
    };
  }, [nativeShell, refresh]);

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

  const revealSearch = React.useCallback(() => {
    setSearchRevealed(true);
    requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }, []);

  /** Fold the field back to its icon. The people filters stay as they are. */
  const hideSearch = React.useCallback((clearQuery = false) => {
    setSearchRevealed(false);
    // The field is folded away but still in the tree. Focus must not stay in it.
    searchInputRef.current?.blur();
    if (clearQuery) {
      setSearchQuery("");
      setSearchListId(null);
    }
  }, []);

  /** The zoom as the key handler below reads it: the newest, with no wait for a paint. */
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;

  // Cmd/Ctrl + and − zoom, and Cmd/Ctrl 0 goes back to 100%, as in a
  // browser. The same steps and limits as the buttons in Settings. The
  // desktop app only: in the planner these keys stay the browser's own.
  React.useEffect(() => {
    if (!isStandaloneTodo()) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      // By the character, not the key's place, so it works on any layout:
      // on a Danish keyboard + has a key of its own.
      let step: number | "reset" | null = null;
      if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") step = 10;
      else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") step = -10;
      else if (e.key === "0" || e.code === "Numpad0") step = "reset";
      if (step === null) return;
      e.preventDefault();
      const current = zoomRef.current;
      const next =
        step === "reset" ? 100 : Math.min(170, Math.max(50, current + step));
      if (next !== current) {
        zoomRef.current = next;
        setZoom(next);
        persistPref(ZOOM_KEY, String(next));
      }
      // Says the zoom in the top right corner, as a browser does. One toast
      // that changes its number, and it shows at a limit too, so a press
      // that can go no further still gets an answer.
      toast(`${next}%`, {
        id: "todo-zoom",
        position: "top-right",
        duration: 1400,
        closeButton: false,
        className: "todo-zoom-toast",
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
  }, [revealSearch, hideSearch]);

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
  }, [hideSearch]);

  /** The nearest thing above `from` that scrolls and has more to show. */
  function scrollableAbove(from: Element | null): HTMLElement | null {
    let el = from as HTMLElement | null;
    while (el && el !== document.body) {
      const overflow = getComputedStyle(el).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Scroll what a carried card is over when the card is near its edge —
   * or past it: the add row sits over a column's foot, and a finger that
   * has gone below the column still means "further down".
   */
  function steerDragAutoScroll(x: number, y: number) {
    const edge = 56;
    const el =
      scrollableAbove(document.elementFromPoint(x, y)) ??
      scrollableAbove(document.querySelector(".task-item.dragging"));
    let dy = 0;
    if (el) {
      const rect = el.getBoundingClientRect();
      const speed = (factor: number) => Math.ceil(Math.min(1, Math.max(0, factor)) * 14);
      if (y < rect.top + edge) dy = -speed((rect.top + edge - y) / edge);
      else if (y > rect.bottom - edge) dy = speed((y - (rect.bottom - edge)) / edge);
    }
    dragAutoScrollRef.current = el && dy ? { el, dy } : null;
    if (dragAutoScrollRef.current && dragAutoScrollFrameRef.current == null) {
      const step = () => {
        const scroll = dragAutoScrollRef.current;
        if (!scroll || !taskDragRef.current?.started) {
          dragAutoScrollFrameRef.current = null;
          return;
        }
        scroll.el.scrollTop += scroll.dy;
        dragAutoScrollFrameRef.current = requestAnimationFrame(step);
      };
      dragAutoScrollFrameRef.current = requestAnimationFrame(step);
    }
  }

  // Pointer-drag: window-level move/up so drags survive leaving the row.
  React.useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const taskDrag = taskDragRef.current;
      if (taskDrag) {
        if (!taskDrag.started) {
          const moved =
            Math.abs(e.clientX - taskDrag.startX) >= 4 ||
            Math.abs(e.clientY - taskDrag.startY) >= 4;
          if (taskDrag.pointerType === "touch") {
            // A finger that moves before the hold is up is scrolling the
            // list, not carrying a card. The hold is called off and the
            // page scrolls as it always did.
            if (
              Math.abs(e.clientX - taskDrag.startX) >= 8 ||
              Math.abs(e.clientY - taskDrag.startY) >= 8
            ) {
              if (taskDrag.holdTimer != null) window.clearTimeout(taskDrag.holdTimer);
              taskDragRef.current = null;
            }
            return;
          }
          if (!moved) return;
          taskDrag.started = true;
          setDraggingTaskId(taskDrag.taskId);
        }
        e.preventDefault();
        const container = tasksContainerRef.current;
        if (!container) return;
        steerDragAutoScroll(e.clientX, e.clientY);
        const live = liveRef.current;
        const dragged = live.state.tasks.find((t) => t.id === taskDrag.taskId);
        // A search hides rows; it does not stop the board being a board.
        // Where the task belongs in the column it cannot see is worked out
        // by placeInColumn.
        const boardMode = live.view === "lists" && dragged;

        // A tab under the pointer means another list, not another place in
        // this one. Take the drop there and leave the order alone.
        const tabUnder = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>(".tab[data-list-id]");
        const dropListId = tabUnder?.dataset.listId;
        const overTab =
          dropListId &&
          dropListId !== TODO_ALL_LIST_ID &&
          dragged &&
          dropListId !== dragged.listId
            ? dropListId
            : null;
        if (taskDropListIdRef.current !== overTab) {
          taskDropListIdRef.current = overTab;
          setTaskDropListId(overTab);
        }
        if (overTab) {
          boardDragHoverRef.current = null;
          setBoardDragHover(null);
          setTaskPreviewIds(null);
          return;
        }

        let column: TodoBoardColumn | null = null;
        if (boardMode && dragged) {
          const under = document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest<HTMLElement>("[data-board-column]");
          const hoverAttr = under?.dataset.boardColumn;
          column = isTodoBoardColumn(hoverAttr)
            ? hoverAttr
            : boardColumnOf(dragged, live.somedayEnabled);
          const hover = { taskId: taskDrag.taskId, column };
          boardDragHoverRef.current = hover;
          setBoardDragHover((prev) =>
            prev?.taskId === hover.taskId && prev.column === hover.column
              ? prev
              : hover
          );
        } else {
          boardDragHoverRef.current = null;
          setBoardDragHover(null);
        }

        const scope =
          column != null
            ? container.querySelector<HTMLElement>(
                `[data-board-column="${column}"] .board-column-tasks`
              )
            : container;
        if (!scope) return;
        const rows = Array.from(
          scope.querySelectorAll<HTMLElement>(":scope > .task-item")
        ).filter((el) => el.dataset.taskId !== taskDrag.taskId);
        let index = rows.length;
        for (let i = 0; i < rows.length; i++) {
          const rect = rows[i].getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            index = i;
            break;
          }
        }
        const colIds = rows
          .map((el) => el.dataset.taskId)
          .filter((id): id is string => Boolean(id));
        colIds.splice(index, 0, taskDrag.taskId);

        let ids = colIds;
        if (column != null && dragged) {
          // What the board is drawing, in its order — see boardScopeRef.
          const open = boardScopeRef.current;
          const byCol = emptyBoardColumns<string>();
          for (const t of open) {
            if (t.id === taskDrag.taskId) continue;
            byCol[boardColumnOf(t, live.somedayEnabled)].push(t.id);
          }
          byCol[column] = placeInColumn(byCol[column], colIds, taskDrag.taskId);
          ids = [
            ...byCol.someday,
            ...byCol.backlog,
            ...byCol.week,
            ...byCol.today,
          ];
        }

        setTaskPreviewIds((prev) =>
          prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])
            ? prev
            : ids
        );
        return;
      }

      const tabDrag = tabDragRef.current;
      if (tabDrag) {
        if (!tabDrag.started) {
          if (
            Math.abs(e.clientX - tabDrag.startX) < 4 &&
            Math.abs(e.clientY - tabDrag.startY) < 4
          )
            return;
          tabDrag.started = true;
          setDraggingListId(tabDrag.listId);
        }
        e.preventDefault();
        const row = tabsRowRef.current;
        if (!row) return;
        const tabEls = Array.from(
          row.querySelectorAll<HTMLElement>(".tab")
        ).filter(
          (el) =>
            el.dataset.listId &&
            el.dataset.listId !== TODO_ALL_LIST_ID &&
            el.dataset.listId !== tabDrag.listId
        );
        let index = tabEls.length;
        for (let i = 0; i < tabEls.length; i++) {
          const rect = tabEls[i].getBoundingClientRect();
          if (e.clientX < rect.left + rect.width / 2) {
            index = i;
            break;
          }
        }
        const ids = tabEls
          .map((el) => el.dataset.listId)
          .filter((id): id is string => Boolean(id));
        ids.splice(index, 0, tabDrag.listId);
        setListPreviewIds((prev) =>
          prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])
            ? prev
            : ids
        );
        return;
      }

      const groupDrag = groupDragRef.current;
      if (groupDrag) {
        if (!groupDrag.started) {
          if (
            Math.abs(e.clientX - groupDrag.startX) < 4 &&
            Math.abs(e.clientY - groupDrag.startY) < 4
          )
            return;
          groupDrag.started = true;
          setDraggingGroupId(groupDrag.groupId);
        }
        e.preventDefault();
        const row = groupsRowRef.current;
        if (!row) return;
        const groupEls = Array.from(
          row.querySelectorAll<HTMLElement>(".group-tab")
        ).filter((el) => el.dataset.groupId !== groupDrag.groupId);
        let index = groupEls.length;
        for (let i = 0; i < groupEls.length; i++) {
          const rect = groupEls[i].getBoundingClientRect();
          if (e.clientX < rect.left + rect.width / 2) {
            index = i;
            break;
          }
        }
        const ids = groupEls
          .map((el) => el.dataset.groupId)
          .filter((id): id is string => Boolean(id));
        ids.splice(index, 0, groupDrag.groupId);
        setGroupPreviewIds((prev) =>
          prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])
            ? prev
            : ids
        );
        return;
      }

      const personDrag = personDragRef.current;
      if (personDrag) {
        if (!personDrag.started) {
          if (
            Math.abs(e.clientX - personDrag.startX) < 4 &&
            Math.abs(e.clientY - personDrag.startY) < 4
          )
            return;
          personDrag.started = true;
          setDraggingPersonId(personDrag.personId);
        }
        e.preventDefault();
        const row = filterRowRef.current;
        if (!row) return;
        // Everyone carries no person id, so it is never a place to drop and
        // never moves: the chips order behind it.
        const chipEls = Array.from(
          row.querySelectorAll<HTMLElement>("[data-person-id]")
        ).filter((el) => el.dataset.personId !== personDrag.personId);
        let index = chipEls.length;
        for (let i = 0; i < chipEls.length; i++) {
          const rect = chipEls[i].getBoundingClientRect();
          if (e.clientX < rect.left + rect.width / 2) {
            index = i;
            break;
          }
        }
        const ids = chipEls
          .map((el) => el.dataset.personId)
          .filter((id): id is string => Boolean(id));
        ids.splice(index, 0, personDrag.personId);
        setPersonPreviewIds((prev) =>
          prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])
            ? prev
            : ids
        );
      }
    };

    const onPointerUp = () => {
      const taskDrag = taskDragRef.current;
      taskDragRef.current = null;
      if (taskDrag?.holdTimer != null) window.clearTimeout(taskDrag.holdTimer);
      dragAutoScrollRef.current = null;
      const tabDrag = tabDragRef.current;
      tabDragRef.current = null;
      const groupDrag = groupDragRef.current;
      groupDragRef.current = null;
      const personDrag = personDragRef.current;
      personDragRef.current = null;
      if (taskDrag?.started) {
        finishTaskDrag(taskDrag.taskId);
      } else if (taskDrag) {
        boardDragHoverRef.current = null;
        setBoardDragHover(null);
      }
      if (tabDrag?.started) {
        suppressTabClickUntil.current = Date.now() + 250;
        finishTabDrag(tabDrag.listId);
      }
      if (groupDrag?.started) {
        suppressGroupClickUntil.current = Date.now() + 250;
        finishGroupDrag(groupDrag.groupId);
      }
      if (personDrag?.started) {
        suppressPersonClickUntil.current = Date.now() + 250;
        finishPersonDrag(personDrag.personId);
      }
    };

    // Once a card is carried, the finger's movement is the card's, not the
    // page's. Only a listener that is not passive can say so; React's are.
    const onTouchMove = (e: TouchEvent) => {
      if (taskDragRef.current?.started && e.cancelable) e.preventDefault();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("touchmove", onTouchMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isInteractiveDragTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el?.closest) return false;
    return Boolean(
      el.closest(
        /* `trix-editor` and a bare `[contenteditable]`, not the Quill classes
           that used to be here and not `[contenteditable="true"]` either:
           Trix does not spell the attribute that way, so selecting words in
           a note read as the start of a card drag and tilted the card. */
        "input, button, a, textarea, select, [contenteditable]," +
          " trix-editor, .trix-notes-bubble, .task-menu, .assign-menu"
      )
    );
  }

  function finishTaskDrag(taskId: string) {
    const {
      taskPreviewIds: ids,
      view: liveView,
      state: liveState,
      somedayEnabled: liveSomeday,
    } = liveRef.current;
    const hover = boardDragHoverRef.current;
    const dropListId = taskDropListIdRef.current;
    if (hover) suppressRailClickRef.current = true;
    boardDragHoverRef.current = null;
    taskDropListIdRef.current = null;
    setBoardDragHover(null);
    setTaskDropListId(null);
    setDraggingTaskId(null);
    setTaskPreviewIds(null);

    // Dropped on a tab: the task belongs to that list now, and keeps the
    // column it was in.
    if (dropListId) {
      const moved = liveState.tasks.find((t) => t.id === taskId);
      // The same path the menu's Change list takes, so a local task is
      // written to the server on its way and a synced one keeps its links.
      if (moved && moved.listId !== dropListId) {
        void mutateTask(taskId, { listId: dropListId });
      }
      return;
    }

    const byId = new Map(liveState.tasks.map((t) => [t.id, t]));
    /*
      Dropped on a pill, which is a section and not a place in one.

      A pill holds no rows, so the drag worked out no order to put the task
      in — and the ordering path below reads that as nothing to do. What was
      asked for is plain enough without it: this task belongs to that
      section now. It goes to the end of it, which is where a task dropped
      on a name rather than between two rows belongs.
    */
    if (!ids && hover?.taskId === taskId && hover.column) {
      const dropped = byId.get(taskId);
      if (!dropped || dropped.completed) return;
      const flags = boardColumnPatch(hover.column);
      const patch: TodoTaskPatch = {};
      if (flags.isBacklog !== dropped.isBacklog) patch.isBacklog = flags.isBacklog;
      if (flags.isToday !== dropped.isToday) patch.isToday = flags.isToday;
      if (flags.isSomeday !== dropped.isSomeday) patch.isSomeday = flags.isSomeday;
      if (Object.keys(patch).length) void mutateTask(taskId, patch);
      return;
    }
    if (!ids) return;
    if (liveView === "favourites") {
      // Favourites keep their own ordering — reassign sequential positions.
      ids.forEach((id, index) => {
        const task = byId.get(id);
        if (task && task.favouritePosition !== index) {
          void mutateTask(id, { favouritePosition: index });
        }
      });
      return;
    }
    const dragged = byId.get(taskId);
    const boardMode = liveView === "lists" && dragged && !dragged.completed;
    const targetColumn =
      boardMode && hover?.taskId === taskId
        ? hover.column
        : dragged
          ? boardColumnOf(dragged, liveSomeday)
          : null;

    // Board: persist the visual column order (All tab mixes lists — do not
    // restrict neighbors to the dragged task's list). Positions are global,
    // so a slot between the column neighbors carries into per-list tabs.
    // One PATCH for the dragged task. The whole column is reindexed only
    // when the neighbors leave no room for a midpoint.
    if (boardMode && dragged && targetColumn) {
      const orderedIds = ids.filter((id) => {
        if (id === taskId) return true;
        const t = byId.get(id);
        return (
          Boolean(t) &&
          !t!.completed &&
          boardColumnOf(t!, liveSomeday) === targetColumn
        );
      });
      const index = orderedIds.indexOf(taskId);
      if (index < 0) return;
      const flags = boardColumnPatch(targetColumn);
      const flagPatch: TodoTaskPatch = {};
      if (flags.isBacklog !== dragged.isBacklog) {
        flagPatch.isBacklog = flags.isBacklog;
      }
      if (flags.isToday !== dragged.isToday) flagPatch.isToday = flags.isToday;
      if (flags.isSomeday !== dragged.isSomeday) {
        flagPatch.isSomeday = flags.isSomeday;
      }

      const prev = index > 0 ? byId.get(orderedIds[index - 1]) : null;
      const next =
        index < orderedIds.length - 1 ? byId.get(orderedIds[index + 1]) : null;
      if (!prev && !next) {
        // Alone in the column: only the column flags can change.
        if (Object.keys(flagPatch).length) void mutateTask(taskId, flagPatch);
        return;
      }
      const slot = slotBetween(prev?.position, next?.position);
      if (slot !== null) {
        const patch: TodoTaskPatch = { ...flagPatch };
        if (slot !== dragged.position) patch.position = slot;
        if (Object.keys(patch).length) void mutateTask(taskId, patch);
        return;
      }

      // No room: spread the column out again, one PATCH per task that moves.
      const base = Date.now() / 1000;
      orderedIds.forEach((id, i) => {
        const task = byId.get(id);
        if (!task) return;
        const patch: TodoTaskPatch = id === taskId ? { ...flagPatch } : {};
        const nextPos = base + i;
        if (task.position !== nextPos) patch.position = nextPos;
        if (Object.keys(patch).length) void mutateTask(id, patch);
      });
      return;
    }

    if (!dragged) return;
    // The flat list ranks by column before position, so only peers in the
    // same column are real neighbors.
    const draggedColumn = boardColumnOf(dragged, liveSomeday);
    const peers = ids.filter((id) => {
      if (id === taskId) return true;
      const t = byId.get(id);
      return (
        Boolean(t) &&
        t!.completed === dragged.completed &&
        boardColumnOf(t!, liveSomeday) === draggedColumn
      );
    });
    const index = peers.indexOf(taskId);
    if (index < 0) return;
    const prev = index > 0 ? byId.get(peers[index - 1]) : null;
    const next = index < peers.length - 1 ? byId.get(peers[index + 1]) : null;
    if (!prev && !next) return;
    const slot = slotBetween(prev?.position, next?.position);
    if (slot !== null) {
      if (slot !== dragged.position) void mutateTask(taskId, { position: slot });
      return;
    }
    // No room between the neighbors: spread the run out again.
    const base = Date.now() / 1000;
    peers.forEach((id, i) => {
      const task = byId.get(id);
      if (task && task.position !== base + i) {
        void mutateTask(id, { position: base + i });
      }
    });
  }

  function finishTabDrag(listId: string) {
    const { listPreviewIds: ids, state: liveState } = liveRef.current;
    setDraggingListId(null);
    setListPreviewIds(null);
    if (!ids) return;
    const byId = new Map(liveState.lists.map((l) => [l.id, l]));
    const index = ids.indexOf(listId);
    if (index < 0) return;
    const prev = index > 0 ? byId.get(ids[index - 1]) : null;
    const next = index < ids.length - 1 ? byId.get(ids[index + 1]) : null;
    let position: number;
    if (prev && next) position = (prev.position + next.position) / 2;
    else if (prev) position = prev.position + 1;
    else if (next) position = next.position - 1;
    else return;
    setState((s) => ({
      ...s,
      lists: s.lists.map((l) => (l.id === listId ? { ...l, position } : l)),
    }));
    void api("/api/todo/lists", "PATCH", { id: listId, position }).catch(
      (err) => {
        toast.error(describeError(err, "Reorder failed"));
        void refresh();
      }
    );
  }

  function finishGroupDrag(groupId: string) {
    const { groupPreviewIds: ids, state: liveState } = liveRef.current;
    setDraggingGroupId(null);
    setGroupPreviewIds(null);
    if (!ids) return;
    const byId = new Map(liveState.groups.map((g) => [g.id, g]));
    const index = ids.indexOf(groupId);
    if (index < 0) return;
    const prev = index > 0 ? byId.get(ids[index - 1]) : null;
    const next = index < ids.length - 1 ? byId.get(ids[index + 1]) : null;
    let position: number;
    if (prev && next) position = (prev.position + next.position) / 2;
    else if (prev) position = prev.position + 1;
    else if (next) position = next.position - 1;
    else return;
    setState((s) => ({
      ...s,
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, position } : g)),
    }));
    void api("/api/todo/groups", "PATCH", { id: groupId, position }).catch(
      (err) => {
        toast.error(describeError(err, "Reorder failed"));
        void refresh();
      }
    );
  }

  /**
   * Writes where a dragged filter chip was let go.
   *
   * The chips show only the people with a task on this list, so the two the
   * chip landed between can have others sitting between them on the roster.
   * A position halfway between the two neighbours puts the person where the
   * user dropped them relative to the chips they can see, which is the order
   * they were arranging.
   */
  function finishPersonDrag(personId: string) {
    const { personPreviewIds: ids, state: liveState } = liveRef.current;
    setDraggingPersonId(null);
    setPersonPreviewIds(null);
    if (!ids) return;
    const byId = new Map(liveState.people.map((person) => [person.id, person]));
    const index = ids.indexOf(personId);
    if (index < 0) return;
    const prev = index > 0 ? byId.get(ids[index - 1]) : null;
    const next = index < ids.length - 1 ? byId.get(ids[index + 1]) : null;
    let position: number;
    if (prev && next) position = (prev.position + next.position) / 2;
    else if (prev) position = prev.position + 1;
    else if (next) position = next.position - 1;
    else return;
    setState((s) => ({
      ...s,
      people: s.people.map((person) =>
        person.id === personId ? { ...person, position } : person
      ),
    }));
    void api("/api/todo/people", "PATCH", { id: personId, position }).catch(
      (err) => {
        toast.error(describeError(err, "Reorder failed"));
        void refresh();
      }
    );
  }

  /** redd-do's enable-groups semantics: first enable creates a default group
   *  and adopts every ungrouped list into it. */
  function handleGroupsEnabledChange(enabled: boolean) {
    setGroupsEnabled(enabled);
    persistPref(GROUPS_KEY, enabled ? "1" : "0");
    if (!enabled) return;
    void (async () => {
      try {
        if (state.groups.length === 0) {
          const json = await api("/api/todo/groups", "POST", {
            name: "General",
          });
          const group = json.group as TodoGroup;
          const ungrouped = state.lists.filter((l) => !l.groupId);
          await Promise.all(
            ungrouped.map((l) =>
              api("/api/todo/lists", "PATCH", { id: l.id, groupId: group.id })
            )
          );
          setState((s) => ({
            ...s,
            groups: [...s.groups, group],
            lists: s.lists.map((l) =>
              l.groupId ? l : { ...l, groupId: group.id }
            ),
          }));
          setCurrentGroupId(group.id);
          persistPref(CURRENT_GROUP_KEY, group.id);
        } else {
          // Adopt any lists created while groups were off into the first group.
          const first = [...state.groups].sort(
            (a, b) => a.position - b.position
          )[0];
          const ungrouped = state.lists.filter((l) => !l.groupId);
          if (ungrouped.length) {
            await Promise.all(
              ungrouped.map((l) =>
                api("/api/todo/lists", "PATCH", { id: l.id, groupId: first.id })
              )
            );
            setState((s) => ({
              ...s,
              lists: s.lists.map((l) =>
                l.groupId ? l : { ...l, groupId: first.id }
              ),
            }));
          }
        }
      } catch (err) {
        toast.error(describeError(err, "Could not enable groups"));
        void refresh();
      }
    })();
  }

  function switchToGroup(groupId: string) {
    setCurrentGroupId(groupId);
    persistPref(CURRENT_GROUP_KEY, groupId);
    const groupLists = state.lists.filter((l) => l.groupId === groupId);
    if (groupLists.length === 1) {
      setCurrentListId(groupLists[0].id);
      persistPref(TODO_CURRENT_LIST_KEY, groupLists[0].id);
    } else if (groupLists.length > 1) {
      setCurrentListId(TODO_ALL_LIST_ID);
      persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
    } else {
      setCurrentListId(null);
      persistPref(TODO_CURRENT_LIST_KEY, "");
    }
  }

  function removeGroup(group: TodoGroup) {
    if (state.groups.length <= 1) {
      toast("You must have at least one group!");
      return;
    }
    const groupLists = state.lists.filter((l) => l.groupId === group.id);
    const groupListIds = new Set(groupLists.map((l) => l.id));
    const groupTasks = state.tasks.filter(
      (t) => t.listId !== null && groupListIds.has(t.listId)
    );
    const completed = groupTasks.filter((t) => t.completed).length;
    setConfirmModal({
      title: "Delete group?",
      message: `Are you sure you want to delete the group '${group.name}'? This will delete ${groupLists.length} ${groupLists.length === 1 ? "list" : "lists"} containing ${groupTasks.length - completed} uncompleted and ${completed} completed tasks.`,
      confirmLabel: t("delete"),
      danger: true,
      onConfirm: () => {
        setState((s) => ({
          ...s,
          groups: s.groups.filter((g) => g.id !== group.id),
          lists: s.lists.filter((l) => l.groupId !== group.id),
          tasks: s.tasks.filter(
            (task) => task.listId === null || !groupListIds.has(task.listId)
          ),
        }));
        if (currentGroupId === group.id) setCurrentGroupId(null);
        void api(`/api/todo/groups?id=${encodeURIComponent(group.id)}`, "DELETE")
          .then(() =>
            showUndo(`Group '${group.name}' deleted`, () => {
              void (async () => {
                const json = await api("/api/todo/groups", "POST", {
                  name: group.name,
                  colour: group.colour,
                });
                const created = json.group as TodoGroup;
                for (const list of groupLists) {
                  const listJson = await api("/api/todo/lists", "POST", {
                    id: newClientId(),
                    name: list.name,
                    colour: list.colour,
                    groupId: created.id,
                  });
                  const newList = listJson.list as TodoList;
                  for (const task of groupTasks.filter(
                    (task) => task.listId === list.id
                  )) {
                    await recreateTask({ ...task, listId: newList.id });
                  }
                }
                await refresh();
              })();
            })
          )
          .catch((err) => {
            toast.error(describeError(err, "Delete failed"));
            void refresh();
          });
      },
    });
  }

  const listsSorted = React.useMemo(
    () => [...state.lists].sort((a, b) => a.position - b.position),
    [state.lists]
  );

  const groupsSorted = React.useMemo(
    () => [...state.groups].sort((a, b) => a.position - b.position),
    [state.groups]
  );
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
  const peopleSorted = React.useMemo(
    () => [...state.people].sort((a, b) => a.position - b.position),
    [state.people]
  );
  const groupsForRender = React.useMemo(() => {
    if (!groupPreviewIds) return groupsSorted;
    const byId = new Map(groupsSorted.map((g) => [g.id, g]));
    return groupPreviewIds
      .map((id) => byId.get(id))
      .filter((g): g is TodoGroup => Boolean(g));
  }, [groupsSorted, groupPreviewIds]);
  const activeGroup = groupsEnabled
    ? (groupsSorted.find((g) => g.id === currentGroupId) ?? groupsSorted[0] ?? null)
    : null;

  const lists = React.useMemo(() => {
    const scoped =
      groupsEnabled && activeGroup
        ? listsSorted.filter((l) => l.groupId === activeGroup.id)
        : listsSorted;
    if (!listPreviewIds) return scoped;
    const byId = new Map(scoped.map((l) => [l.id, l]));
    return listPreviewIds
      .map((id) => byId.get(id))
      .filter((l): l is TodoList => Boolean(l));
  }, [listsSorted, listPreviewIds, groupsEnabled, activeGroup]);
  const isAllListsView =
    lists.length > 1 &&
    (currentListId === TODO_ALL_LIST_ID ||
      currentListId === null ||
      (currentListId !== TODO_ALL_LIST_ID &&
        !lists.some((l) => l.id === currentListId)));
  const activeList = isAllListsView
    ? null
    : (lists.find((l) => l.id === currentListId) ??
      (lists.length === 1 ? lists[0] : null));
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

  // Silent enter/leave sync for Basecamp / Apple Reminders lists.
  React.useEffect(() => {
    const nextKey =
      view === "lists" && !isAllListsView && currentListId
        ? currentListId
        : null;
    const prevKey = autoSyncKeyRef.current;
    if (prevKey === nextKey) return;

    const prevList = prevKey
      ? listsRef.current.find((l) => l.id === prevKey)
      : null;
    const nextList = nextKey
      ? listsRef.current.find((l) => l.id === nextKey)
      : null;

    autoSyncKeyRef.current = nextKey;
    autoSyncList(prevList);
    autoSyncList(nextList);
  }, [view, currentListId, isAllListsView]);

  // If Reminders connects while a linked list is already open, sync once.
  React.useEffect(() => {
    if (!remindersConnected) return;
    const key = autoSyncKeyRef.current;
    if (!key) return;
    const list = listsRef.current.find((l) => l.id === key);
    if (!list?.remindersListId) return;
    autoSyncList(list);
  }, [remindersConnected]);

  // Push a final silent sync when leaving the To-Do page.
  React.useEffect(() => {
    return () => {
      const key = autoSyncKeyRef.current;
      if (!key) return;
      const list = listsRef.current.find((l) => l.id === key);
      if (!list) return;
      const remindersOk =
        Boolean(list.remindersListId) &&
        isNativeShell() &&
        remindersConnectedRef.current;
      if (!list.basecampListId && !remindersOk) return;
      void (async () => {
        try {
          if (list.basecampListId) {
            await api("/api/todo/basecamp/sync", "POST", { listId: list.id });
          }
          if (remindersOk) {
            await syncRemindersList(
              list,
              tasksRef.current.filter((t) => t.listId === list.id),
              { api }
            );
          }
        } catch {
          /* unmount sync is best-effort */
        }
      })();
    };
  }, []);
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
  const favKey = (t: TodoTask) =>
    t.favouritePosition ?? Number.MAX_SAFE_INTEGER;

  /* Parents only, whatever the view: a subtask lives inside its parent's
     expanded card, never as a card of the board. */
  const parentTasks = React.useMemo(
    () => state.tasks.filter((t) => !t.parentTaskId),
    [state.tasks]
  );
  const tasksForView =
    view === "favourites"
      ? parentTasks.filter((t) => t.isFavourite)
      : isAllListsView
        ? parentTasks.filter(
            (t) => t.listId === null || scopedListIds.has(t.listId)
          )
        : activeList
          ? parentTasks.filter((t) => t.listId === activeList.id)
          : [];
  const openTasksSorted = tasksForView
    .filter((t) => !t.completed)
    .sort(
      view === "favourites"
        ? (a, b) => favKey(a) - favKey(b) || byOrder(a, b)
        : byOrder
    );
  boardScopeRef.current = openTasksSorted;
  const doneTasks =
    view === "favourites"
      ? []
      : tasksForView
          .filter((t) => t.completed)
          .sort((a, b) => {
            const timeA = a.completedAt ? Date.parse(a.completedAt) : 0;
            const timeB = b.completedAt ? Date.parse(b.completedAt) : 0;
            return timeB - timeA;
          });
  // Search: incomplete tasks across every list, grouped per list, preferred
  // (current) list first — matching redd-do's getListSearchGroups.
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;
  const searchGroups = React.useMemo(() => {
    if (!isSearching) return [];
    const groups = listsSorted
      .map((list) => ({
        list,
        tasks: state.tasks
          .filter(
            (t) =>
              t.listId === list.id &&
              !t.completed &&
              (t.text || "").toLowerCase().includes(trimmedQuery)
          )
          .sort(byOrder),
      }))
      .filter((g) => g.tasks.length > 0);
    const preferredId =
      (view === "lists" ? activeList?.id : searchListId) ?? null;
    const idx = groups.findIndex((g) => g.list.id === preferredId);
    if (idx > 0) {
      const [preferred] = groups.splice(idx, 1);
      groups.unshift(preferred);
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearching, trimmedQuery, listsSorted, state.tasks, view, activeList?.id, searchListId]);
  const selectedSearchGroup =
    searchGroups.find((g) => g.list.id === searchListId) ??
    searchGroups[0] ??
    null;

  /** On a specific list tab: hits in other lists (for jump chips). Hidden on All. */
  const otherListSearchHits = React.useMemo(() => {
    if (!isSearching || view !== "lists" || isAllListsView || !activeList) {
      return [];
    }
    return searchGroups.filter((g) => g.list.id !== activeList.id);
  }, [isSearching, view, isAllListsView, activeList, searchGroups]);

  const openTasks = React.useMemo(() => {
    // Lists view keeps the board: filter the current tab's open tasks in place.
    if (isSearching && view === "lists") {
      const hits = openTasksSorted.filter((t) =>
        (t.text || "").toLowerCase().includes(trimmedQuery)
      );
      // A drag may be under way: the board can be dragged while filtering,
      // so the rows that are showing follow the preview like any others.
      if (!taskPreviewIds) return hits;
      const byId = new Map(hits.map((t) => [t.id, t]));
      return taskPreviewIds
        .map((id) => byId.get(id))
        .filter((t): t is TodoTask => Boolean(t));
    }
    // Favourites: flat list, one search-group at a time via the hit chips.
    if (isSearching) {
      return selectedSearchGroup ? selectedSearchGroup.tasks : [];
    }
    if (!taskPreviewIds) return openTasksSorted;
    const byId = new Map(openTasksSorted.map((t) => [t.id, t]));
    return taskPreviewIds
      .map((id) => byId.get(id))
      .filter((t): t is TodoTask => Boolean(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isSearching,
    view,
    trimmedQuery,
    selectedSearchGroup,
    taskPreviewIds,
    openTasksSorted,
  ]);

  /**
   * People who have at least one task on the current list (or across lists on
   * All). Filter chips only offer these names, not the full roster.
   */
  const assigneeFilterPeople = React.useMemo(() => {
    if (!assignEnabled || view !== "lists") return [];
    const assignedIds = new Set<string>();
    for (const task of tasksForView) {
      for (const id of task.assigneeIds) assignedIds.add(id);
    }
    if (assignedIds.size === 0) return [];
    const offered = peopleSorted.filter((person) => assignedIds.has(person.id));
    if (!personPreviewIds) return offered;
    // Mid-drag the row follows the pointer, not the roster.
    const byId = new Map(offered.map((person) => [person.id, person]));
    const previewed = personPreviewIds
      .map((id) => byId.get(id))
      .filter((person): person is TodoPerson => Boolean(person));
    return previewed.length === offered.length ? previewed : offered;
  }, [assignEnabled, view, tasksForView, peopleSorted, personPreviewIds]);

  // Drop filter ids that are not offered on this list (or left the roster).
  React.useEffect(() => {
    const allowed = new Set(assigneeFilterPeople.map((person) => person.id));
    setAssigneeFilterIds((ids) => {
      const next = ids.filter((id) => allowed.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [assigneeFilterPeople]);

  /** The roster rows that are the reader. Empty: the board has no "mine". */
  const mePersonIds = React.useMemo(
    () => mePersonIdsOf(state.people, viewerEmails, markedMeId),
    [state.people, viewerEmails, markedMeId]
  );
  /** With assigning off there is no "mine": the board shows every task. */
  const hasMe = assignEnabled && mePersonIds.length > 0;
  /** What the board shows: "mine" only once the reader is on the roster. */
  const scope: PeopleScope = hasMe ? peopleScope : "everyone";

  /** The makers that are the reader, for a task with nobody on it. */
  const makerKeys = React.useMemo(
    () => (isStandaloneTodo() ? [THIS_DEVICE_MAKER] : viewerKeys),
    [viewerKeys]
  );

  const boardTasks = React.useMemo(
    () => tasksInScope(openTasks, scope, mePersonIds, assigneeFilterIds, makerKeys),
    [openTasks, scope, mePersonIds, assigneeFilterIds, makerKeys]
  );
  const myOpenCount = React.useMemo(
    () => tasksInScope(openTasks, "mine", mePersonIds, [], makerKeys).length,
    [openTasks, mePersonIds, makerKeys]
  );

  const filteredDoneTasks = React.useMemo(
    () => tasksInScope(doneTasks, scope, mePersonIds, assigneeFilterIds, makerKeys),
    [doneTasks, scope, mePersonIds, assigneeFilterIds, makerKeys]
  );

  /** Board columns stay up while searching in lists; favourites stays a flat list. */
  const showBoard =
    kanbanEnabled &&
    view === "lists" &&
    (isAllListsView || Boolean(activeList));
  const boardWidth = showBoard;
  /** Each column's order, from the header; due date until changed. */
  const [storedColumnSorts, setColumnSorts] = React.useState(loadColumnSorts);
  /** With assigning off, a column kept on "assignee" reads by due date. */
  const columnSorts = React.useMemo(() => {
    if (assignEnabled) return storedColumnSorts;
    const next = { ...storedColumnSorts };
    for (const column of Object.keys(next) as TodoBoardColumn[]) {
      if (next[column].sort === "assignee") {
        next[column] = DEFAULT_SORT_ORDER;
      }
    }
    return next;
  }, [storedColumnSorts, assignEnabled]);
  /**
   * Pick an order: its natural direction. Pick the order the column is
   * already on: the other direction. Manual has no direction to flip.
   */
  function pickColumnSort(column: TodoBoardColumn, sort: ColumnSort) {
    setColumnSorts((current) => {
      const was = current[column];
      const desc = sort !== "manual" && was.sort === sort ? !was.desc : false;
      const next = { ...current, [column]: { sort, desc } };
      persistPref(COLUMN_SORT_KEY, JSON.stringify(next));
      return next;
    });
  }
  /** The "⇅" menu that is up, and the glyph it hangs off. */
  const [columnSortMenu, setColumnSortMenu] =
    React.useState<TodoBoardColumn | null>(null);
  const [columnSortAnchor, setColumnSortAnchor] =
    React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!columnSortMenu) return;
    const close = () => {
      setColumnSortMenu(null);
      setColumnSortAnchor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // MenuPortal swallows the pointer inside the menu; the glyph toggles.
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [columnSortMenu]);

  /*
    Each column in its own order. Not during a drag: then the rows follow
    the preview, and the sort takes over again when the task lands.
  */
  const sortColumn = React.useCallback(
    (column: TodoBoardColumn, tasks: TodoTask[]) => {
      const order = columnSorts[column];
      if (order.sort === "manual" || taskPreviewIds) return tasks;
      const names = new Map(state.people.map((p) => [p.id, p.name]));
      return [...tasks].sort(
        columnComparator(order, (id) => names.get(id) ?? "")
      );
    },
    [columnSorts, taskPreviewIds, state.people]
  );

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
      byColumn[boardColumnOf(task, somedayEnabled)].push(task);
    }
    return order.flatMap((column) => sortColumn(column, byColumn[column]));
  }, [boardTasks, somedayEnabled, sortColumn]);

  /**
   * The note that offers Board View for a long list (see BoardViewNudge).
   * It answers the reader's own act: a task they added in the list view.
   */
  const [boardNudgeOpen, setBoardNudgeOpen] = React.useState(false);
  const addedInListViewRef = React.useRef(false);
  React.useEffect(() => {
    if (!addedInListViewRef.current) return;
    addedInListViewRef.current = false;
    let seen = true;
    try {
      seen = localStorage.getItem(BOARD_NUDGE_SEEN_KEY) === "1";
    } catch {
      /* private mode: no note, it could not be put away for good */
    }
    if (
      boardNudgeIsDue({
        added: true,
        boardViewOn: kanbanEnabled,
        seen,
        openTasksInList: flatListTasks.length,
      })
    ) {
      setBoardNudgeOpen(true);
    }
  }, [flatListTasks.length, kanbanEnabled]);
  function answerBoardNudge(tryBoard: boolean) {
    setBoardNudgeOpen(false);
    persistPref(BOARD_NUDGE_SEEN_KEY, "1");
    if (tryBoard) {
      setKanbanEnabled(true);
      persistPref(KANBAN_KEY, "1");
      return;
    }
    toast(t("boardNudgeLater"), {
      icon: <SettingsGearIcon />,
      action: { label: t("gotIt"), onClick: () => {} },
    });
  }

  /**
   * The first and last task of every run — each board column, or the
   * favourites list — so the menu can leave out a move that would change
   * nothing. Runs cover every list: a single list tab shows a subset, and
   * the task at the head of the whole run heads the subset too.
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
      const byColumn = emptyBoardColumns<TodoTask>();
      for (const task of state.tasks) {
        if (!task.completed) byColumn[boardColumnOf(task, somedayEnabled)].push(task);
      }
      for (const run of Object.values(byColumn)) mark(run.sort(byOrder));
    }
    return { first, last };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tasks, view, somedayEnabled]);

  /**
   * The last thing Cmd+Z takes back.
   *
   * The toast is a six-second offer beside a delete; this is the same
   * offer under a key, and it outlives the toast. Ticking a task off
   * registers here without a toast — the flight to Done already says
   * what happened, and Cmd+Z is how it is taken back.
   */
  const lastUndoRef = React.useRef<(() => void) | null>(null);

  function registerUndo(restore: () => void) {
    lastUndoRef.current = restore;
  }

  function showUndo(message: string, restore: () => void) {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndoState({ message, restore });
    registerUndo(restore);
    undoTimer.current = window.setTimeout(() => setUndoState(null), 6000);
  }

  /* Cmd+Z takes back the last change. A box being typed in keeps its own
     undo: there the key belongs to the words, not to the board. */
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      if (event.key !== "z" && event.key !== "Z") return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable ||
          active.closest("trix-editor"))
      ) {
        return;
      }
      const restore = lastUndoRef.current;
      if (!restore) return;
      event.preventDefault();
      lastUndoRef.current = null;
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      setUndoState(null);
      restore();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function patchTaskLocal(id: string, patch: Partial<TodoTask>) {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }

  async function mutateTask(id: string, patch: TodoTaskPatch) {
    const existing = tasksRef.current.find((t) => t.id === id);
    if (!existing) return;

    patchTaskLocal(id, patch as Partial<TodoTask>);
    try {
      const json = await api("/api/todo/tasks", "PATCH", { id, ...patch });
      const task = json.task as TodoTask;
      patchTaskLocal(id, task);
      // A focus window that shows this task must not keep the old text.
      focusChannelRef.current?.postMessage({
        type: BOARD_TASK_CHANGED_MESSAGE,
        taskId: id,
        task,
      });
      /*
        Onto a list Reminders mirrors, from one it does not: the task gets
        its reminder now, the way a task added on that list does.
      */
      const movedOnto =
        patch.listId && task.remindersId == null
          ? listsRef.current.find((l) => l.id === patch.listId)
          : undefined;
      if (movedOnto?.remindersListId && !isOfflineNow()) {
        const remindersListId = movedOnto.remindersListId;
        pushReminders(async () => {
          const reminder = await createRemindersTask(
            remindersListId,
            task.text,
            task.dueOn
          );
          if (reminder.id) {
            await api("/api/todo/tasks", "PATCH", {
              id: task.id,
              remindersId: reminder.id,
            });
            patchTaskLocal(task.id, { remindersId: reminder.id });
          }
        });
      }
      if (
        !isOfflineNow() &&
        task.remindersId &&
        listOfTask(task)?.remindersListId
      ) {
        if (patch.completed !== undefined) {
          pushReminders(() =>
            updateRemindersStatus(task.remindersId as string, task.completed)
          );
        }
        if (patch.text !== undefined) {
          pushReminders(() =>
            updateRemindersTitle(task.remindersId as string, task.text)
          );
        }
        if (patch.dueOn !== undefined) {
          pushReminders(() =>
            updateRemindersDue(task.remindersId as string, task.dueOn)
          );
        }
      }
    } catch (err) {
      toast.error(describeError(err, "Update failed"));
      if (!isOfflineNow()) void refresh();
    }
  }

  async function finishTaskFlight(opts: {
    taskId: string;
    toCompleted?: boolean;
    boardColumn?: TodoBoardColumn;
    /** Board column moves use a gentle slide; DONE uses the scale flight. */
    motion?: "slide" | "flight";
    /**
     * How long the card stands ticked before it goes. A tick under the
     * pointer holds briefly; a tick from the focus window holds longer,
     * since the reader's eyes are still on their way over from it.
     */
    holdMs?: number;
    startRect: DOMRect;
    wrap: HTMLElement;
    ghost: HTMLElement;
    /**
     * Lets the other rows go, with the glide the card sets off on. They wait
     * for the card: see holdRowsInPlace.
     */
    releaseRows?: (glide: { durationMs: number; easing: string }) => void;
  }) {
    const {
      taskId,
      toCompleted,
      boardColumn,
      motion = "flight",
      holdMs = FLIGHT_HOLD_MS,
      startRect,
      wrap,
      ghost,
      releaseRows,
    } = opts;
    const animKey = animTargetKey(taskId, Boolean(toCompleted));

    const findTarget = () => {
      if (toCompleted) {
        const landed = doneTasksRef.current?.querySelector(
          `.task-item[data-task-id="${CSS.escape(taskId)}"]`
        ) as HTMLElement | null;
        // React may not have painted the row yet, so wait for a real box.
        if (landed && landed.getBoundingClientRect().height > 0) return landed;
        // Done is shut: the list is display:none and no row will ever have a
        // box there. The task flies to the Done bar and fades into it.
        if (doneCollapsed) return doneHeadingRowRef.current;
        return landed;
      }
      if (boardColumn) {
        return document.querySelector(
          `.todo-shell [data-board-column="${boardColumn}"] .task-item[data-task-id="${CSS.escape(taskId)}"]`
        ) as HTMLElement | null;
      }
      return tasksContainerRef.current?.querySelector(
        `.task-item[data-task-id="${CSS.escape(taskId)}"]`
      ) as HTMLElement | null;
    };

    let targetElement: HTMLElement | null = null;
    for (let i = 0; i < 24; i++) {
      targetElement = findTarget();
      if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) break;
      }
      await waitAnimationFrames(1);
    }

    if (!targetElement) {
      releaseRows?.({ durationMs: ROW_SLIDE_MS, easing: ROW_GLIDE_EASING });
      dropAnimTarget(animKey);
      wrap.remove();
      return;
    }

    const targetRect = targetElement.getBoundingClientRect();
    // Landing on the Done bar, not on a card of its own: the ghost fades out
    // there, and the bar must stay visible to receive it.
    const landsOnCard = targetElement.classList.contains("task-item");
    // Keep the landing card hidden while the ghost slides — must clear after,
    // or React reuse leaves Today/Week cards permanently invisible.
    if (landsOnCard) targetElement.style.visibility = "hidden";

    try {
      const dx = targetRect.left - startRect.left;
      const dy = targetRect.top - startRect.top;

      if (motion === "slide") {
        ghost.style.transition =
          "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)";
        await waitAnimationFrames(1);
        releaseRows?.({ durationMs: ROW_SLIDE_MS, easing: ROW_GLIDE_EASING });
        ghost.style.transform = `translate(${dx}px, ${dy}px)`;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 400);
        });
      } else {
        // Translate only — do not scale to the DONE width. Non-uniform
        // scaleX stretches column cards (~1/3 width) into the full-width
        // done list and makes the text look rubbery.
        //
        // The card holds still for a moment first. The tick, the line
        // through the words and the party all land in that moment, and the
        // card leaves after them instead of under them. The curve eases in
        // and out, so the card sets off gently rather than shooting away.
        ghost.style.transition =
          `transform ${FLIGHT_GLIDE_MS}ms ${FLIGHT_GLIDE_EASING},` +
          ` opacity ${FLIGHT_GLIDE_MS}ms ease`;
        await waitAnimationFrames(1);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, holdMs);
        });
        releaseRows?.({
          durationMs: FLIGHT_GLIDE_MS,
          easing: FLIGHT_GLIDE_EASING,
        });
        ghost.style.transform = `translate(${dx}px, ${dy}px)`;
        ghost.style.opacity = landsOnCard ? "0.92" : "0";

        if (toCompleted) {
          // The bar answers as the card reaches it, not as it sets off.
          const heading = document.querySelector(".todo-shell .done-heading");
          window.setTimeout(() => {
            heading?.classList.add("receiving-task");
            window.setTimeout(
              () => heading?.classList.remove("receiving-task"),
              400
            );
          }, FLIGHT_GLIDE_MS - 260);
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, FLIGHT_GLIDE_MS + 40);
        });
      }
    } finally {
      releaseRows?.({ durationMs: ROW_SLIDE_MS, easing: ROW_GLIDE_EASING });
      if (landsOnCard) targetElement.style.visibility = "";
      wrap.remove();
      dropAnimTarget(animKey);
    }
  }


  /**
   * Ask the focus window of a task to save and close, and wait until it says
   * that it did. The wait has an end: a window that never answers must not
   * stop the next one.
   */
  function closeFocusWindowOf(taskId: string): Promise<void> {
    return new Promise((resolve) => {
      const waiters = focusEndWaitersRef.current;
      const done = () => {
        window.clearTimeout(timer);
        waiters.delete(taskId);
        // The window says "ended" and then hides. Give the hide a moment to
        // reach the shell before the next window asks for a place.
        window.setTimeout(resolve, 60);
      };
      const timer = window.setTimeout(done, 1500);
      waiters.set(taskId, done);
      setActiveFocusTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      focusChannelRef.current?.postMessage({ type: "focus-exit-request", taskId });
    });
  }

  /**
   * Open the floating focus window for a task, or ask the open one to leave.
   * The board's button and the Today session both come through here.
   */
  function toggleTaskFocusPopout(task: TodoTask) {
    /*
      Which half of this ran, and how far it got.

      The focus button was reported as doing nothing. The shell logs every
      request it receives to open the panel and has never logged one, so
      either the press never became a request or it never reached the shell.
      This says which: the exit branch answers a task the page believes is
      already focused, and the open branch says whether the shell took it.
    */
    console.info(
      `[todo] focus pressed for ${task.id} — page thinks it is ${
        activeFocusTaskIds.has(task.id) ? "already focused (exit)" : "not focused (open)"
      }`
    );
    if (activeFocusTaskIds.has(task.id)) {
      // Clear locally even if the hidden panel never answers — otherwise the
      // button stays in "exit" mode and never re-opens focus.
      setActiveFocusTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      focusChannelRef.current?.postMessage({
        type: "focus-exit-request",
        taskId: task.id,
      });
      return;
    }
    // Two windows at most. In the desktop app each task has a window of its
    // own, so the board closes the one that gives way, by that window's own
    // save-and-close: its time is kept and its mark goes. The planner shell
    // has two fixed panels and points the second one at the new task itself.
    const giveWay = standalone
      ? focusToGiveWay([...activeFocusTaskIds], task.id)
      : null;
    setActiveFocusTaskIds((prev) => new Set(prev).add(task.id));
    void (giveWay ? closeFocusWindowOf(giveWay) : Promise.resolve())
      .then(() => openTodoFocusPopout(task))
      .then(() => console.info(`[todo] focus: the shell took ${task.id}`))
      .catch((err) => {
        setActiveFocusTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        console.warn("[todo] focus: the shell refused it:", err);
        toast.error(describeError(err, "Could not open focus window"));
      });
  }

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

  function boardColumnLabel(column: TodoBoardColumn): string {
    if (column === "someday") return t("boardSomeday");
    if (column === "backlog") return t("boardBacklog");
    if (column === "week") return t("boardThisWeek");
    return t("boardToday");
  }

  /**
   * A column's name as drawn. The headers are set in capitals, but an
   * aside in brackets at the end — "Soon (-ish)" — stays in small letters
   * and a shade lighter: it is a wink, not part of the name.
   */
  function boardColumnName(column: TodoBoardColumn): React.ReactNode {
    const label = boardColumnLabel(column);
    const aside = label.match(/^(.*?)\s*(\([^)]*\))$/);
    if (!aside) return label;
    return (
      <>
        {aside[1]} <span className="board-label-aside">{aside[2]}</span>
      </>
    );
  }

  function onRailActivate(column: TodoBoardColumn) {
    if (suppressRailClickRef.current) {
      suppressRailClickRef.current = false;
      return;
    }
    storeSomedayExpanded(column === "someday");
  }

  /**
   * The sections as a row of pills, for a tile too short to stack them.
   *
   * Each pill carries `data-board-column`, which is what the drag already
   * looks for under the pointer — so a task dragged onto a pill lands in
   * that section, and the pill lights up on the way, without the drag
   * knowing anything about pills.
   *
   * At most three are named. The rest live behind "…", and whichever is
   * open is always one of the named, so the row never hides the section
   * the reader is looking at.
   */
  function renderBoardPills(sections: TodoBoardColumn[], active: TodoBoardColumn) {
    const shown = sections.slice(0, 3);
    const rest = sections.slice(3);
    if (!shown.includes(active) && rest.includes(active)) {
      shown[shown.length - 1] = active;
    }
    const hidden = sections.filter((column) => !shown.includes(column));
    const pill = (column: TodoBoardColumn) => (
      <button
        key={column}
        type="button"
        data-board-column={column}
        className={`board-pill${column === active ? " is-active" : ""}${
          boardDragHover?.column === column ? " is-drop-target" : ""
        }`}
        onClick={() => openStackSection(column)}
      >
        {boardColumnName(column)}
        <span className="board-pill-count">{boardColumns[column].length}</span>
      </button>
    );
    return (
      <div className="board-pills">
        {shown.map(pill)}
        {hidden.length ? (
          <div className="board-pill-more-wrap">
            <button
              type="button"
              className="board-pill board-pill-more"
              title={t("boardMoreSections")}
              aria-label={t("boardMoreSections")}
              onClick={(event) => {
                event.stopPropagation();
                setPillMenuOpen((open) => !open);
              }}
            >
              …
            </button>
            {pillMenuOpen ? (
              <div
                className="board-pill-menu"
                onClick={(event) => event.stopPropagation()}
              >
                {hidden.map((column) => (
                  <button
                    key={column}
                    type="button"
                    data-board-column={column}
                    className="board-pill-menu-item"
                    onClick={() => {
                      openStackSection(column);
                      setPillMenuOpen(false);
                    }}
                  >
                    {boardColumnName(column)}
                    <span className="board-pill-count">
                      {boardColumns[column].length}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {boardColumns.today.some((task) => !task.completed) ? (
          <button
            type="button"
            className="board-start-btn board-pills-start"
            title={t("sessionStart")}
            onClick={startTodaySession}
          >
            <span aria-hidden="true">▶</span> {t("sessionStart")}
          </button>
        ) : null}
      </div>
    );
  }

  function renderBoardColumn(
    column: TodoBoardColumn,
    asRail = false,
    folded = false
  ) {
    const label = boardColumnLabel(column);
    return (
      <section
        key={column}
        className={`board-column board-column-${column}${
          asRail ? " is-rail" : ""
        }${folded ? " is-folded" : ""}${
          boardDragHover?.column === column
            ? " board-column-drop-target"
            : ""
        }${draggingColumn === column ? " is-dragging-column" : ""}`}
        data-board-column={column}
        role={asRail ? "button" : undefined}
        tabIndex={asRail ? 0 : undefined}
        title={asRail ? t("expandColumn").replace("{name}", label) : undefined}
        aria-label={
          asRail
            ? `${t("expandColumn").replace("{name}", label)} (${
                boardColumns[column].length
              })`
            : undefined
        }
        onClick={asRail ? () => onRailActivate(column) : undefined}
        onKeyDown={
          asRail
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onRailActivate(column);
                }
              }
            : undefined
        }
      >
        {(column === "someday" || column === "today" || column === "backlog") && (
          <div className="board-rail-face" aria-hidden={!asRail}>
            {column === "someday" ? (
              <History className="board-rail-icon" aria-hidden="true" />
            ) : null}
            <span className="board-rail-text">
              <span className="board-rail-label">{boardColumnName(column)}</span>
              <span className="board-rail-count">
                {boardColumns[column].length}
              </span>
            </span>
          </div>
        )}
        <div className="board-column-body">
          <header
            className="board-column-header"
            onPointerDown={(event) => {
              if (asRail || folded) return;
              startColumnDrag(event, column);
            }}
            onClick={folded ? () => openStackSection(column) : undefined}
            role={folded ? "button" : undefined}
            tabIndex={folded ? 0 : undefined}
            onKeyDown={
              folded
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openStackSection(column);
                    }
                  }
                : undefined
            }
          >
            <span className="board-column-title">{boardColumnName(column)}</span>
            <span className="board-column-count">
              {boardColumns[column].length}
            </span>
            {/* The order, on hover: a glyph, and the order's name when it
                is not the default. One click opens the choice. */}
            {asRail || folded ? null : (
              <span
                className={`board-sort-wrap${
                  columnSortMenu === column ? " is-open" : ""
                }`}
              >
                <button
                  type="button"
                  className="board-sort-btn"
                  title={t("sortBy")}
                  aria-label={`${t("sortBy")}: ${t(
                    SORT_LABEL_KEY[columnSorts[column].sort]
                  )}`}
                  aria-haspopup="menu"
                  aria-expanded={columnSortMenu === column}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (columnSortMenu === column) {
                      setColumnSortMenu(null);
                      setColumnSortAnchor(null);
                    } else {
                      setColumnSortAnchor(event.currentTarget);
                      setColumnSortMenu(column);
                    }
                  }}
                >
                  {/* The direction, as an arrow that turns; ⇅ where there
                      is none (manual). */}
                  {columnSorts[column].sort === "manual" ? (
                    <ArrowDownUp size={13} strokeWidth={2} aria-hidden />
                  ) : (
                    <ArrowUp
                      size={13}
                      strokeWidth={2}
                      aria-hidden
                      className={`board-sort-arrow${
                        columnSorts[column].desc ? " is-desc" : ""
                      }`}
                    />
                  )}
                  <span className="board-sort-label">
                    {t(SORT_LABEL_KEY[columnSorts[column].sort])}
                  </span>
                </button>
                <MenuPortal
                  open={columnSortMenu === column}
                  anchorEl={columnSortMenu === column ? columnSortAnchor : null}
                  className="task-menu board-sort-menu"
                  align="right"
                  role="menu"
                  ariaLabel={t("sortBy")}
                >
                  <MenuKeys
                    onClose={() => {
                      const glyph = columnSortAnchor;
                      setColumnSortMenu(null);
                      setColumnSortAnchor(null);
                      glyph?.focus();
                    }}
                  >
                  {/* The active row carries its arrow: pick it again and
                      the order runs the other way. */}
                  {COLUMN_SORTS.filter(
                    (sort) => assignEnabled || sort !== "assignee"
                  ).map((sort) => {
                    const active = columnSorts[column].sort === sort;
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
                          pickColumnSort(column, sort);
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
                              columnSorts[column].desc ? " is-desc" : ""
                            }`}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                  </MenuKeys>
                </MenuPortal>
              </span>
            )}
            {column === "someday" ? (
              <button
                type="button"
                className="board-column-collapse"
                title={t("collapseSomeday")}
                aria-label={t("collapseSomeday")}
                onClick={() => storeSomedayExpanded(false)}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
            ) : null}
            {column === "today" &&
            boardColumns.today.some((task) => !task.completed) ? (
              <button
                type="button"
                className="board-start-btn"
                title={t("sessionStart")}
                onClick={startTodaySession}
              >
                <span aria-hidden="true">▶</span> {t("sessionStart")}
              </button>
            ) : null}
          </header>
          <div className="board-column-tasks">
            {folded ? null : boardColumns[column].map(renderTask)}
          </div>
          {folded ? null : (
          <div className="board-column-add">
            <AddTaskComposer
              placeholder={t("addTaskPlaceholder")}
              addLabel={t("addTask")}
              minutesLabel={t("minutes")}
              onSubmit={(draft) => void addTask(column, draft)}
              uploadImageForList={uploaderForList}
              resolveImageSrc={resolveBasecampImage}
              people={state.people}
              assignEnabled={assignEnabled}
              onEditPeople={() => setPeopleEditorOpen(true)}
              lists={lists}
              defaultList={addTargetList}
              lang={lang}
              t={t}
            />
          </div>
          )}
        </div>
      </section>
    );
  }

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

  /** Open the Today session on the column as it stands. */
  function startTodaySession() {
    const queue = boardColumns.today.filter((task) => !task.completed);
    if (queue.length === 0) return;
    setSessionIds(queue.map((task) => task.id));
  }

  /** Skip: the task goes to the end of the queue, and the next one runs. */
  /**
   * Take a finished task back up in the session.
   *
   * The task in hand is nothing more than the first of the queue that is not
   * done, so bringing one back is two things and not one: clear the tick, and
   * move it to the front. Clearing the tick alone would leave the task where
   * it happened to sit, which for one finished early is behind everything
   * still to do — and the session would look unchanged.
   */
  function uncompleteSessionTask(task: TodoTask) {
    void mutateTask(task.id, { completed: false });
    setSessionIds((ids) =>
      ids ? [task.id, ...ids.filter((id) => id !== task.id)] : ids
    );
  }

  function skipSessionTask(task: TodoTask) {
    setSessionIds((ids) =>
      ids
        ? [...ids.filter((id) => id !== task.id), task.id]
        : ids
    );
  }

  /** A task added inside the session joins the end of its queue. */
  async function addSessionTask(text: string, durationMinutes: number | null) {
    const id = await addTask("today", {
      ...EMPTY_TASK_DRAFT,
      text,
      duration: durationMinutes == null ? "" : String(durationMinutes),
    });
    if (id) setSessionIds((ids) => (ids ? [...ids, id] : ids));
  }

  /**
   * Send a task to one end of the run it sits in: its board column, or the
   * favourites list when that view is up. New tasks land at the bottom, so
   * this is the way to either end without a drag.
   */
  function moveTaskToEdge(task: TodoTask, edge: "top" | "bottom") {
    const step = (values: number[]) =>
      edge === "top" ? Math.min(0, ...values) - 1 : Math.max(0, ...values) + 1;
    if (view === "favourites") {
      const peers = state.tasks.filter(
        (t) => t.isFavourite && !t.completed && t.id !== task.id && !t.parentTaskId
      );
      void mutateTask(task.id, {
        favouritePosition: step(peers.map((t) => t.favouritePosition ?? 0)),
      });
      return;
    }
    // Every list, not only this one: the All tab mixes them in one column,
    // and a per-list tab is a subset of that.
    const column = boardColumnOf(task, somedayEnabled);
    const peers = state.tasks.filter(
      (t) =>
        !t.completed &&
        t.id !== task.id &&
        !t.parentTaskId &&
        boardColumnOf(t, somedayEnabled) === column
    );
    void mutateTask(task.id, { position: step(peers.map((t) => t.position)) });
  }

  function toggleFavourite(task: TodoTask) {
    // Heart is Favourites-only — independent of Backlog / Soon (-ish) / Today.
    void mutateTask(task.id, { isFavourite: !task.isFavourite });
  }

  function toggleTaskCompleted(
    task: TodoTask,
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const sourceElement = event.currentTarget.closest(
      ".task-item"
    ) as HTMLElement | null;
    completeTaskWithFlight(
      task,
      !task.completed,
      event.currentTarget,
      sourceElement
    );
  }

  /**
   * The tick as the board does it: the box checked, the words struck, the
   * little party, and the card's flight to Done. From the checkbox on the
   * row, and from the focus window's tick, which names the row from the
   * other side of a channel (see the focus channel effect).
   */
  function completeTaskWithFlight(
    task: TodoTask,
    nextCompleted: boolean,
    checkbox: HTMLInputElement | null,
    sourceElement: HTMLElement | null,
    holdMs?: number
  ) {
    // Ticking a task off is what Cmd+Z takes back, wherever it is done
    // from — a card, the focus window, the Today session.
    if (nextCompleted) {
      registerUndo(() => void mutateTask(task.id, { completed: false }));
    }

    // Favourites / search: no DONE flight target — just toggle. The board
    // and the single list both get the party and the flight.
    if (view === "favourites" || isSearching || !sourceElement) {
      void mutateTask(task.id, { completed: nextCompleted });
      return;
    }

    // Paint strikethrough / checkbox immediately for the ghost clone.
    sourceElement.classList.toggle("completed-task", nextCompleted);
    const textSpan = sourceElement.querySelector(".task-text");
    textSpan?.classList.toggle("completed", nextCompleted);
    if (checkbox) checkbox.checked = nextCompleted;

    if (nextCompleted && textSpan) {
      textSpan.classList.remove("pre-complete-pop");
      void (textSpan as HTMLElement).offsetWidth;
      textSpan.classList.add("pre-complete-pop");
      spawnCompletionParty(sourceElement);
    }

    // Clone the ghost BEFORE React unmounts the source row on state update.
    const { startRect, wrap, ghost } = spawnTaskGhost(sourceElement);

    // Where every other row is now, in the open list and in Done. The change
    // is drawn at once, so the rows can be held there until the card sets
    // off: the gap it leaves closes behind it, and the rows where it lands
    // make way as it comes.
    const rowLists = [tasksContainerRef.current, doneTasksRef.current];
    const rowsBefore = measureRowBoxes(
      rowLists,
      ".task-item[data-task-id]",
      "data-task-id"
    );

    const completedAt = nextCompleted ? new Date().toISOString() : null;
    flushSync(() => {
      setAnimHiddenTargets((keys) =>
        new Set(keys).add(animTargetKey(task.id, nextCompleted))
      );
      patchTaskLocal(task.id, {
        completed: nextCompleted,
        completedAt,
      });
    });
    const releaseRows = holdRowsInPlace(
      rowLists,
      rowsBefore,
      ".task-item[data-task-id]",
      "data-task-id",
      { skipId: task.id }
    );

    const boardColumn =
      !nextCompleted && view === "lists" && !isSearching && showBoard
        ? boardColumnOf(task, somedayEnabled)
        : undefined;

    void finishTaskFlight({
      taskId: task.id,
      toCompleted: nextCompleted,
      boardColumn,
      holdMs,
      startRect,
      wrap,
      ghost,
      releaseRows,
    });

    void (async () => {
      try {
        const json = await api("/api/todo/tasks", "PATCH", {
          id: task.id,
          completed: nextCompleted,
        });
        const updated = json.task as TodoTask;
        patchTaskLocal(task.id, updated);
        if (updated.remindersId && listOfTask(updated)?.remindersListId) {
          pushReminders(() =>
            updateRemindersStatus(
              updated.remindersId as string,
              updated.completed
            )
          );
        }
      } catch (err) {
        toast.error(describeError(err, "Update failed"));
        void refresh();
      }
    })();
  }

  /**
   * Bring the task that was just added onto the screen, and say which one it
   * is for a moment.
   *
   * It lands at the foot of its column, which on a full column is past the
   * bottom of the box — so without this the box looks unchanged and the typing
   * looks lost. React has not painted the row when this is called, so the row
   * is waited for rather than looked for once.
   */
  async function revealAddedTask(
    taskId: string,
    column: TodoBoardColumn | null
  ) {
    setJustAddedTaskId(taskId);
    if (justAddedTimer.current) window.clearTimeout(justAddedTimer.current);
    justAddedTimer.current = window.setTimeout(
      () => setJustAddedTaskId(null),
      JUST_ADDED_MS
    );

    const find = () =>
      (column
        ? document.querySelector(
            `.todo-shell [data-board-column="${column}"] .task-item[data-task-id="${CSS.escape(taskId)}"]`
          )
        : tasksContainerRef.current?.querySelector(
            `.task-item[data-task-id="${CSS.escape(taskId)}"]`
          )) as HTMLElement | null;

    for (let i = 0; i < 24; i++) {
      const row = find();
      if (row && row.getBoundingClientRect().height > 0) {
        // "nearest" scrolls the column only as far as it has to, so a board
        // that was already showing the foot of the column does not move.
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      await waitAnimationFrames(1);
    }
  }

  /**
   * Make a task from what an add row holds. The caller clears its own row.
   *
   * The draft's list wins over the tab's: a list picked in the row on the
   * All tab makes a server task, where the tab alone would keep it local.
   */
  async function addTask(
    column: TodoBoardColumn = "week",
    draft: TaskDraft
  ): Promise<string | null> {
    const text = draft.text.trim();
    if (!text) return null;

    const pickedList = draft.listId
      ? (lists.find((l) => l.id === draft.listId) ?? null)
      : null;
    const targetList = pickedList ?? addTargetList;
    // All tab, no list picked: a task on no list, the reader's own.
    const listId = targetList?.id ?? null;

    const durationVal = Number.parseInt(draft.duration, 10);
    const expected =
      Number.isFinite(durationVal) && durationVal > 0 ? durationVal : null;
    const draftAssignees = draft.assigneeIds;
    // The add row's note is HTML from the notes editor, pictures and all.
    const notesHtml = notesHtmlIsEmpty(draft.notes) ? null : draft.notes;
    const dueOn = draft.dueOn;
    const subtaskDrafts = draft.subtasks
      .map((row) => ({ ...row, text: row.text.trim() }))
      .filter((row) => row.text);
    // Due today, or already past: it lands in Today whatever row it was
    // typed into.
    const landing: TodoBoardColumn =
      dueOn && dueOn <= todayDueOn() ? "today" : column;
    const flags = boardColumnPatch(landing);
    const isToday = flags.isToday;
    const isBacklog = flags.isBacklog;
    const isSomeday = flags.isSomeday;
    const tempId = newClientId();
    /*
      Who the new task has to get below.

      The server picks the spot — MAX(position) + 1 over the open tasks of
      the same list, or of the tasks on no list — and a spot chosen
      differently here would move the row the moment the answer came back.
    */
    const columnPeers = openTasks.filter(
      (t) =>
        boardColumnOf(t, somedayEnabled) === landing && t.listId === listId
    );
    // People picked in the add row come first. Otherwise, with a people
    // filter on, assign those people so the new task stays visible.
    const filterableIds = new Set(assigneeFilterPeople.map((p) => p.id));
    // Under "mine" a new task needs nobody on it: the reader made it,
    // and that keeps it on their board.
    const seedAssignees = draftAssignees.length
      ? draftAssignees
      : assigneeFilterIds.length > 0
          ? assigneeFilterIds.filter((id) => filterableIds.has(id))
          : [];
    const optimistic: TodoTask = {
      id: tempId,
      listId,
      createdBy: makerKeys[0] ?? null,
      text,
      notesHtml,
      dueOn,
      completed: false,
      parentTaskId: null,
      completedAt: null,
      isFavourite: false,
      favouritePosition: null,
      isBacklog,
      isToday,
      isSomeday,
      showOnCalendar: false,
      assigneeIds: seedAssignees,
      colour: null,
      expectedDurationMinutes: expected,
      timeSpentSeconds: 0,
      // Below the column, and below the rest of the list — see columnPeers.
      position:
        Math.max(
          0,
          ...columnPeers.map((t) => t.position),
          ...state.tasks
            .filter((t) => t.listId === listId && !t.completed)
            .map((t) => t.position)
        ) + 1,
      basecampId: null,
      remindersId: null,
      createdAt: new Date().toISOString(),
    };
    // The steps go in with the parent, so the card shows them at once.
    const optimisticSubtasks: TodoTask[] = subtaskDrafts.map((row, index) => ({
      ...optimistic,
      id: newClientId(),
      text: row.text,
      notesHtml: null,
      dueOn: null,
      isBacklog: false,
      isToday: false,
      isSomeday: false,
      assigneeIds: row.assigneeIds,
      expectedDurationMinutes: null,
      position: index + 1,
      parentTaskId: tempId,
    }));
    setState((s) => ({
      ...s,
      tasks: [optimistic, ...optimisticSubtasks, ...s.tasks],
    }));
    // Which column to look in is about how the board is laid out, not about
    // which box the words were typed into.
    void revealAddedTask(tempId, showBoard && !isSearching ? landing : null);

    try {
      const json = await api("/api/todo/tasks", "POST", {
        id: tempId,
        listId,
        text,
        notesHtml,
        dueOn,
        expectedDurationMinutes: expected,
        isBacklog,
        isToday,
        isSomeday,
        // Send the seeded people too. Without them the server answer has no
        // assignees, and a filtered board drops the task the user just added.
        assigneeIds: seedAssignees,
      });
      const created = json.task as TodoTask;
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === tempId ? { ...t, ...created } : t)),
      }));
      // One at a time, in order: the server numbers each step after the
      // last, so a parallel send could land them shuffled.
      for (const subtask of optimisticSubtasks) {
        try {
          const stepJson = await api("/api/todo/tasks", "POST", {
            id: subtask.id,
            listId,
            parentTaskId: tempId,
            text: subtask.text,
            assigneeIds: subtask.assigneeIds,
          });
          const savedStep = stepJson.task as TodoTask | undefined;
          if (savedStep?.id) {
            setState((s) => ({
              ...s,
              tasks: s.tasks.map((t) =>
                t.id === subtask.id ? { ...t, ...savedStep } : t
              ),
            }));
          }
        } catch (err) {
          setState((s) => ({
            ...s,
            tasks: s.tasks.filter((t) => t.id !== subtask.id),
          }));
          toast.error(describeError(err, "Could not add the subtask"));
        }
      }
      if (targetList?.remindersListId && !isOfflineNow()) {
        pushReminders(async () => {
          const reminder = await createRemindersTask(
            targetList.remindersListId as string,
            created.text,
            created.dueOn
          );
          if (reminder.id) {
            await api("/api/todo/tasks", "PATCH", {
              id: created.id,
              remindersId: reminder.id,
            });
            patchTaskLocal(created.id, { remindersId: reminder.id });
          }
        });
      }
    } catch (err) {
      toast.error(describeError(err, "Could not add task"));
      setState((s) => ({
        ...s,
        tasks: s.tasks.filter(
          (t) => t.id !== tempId && t.parentTaskId !== tempId
        ),
      }));
      return null;
    }
    return tempId;
  }

  async function recreateTask(task: TodoTask): Promise<void> {
    const json = await api("/api/todo/tasks", "POST", {
      id: task.id.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
        ? task.id
        : newClientId(),
      listId: task.listId,
      text: task.text,
      expectedDurationMinutes: task.expectedDurationMinutes,
      isFavourite: task.isFavourite,
      isBacklog: task.isBacklog,
      isToday: task.isToday,
      isSomeday: task.isSomeday,
      assigneeIds: task.assigneeIds,
      ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    });
    const created = json.task as TodoTask;
    const patch: TodoTaskPatch = {};
    if (task.completed) patch.completed = true;
    if (task.notesHtml) patch.notesHtml = task.notesHtml;
    if (task.colour) patch.colour = task.colour;
    if (task.timeSpentSeconds) patch.timeSpentSeconds = task.timeSpentSeconds;
    if (task.position !== undefined) patch.position = task.position;
    if (Object.keys(patch).length) {
      await api("/api/todo/tasks", "PATCH", { id: created.id, ...patch });
    }
  }

  async function removeTask(id: string) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));

    try {
      await api(`/api/todo/tasks?id=${encodeURIComponent(id)}`, "DELETE");
      if (task.remindersId && listOfTask(task)?.remindersListId) {
        pushReminders(() => deleteRemindersTask(task.remindersId as string));
      }
      // A step says so: "Task deleted" over a card of steps read as
      // though the whole task had gone.
      showUndo(t(task.parentTaskId ? "subtaskDeleted" : "taskDeleted"), () => {
        void recreateTask(task).then(refresh);
      });
    } catch (err) {
      toast.error(describeError(err, "Delete failed"));
      void refresh();
    }
  }

  function clearDone() {
    if (!doneTasks.length) return;
    const snapshot = [...doneTasks];
    setConfirmModal({
      title: t("clearAll"),
      message: t("deleteAllCompleted"),
      confirmLabel: t("delete"),
      danger: true,
      onConfirm: () => {
        const ids = snapshot.map((task) => task.id);
        setState((s) => ({
          ...s,
          tasks: s.tasks.filter((task) => !ids.includes(task.id)),
        }));
        const restore = () => {
          void Promise.all(snapshot.map(recreateTask)).then(refresh);
        };
        void Promise.all(
          ids.map((id) =>
            api(`/api/todo/tasks?id=${encodeURIComponent(id)}`, "DELETE")
          )
        )
          .then(() => showUndo(t("taskDeleted"), restore))
          .catch((err) => {
            toast.error(describeError(err, "Delete failed"));
            void refresh();
          });
      },
    });
  }

  function openCreateListModal() {
    setModalName("");
    setModalColour("");
    setModalEmoji("");
    setModalBcProjectId("");
    setModalBcListId("");
    setBcTodolists([]);
    setModalRemindersListId("");
    setListModal({ mode: "create", kind: "list" });
  }

  function openRenameListModal(list: TodoList) {
    setModalName(list.name);
    // Prefer hex for the blocker-style picker; map legacy named keys.
    setModalColour(
      list.colour?.startsWith("#")
        ? list.colour
        : resolveTabColorHex(list.colour) ?? list.colour ?? ""
    );
    setModalEmoji(resolveListIconId(list.emoji) ?? "");
    setModalBcProjectId(list.basecampProjectId ?? "");
    setModalBcListId(list.basecampListId ?? "");
    setBcTodolists([]);
    setModalRemindersListId(list.remindersListId ?? "");
    if (list.basecampProjectId) void selectBcProjectKeepList(list);
    setListModal({ mode: "rename", kind: "list", list });
  }

  async function selectBcProjectKeepList(list: TodoList) {
    try {
      const json = await api(
        `/api/todo/basecamp/todolists?projectId=${encodeURIComponent(list.basecampProjectId as string)}`,
        "GET"
      );
      setBcTodolists(json.todolists as { id: string; name: string }[]);
      setModalBcListId(list.basecampListId ?? "");
    } catch {
      /* selector stays empty */
    }
  }

  function openCreateGroupModal() {
    setModalName("");
    setModalColour("");
    setModalBcProjectId("");
    setModalBcListId("");
    setBcTodolists([]);
    setImportingGroup(false);
    setListModal({ mode: "create", kind: "group" });
  }

  function openRenameGroupModal(group: TodoGroup) {
    setModalName(group.name);
    setModalColour(group.colour ?? "");
    setModalBcProjectId("");
    setListModal({ mode: "rename", kind: "group", group });
  }

  async function submitListModal() {
    const modal = listModal;
    if (!modal || importingGroup) return;

    const isBcGroupImport =
      modal.kind === "group" &&
      modal.mode === "create" &&
      Boolean(modalBcProjectId && bcConnected);

    const projectName = bcProjects.find((p) => p.id === modalBcProjectId)?.name;
    const bcListName = bcTodolists.find((l) => l.id === modalBcListId)?.name;
    const remindersListName = remindersLists.find(
      (l) => l.id === modalRemindersListId
    )?.name;
    // Empty name: fall back to linked source name (redd-do behaviour).
    const name =
      modalName.trim() ||
      (isBcGroupImport
        ? projectName || "New Group"
        : modal.kind === "list"
          ? bcListName || remindersListName || ""
          : "");
    if (!name) return;

    // Keep the modal open while importing so we can show progress.
    if (!isBcGroupImport) setListModal(null);

    try {
      if (modal.kind === "group") {
        if (modal.mode === "create") {
          if (isBcGroupImport) setImportingGroup(true);
          const json = await api("/api/todo/groups", "POST", {
            name,
            colour: modalColour || null,
          });
          const group = json.group as TodoGroup;
          setCurrentGroupId(group.id);
          persistPref(CURRENT_GROUP_KEY, group.id);

          if (isBcGroupImport) {
            const bcProjectId = modalBcProjectId;
            const listsJson = await api(
              `/api/todo/basecamp/todolists?projectId=${encodeURIComponent(bcProjectId)}`,
              "GET"
            );
            const todolists = (listsJson.todolists ?? []) as {
              id: string;
              name: string;
            }[];
            const createdLists: TodoList[] = [];
            for (const bcList of todolists) {
              const created = await api("/api/todo/lists", "POST", {
                id: newClientId(),
                name: bcList.name || "Untitled",
                groupId: group.id,
              });
              let list = created.list as TodoList;
              const patched = await api("/api/todo/lists", "PATCH", {
                id: list.id,
                basecampProjectId: bcProjectId,
                basecampListId: bcList.id,
              });
              list = patched.list as TodoList;
              createdLists.push(list);
            }
            await Promise.all(
              createdLists.map((list) =>
                api("/api/todo/basecamp/sync", "POST", { listId: list.id }).catch(
                  () => null
                )
              )
            );
            setState((s) => ({
              ...s,
              groups: [...s.groups, group],
              lists: [...s.lists, ...createdLists],
            }));
            if (createdLists[0]) {
              setCurrentListId(createdLists[0].id);
              persistPref(TODO_CURRENT_LIST_KEY, createdLists[0].id);
            } else {
              setCurrentListId(TODO_ALL_LIST_ID);
              persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
            }
            await refresh();
            setListModal(null);
            setImportingGroup(false);
          } else {
            setState((s) => ({ ...s, groups: [...s.groups, group] }));
            setCurrentListId(TODO_ALL_LIST_ID);
            persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
          }
        } else {
          const { id } = modal.group;
          setState((s) => ({
            ...s,
            groups: s.groups.map((g) =>
              g.id === id ? { ...g, name, colour: modalColour || null } : g
            ),
          }));
          await api("/api/todo/groups", "PATCH", {
            id,
            name,
            colour: modalColour || null,
          });
        }
        return;
      }
      const links = {
        basecampProjectId: modalBcListId ? modalBcProjectId || null : null,
        basecampListId: modalBcListId || null,
        remindersListId: modalRemindersListId || null,
      };
      const appearance = {
        colour: modalColour || null,
        emoji: modalEmoji || null,
      };
      if (modal.mode === "create") {
        const listId = newClientId();
        const json = await api("/api/todo/lists", "POST", {
          id: listId,
          name,
          ...appearance,
          ...links,
          groupId: groupsEnabled ? (activeGroup?.id ?? null) : null,
        });
        const list = {
          ...(json.list as TodoList),
          id: (json.list as TodoList).id || listId,
          name,
          ...appearance,
          ...links,
          groupId: groupsEnabled ? (activeGroup?.id ?? null) : null,
        } as TodoList;
        setState((s) => ({ ...s, lists: [...s.lists, list] }));
        setCurrentListId(list.id);
        persistPref(TODO_CURRENT_LIST_KEY, list.id);
        if (
          list.remindersListId &&
          isNativeShell() &&
          remindersConnected &&
          !isOfflineNow()
        ) {
          suppressAutoSyncListIdsRef.current.add(list.id);
          const toastId = toast.loading(
            `Importing “${list.name}” from Apple Reminders…`
          );
          try {
            const result = await syncRemindersList(list, [], {
              api,
              onProgress: (progress) => {
                toast.loading(
                  `“${list.name}”: ${remindersProgressLabel(progress)}`,
                  { id: toastId }
                );
              },
              onTaskPulled: (task) => {
                setState((s) => ({
                  ...s,
                  tasks: s.tasks.some((row) => row.id === task.id)
                    ? s.tasks
                    : [...s.tasks, task],
                }));
              },
            });
            toast.success(
              result.pulled
                ? `Imported ${result.pulled} task${
                    result.pulled === 1 ? "" : "s"
                  } from Apple Reminders`
                : `“${list.name}” is linked to Apple Reminders`,
              { id: toastId, duration: 5000 }
            );
          } catch (err) {
            toast.error(
              describeError(err, "Could not import from Apple Reminders"),
              { id: toastId }
            );
          } finally {
            suppressAutoSyncListIdsRef.current.delete(list.id);
          }
          void refresh();
        }
        if (list.basecampListId && !isOfflineNow()) {
          suppressAutoSyncListIdsRef.current.add(list.id);
          const toastId = toast.loading(
            `Importing “${list.name}” from Basecamp…`
          );
          try {
            const syncJson = await api("/api/todo/basecamp/sync", "POST", {
              listId: list.id,
            });
            const result = syncJson.result as {
              pulled: number;
              pushed: number;
              removed: number;
              updated: number;
            };
            toast.success(`Synced “${list.name}”`, {
              id: toastId,
              description: formatSyncCounts("Basecamp", result),
              duration: 5000,
            });
          } catch (err) {
            toast.error(
              describeError(err, "Could not import from Basecamp"),
              { id: toastId }
            );
          } finally {
            suppressAutoSyncListIdsRef.current.delete(list.id);
          }
          void refresh();
        }
      } else {
        const { id } = modal.list;
        setState((s) => ({
          ...s,
          lists: s.lists.map((l) =>
            l.id === id
              ? { ...l, name, ...appearance, ...links }
              : l
          ),
        }));
        await api("/api/todo/lists", "PATCH", {
          id,
          name,
          ...appearance,
          ...links,
        });
      }
    } catch (err) {
      if (isBcGroupImport) {
        toast.error(describeError(err, t("importFromBasecampFailed")));
        setImportingGroup(false);
        setListModal(null);
      } else {
        toast.error(describeError(err, "Could not save"));
      }
      void refresh();
    }
  }

  function removeList(list: TodoList) {
    const listTasks = state.tasks.filter((task) => task.listId === list.id);
    setConfirmModal({
      title: t("deleteList"),
      message: `${t("deleteConfirm")} (${list.name})`,
      confirmLabel: t("deleteList"),
      danger: true,
      onConfirm: () => {
        setState((s) => ({
          ...s,
          lists: s.lists.filter((l) => l.id !== list.id),
          tasks: s.tasks.filter((task) => task.listId !== list.id),
        }));
        if (currentListId === list.id || currentListId === TODO_ALL_LIST_ID) {
          const remaining = lists.filter((l) => l.id !== list.id);
          if (remaining.length === 1) {
            setCurrentListId(remaining[0].id);
            persistPref(TODO_CURRENT_LIST_KEY, remaining[0].id);
          } else if (remaining.length > 1) {
            setCurrentListId(TODO_ALL_LIST_ID);
            persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
          } else {
            setCurrentListId(null);
            persistPref(TODO_CURRENT_LIST_KEY, "");
          }
        }
        void api(`/api/todo/lists?id=${encodeURIComponent(list.id)}`, "DELETE")
          .then(() =>
            showUndo(t("listDeleted"), () => {
              void (async () => {
                const json = await api("/api/todo/lists", "POST", {
                  id: newClientId(),
                  name: list.name,
                  colour: list.colour,
                  emoji: list.emoji,
                  groupId: list.groupId,
                });
                let created = json.list as TodoList;
                if (
                  list.basecampListId ||
                  list.remindersListId
                ) {
                  const patched = await api("/api/todo/lists", "PATCH", {
                    id: created.id,
                    basecampProjectId: list.basecampProjectId,
                    basecampListId: list.basecampListId,
                    remindersListId: list.remindersListId,
                  });
                  created = patched.list as TodoList;
                }
                for (const task of listTasks) {
                  await recreateTask({ ...task, listId: created.id });
                }
                await refresh();
              })();
            })
          )
          .catch((err) => {
            toast.error(describeError(err, "Delete failed"));
            void refresh();
          });
      },
    });
  }

  const editInputRef = React.useRef<HTMLTextAreaElement | null>(null);

  function resizeEditTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }

  function startEditTask(task: TodoTask) {
    if (view === "favourites") {
      // redd-do navigates to the task's list from the favourites view.
      if (task.listId) navigateToList(task.listId);
      return;
    }
    editingTextRef.current = task.text;
    setEditingTaskId(task.id);
  }

  React.useLayoutEffect(() => {
    if (!editingTaskId) return;
    resizeEditTextarea(editInputRef.current);
  }, [editingTaskId]);

  /**
   * Where the caret goes when a title's editor closes: back to the title
   * (`0`), or on to the control after it (`1`), or the one before (`-1`).
   *
   * Set by the keys that close the editor, never by a click elsewhere:
   * the caret follows the pointer then. It waits for the title to be back
   * on the page — moving the caret while the editor was still being taken
   * away lost it altogether, and the card read as unselected.
   */
  const caretAfterEditRef = React.useRef<{
    taskId: string;
    step: -1 | 0 | 1;
  } | null>(null);
  React.useEffect(() => {
    if (editingTaskId) return;
    const exit = caretAfterEditRef.current;
    if (!exit) return;
    caretAfterEditRef.current = null;
    const card = document.querySelector(
      `.task-item[data-task-id="${CSS.escape(exit.taskId)}"]`
    ) as HTMLElement | null;
    const title = card?.querySelector(".task-text") as HTMLElement | null;
    if (!card || !title) return;
    // The title first, whatever else follows: the card holding the caret
    // is what draws its pill, and the pill's buttons are stops of their own.
    title.focus();
    if (exit.step === 0) return;
    const stops = focusStops(card);
    const at = stops.indexOf(title);
    if (at === -1) return;
    stops[at + exit.step]?.focus();
  }, [editingTaskId]);

  function commitEditTask() {
    const id = editingTaskId;
    const text = editingTextRef.current.trim();
    setEditingTaskId(null);
    if (!id || !text) return;
    void mutateTask(id, { text });
  }

  function commitEditDuration(task: TodoTask) {
    const raw = editingDuration.trim();
    setEditingDurationTaskId(null);
    const minutes = Number.parseInt(raw, 10);
    const value = Number.isFinite(minutes) && minutes > 0 ? minutes : null;
    if (task.completed) {
      void mutateTask(task.id, { timeSpentSeconds: value ? value * 60 : 0 });
    } else {
      void mutateTask(task.id, { expectedDurationMinutes: value });
    }
  }

  /**
   * Where this task's note sends a picture.
   *
   * On a Basecamp-linked list, in the planner, straight to Basecamp: a
   * picture there is a file it has signed, named by an sgid. Anywhere
   * else — a task on no list, an unlinked list, the desktop app — to the
   * app's own store, and the sync gives it to Basecamp if the task ever
   * reaches a linked list.
   */
  function uploaderForTask(task: TodoTask): UploadImage {
    if (isStandaloneTodo()) return uploadLocalNoteImage;
    /*
      A subtask's note never reaches Basecamp: a step there holds a title
      and a tick, and no notes. A picture given to Basecamp from one was
      signed and then never expanded, so the only copy this app could draw
      was the one the upload kept in the server's memory — and on the
      live site that memory is a different process by the next request.
      The picture 404ed as soon as it was pasted. The app's own store is
      the picture's home for every subtask, linked list or not.
    */
    if (task.parentTaskId) return uploadLocalNoteImage;
    return uploaderForList(task.listId);
  }

  /**
   * Where a note on this list sends a picture. The half of the rule above
   * that a task not yet made can ask: the add row writes its note before
   * there is a task, and knows only the list it will go on.
   */
  function uploaderForList(listId: string | null): UploadImage {
    if (isStandaloneTodo()) return uploadLocalNoteImage;
    const list = listsRef.current.find((l) => l.id === listId);
    if (!list?.basecampProjectId || !list?.basecampListId) {
      return uploadLocalNoteImage;
    }
    return uploadBasecampImage;
  }

  function toggleNotes(task: TodoTask) {
    if (openNotesTaskId === task.id) {
      saveNotes(task.id);
      return;
    }
    setOpenNotesTaskId(task.id);
    setNotesDraft(task.notesHtml ?? "");
    setNotesExpanded(false);
  }

  /**
   * The notes editor the board opens under a row. The Today session shows the
   * same one, so notes are written in one place and one way.
   */
  function renderNotesEditor(task: TodoTask) {
    if (openNotesTaskId !== task.id) return null;
    /*
      One editor at a time.

      With the full-window note open, this one kept running underneath it:
      two live documents over one draft, and one slot for the save to read
      from. Which copy a save saw depended on which editor mounted last —
      the kind of difference between the expanded and the small note that
      has no business existing. The overlay covers this box anyway; when it
      closes, this editor comes back and loads the draft the overlay wrote.
    */
    if (notesExpanded) {
      return (
        <div className="notes-container open" style={{ display: "block" }}>
          <div className="notes-editor-wrapper active" />
        </div>
      );
    }
    return (
      <div className="notes-container open" style={{ display: "block" }}>
        <div className="notes-editor-wrapper active">
          {/* The notes button opens this box to be written in, so the
              caret starts here rather than after a second click. */}
          <TrixNotesEditor
            value={notesDraft}
            onChange={setNotesDraft}
            placeholder="Add notes..."
            resolveImageSrc={resolveBasecampImage}
            uploadImage={uploaderForTask(task)}
            onPendingChange={(n) => (notesUploading.current = n)}
            readCurrentRef={notesReadCurrent}
            onDone={() => saveNotes(task.id)}
            autoFocus
          />
          <button
            className="notes-done-btn"
            title="Done editing"
            onClick={() => saveNotes(task.id)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      </div>
    );
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
  /**
   * The note as the reader sees it: read from the visible editor itself.
   *
   * A slot the editors registered into answered for this before, and hot
   * reload proved how weak that is — a stale instance can hold the slot
   * while the visible one goes unread, and the save quietly writes the
   * wrong document. The DOM cannot be stale about which editor is on
   * screen: the one inside the open note container is the one the reader
   * is typing in.
   */
  function readOpenNote(): string | null {
    const el = (document.querySelector(
      ".notes-overlay-body trix-editor"
    ) ?? document.querySelector(
      ".notes-container.open trix-editor"
    )) as (HTMLElement & { value: string }) | null;
    if (!el || !el.isConnected) return null;
    return trixToBasecamp(el.value);
  }


  React.useEffect(() => {
    if (!notesExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // The card is the task now, not only its notes: leaving it saves and
      // puts the reader back on the board, not into the small note box.
      if (openNotesTaskId) saveNotes(openNotesTaskId);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesExpanded]);

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
  // The card over the Calendar goes away on a press on the Calendar or on the
  // top bar, and on Escape when nothing of the card's own is open. A menu of
  // the card is drawn outside the card, on the page, so a press there stays.
  const cardBusy = Boolean(
    duePopoverTaskId || openMenuTaskId || openListPickerTaskId || openAssignTaskId ||
      editingTaskId || openNotesTaskId
  );
  const cardBusyRef = React.useRef(cardBusy);
  cardBusyRef.current = cardBusy;
  React.useEffect(() => {
    if (!calendarCard && !calendarNew) return;
    const close = () => {
      if (calendarCard) {
        calendarCardClosedRef.current = { taskId: calendarCard.taskId, at: Date.now() };
      }
      setCalendarCard(null);
      setCalendarNew(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;
      if (target.closest(".calendar-task-popover")) return;
      if (target.closest("#plan-mode, .title-bar")) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || cardBusyRef.current) return;
      // A menu of the card or of the add-task box is drawn on the page.
      // Escape is for that menu first.
      if (document.querySelector(".todo-menu-portal-root, .assign-menu-portal-root")) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [calendarCard, calendarNew]);
  // A task that is ticked, or deleted, leaves the Calendar. Its card goes too,
  // after the tick has had its moment.
  const calendarCardTask = calendarCard
    ? state.tasks.find((item) => item.id === calendarCard.taskId)
    : undefined;
  const calendarCardGone = Boolean(calendarCard) && (!calendarCardTask || calendarCardTask.completed);
  React.useEffect(() => {
    if (!calendarCardGone) return;
    const id = window.setTimeout(() => setCalendarCard(null), 700);
    return () => window.clearTimeout(id);
  }, [calendarCardGone]);

  function calendarPopoverPlace(at: CalendarTaskAnchor): React.CSSProperties {
    const scale = zoom / 100;
    const winW = window.innerWidth / scale;
    const winH = window.innerHeight / scale;
    const anchor = { left: at.left / scale, top: at.top / scale, bottom: at.bottom / scale };
    const width = Math.min(420, winW - 24);
    const left = Math.min(Math.max(anchor.left, 12), winW - width - 12);
    // Under the place, or over it when the place is low in the window.
    const below = anchor.bottom < winH * 0.62;
    return below
      ? { left, width, top: anchor.bottom + 10 }
      : { left, width, bottom: winH - anchor.top + 10 };
  }

  function renderCalendarCard() {
    if (view !== "plan") return null;
    if (calendarNew) return renderCalendarNewTask(calendarNew);
    if (!calendarCard) return null;
    const task = state.tasks.find((item) => item.id === calendarCard.taskId);
    if (!task) return null;
    return (
      <div
        className="calendar-task-popover"
        role="dialog"
        aria-label={task.text}
        style={calendarPopoverPlace(calendarCard.anchor)}
      >
        {renderTask(task)}
      </div>
    );
  }

  /**
   * The add-task box over the Calendar, beside the day that was
   * double-clicked. It is the add-task box of a list, with the due day set.
   * The new task is ticked for the Calendar, it gets its hours when the
   * click was in the hours of the week view, and then its card takes the
   * place of the box, as after a double click on a task.
   */
  function renderCalendarNewTask(request: CalendarTaskRequest) {
    return (
      <div
        className="calendar-task-popover calendar-task-popover--new"
        role="dialog"
        aria-label={t("addTask")}
        style={calendarPopoverPlace(request.anchor)}
      >
        <AddTaskComposer
          key={`${request.dateKey}-${request.startMinutes ?? "day"}`}
          placeholder={t("addTaskPlaceholder")}
          addLabel={t("addTask")}
          minutesLabel={t("minutes")}
          initialDraft={{ dueOn: request.dateKey }}
          autoFocus
          onSubmit={(draft) => {
            void (async () => {
              const id = await addTask("week", draft);
              if (!id) return;
              await mutateTask(id, { showOnCalendar: true });
              if (request.startMinutes != null && draft.dueOn === request.dateKey) {
                const minutes = Number.parseInt(draft.duration, 10);
                const length = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
                window.PlanModule?.setTaskTime(
                  id,
                  request.startMinutes,
                  Math.min(request.startMinutes + length, 23 * 60)
                );
              }
              setCalendarNew(null);
              setCalendarCard({ taskId: id, anchor: request.anchor });
            })();
          }}
          uploadImageForList={uploaderForList}
          resolveImageSrc={resolveBasecampImage}
          people={state.people}
          assignEnabled={assignEnabled}
          onEditPeople={() => setPeopleEditorOpen(true)}
          lists={lists}
          defaultList={addTargetList}
          lang={lang}
          t={t}
        />
      </div>
    );
  }

  function renderNotesOverlay() {
    if (!openNotesTaskId || !notesExpanded) return null;
    const task = state.tasks.find((t) => t.id === openNotesTaskId);
    if (!task) return null;
    const taskList = state.lists.find((l) => l.id === task.listId);
    const listIconId = resolveListIconId(taskList?.emoji);
    const assignees = task.assigneeIds
      .map((id) => peopleById.get(id))
      .filter((p): p is TodoPerson => Boolean(p));
    const mySubtasks = subtasksByTask.get(task.id) ?? [];
    /* While a row is carried, the list is drawn in the order the pointer
       is making, and the stored order takes over again on the drop. */
    const orderedSubtasks = subtaskPreview
      ? subtaskPreview
          .map((id) => mySubtasks.find((st) => st.id === id))
          .filter((st): st is TodoTask => Boolean(st))
      : mySubtasks;
    /*
      The row that adds a subtask. It is drawn after the last step
      still to do, not under the done pile, so a new step lands where
      it is read — and when every step is done, at the top.
    */
    const lastOpenSubtaskId =
      [...orderedSubtasks].reverse().find((st) => !st.completed)?.id ?? null;
    const addSubtaskRow = (
      <>
      {/*
        The new subtask, as the add-task row is for a task: type
        the words, Tab on to its time, notes and people, and
        Enter adds it with all of them.
      */}
      <div
        className={`task-subtask-row task-subtask-add-row${
          newSubtaskText.trim() ||
          newSubtaskAssigneeIds.length ||
          newSubtaskNotesOpen ||
          newSubtaskDuration != null
            ? " is-drafting"
            : ""
        }`}
      >
        {/* Where the check circle stands on the rows above, so
            the words start where theirs do. */}
        <span
          className="task-subtask-check task-subtask-check-ghost"
          aria-hidden
          onClick={() => newSubtaskInputRef.current?.focus()}
        >
          <Plus size={12} strokeWidth={2.5} />
        </span>
        <input
          ref={newSubtaskInputRef}
          type="text"
          className="task-subtask-add"
          placeholder={t("addSubtask")}
          value={newSubtaskText}
          onChange={(e) => setNewSubtaskText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            submitNewSubtask(task);
          }}
        />
        <span className="task-subtask-actions">
          {newSubtaskDurEditing ? (
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              className="task-subtask-dur-input"
              defaultValue={
                newSubtaskDuration == null ? "" : String(newSubtaskDuration)
              }
              placeholder="min"
              onBlur={(e) => {
                setNewSubtaskDurEditing(false);
                const raw = e.target.value.replace(/[^0-9]/g, "");
                setNewSubtaskDuration(raw ? Math.round(Number(raw)) : null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") setNewSubtaskDurEditing(false);
              }}
            />
          ) : (
            <button
              type="button"
              className={`task-subtask-action${
                newSubtaskDuration != null ? " has-value" : ""
              }`}
              title={t("estimateTime")}
              onClick={() => setNewSubtaskDurEditing(true)}
            >
              <ClockIcon />
              {newSubtaskDuration != null ? (
                <span>{newSubtaskDuration}m</span>
              ) : null}
            </button>
          )}
          <button
            type="button"
            className={`task-subtask-action${
              notesHtmlIsEmpty(newSubtaskNotes) ? "" : " has-value"
            }${newSubtaskNotesOpen ? " is-active" : ""}`}
            title={t("notes")}
            onClick={() => setNewSubtaskNotesOpen((open) => !open)}
          >
            <NotesIcon />
          </button>
          {assignEnabled ? (
            <span className="assign-menu-wrap">
              <button
                type="button"
                className={`task-subtask-action${
                  newSubtaskAssigneeIds.length ? " has-value" : ""
                }`}
                title={t("assignPerson")}
                onClick={(e) => {
                  e.stopPropagation();
                  if (openAssignTaskId === NEW_SUBTASK_ASSIGN_ID) {
                    closeAssignMenu();
                  } else {
                    setAssignAnchorEl(e.currentTarget);
                    setOpenAssignTaskId(NEW_SUBTASK_ASSIGN_ID);
                  }
                }}
              >
                {newSubtaskAssigneeIds.length ? (
                  <TaskAssigneeStack
                    people={newSubtaskAssigneeIds
                      .map((pid) => peopleById.get(pid))
                      .filter((p): p is TodoPerson => Boolean(p))}
                    size={18}
                  />
                ) : (
                  <User size={14} strokeWidth={2} />
                )}
              </button>
              <TaskAssignMenu
                open={openAssignTaskId === NEW_SUBTASK_ASSIGN_ID}
                anchorEl={
                  openAssignTaskId === NEW_SUBTASK_ASSIGN_ID ? assignAnchorEl : null
                }
                people={state.people}
                assigneeIds={newSubtaskAssigneeIds}
                t={t}
                onToggle={(personId) =>
                  setNewSubtaskAssigneeIds((ids) =>
                    ids.includes(personId)
                      ? ids.filter((id) => id !== personId)
                      : [...ids, personId]
                  )
                }
                onEditPeople={() => {
                  closeAssignMenu();
                  setPeopleEditorOpen(true);
                }}
                onClose={closeAssignMenu}
              />
            </span>
          ) : null}
          {/* The places of the focus button and the ×, which a
              subtask not yet added has no use for, so its
              controls line up with the rows above. */}
          {nativeShell ? (
            <span className="task-subtask-action task-subtask-slot" aria-hidden />
          ) : null}
          <span className="task-subtask-delete task-subtask-slot" aria-hidden />
        </span>
      </div>
      {newSubtaskNotesOpen ? (
        <div className="task-subtask-notes">
          <TrixNotesEditor
            value={newSubtaskNotes}
            onChange={setNewSubtaskNotes}
            placeholder="Add notes..."
            resolveImageSrc={resolveBasecampImage}
            uploadImage={uploaderForTask(task)}
            onDone={() => {
              setNewSubtaskNotesOpen(false);
              newSubtaskInputRef.current?.focus();
            }}
            autoFocus
          />
          <button
            type="button"
            className="notes-done-btn"
            title="Done editing"
            onClick={() => {
              setNewSubtaskNotesOpen(false);
              newSubtaskInputRef.current?.focus();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      ) : null}
      </>
    );
    return (
      <div
        className="modal-overlay notes-overlay"
        onClick={(event) => {
          // Only the ground behind the card. A click inside it is the task.
          if (event.target === event.currentTarget) saveNotes(task.id);
        }}
      >
        <div
          className="notes-overlay-card task-overlay-card"
          role="dialog"
          aria-modal="true"
          aria-label={task.text}
        >
          <div className="notes-overlay-head">
            <input
              type="checkbox"
              className="task-checkbox"
              checked={task.completed}
              onChange={(event) => toggleTaskCompleted(task, event)}
              aria-label={t("markDone")}
            />
            <h2 className="notes-overlay-title">{task.text}</h2>
            <button
              type="button"
              className="notes-collapse-btn"
              title={t("collapseTask")}
              aria-label={t("collapseTask")}
              onClick={() => saveNotes(task.id)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          </div>
          <div className="task-overlay-scroll">
          <div
            className="task-overlay-fields"
            ref={setOverlayFieldsNode}
            onScroll={updateOverlayFade}
          >
            {/* The list it is on. The picker is the card's own, drawn here. */}
            <div className="task-overlay-row">
              <span className="task-overlay-label">{t("fieldList")}</span>
              <div className="task-overlay-value">
                <div
                  className={`task-list-origin-wrap${overlayListOpen ? " is-open" : ""}`}
                >
                  <button
                    type="button"
                    className="task-overlay-list-btn"
                    aria-haspopup="menu"
                    aria-expanded={overlayListOpen}
                    disabled={state.lists.length === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOverlayListOpen((v) => !v);
                    }}
                  >
                    {listIconId ? (
                      <ListIcon id={listIconId} size={15} />
                    ) : null}
                    <span>{taskList?.name ?? "—"}</span>
                  </button>
                  {overlayListOpen ? (
                    <MenuKeys
                      className="task-list-picker"
                      onClose={() => setOverlayListOpen(false)}
                    >
                      {state.lists.map((l) => {
                        const iconId = resolveListIconId(l.emoji);
                        const selected = l.id === task.listId;
                        return (
                          <button
                            key={l.id}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={`task-list-picker-item${
                              selected ? " is-current" : ""
                            }`}
                            onClick={() => {
                              setOverlayListOpen(false);
                              if (!selected) void mutateTask(task.id, { listId: l.id });
                            }}
                          >
                            <span
                              className={`task-list-picker-icon${iconId ? " has-icon" : ""}`}
                            >
                              {iconId ? (
                                <ListIcon id={iconId} size={14} />
                              ) : (
                                listOriginLetters(l)
                              )}
                            </span>
                            <span className="task-list-picker-name">{l.name}</span>
                          </button>
                        );
                      })}
                    </MenuKeys>
                  ) : null}
                </div>
              </div>
            </div>
            {assignEnabled ? (
              <div className="task-overlay-row">
                <span className="task-overlay-label">{t("fieldAssignedTo")}</span>
                <div className="task-overlay-value">
                  <button
                    type="button"
                    className="task-overlay-assign-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const el = e.currentTarget;
                      setOverlayAssignAnchor((now) => (now ? null : el));
                    }}
                  >
                    {assignees.length ? (
                      <>
                        <TaskAssigneeStack people={assignees} size={26} />
                        <span className="task-overlay-assign-names">
                          {assignees.map((p) => shortPersonName(p.name)).join(", ")}
                        </span>
                      </>
                    ) : (
                      <span className="task-overlay-placeholder">{t("assignPerson")}</span>
                    )}
                  </button>
                  <TaskAssignMenu
                    open={Boolean(overlayAssignAnchor)}
                    anchorEl={overlayAssignAnchor}
                    people={state.people}
                    assigneeIds={task.assigneeIds}
                    t={t}
                    onToggle={(personId) => toggleTaskAssignee(task.id, personId)}
                    onEditPeople={() => {
                      setOverlayAssignAnchor(null);
                      setPeopleEditorOpen(true);
                    }}
                    onClose={() => setOverlayAssignAnchor(null)}
                  />
                </div>
              </div>
            ) : null}
            <div className="task-overlay-row">
              <span className="task-overlay-label">{t("fieldDuration")}</span>
              <div className="task-overlay-value">
                <input
                  key={`${task.id}:${task.expectedDurationMinutes ?? ""}`}
                  type="text"
                  inputMode="numeric"
                  className="task-overlay-duration"
                  defaultValue={
                    task.expectedDurationMinutes == null
                      ? ""
                      : String(task.expectedDurationMinutes)
                  }
                  /* As wide as its number, so "min" sits right after it.
                     Empty, the inline width goes and the stylesheet's
                     width takes over — the placeholder needs the room.
                     The box has 8px of padding and a 1px border on each
                     side, and its width counts them. Two spare characters
                     were less than that, so "90" showed as "9". */
                  style={
                    task.expectedDurationMinutes == null
                      ? undefined
                      : {
                          width: `calc(${String(task.expectedDurationMinutes).length}ch + 22px)`,
                        }
                  }
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.width = el.value ? `calc(${el.value.length}ch + 22px)` : "";
                  }}
                  placeholder={t("estimateTime")}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const minutes = raw ? Number(raw.replace(/[^0-9]/g, "")) : null;
                    const next =
                      minutes != null && Number.isFinite(minutes) && minutes > 0
                        ? Math.round(minutes)
                        : null;
                    if (next === (task.expectedDurationMinutes ?? null)) return;
                    void mutateTask(task.id, { expectedDurationMinutes: next });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
                <span className="task-overlay-unit">min</span>
              </div>
            </div>
            <div className="task-overlay-row">
              <span className="task-overlay-label">{t("fieldDue")}</span>
              <div className="task-overlay-value task-overlay-due-value">
                <input
                  type="date"
                  className="task-overlay-due"
                  aria-label={t("fieldDue")}
                  value={task.dueOn ?? ""}
                  onChange={(e) =>
                    void mutateTask(task.id, dueDatePatch(e.target.value || null))
                  }
                />
                {task.dueOn ? (
                  <>
                    <span className="task-overlay-due-said">
                      {formatDueOn(task.dueOn, lang, t)}
                    </span>
                    <button
                      type="button"
                      className="task-overlay-due-clear"
                      title={t("composerClear")}
                      aria-label={t("composerClear")}
                      onClick={() => void mutateTask(task.id, { dueOn: null })}
                    >
                      <X size={13} strokeWidth={2.5} aria-hidden />
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="task-overlay-row task-overlay-notes">
              <span className="task-overlay-label">{t("fieldNotes")}</span>
              <div className="task-overlay-value notes-overlay-body">
                <TrixNotesEditor
                  value={notesDraft}
                  onChange={setNotesDraft}
                  placeholder="Add notes..."
                  resolveImageSrc={resolveBasecampImage}
                  uploadImage={uploaderForTask(task)}
                  onPendingChange={(n) => (notesUploading.current = n)}
                  readCurrentRef={notesReadCurrent}
                  className="notes-overlay-editor"
                  /* The full-window note has no tick of its own — the same
                     save puts it away, so the key means one thing in both. */
                  onDone={() => saveNotes(task.id)}
                />
              </div>
            </div>
            {(
            <div className="task-overlay-row task-overlay-subtasks">
              <span className="task-overlay-label">{t("subtasks")}</span>
              <div className="task-overlay-value">
                <div className="task-subtask-list" ref={subtaskListRef}>
                  {/* One flat list, the add row keyed in it like a row. It
                      moves down as steps are added, and React keeps it:
                      the same input, with the caret still in it, so the
                      next step can be typed at once. Drawn inside a row's
                      fragment, it was a new input after each Enter. */}
                  {[
                    ...(lastOpenSubtaskId === null
                      ? [<React.Fragment key="add-subtask">{addSubtaskRow}</React.Fragment>]
                      : []),
                    ...orderedSubtasks.flatMap((subtask) => [
                    <React.Fragment key={subtask.id}>
                    <div
                      data-subtask-id={subtask.id}
                      className={`task-subtask-row${subtask.completed ? " is-done" : ""}${
                        subtaskDragId === subtask.id ? " is-dragging" : ""
                      }`}
                    >
                      <span
                        className="task-subtask-grip"
                        title={t("dragToReorder")}
                        aria-hidden
                        onPointerDown={(e) =>
                          startSubtaskDrag(e, task.id, subtask.id)
                        }
                      >
                        <svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
                          <circle cx="2.5" cy="3" r="1.4" />
                          <circle cx="7.5" cy="3" r="1.4" />
                          <circle cx="2.5" cy="8" r="1.4" />
                          <circle cx="7.5" cy="8" r="1.4" />
                          <circle cx="2.5" cy="13" r="1.4" />
                          <circle cx="7.5" cy="13" r="1.4" />
                        </svg>
                      </span>
                      <button
                        type="button"
                        className={`task-subtask-check${
                          subtask.completed ? " is-checked" : ""
                        }`}
                        aria-label={subtask.text}
                        aria-pressed={subtask.completed}
                        onClick={(e) => {
                          const completing = !subtask.completed;
                          const patch: TodoTaskPatch = { completed: completing };
                          // The tick lands, then the row goes to the pile.
                          subtaskHoldRef.current = true;
                          if (completing) popCheck(e.currentTarget);
                          if (completing) {
                            spawnCompletionParty(e.currentTarget, {
                              emoji: randomSubtaskPartyEmoji(),
                            });
                          }
                          if (completing) {
                            // The freshest tick reads first in the pile.
                            const done = mySubtasks.filter(
                              (st) => st.completed && st.id !== subtask.id
                            );
                            if (done.length) {
                              const top = Math.min(...done.map((st) => st.position));
                              if (subtask.position >= top) patch.position = top - 1;
                            }
                          }
                          void mutateTask(subtask.id, patch);
                        }}
                      >
                        {subtask.completed ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : null}
                      </button>
                      {/* A textarea, not an input: a long step wraps
                          instead of clipping. Auto-grown to its text; a
                          step stays one logical line (Enter commits, and
                          pasted newlines collapse to spaces). */}
                      <textarea
                        rows={1}
                        className="task-subtask-text"
                        defaultValue={subtask.text}
                        ref={resizeEditTextarea}
                        onInput={(e) => resizeEditTextarea(e.currentTarget)}
                        onBlur={(e) => {
                          const text = e.target.value
                            .replace(/\s*\n\s*/g, " ")
                            .trim();
                          if (!text || text === subtask.text) {
                            e.target.value = subtask.text;
                            resizeEditTextarea(e.target);
                            return;
                          }
                          void mutateTask(subtask.id, { text });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.currentTarget.blur();
                          }
                        }}
                      />
                      {/* What a subtask carries, and what can be done to
                          it — the card's own controls, on a smaller row.
                          Only making subtasks of subtasks is missing, on
                          purpose. */}
                      <span className="task-subtask-actions">
                        {subtaskDurEditId === subtask.id ? (
                          <input
                            autoFocus
                            type="text"
                            inputMode="numeric"
                            className="task-subtask-dur-input"
                            defaultValue={
                              subtask.expectedDurationMinutes == null
                                ? ""
                                : String(subtask.expectedDurationMinutes)
                            }
                            placeholder="min"
                            onBlur={(e) => {
                              setSubtaskDurEditId(null);
                              const raw = e.target.value.replace(/[^0-9]/g, "");
                              const next = raw ? Math.round(Number(raw)) : null;
                              if (next === (subtask.expectedDurationMinutes ?? null))
                                return;
                              void mutateTask(subtask.id, {
                                expectedDurationMinutes: next,
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setSubtaskDurEditId(null);
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className={`task-subtask-action${
                              subtask.expectedDurationMinutes != null
                                ? " has-value"
                                : ""
                            }`}
                            title={t("estimateTime")}
                            onClick={() => setSubtaskDurEditId(subtask.id)}
                          >
                            <ClockIcon />
                            {subtask.expectedDurationMinutes != null ? (
                              <span>{subtask.expectedDurationMinutes}m</span>
                            ) : null}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`task-subtask-action${
                            subtask.notesHtml ? " has-value" : ""
                          }`}
                          title={t("notes")}
                          onClick={() => {
                            if (subtaskNotesId === subtask.id) {
                              saveSubtaskNotes(subtask);
                            } else {
                              setSubtaskNotesId(subtask.id);
                              setSubtaskNotesDraft(subtask.notesHtml ?? "");
                            }
                          }}
                        >
                          <NotesIcon />
                        </button>
                        {assignEnabled ? (
                          <span className="assign-menu-wrap">
                            <button
                              type="button"
                              className={`task-subtask-action${
                                subtask.assigneeIds.length ? " has-value" : ""
                              }`}
                              title={t("assignPerson")}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (openAssignTaskId === subtask.id) {
                                  closeAssignMenu();
                                } else {
                                  setAssignAnchorEl(e.currentTarget);
                                  setOpenAssignTaskId(subtask.id);
                                }
                              }}
                            >
                              {subtask.assigneeIds.length ? (
                                <TaskAssigneeStack
                                  people={subtask.assigneeIds
                                    .map((pid) => peopleById.get(pid))
                                    .filter((p): p is TodoPerson => Boolean(p))}
                                  size={18}
                                />
                              ) : (
                                <User size={14} strokeWidth={2} />
                              )}
                            </button>
                            <TaskAssignMenu
                              open={openAssignTaskId === subtask.id}
                              anchorEl={
                                openAssignTaskId === subtask.id ? assignAnchorEl : null
                              }
                              people={state.people}
                              assigneeIds={subtask.assigneeIds}
                              t={t}
                              onToggle={(personId) =>
                                toggleTaskAssignee(subtask.id, personId)
                              }
                              onEditPeople={() => {
                                closeAssignMenu();
                                setPeopleEditorOpen(true);
                              }}
                              onClose={closeAssignMenu}
                            />
                          </span>
                        ) : null}
                        {nativeShell && !subtask.completed ? (
                          <button
                            type="button"
                            className={`task-subtask-action${
                              activeFocusTaskIds.has(subtask.id)
                                ? " is-active"
                                : ""
                            }`}
                            title={
                              activeFocusTaskIds.has(subtask.id)
                                ? "Exit focus mode"
                                : "Focus on this task"
                            }
                            onClick={() => toggleTaskFocusPopout(subtask)}
                          >
                            <FocusIcon />
                          </button>
                        ) : nativeShell ? (
                          /* A done step has no focus button. Its place is
                             kept, so every row's controls stand in the
                             same columns. */
                          <span className="task-subtask-action task-subtask-slot" aria-hidden />
                        ) : null}
                        <button
                          type="button"
                          className="task-subtask-delete"
                          title={t("deleteSubtask")}
                          aria-label={t("deleteSubtask")}
                          onClick={() => void removeTask(subtask.id)}
                        >
                          ×
                        </button>
                      </span>
                    </div>
                    {subtaskNotesId === subtask.id ? (
                      <div className="task-subtask-notes">
                        <TrixNotesEditor
                          value={subtaskNotesDraft}
                          onChange={setSubtaskNotesDraft}
                          placeholder="Add notes..."
                          resolveImageSrc={resolveBasecampImage}
                          uploadImage={uploaderForTask(subtask)}
                          onDone={() => saveSubtaskNotes(subtask)}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="notes-done-btn"
                          title="Done editing"
                          onClick={() => saveSubtaskNotes(subtask)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      </div>
                    ) : null}
                    </React.Fragment>,
                    ...(subtask.id === lastOpenSubtaskId
                      ? [<React.Fragment key="add-subtask">{addSubtaskRow}</React.Fragment>]
                      : []),
                  ]),
                  ]}
                </div>
              </div>
            </div>
            )}
          </div>
          {/* More below the fold. Gone at the bottom, so the last row is
              never read through a veil. */}
          {overlayMoreBelow ? <div className="task-overlay-fade" aria-hidden /> : null}
          </div>
        </div>
      </div>
    );
  }

  function saveNotes(taskId: string) {
    /*
      Straight from the editor, not from the draft.

      The draft is state, filled by the editor's change events — and a
      picture's sgid arrives outside any event Trix raises, so a draft can
      be one step behind the document at exactly the moment that matters.
      The editor serializes on demand; asking it at save time cannot be
      stale.
    */
    const html = readOpenNote() ?? notesReadCurrent.current?.() ?? notesDraft;
    /*
      A picture Basecamp has not answered for yet has no sgid, and the
      Basecamp HTML this draft holds has already dropped it — so the note
      would save without it, and the picture would vanish from under the
      writer with nothing said.

      Counted by the editor rather than read out of the draft: by the time
      the HTML is in Basecamp's shape the evidence is gone, which is why
      asking the draft always answered none.
    */
    if (notesUploading.current > 0 || pendingAttachments(html) > 0) {
      toast.error("A picture is still uploading");
      return;
    }
    setOpenNotesTaskId(null);
    setNotesExpanded(false);
    const isEmpty = !html || html === "<p><br></p>";
    void mutateTask(taskId, {
      notesHtml: isEmpty ? null : html,
    });
  }

  /**
   * A task's subtasks are its child tasks, grouped from the one state the
   * board holds. The work first, the done pile under it, each in position
   * order — and a tick sends the row to the top of the pile (the check
   * button moves its position there).
   */
  const subtasksByTask = React.useMemo(() => {
    const map = new Map<string, TodoTask[]>();
    for (const task of state.tasks) {
      if (!task.parentTaskId) continue;
      const list = map.get(task.parentTaskId);
      if (list) list.push(task);
      else map.set(task.parentTaskId, [task]);
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        a.completed !== b.completed
          ? (a.completed ? 1 : -1)
          : a.position - b.position
      );
    }
    return map;
  }, [state.tasks]);

  /**
   * A subtask is a full task, so its edits are `mutateTask` and its delete
   * is `removeTask` — the same optimistic paths, undo included. Only the
   * create differs: the new row carries its parent.
   */
  async function addSubtask(
    parent: TodoTask,
    text: string,
    extras: {
      assigneeIds?: string[];
      notesHtml?: string | null;
      expectedDurationMinutes?: number | null;
    } = {}
  ) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = newClientId();
    const siblings = subtasksByTask.get(parent.id) ?? [];
    const position = siblings.length
      ? Math.max(...siblings.map((s) => s.position)) + 1
      : 1;
    const now = new Date().toISOString();
    const optimistic: TodoTask = {
      id,
      listId: parent.listId,
      createdBy: makerKeys[0] ?? null,
      text: trimmed,
      notesHtml: extras.notesHtml ?? null,
      dueOn: null,
      completed: false,
      completedAt: null,
      isFavourite: false,
      favouritePosition: null,
      isBacklog: false,
      isToday: false,
      isSomeday: false,
      showOnCalendar: false,
      assigneeIds: extras.assigneeIds ?? [],
      colour: null,
      expectedDurationMinutes: extras.expectedDurationMinutes ?? null,
      timeSpentSeconds: 0,
      position,
      basecampId: null,
      remindersId: null,
      parentTaskId: parent.id,
      createdAt: now,
    };
    setState((s) => ({ ...s, tasks: [...s.tasks, optimistic] }));
    try {
      const json = await api("/api/todo/tasks", "POST", {
        id,
        listId: parent.listId,
        parentTaskId: parent.id,
        text: trimmed,
        ...(extras.assigneeIds?.length ? { assigneeIds: extras.assigneeIds } : {}),
        ...(extras.notesHtml ? { notesHtml: extras.notesHtml } : {}),
        ...(extras.expectedDurationMinutes != null
          ? { expectedDurationMinutes: extras.expectedDurationMinutes }
          : {}),
      });
      const saved = json.task as TodoTask | undefined;
      if (saved?.id) {
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...saved } : t)),
        }));
      }
    } catch (err) {
      setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
      toast.error(describeError(err, "Could not add the subtask"));
    }
  }

  /**
   * The subtask whose note is open in the expanded card, and its draft.
   *
   * Its own pair, not the board's `openNotesTaskId`: the expanded card's
   * Notes field is already bound to that machinery for the parent, and one
   * slot cannot hold two drafts.
   */
  const [subtaskNotesId, setSubtaskNotesId] = React.useState<string | null>(null);
  const [subtaskNotesDraft, setSubtaskNotesDraft] = React.useState("");
  /** The subtask whose duration box is open. */
  const [subtaskDurEditId, setSubtaskDurEditId] = React.useState<string | null>(null);

  /** The subtask being written in the expanded card: its words, and what it will carry. */
  const [newSubtaskText, setNewSubtaskText] = React.useState("");
  const [newSubtaskAssigneeIds, setNewSubtaskAssigneeIds] = React.useState<string[]>([]);
  const [newSubtaskNotes, setNewSubtaskNotes] = React.useState("");
  const [newSubtaskNotesOpen, setNewSubtaskNotesOpen] = React.useState(false);
  const [newSubtaskDuration, setNewSubtaskDuration] = React.useState<number | null>(null);
  const [newSubtaskDurEditing, setNewSubtaskDurEditing] = React.useState(false);
  const newSubtaskInputRef = React.useRef<HTMLInputElement | null>(null);

  function resetNewSubtask() {
    setNewSubtaskText("");
    setNewSubtaskAssigneeIds([]);
    setNewSubtaskNotes("");
    setNewSubtaskNotesOpen(false);
    setNewSubtaskDuration(null);
    setNewSubtaskDurEditing(false);
  }

  // A draft belongs to the card it was typed in.
  React.useEffect(() => {
    resetNewSubtask();
  }, [openNotesTaskId]);

  function submitNewSubtask(parent: TodoTask) {
    if (!newSubtaskText.trim()) return;
    void addSubtask(parent, newSubtaskText, {
      assigneeIds: newSubtaskAssigneeIds,
      notesHtml: notesHtmlIsEmpty(newSubtaskNotes) ? null : newSubtaskNotes,
      expectedDurationMinutes: newSubtaskDuration,
    });
    resetNewSubtask();
    newSubtaskInputRef.current?.focus();
  }

  function saveSubtaskNotes(subtask: TodoTask) {
    const html = subtaskNotesDraft;
    const isEmpty = !html || html === "<p><br></p>";
    setSubtaskNotesId(null);
    setSubtaskNotesDraft("");
    const next = isEmpty ? null : html;
    if (next !== subtask.notesHtml) {
      void mutateTask(subtask.id, { notesHtml: next });
    }
  }

  /** The subtask being carried, and the order the pointer is drawing. */
  const [subtaskDragId, setSubtaskDragId] = React.useState<string | null>(null);
  const [subtaskPreview, setSubtaskPreview] = React.useState<string[] | null>(null);
  const subtaskListRef = React.useRef<HTMLDivElement | null>(null);

  /*
    A step ticked off sorts to the pile at the bottom. It slides there,
    after a beat in which the tick is seen to land, and the steps it
    passes make way: the rows' places are kept from one order to the next
    and the change is drawn as a move. Not while a row is being carried —
    the pointer is drawing that order, and it should follow the hand.
  */
  const subtaskTopsRef = React.useRef<Map<string, number>>(new Map());
  const subtaskHoldRef = React.useRef(false);
  const overlaySubtaskOrder = React.useMemo(() => {
    if (!openNotesTaskId || !notesExpanded) return "";
    const mine = subtasksByTask.get(openNotesTaskId) ?? [];
    return (subtaskPreview ?? mine.map((st) => st.id)).join("|");
  }, [openNotesTaskId, notesExpanded, subtasksByTask, subtaskPreview]);
  React.useLayoutEffect(() => {
    const list = subtaskListRef.current;
    // Only the steps: the add row carries no id and holds no place.
    const rows = ":scope > .task-subtask-row[data-subtask-id]";
    if (!list || subtaskDragId) {
      subtaskTopsRef.current = measureRowTops(list, rows, "data-subtask-id");
      subtaskHoldRef.current = false;
      return;
    }
    subtaskTopsRef.current = slideRowsIntoPlace(list, subtaskTopsRef.current, rows, "data-subtask-id", {
      holdMs: subtaskHoldRef.current ? ROW_SLIDE_HOLD_MS : 0,
    });
    subtaskHoldRef.current = false;
  }, [overlaySubtaskOrder, subtaskDragId]);

  /**
   * Put one subtask where it was dropped.
   *
   * One write nearly always: the moved row takes the midpoint between its
   * new neighbours. Only when the floats leave no room between them is the
   * whole list renumbered — and order is local either way, because Basecamp
   * has no route for a step's position.
   */
  function reorderSubtasks(taskId: string, order: string[], movedId: string) {
    const rows = subtasksByTask.get(taskId) ?? [];
    const writes = placeByPosition(rows, order, movedId);
    if (!writes) return;
    // Each write is an ordinary task mutation — optimistic, queued offline —
    // and the grouped sort draws the new order from the positions.
    for (const write of writes) {
      void mutateTask(write.id, { position: write.position });
    }
  }

  /** The grip's pointer-drag: the session queue's, on smaller rows. */
  function startSubtaskDrag(
    event: React.PointerEvent,
    taskId: string,
    subtaskId: string
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    let lastOrder: string[] | null = null;

    const onMove = (move: PointerEvent) => {
      if (!started) {
        if (
          Math.abs(move.clientX - startX) < 4 &&
          Math.abs(move.clientY - startY) < 4
        ) {
          return;
        }
        started = true;
        window.getSelection()?.removeAllRanges();
        setSubtaskDragId(subtaskId);
      }
      const rows = Array.from(
        subtaskListRef.current?.querySelectorAll<HTMLElement>(
          ":scope > .task-subtask-row[data-subtask-id]"
        ) ?? []
      ).filter((row) => row.dataset.subtaskId !== subtaskId);
      let index = rows.length;
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i].getBoundingClientRect();
        if (move.clientY < rect.top + rect.height / 2) {
          index = i;
          break;
        }
      }
      const order = rows
        .map((row) => row.dataset.subtaskId)
        .filter((id): id is string => Boolean(id));
      order.splice(index, 0, subtaskId);
      lastOrder = order;
      setSubtaskPreview((prevOrder) =>
        prevOrder &&
        prevOrder.length === order.length &&
        prevOrder.every((v, i) => v === order[i])
          ? prevOrder
          : order
      );
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setSubtaskDragId(null);
      setSubtaskPreview(null);
      if (started && lastOrder) reorderSubtasks(taskId, lastOrder, subtaskId);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  /**
   * The whole task, expanded: title, list, people, duration, notes and
   * subtasks in one card over the window. The expand button on a card and
   * the subtask chip both come here.
   */
  function openTaskOverlay(task: TodoTask) {
    if (openNotesTaskId === task.id) {
      /*
        The small note box may be open with unsaved words in it. The big
        card runs a second editor over the same draft, so what is live in
        the small one is carried into the draft first — the same carry the
        old expand button made — or the last keystrokes would be lost.
      */
      if (notesUploading.current > 0) {
        toast.error("A picture is still uploading");
        return;
      }
      const live = readOpenNote() ?? notesReadCurrent.current?.();
      if (live != null) setNotesDraft(live);
    } else {
      setOpenNotesTaskId(task.id);
      setNotesDraft(task.notesHtml ?? "");
    }
    setNotesExpanded(true);
  }

  const peopleById = React.useMemo(() => {
    const map = new Map<string, TodoPerson>();
    for (const person of state.people) map.set(person.id, person);
    return map;
  }, [state.people]);

  const searchPeopleCandidates = React.useCallback(
    async (query: string): Promise<TodoPersonCandidate[]> => {
      try {
        const json = await api(
          `/api/todo/people/search?q=${encodeURIComponent(query)}`,
          "GET"
        );
        return (json.results as TodoPersonCandidate[]) ?? [];
      } catch {
        return [];
      }
    },
    []
  );

  async function addBoardPerson(
    candidate: TodoPersonCandidate | { name: string }
  ): Promise<TodoPerson | null> {
    try {
      const body =
        "key" in candidate
          ? {
              name: candidate.name,
              photoUrl: candidate.photoUrl,
              sourceKind: candidate.sourceKind,
              sourceId: candidate.sourceId,
              email: candidate.email,
            }
          : { name: candidate.name, sourceKind: "manual" as const };
      const json = await api("/api/todo/people", "POST", body);
      const person = json.person as TodoPerson;
      // The add may have matched an existing row and filled in its blanks, so
      // take the returned row over the copy already on the board.
      setState((s) => ({
        ...s,
        people: s.people.some((p) => p.id === person.id)
          ? s.people.map((p) => (p.id === person.id ? person : p))
          : [...s.people, person],
      }));
      return person;
    } catch (err) {
      toast.error(describeError(err, "Could not add person"));
      return null;
    }
  }


  /**
   * A picture for a person's avatar, or none. The picture is made small and
   * kept where note pictures are kept (see uploadLocalNoteImage), and the
   * person keeps its address. Without one, the avatar shows initials.
   */
  async function setPersonPhoto(personId: string, file: File | null) {
    let photoUrl: string | null = null;
    if (file) {
      try {
        const avatar = await squareAvatarFile(file);
        const stored = await uploadLocalNoteImage(avatar, () => {});
        photoUrl = stored.mediaId ? noteMediaSrc(stored.mediaId) : stored.url ?? null;
        if (!photoUrl) throw new Error("no address");
      } catch (err) {
        toast.error(describeError(err, t("photoFailed")));
        return;
      }
    }
    setState((s) => ({
      ...s,
      people: s.people.map((person) =>
        person.id === personId ? { ...person, photoUrl } : person
      ),
    }));
    try {
      await api("/api/todo/people", "PATCH", { id: personId, photoUrl });
    } catch (err) {
      toast.error(describeError(err, t("photoFailed")));
      void refresh();
    }
  }

  async function removeBoardPerson(id: string) {
    const snapshot = state.people;
    setState((s) => ({
      ...s,
      people: s.people.filter((p) => p.id !== id),
      tasks: s.tasks.map((t) =>
        t.assigneeIds.includes(id)
          ? { ...t, assigneeIds: t.assigneeIds.filter((pid) => pid !== id) }
          : t
      ),
    }));
    try {
      await api(`/api/todo/people?id=${encodeURIComponent(id)}`, "DELETE");
    } catch (err) {
      toast.error(describeError(err, "Could not remove person"));
      setState((s) => ({ ...s, people: snapshot }));
      void refresh();
    }
  }

  function toggleTaskAssignee(taskId: string, personId: string) {
    const task = liveRef.current.state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const removing = task.assigneeIds.includes(personId);
    const next = removing
      ? task.assigneeIds.filter((id) => id !== personId)
      : [...task.assigneeIds, personId];

    /*
      The people on a subtask are always on its task too, so the two
      directions need care here:

      Putting somebody on a subtask quietly puts them on the parent — the
      store does the write; the card is updated at once so the avatar does
      not lag the menu.

      Taking somebody off a task they still hold subtasks of is asked
      about first: the store will strip their subtask assignments with the
      same write, and that should never be a surprise.
    */
    if (removing && !task.parentTaskId) {
      const held = (subtasksByTask.get(taskId) ?? []).filter((child) =>
        child.assigneeIds.includes(personId)
      );
      if (held.length) {
        const name = peopleById.get(personId)?.name ?? "";
        closeAssignMenu();
        setConfirmModal({
          title: t("unassignCascadeTitle"),
          message: t("unassignCascadeMessage")
            .replace("{name}", name)
            .replace("{count}", String(held.length)),
          confirmLabel: t("unassignCascadeConfirm"),
          danger: true,
          onConfirm: () => {
            // The children on screen follow at once; the store makes the
            // same cut authoritatively.
            setState((s) => ({
              ...s,
              tasks: s.tasks.map((row) =>
                row.parentTaskId === taskId && row.assigneeIds.includes(personId)
                  ? {
                      ...row,
                      assigneeIds: row.assigneeIds.filter((id) => id !== personId),
                    }
                  : row
              ),
            }));
            void mutateTask(taskId, { assigneeIds: next });
          },
        });
        return;
      }
    }
    if (!removing && task.parentTaskId) {
      const parent = liveRef.current.state.tasks.find(
        (row) => row.id === task.parentTaskId
      );
      if (parent && !parent.assigneeIds.includes(personId)) {
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((row) =>
            row.id === parent.id
              ? { ...row, assigneeIds: [...row.assigneeIds, personId] }
              : row
          ),
        }));
      }
    }
    // Keep the menu open so multiple people can be checked.
    void mutateTask(taskId, { assigneeIds: next });
  }

  function closeAssignMenu() {
    // The menu holds the caret while it is up. Hand it back to the button,
    // or it falls to the page and the next Tab starts from the top.
    assignAnchorEl?.focus();
    setOpenAssignTaskId(null);
    setAssignAnchorEl(null);
  }

  /** A picture from this app's store, for the backup file. */
  async function readMediaForBackup(id: string): Promise<BackupMedia | null> {
    try {
      if (isStandaloneTodo()) {
        installTauriMediaStore();
        const found = await todoMediaStore().read(id);
        if (!found) return null;
        return {
          id,
          contentType: found.contentType,
          filename: found.filename,
          data: bytesToBase64(found.bytes),
        };
      }
      const res = await fetch(noteMediaSrc(id));
      if (!res.ok) return null;
      return {
        id,
        contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
        filename: "",
        data: bytesToBase64(new Uint8Array(await res.arrayBuffer())),
      };
    } catch {
      return null;
    }
  }

  async function exportData() {
    const now = new Date();
    // The pictures go in the file too, so the board keeps them on another
    // computer. See backup-media.ts.
    const ids = boardMediaIds(state);
    const media = (await Promise.all(ids.map(readMediaForBackup))).filter(
      (m): m is BackupMedia => m !== null
    );
    if (media.length < ids.length) {
      toast.warning(t("exportMissingPictures"));
    }
    const backup = buildTodoBackup(state, now, media);
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = todoBackupFileName(now);
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * The file's pictures into this app's store, before the board goes in.
   * Answers the file with the notes and the avatars naming the new ids.
   */
  async function storeBackupMedia(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const media = backupMediaOf(payload);
    const newIds = new Map<string, string>();
    for (const item of media) {
      try {
        const file = new File([base64ToBytes(item.data)], item.filename || "image", {
          type: item.contentType,
        });
        const stored = await uploadLocalNoteImage(file, () => {});
        if (stored.mediaId) newIds.set(item.id, stored.mediaId);
      } catch {
        // Left with its old id: it draws as missing, and the rest go in.
      }
    }
    return withNewMediaIds(payload, newIds, noteMediaSrc);
  }

  function importData(file: File) {
    void file.text().then((text) => {
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        toast.error("Not a valid JSON backup file");
        return;
      }
      setSettingsOpen(false);
      setConfirmModal({
        title: t("importConfirmTitle"),
        message: t("importConfirmMessage"),
        confirmLabel: t("importLabel"),
        onConfirm: () => {
          void storeBackupMedia(payload as Record<string, unknown>)
            .then((withMedia) => api("/api/todo/import", "POST", withMedia))
            .then((json) => {
              const c = json.imported as { lists: number; tasks: number };
              toast.success(`${t("importDone")}: ${c.lists} lists, ${c.tasks} tasks`);
              void refresh();
            })
            .catch((err) =>
              toast.error(describeError(err, "Import failed"))
            );
        },
      });
    });
  }

  function listOriginLetters(list: TodoList | undefined): string {
    if (!list) return "?";
    const letters = list.name.replace(/[^\p{L}\p{N}]+/gu, "");
    return (letters.slice(0, 2) || list.name.slice(0, 2) || "?").toUpperCase();
  }

  function renderTask(task: TodoTask) {
    const editing = editingTaskId === task.id;
    const menuOpen = openMenuTaskId === task.id;
    const assignOpen = openAssignTaskId === task.id;
    const assignees = task.assigneeIds
      .map((id) => peopleById.get(id))
      .filter((p): p is TodoPerson => Boolean(p));
    const unlisted = isUnlistedTask(task);
    const taskList = listOfTask(task);
    const showListOrigin = isAllListsView;
    const listOriginIconId = resolveListIconId(taskList?.emoji);
    const listPickerOpen = openListPickerTaskId === task.id;
    const editingDur = editingDurationTaskId === task.id;
    const hasDuration = task.completed
      ? task.timeSpentSeconds > 0
      : task.expectedDurationMinutes != null;

    const durationEditor = (
      <input
        autoFocus
        type="number"
        min={0}
        max={999}
        className="task-duration-input"
        style={{ width: 52 }}
        value={editingDuration}
        onChange={(e) => setEditingDuration(e.target.value)}
        onBlur={() => commitEditDuration(task)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitEditDuration(task);
          if (e.key === "Escape") setEditingDurationTaskId(null);
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );

    const startDurationEdit = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (view === "favourites") {
        if (task.listId) navigateToList(task.listId);
        return;
      }
      setEditingDurationTaskId(task.id);
      setEditingDuration(
        task.completed
          ? task.timeSpentSeconds
            ? String(Math.round(task.timeSpentSeconds / 60))
            : ""
          : task.expectedDurationMinutes
            ? String(task.expectedDurationMinutes)
            : ""
      );
    };

    const metaAlways = hasDuration ? (
      editingDur ? (
        durationEditor
      ) : (
        <span
          className={`task-meta ${task.completed ? "actual-time" : ""}`}
          title={task.completed ? undefined : "Click to edit duration"}
          onClick={startDurationEdit}
        >
          {task.completed
            ? timeSpentLabel(task.timeSpentSeconds)
            : `${task.expectedDurationMinutes}${t("minutes")}`}
        </span>
      )
    ) : null;

    const metaHover = !hasDuration ? (
      editingDur ? (
        durationEditor
      ) : (
        <span
          className="task-meta add-time"
          title="Add duration"
          onClick={startDurationEdit}
        >
          <ClockIcon />
        </span>
      )
    ) : null;

    /*
      Favourite and focus, drawn the way notesBtn already is.

      A button that carries state goes in `.always-actions` and one that
      does not goes in `.hover-actions`, so the row is the same width
      whether the pointer is on it or not. The two used to sit together in
      `.always-actions` under a `hover-only` class that only hid them —
      which still took the width the moment the pointer arrived, and
      re-wrapped the task under it.
    */
    const isFocused = activeFocusTaskIds.has(task.id);
    /*
      The same split as favourite and focus: with somebody on it this is
      state and stays on the row, with nobody on it it is a control and
      rides in the pill. It was `hover-only` inside `.always-actions`,
      which widened the row on hover and moved the words with it.
    */
    const assignChip = assignEnabled && !task.completed ? (
      <div
        className={`assign-menu-wrap task-chip-wrap ${
          assignOpen ? "has-open-menu" : ""
        }`}
      >
        <button
          type="button"
          className={`task-chip task-chip-assign${
            assignees.length > 0 ? " is-set" : " is-icon is-ghost"
          }`}
          title={
            assignees.length > 0
              ? assignees.map((p) => shortPersonName(p.name)).join(", ")
              : t("assignPerson")
          }
          onClick={(e) => {
            e.stopPropagation();
            setOpenMenuTaskId(null);
            if (assignOpen) {
              closeAssignMenu();
            } else {
              setAssignAnchorEl(e.currentTarget);
              setOpenAssignTaskId(task.id);
            }
          }}
        >
          {assignees.length > 0 ? (
            <TaskAssigneeStack people={assignees} size={20} />
          ) : (
            // The icon alone: the word is for the add row, where nothing is
            // known yet. On a card the ghost is one of a row of icons.
            <User size={13} strokeWidth={2} aria-hidden />
          )}
        </button>
        <TaskAssignMenu
          open={assignOpen}
          anchorEl={assignOpen ? assignAnchorEl : null}
          people={state.people}
          assigneeIds={task.assigneeIds}
          t={t}
          onToggle={(personId) => toggleTaskAssignee(task.id, personId)}
          onEditPeople={() => {
            closeAssignMenu();
            setPeopleEditorOpen(true);
          }}
          onClose={closeAssignMenu}
        />
      </div>
    ) : null;
    /*
      The due date, the duration and the note as chips of the meta row —
      the same three the add row draws. Set, a chip is filled; unset, it is
      a ghost that arrives with the pointer, in the same place, so a card
      and the add row read as one vocabulary.
    */
    const dueDays = task.dueOn ? daysUntilDue(task.dueOn) : null;
    const duePopoverOpen = duePopoverTaskId === task.id;
    const closeDuePopover = () => {
      // The caret goes back to the chip, so Tab carries on along the row.
      duePopoverAnchor?.focus();
      setDuePopoverTaskId(null);
      setDuePopoverAnchor(null);
    };
    const dueChip = !task.completed ? (
      <span className="task-chip-wrap">
        <button
          type="button"
          /* `is-icon` with no date: a chip with a label has more room on the
             right, for the words. With the icon alone that room stayed, and
             the icon sat left of the middle. */
          className={`task-chip task-chip-due${task.dueOn ? " is-set" : " is-icon is-ghost"}${
            dueDays != null && dueDays < 0
              ? " is-overdue"
              : dueDays === 0
                ? " is-due-today"
                : ""
          }${duePopoverOpen ? " is-on" : ""}`}
          title={
            task.dueOn
              ? `${t("fieldDue")}: ${formatDueOn(task.dueOn, lang, t)}`
              : t("composerDue")
          }
          aria-haspopup="dialog"
          aria-expanded={duePopoverOpen}
          onClick={(e) => {
            e.stopPropagation();
            if (duePopoverOpen) {
              closeDuePopover();
              return;
            }
            if (view === "favourites") {
              if (task.listId) navigateToList(task.listId);
              return;
            }
            setOpenMenuTaskId(null);
            setOpenAssignTaskId(null);
            setDuePopoverAnchor(e.currentTarget);
            setDuePopoverTaskId(task.id);
            setDueCalendarWanted(task.showOnCalendar);
          }}
        >
          <Calendar size={13} strokeWidth={2} aria-hidden />
          {task.dueOn ? (
            <span className="task-chip-label">
              {formatDueOnShort(task.dueOn, lang, t)}
            </span>
          ) : null}
        </button>
        {duePopoverOpen ? (
        <DuePopover
          open={duePopoverOpen}
          anchorEl={duePopoverOpen ? duePopoverAnchor : null}
          value={task.dueOn}
          onPick={(dueOn) => {
            closeDuePopover();
            // Only a dated task can be on the Calendar: a day taken away
            // takes the task off it, and a first day puts it on when the
            // box was ticked before the day was picked.
            void mutateTask(task.id, {
              ...dueDatePatch(dueOn),
              showOnCalendar: dueOn ? dueCalendarWanted : false,
            });
          }}
          onClose={closeDuePopover}
          calendar={
            planEnabled
              ? {
                  checked: dueCalendarWanted,
                  onChange: (checked) => {
                    setDueCalendarWanted(checked);
                    if (task.dueOn) {
                      void mutateTask(task.id, { showOnCalendar: checked });
                    }
                  },
                }
              : undefined
          }
          lang={lang}
          t={t}
        />
        ) : null}
      </span>
    ) : null;
    /* The clock opens the same popover the add row uses, on the chip. */
    const durationPopoverOpen = durationPopoverTaskId === task.id;
    const openDurationPopover = (anchor: HTMLElement) => {
      if (view === "favourites") {
        if (task.listId) navigateToList(task.listId);
        return;
      }
      setOpenMenuTaskId(null);
      setOpenAssignTaskId(null);
      setDurationPopoverAnchor(anchor);
      setDurationPopoverTaskId(task.id);
    };
    const closeDurationPopover = () => {
      durationPopoverAnchor?.focus();
      setDurationPopoverTaskId(null);
      setDurationPopoverAnchor(null);
    };
    const durationChip = (
      <span className="task-chip-wrap">
        <button
          type="button"
          className={`task-chip task-chip-duration${
            hasDuration ? " is-set" : " is-icon is-ghost"
          }${durationPopoverOpen ? " is-on" : ""}`}
          title={hasDuration ? "Click to edit duration" : t("addDuration")}
          aria-haspopup="dialog"
          aria-expanded={durationPopoverOpen}
          onClick={(e) => {
            e.stopPropagation();
            if (durationPopoverOpen) closeDurationPopover();
            else openDurationPopover(e.currentTarget);
          }}
        >
          <ClockIcon size={13} />
          {hasDuration && task.expectedDurationMinutes != null ? (
            <span className="task-chip-label">
              {formatDurationShort(
                task.expectedDurationMinutes,
                t("minutes"),
                t("hoursShort")
              )}
            </span>
          ) : null}
        </button>
        {durationPopoverOpen ? (
        <DurationPopover
          open={durationPopoverOpen}
          anchorEl={durationPopoverOpen ? durationPopoverAnchor : null}
          minutes={task.expectedDurationMinutes}
          onPick={(minutes) => {
            closeDurationPopover();
            void mutateTask(task.id, { expectedDurationMinutes: minutes });
          }}
          onClose={closeDurationPopover}
          t={t}
        />
        ) : null}
      </span>
    );
    const notesChip = (
      <button
        type="button"
        className={`task-chip is-icon task-chip-notes${
          task.notesHtml ? " is-set" : " is-ghost"
        }${openNotesTaskId === task.id ? " is-on" : ""}`}
        title={t("fieldNotes")}
        aria-label={t("fieldNotes")}
        onClick={(e) => {
          e.stopPropagation();
          toggleNotes(task);
        }}
      >
        <NotesIcon />
      </button>
    );
    const favBtn = !kanbanEnabled ? (
      <button
        className={`fav-btn${task.isFavourite ? " active" : " is-ghost"}`}
        title="Toggle Favourite"
        onClick={(e) => {
          e.stopPropagation();
          toggleFavourite(task);
        }}
      >
        <HeartIcon size={18} filled={task.isFavourite} />
      </button>
    ) : null;
    const focusBtn =
      nativeShell && !task.completed ? (
        <button
          className={`focus-btn ${isFocused ? "active-focus" : "is-ghost"}`}
          title={isFocused ? "Exit focus mode" : "Focus on this task"}
          onClick={(e) => {
            e.stopPropagation();
            toggleTaskFocusPopout(task);
          }}
        >
          <FocusIcon />
        </button>
      ) : null;
    const notesBtn = (
      <button
        className={`notes-btn ${task.notesHtml ? "has-notes" : ""}`}
        title="Add/Edit Notes"
        onClick={(e) => {
          e.stopPropagation();
          toggleNotes(task);
        }}
      >
        <NotesIcon />
      </button>
    );

    const hideForAnim = animHiddenTargets.has(
      animTargetKey(task.id, task.completed)
    );

    /* The checkbox, and the list-origin picker, each once: the done row
       keeps them stacked in a leading column, an open row shows the origin
       in the meta row below the words. */
    const checkboxEl = (
      <input
        type="checkbox"
        className="task-checkbox"
        checked={task.completed}
        onChange={(e) => toggleTaskCompleted(task, e)}
        /*
          Space is the box's own key, and a browser gives Enter to the
          form around it — there is none here, so on a card Enter did
          nothing at all. It ticks the task off, as everywhere else.
        */
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.currentTarget.click();
        }}
      />
    );
    const originPicker = showListOrigin ? (
      <div
        className={`task-list-origin-wrap${
          listPickerOpen ? " is-open" : ""
        }`}
      >
        <button
          type="button"
          className={`task-list-origin${
            listOriginIconId || unlisted ? " has-icon" : ""
          }${unlisted ? " is-unassigned" : ""}`}
          title={
            unlisted
              ? "Assign to a list"
              : taskList
                ? `List: ${taskList.name}. Change list`
                : "Assign to a list"
          }
          aria-label={
            unlisted
              ? "Assign to a list"
              : taskList
                ? `Change list from ${taskList.name}`
                : "Assign to a list"
          }
          aria-haspopup="menu"
          aria-expanded={listPickerOpen}
          disabled={lists.length === 0}
          onClick={(e) => {
            e.stopPropagation();
            setOpenMenuTaskId(null);
            setMenuShowsMoveTargets(false);
            setOpenAssignTaskId(null);
            setListPickerAnchorEl(listPickerOpen ? null : e.currentTarget);
            setOpenListPickerTaskId(
              listPickerOpen ? null : task.id
            );
          }}
        >
          {listOriginIconId ? (
            <ListIcon id={listOriginIconId} size={14} />
          ) : unlisted ? (
            <List size={14} strokeWidth={1.75} aria-hidden />
          ) : (
            listOriginLetters(taskList)
          )}
        </button>
        <MenuPortal
          open={listPickerOpen}
          anchorEl={listPickerOpen ? listPickerAnchorEl : null}
          className="task-list-picker"
          role="menu"
          ariaLabel="Move to list"
        >
          <MenuKeys
            onClose={() => {
              const anchor = listPickerAnchorEl;
              setOpenListPickerTaskId(null);
              setListPickerAnchorEl(null);
              anchor?.focus();
            }}
          >
          {lists.map((l) => {
            const iconId = resolveListIconId(l.emoji);
            const selected = !unlisted && l.id === task.listId;
            return (
              <button
                key={l.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`task-list-picker-item${
                  selected ? " is-current" : ""
                }`}
                onClick={() => {
                  setOpenListPickerTaskId(null);
                  if (selected) return;
                  void mutateTask(task.id, { listId: l.id });
                }}
              >
                <span
                  className={`task-list-picker-icon${
                    iconId ? " has-icon" : ""
                  }`}
                >
                  {iconId ? (
                    <ListIcon id={iconId} size={14} />
                  ) : (
                    listOriginLetters(l)
                  )}
                </span>
                <span className="task-list-picker-name">{l.name}</span>
              </button>
            );
          })}
          </MenuKeys>
        </MenuPortal>
      </div>
    ) : null;
    const mySubtasks = subtasksByTask.get(task.id) ?? [];
    const subtasksDone = mySubtasks.filter((st) => st.completed).length;
    const expandBtn = (
      <button
        type="button"
        className="task-expand-btn is-inline is-ghost"
        title={t("expandTask")}
        aria-label={t("expandTask")}
        onClick={(e) => {
          e.stopPropagation();
          openTaskOverlay(task);
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    );
    /* The "…" menu: in the meta row of an open card, in the hover pill of
       a done row. */
    const menuWrap = (
          <div
            className={`task-menu-wrap ${menuOpen ? "has-open-menu" : ""}`}
          >
            <button
              className="task-menu-btn is-ghost"
              title="Task options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setOpenAssignTaskId(null);
                setOpenListPickerTaskId(null);
                setMenuShowsMoveTargets(false);
                setMenuAnchorEl(menuOpen ? null : e.currentTarget);
                setOpenMenuTaskId(menuOpen ? null : task.id);
              }}
            >
              <MenuDotsIcon />
            </button>
            <MenuPortal
              open={menuOpen}
              anchorEl={menuOpen ? menuAnchorEl : null}
              className="task-menu"
              role="menu"
              ariaLabel="Task options"
            >
              {/* The caret goes to the first offer, the arrows and Tab
                  walk them, and Escape gives it back to the button. The
                  menu is put away by the next click anywhere, so it does
                  not close on its own caret when Move to redraws it —
                  which is also why that redraw is a fresh key. */}
              <MenuKeys
                key={menuShowsMoveTargets ? "move" : "offers"}
                closeOnBlur={false}
                onClose={() => {
                  const anchor = menuAnchorEl;
                  setOpenMenuTaskId(null);
                  setMenuShowsMoveTargets(false);
                  setMenuAnchorEl(null);
                  anchor?.focus();
                }}
              >
              {menuShowsMoveTargets ? (
                lists
                  .filter((l) => l.id !== task.listId)
                  .map((l) => {
                    // Each list under its own icon, as the tabs draw them.
                    const iconId = resolveListIconId(l.emoji);
                    return (
                      <button
                        key={l.id}
                        role="menuitem"
                        className="task-menu-item"
                        onClick={() => {
                          setOpenMenuTaskId(null);
                          setMenuShowsMoveTargets(false);
                          void mutateTask(task.id, { listId: l.id });
                        }}
                      >
                        <span
                          className={`task-list-picker-icon${
                            iconId ? " has-icon" : ""
                          }`}
                        >
                          {iconId ? (
                            <ListIcon id={iconId} size={14} />
                          ) : (
                            listOriginLetters(l)
                          )}
                        </span>
                        {l.name}
                      </button>
                    );
                  })
              ) : (
                <>
                  {/* Done tasks sit in the order they were finished, and
                      an end the task already holds is left out. */}
                  {!task.completed && !runEdges.first.has(task.id) ? (
                    <button
                      role="menuitem"
                      className="task-menu-item"
                      onClick={() => {
                        setOpenMenuTaskId(null);
                        moveTaskToEdge(task, "top");
                      }}
                    >
                      <MoveToTopIcon />
                      {t("moveToTop")}
                    </button>
                  ) : null}
                  {!task.completed && !runEdges.last.has(task.id) ? (
                    <button
                      role="menuitem"
                      className="task-menu-item"
                      onClick={() => {
                        setOpenMenuTaskId(null);
                        moveTaskToEdge(task, "bottom");
                      }}
                    >
                      <MoveToBottomIcon />
                      {t("moveToBottom")}
                    </button>
                  ) : null}
                  {lists.length > 1 ||
                  (unlisted && lists.length > 0) ? (
                    <button
                      role="menuitem"
                      className="task-menu-item move-task-item"
                      onClick={() => setMenuShowsMoveTargets(true)}
                    >
                      <MoveIcon />
                      {t("moveTo")}
                    </button>
                  ) : null}
                  {/* The pill's offers, when the tile is too slim to hold
                      them there — see PILL_FOLD_MAX. */}
                  {foldPillActions && !hasDuration && !task.completed ? (
                    <button
                      role="menuitem"
                      className="task-menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        // The chip is folded away, so the popover hangs
                        // off the menu button, which stays.
                        openDurationPopover(
                          (menuAnchorEl as HTMLElement | null) ?? e.currentTarget
                        );
                      }}
                    >
                      <ClockIcon />
                      {t("addDuration")}
                    </button>
                  ) : null}
                  {foldPillActions && !task.notesHtml ? (
                    <button
                      role="menuitem"
                      className="task-menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuTaskId(null);
                        toggleNotes(task);
                      }}
                    >
                      <NotesIcon />
                      {t("fieldNotes")}
                    </button>
                  ) : null}
                  <button
                    role="menuitem"
                    className="task-menu-item delete-task-item"
                    onClick={() => {
                      setOpenMenuTaskId(null);
                      void removeTask(task.id);
                    }}
                  >
                    <TrashIcon />
                    {t("delete")}
                  </button>
                </>
              )}
              </MenuKeys>
            </MenuPortal>
          </div>
    );
    /*
      The open row's utilities, in a pill of their own in the card's
      top-right corner: the menu, expand, favourite and focus. They used to
      share the chip row with the properties, and on a narrow card the two
      fought for one line and the last of them fell off it. Out of the
      flow, over the words on hover, they cost the row nothing. A button
      carrying state — a favourite, a running focus — keeps the pill on
      screen at rest, so the state shows.
    */
    /*
      On the Favourites view every task is a favourite, so a heart on each
      card says nothing: it is what the view is. There the pill waits for the
      pointer, as on a task with no state. A running focus still keeps it on
      screen, because that is news on any view.
    */
    const heartAtRest = task.isFavourite && view !== "favourites";
    const pillShowsState = isFocused || heartAtRest;
    const utilityPill = !task.completed ? (
      <div
        className={`task-utility-pill${pillShowsState ? " has-state" : ""}`}
      >
        {menuWrap}
        {expandBtn}
        {favBtn}
        {focusBtn}
      </div>
    ) : null;
    /* A done row keeps its hover pill: the time it took, its note, its
       menu. An open row lays its marks out as chips instead — below. */
    const actionsCluster = (
      <div className="task-actions">
        <div className="hover-actions">
          {menuWrap}
          {/* Folded into the menu on a slim tile — but a duration being
              typed stays where it is typed. */}
          {foldPillActions && !editingDur ? null : metaHover}
          {!task.notesHtml && !foldPillActions ? notesBtn : null}
          {!heartAtRest ? favBtn : null}
        </div>
        <div className="always-actions">
          {heartAtRest ? favBtn : null}
          {metaAlways}
          {task.notesHtml ? notesBtn : null}
        </div>
      </div>
    );
    const subtaskChip = mySubtasks.length ? (
      <button
        type="button"
        className={`task-subtask-chip${
          subtasksDone === mySubtasks.length ? " all-done" : ""
        }`}
        title={t("subtasks")}
        onClick={(e) => {
          e.stopPropagation();
          openTaskOverlay(task);
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {subtasksDone}/{mySubtasks.length}
      </button>
    ) : task.completed ? null : (
      // No steps yet: a ghost, in the add row's slot for them. It opens
      // the expanded card, where the first step is written.
      <button
        type="button"
        className="task-chip is-icon task-chip-subtasks is-ghost"
        title={t("subtasks")}
        aria-label={t("subtasks")}
        onClick={(e) => {
          e.stopPropagation();
          openTaskOverlay(task);
        }}
      >
        <ListChecks size={13} strokeWidth={2} aria-hidden />
      </button>
    );

    return (
      <div
        key={task.id}
        className={`task-item ${task.completed ? "completed-task" : ""} ${
          showBoard && !task.completed && task.isBacklog ? "backlog-task" : ""
        } ${draggingTaskId === task.id ? "dragging" : ""}${
          draggingTaskId === task.id && taskDropListId ? " drag-over-tab" : ""
        }${
          menuOpen || assignOpen || durationPopoverOpen || duePopoverOpen
            ? " has-open-menu"
            : ""
        }${showListOrigin ? " task-item-all" : ""}${
          listPickerOpen ? " has-open-list-picker" : ""
        }${hideForAnim ? " animation-target-hidden" : ""}${
          justAddedTaskId === task.id ? " just-added" : ""
        }`}
        data-task-id={task.id}
        /*
          The caret walks the card: Tab from one of its controls to the
          next, Left and Right the same way and round again. Without it
          the Mac app's web view sent Tab to the next text box on the
          page, past every chip on the card. See `focus-walk`.
        */
        onKeyDown={(e) => {
          if (walkArrowStops(e, e.currentTarget, { wrap: true })) return;
          walkTabStops(e, e.currentTarget);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (task.completed) return;
          // Filtering hides rows, so the order on screen is not the order of
          // the list — which is why a search used to stop a drag before it
          // began. The board knows better now: a drop there is placed in the
          // whole column, hidden rows and all (see placeInColumn). A plain
          // list still has no way to tell where a drop belongs among what it
          // is not showing, so there it stands.
          if (isSearching && !showBoard) return;
          if (isInteractiveDragTarget(e.target)) return;
          // The card over the Calendar has no list under it to be carried in.
          if ((e.target as HTMLElement).closest?.(".calendar-task-popover")) return;
          const drag = {
            taskId: task.id,
            startX: e.clientX,
            startY: e.clientY,
            started: false,
            pointerType: e.pointerType,
            holdTimer: null as number | null,
          };
          if (e.pointerType === "touch") {
            // On a phone a card is lifted by holding it, not by moving it:
            // moving is how the list scrolls. A short hold, a nudge from
            // the phone where it can give one, and the card is carried.
            drag.holdTimer = window.setTimeout(() => {
              const current = taskDragRef.current;
              if (current !== drag || current.started) return;
              current.holdTimer = null;
              current.started = true;
              window.getSelection()?.removeAllRanges();
              setDraggingTaskId(current.taskId);
              try {
                navigator.vibrate?.(12);
              } catch {
                /* a phone that will not */
              }
            }, TOUCH_DRAG_HOLD_MS);
          }
          taskDragRef.current = drag;
        }}
      >
        <div
          className={`task-main-row${
            task.completed && showListOrigin ? " task-main-row-all" : ""
          }`}
        >
          {task.completed && showListOrigin ? (
            <div className="task-leading">
              {checkboxEl}
              {originPicker}
            </div>
          ) : (
            checkboxEl
          )}
          {editing ? (
            <textarea
              ref={editInputRef}
              autoFocus
              className="task-edit-input"
              defaultValue={editingTextRef.current}
              rows={1}
              onChange={(e) => {
                editingTextRef.current = e.target.value;
                resizeEditTextarea(e.currentTarget);
              }}
              onBlur={commitEditTask}
              onKeyDown={(e) => {
                /*
                  Plain Enter saves; Shift+Enter inserts a newline. Either
                  way the caret goes back to the title it came from, so
                  the walk over the card carries on from there.
                */
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  caretAfterEditRef.current = { taskId: task.id, step: 0 };
                  commitEditTask();
                }
                if (e.key === "Escape") {
                  caretAfterEditRef.current = { taskId: task.id, step: 0 };
                  setEditingTaskId(null);
                }
                /*
                  Tab saves and walks on. The card's own walk is held back
                  here: it would move the caret onto a control that the
                  editor closing is about to redraw, and the caret was
                  lost in the swap.
                */
                if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  caretAfterEditRef.current = {
                    taskId: task.id,
                    step: e.shiftKey ? -1 : 1,
                  };
                  commitEditTask();
                }
              }}
            />
          ) : (
            <span
              className={`task-text ${task.completed ? "completed" : ""}`}
              /*
                The title is a stop of its own, so the keyboard alone can
                open a task for editing: Enter or Space does what a click
                does. A finished task's title is not edited, and stays
                out of the walk.
              */
              role={task.completed ? undefined : "button"}
              tabIndex={task.completed ? undefined : 0}
              onClick={() => (task.completed ? undefined : startEditTask(task))}
              onKeyDown={(e) => {
                if (task.completed) return;
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                startEditTask(task);
              }}
            >
              {task.text}
            </span>
          )}
          {/* When it was finished, as the mail list stamps a message:
              the hour today and yesterday, the day before that. */}
          {task.completed && task.completedAt ? (
            <span className="task-done-stamp">
              {doneStamp(task.completedAt, lang)}
            </span>
          ) : null}
          {task.completed ? actionsCluster : null}
        </div>
        {utilityPill}
        {!task.completed ? (
          <>
            <div className="task-meta-row">
              {/*
                The same row the add row draws, in the same order: the
                person on the left, the list on the right, and between
                them the marks a task carries. What it does not carry
                yet is a ghost until the pointer arrives.
              */}
              <div className="task-meta-chips">
                {/* The add row's order, always: the ghosts appear in their
                    own slots around what the task carries. */}
                {assignChip}
                {dueChip}
                {/* On a slim tile the two unset ones live in the menu. */}
                {foldPillActions && !hasDuration ? null : durationChip}
                {foldPillActions && !task.notesHtml ? null : notesChip}
                {subtaskChip}
                <span className="task-meta-spacer" />
                {/* The list holds the right end of the row, the way the
                    add row keeps its list on the right. The utilities are
                    in the corner pill above. */}
                <div className="task-chip-actions">
                  {originPicker}
                </div>
              </div>
            </div>
          </>
        ) : null}
        {renderNotesEditor(task)}
      </div>
    );
  }

  function renderGroupTab(group: TodoGroup) {
    const active = activeGroup?.id === group.id;
    let className = `group-tab ${active ? "active" : ""} ${
      !active ? "dimmed" : ""
    } ${draggingGroupId === group.id ? "dragging" : ""}`;
    const style: React.CSSProperties = {};
    if (group.colour) {
      if (group.colour.startsWith("#")) {
        style.backgroundColor = group.colour;
        style.borderColor = group.colour;
      } else {
        className += ` tab-bg-${group.colour}`;
      }
    }
    return (
      <div
        key={group.id}
        className={className}
        style={style}
        data-group-id={group.id}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (isInteractiveDragTarget(e.target)) return;
          groupDragRef.current = {
            groupId: group.id,
            startX: e.clientX,
            startY: e.clientY,
            started: false,
          };
        }}
        onClick={() => {
          if (Date.now() < suppressGroupClickUntil.current) return;
          if (active) {
            openRenameGroupModal(group);
          } else {
            switchToGroup(group.id);
          }
        }}
      >
        <span>{group.name}</span>
        {groupsSorted.length > 1 && active ? (
          <button
            className="group-delete-btn"
            title="Delete group"
            onClick={(e) => {
              e.stopPropagation();
              removeGroup(group);
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  function renderAllListTab() {
    const active = view === "lists" && isAllListsView;
    return (
      <div
        key={TODO_ALL_LIST_ID}
        className={`tab tab-all ${active ? "active" : ""}`}
        data-list-id={TODO_ALL_LIST_ID}
        onClick={() => {
          setView("lists");
          setCurrentListId(TODO_ALL_LIST_ID);
          persistPref(TODO_CURRENT_LIST_KEY, TODO_ALL_LIST_ID);
        }}
      >
        <span className="tab-label">
          <span className="tab-name">{t("boardAll")}</span>
        </span>
      </div>
    );
  }

  function renderSyncSourceIcons(opts: {
    basecamp: boolean;
    reminders: boolean;
  }) {
    return (
      <span className="sync-source-stack" aria-hidden="true">
        {opts.basecamp ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/todo/basecamp-logo.png"
            alt=""
            className="sync-source-icon basecamp-icon"
          />
        ) : null}
        {opts.reminders ? (
          <svg
            className="sync-source-icon reminders-icon"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
            <path d="M3 6h.01" />
            <path d="M3 12h.01" />
            <path d="M3 18h.01" />
          </svg>
        ) : null}
      </span>
    );
  }

  function renderSyncControls(opts: {
    basecamp: boolean;
    reminders: boolean;
    stopPropagation?: boolean;
  }) {
    const sources = [
      opts.basecamp ? "Basecamp" : null,
      opts.reminders ? "Apple Reminders" : null,
    ].filter(Boolean);
    const title =
      sources.length > 0
        ? `Sync with ${sources.join(" + ")}`
        : "Sync";
    return (
      <button
        type="button"
        className={`sync-controls${syncing ? " spinning" : ""}`}
        title={title}
        aria-label={title}
        disabled={syncing}
        style={syncing ? { opacity: 0.5 } : undefined}
        onClick={(e) => {
          if (opts.stopPropagation) e.stopPropagation();
          void doSync();
        }}
      >
        {renderSyncSourceIcons(opts)}
        <span className="sync-btn" aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
        </span>
      </button>
    );
  }

  function renderListTab(list: TodoList) {
    const active =
      view === "lists" && !isAllListsView && activeList?.id === list.id;
    let className = `tab ${active ? "active" : ""} ${
      draggingListId === list.id ? "dragging" : ""
    }${taskDropListId === list.id ? " task-drop-target" : ""}`;
    const style: React.CSSProperties & Record<string, string> = {};
    const activeColor = resolveTabColorHex(list.colour);
    const tabIconId = resolveListIconId(list.emoji);
    if (activeColor) {
      const inactiveColor = hexToRgba(activeColor, 0.45);
      if (inactiveColor) {
        className += " tab-colorized";
        style["--tab-color-active"] = activeColor;
        style["--tab-color-inactive"] = inactiveColor;
      }
    }
    return (
      <div
        key={list.id}
        className={className}
        style={style}
        data-list-id={list.id}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (isInteractiveDragTarget(e.target)) return;
          tabDragRef.current = {
            listId: list.id,
            startX: e.clientX,
            startY: e.clientY,
            started: false,
          };
        }}
        onClick={() => {
          if (Date.now() < suppressTabClickUntil.current) return;
          if (active) {
            openRenameListModal(list);
          } else {
            setView("lists");
            setCurrentListId(list.id);
            persistPref(TODO_CURRENT_LIST_KEY, list.id);
          }
        }}
      >
        <span className="tab-label">
          {tabIconId ? (
            <span className="tab-icon" aria-hidden="true">
              <ListIcon id={tabIconId} size={14} />
            </span>
          ) : null}
          <span className="tab-name">{list.name}</span>
        </span>
        {lists.length > 1 && active ? (
          <button
            className="tab-close"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              removeList(list);
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={`todo-shell ${
        draggingTaskId || draggingListId ? "is-reordering" : ""
      }${boardAccordion || boardPills ? " todo-tile-compact" : ""}${
        boardPills ? " todo-tile-pills" : ""
      } ${
        searchRevealed ? "list-search-open" : ""
      }${
        openMenuTaskId || openListPickerTaskId || openAssignTaskId
          ? " task-menu-open"
          : ""
      }${focusMode ? " focus-mode" : ""}${
        shellWidthClasses ? ` ${shellWidthClasses}` : ""
      }`}
      data-theme={effectiveDark ? "dark" : undefined}
      style={
        {
          ["--todo-zoom"]: String(zoom / 100),
          ...(zoom !== 100 ? { zoom: zoom / 100 } : {}),
        } as React.CSSProperties
      }
    >
      <div id="normal-mode">
        <div className="title-bar" data-tauri-drag-region="deep">
          <div className="title-bar-toolbar">
            <button
              type="button"
              className={`title-bar-focus-btn${focusMode ? " active" : ""}`}
              title={focusMode ? t("exitFocusMode") : t("focusMode")}
              aria-pressed={focusMode}
              onClick={() => {
                setFocusMode((v) => {
                  const next = !v;
                  persistPref(FOCUS_MODE_KEY, next ? "1" : "0");
                  return next;
                });
              }}
            >
              <FocusModeIcon on={focusMode} />
            </button>
            {/* The board has no favourites view, so it has no switch —
                unless the Planner View is on, which needs a way there and
                back. */}
            {!kanbanEnabled || planEnabled ? (
              <ViewSwitcher
                active={view}
                onSelect={setView}
                items={[
                  { id: "lists" as const, title: "Lists View", icon: <ListsIcon /> },
                  ...(!kanbanEnabled
                    ? [
                        {
                          id: "favourites" as const,
                          title: "Favourites View",
                          icon: <HeartIcon size={16} filled />,
                        },
                      ]
                    : []),
                  ...(planEnabled
                    ? [
                        {
                          id: "plan" as const,
                          title: t("enablePlanMode"),
                          icon: <PlanViewIcon />,
                        },
                      ]
                    : []),
                ]}
              />
            ) : null}
            <TodoOfflineStatusPill
              isOffline={isOffline}
              pendingOpsCount={pendingOpsCount}
              isSyncing={isSyncing}
              onRetry={() => void syncOfflineOps()}
              lastError={syncError}
            />
            <button
              className="title-bar-settings-btn"
              title={t("settingsTooltip")}
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsGearIcon />
            </button>
          </div>
        </div>

        <div
          className={`content-column${boardWidth ? " board-layout" : ""}`}
          style={view === "plan" ? { display: "none" } : undefined}
        >
          {view === "lists" && groupsEnabled && !focusMode ? (
            <div className="groups-container" style={{ display: "flex" }}>
              <div className="groups" ref={groupsRowRef} style={{ display: "flex" }}>
                {groupsForRender.map(renderGroupTab)}
                <button
                  className="add-group-btn"
                  title="Add new group"
                  onClick={openCreateGroupModal}
                >
                  +
                </button>
              </div>
            </div>
          ) : null}
          {view === "lists" && !focusMode ? (
            <div className="tabs-container">
              <div className="tabs" ref={tabsRowRef}>
                {lists.length > 1 ? renderAllListTab() : null}
                {lists.map(renderListTab)}
                <button
                  className="add-tab-btn-subtle"
                  title="Add new tab"
                  onClick={openCreateListModal}
                >
                  +
                </button>
              </div>
            </div>
          ) : null}

          <div
            id="list-search"
            ref={listSearchRef}
            className={`list-search${
              (view === "favourites" && searchGroups.length > 0) ||
              otherListSearchHits.length > 0
                ? " has-tabs"
                : ""
            }${
              assigneeFilterPeople.length > 0 ? " has-assignee-filter" : ""
            }`}
          >
            <div className="list-search-row">
              {hasMe ? (
                /* Mine or everyone: a two-way switch, and the person pills
                   only on "everyone". The everyday view stays quiet. */
                <div
                  className="board-people-scope"
                  role="group"
                  aria-label={t("filterByAssignee")}
                >
                  <button
                    type="button"
                    className={`board-people-scope-btn${scope === "mine" ? " active" : ""}`}
                    aria-pressed={scope === "mine"}
                    onClick={() => choosePeopleScope("mine")}
                  >
                    {t("myTasks")}
                    <span className="board-people-scope-count">{myOpenCount}</span>
                  </button>
                  <button
                    type="button"
                    className={`board-people-scope-btn${scope === "everyone" ? " active" : ""}`}
                    aria-pressed={scope === "everyone"}
                    onClick={() => choosePeopleScope("everyone")}
                  >
                    {t("filterEveryone")}
                    <span className="board-people-scope-count">{openTasks.length}</span>
                  </button>
                </div>
              ) : null}
              {assigneeFilterPeople.length > 0 && (!hasMe || scope === "everyone") ? (
                <div
                  className={`board-assignee-filter${hasMe ? " after-scope" : ""}`}
                  role="group"
                  aria-label={t("filterByAssignee")}
                  ref={filterRowRef}
                >
                  {hasMe ? null : (
                    <button
                      type="button"
                      className={`board-assignee-filter-btn${
                        assigneeFilterIds.length === 0 ? " active" : ""
                      }`}
                      onClick={() => setAssigneeFilterIds([])}
                    >
                      {t("filterEveryone")}
                    </button>
                  )}
                  {assigneeFilterPeople.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className={`board-assignee-filter-btn${
                        assigneeFilterIds.includes(person.id) ? " active" : ""
                      }${draggingPersonId === person.id ? " dragging" : ""}`}
                      title={person.name}
                      aria-pressed={assigneeFilterIds.includes(person.id)}
                      data-person-id={person.id}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        // The chip is the handle, so the guard the tabs use
                        // against dragging by their controls cannot apply.
                        personDragRef.current = {
                          personId: person.id,
                          startX: e.clientX,
                          startY: e.clientY,
                          started: false,
                        };
                      }}
                      onClick={() => {
                        // A drag ends over a chip and would otherwise also
                        // turn its filter on.
                        if (Date.now() < suppressPersonClickUntil.current) return;
                        setAssigneeFilterIds((ids) =>
                          ids.includes(person.id)
                            ? ids.filter((id) => id !== person.id)
                            : [...ids, person.id]
                        );
                      }}
                    >
                      <TodoPersonAvatar
                        name={person.name}
                        colour={person.colour}
                        photoUrl={person.photoUrl}
                        size={22}
                      />
                      <span>{shortPersonName(person.name)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {/* An icon until it is opened; then a field that takes the
                  rest of the row. */}
              <div
                className={`list-search-inner${searchRevealed ? " open" : ""}`}
                onMouseDown={(e) => {
                  if (searchRevealed) return;
                  e.preventDefault();
                  revealSearch();
                }}
              >
                <button
                  type="button"
                  className="list-search-toggle"
                  aria-label={t("listSearchPlaceholder")}
                  aria-expanded={searchRevealed}
                  tabIndex={searchRevealed ? -1 : 0}
                  onClick={() => {
                    if (searchRevealed) searchInputRef.current?.focus();
                    else revealSearch();
                  }}
                >
                  <svg className="list-search-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="list-search-input"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={t("listSearchPlaceholder")}
                  value={searchQuery}
                  tabIndex={searchRevealed ? 0 : -1}
                  onFocus={() => setSearchRevealed(true)}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            {view === "favourites" && searchGroups.length > 0 ? (
              <div className="list-search-tabs" role="tablist">
                {searchGroups.map((group) => {
                  const selected =
                    group.list.id === selectedSearchGroup?.list.id;
                  return (
                    <button
                      key={group.list.id}
                      type="button"
                      className={`list-search-tab ${selected ? "active" : ""}`}
                      role="tab"
                      aria-selected={selected}
                      onClick={() => {
                        setSearchListId(group.list.id);
                        searchInputRef.current?.focus();
                      }}
                    >
                      <span className="list-search-tab-name">
                        {group.list.name}
                      </span>
                      <span className="list-search-tab-count">
                        {group.tasks.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {view === "lists" && otherListSearchHits.length > 0 ? (
              <div className="list-search-tabs" role="tablist">
                {otherListSearchHits.map((group) => (
                  <button
                    key={group.list.id}
                    type="button"
                    className="list-search-tab"
                    role="tab"
                    onClick={() => {
                      navigateToList(group.list.id);
                      setSearchListId(group.list.id);
                      searchInputRef.current?.focus();
                    }}
                  >
                    <span className="list-search-tab-name">
                      {group.list.name}
                    </span>
                    <span className="list-search-tab-count">
                      {group.tasks.length}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Off the board, the list sits in one column like a board
              column, with the add-task box at its foot. On the board the
              wrapper steps out of the layout. Focus mode keeps the column:
              it hides the tabs, the Done section and the footer, and
              leaves the tasks as they are. */}
          <div
            className={`task-area${
              !showBoard && view !== "plan" ? " list-column" : ""
            }`}
          >
          <div
            className={`tasks-container ${showBoard ? "board-mode" : ""}`}
            ref={tasksContainerRef}
          >
            {/* Behind the Calendar the board is not on screen, and it is
                drawn again at each change of the page: every card of every
                task, for nothing. With some hundred tasks that was half a
                second for each click on the Calendar. So no cards there. */}
            {view === "plan" ? null : isSearching &&
            searchGroups.length === 0 &&
            (!showBoard || boardTasks.length === 0) ? (
              <div className="list-search-empty">{t("listSearchNoMatches")}</div>
            ) : showBoard ? (
              <div
                className={`list-board${
                  !somedayEnabled
                    ? " someday-off"
                    : somedayExpanded
                      ? " someday-expanded"
                      : " someday-collapsed"
                }`}
              >
                {boardPills ? (
                  (() => {
                    /* Someday last, as the board reads it. The open one is
                       remembered across sessions with the accordion's, since
                       both answer the same question: which section is this
                       tile showing. */
                    const sections: TodoBoardColumn[] = [
                      ...visibleColumnOrder,
                      ...(somedayEnabled ? (["someday"] as const) : []),
                    ];
                    const active = sections.includes(openStackColumn)
                      ? openStackColumn
                      : "today";
                    return (
                      <>
                        {renderBoardPills(sections, active)}
                        {renderBoardColumn(active)}
                      </>
                    );
                  })()
                ) : boardAccordion ? (
                  (() => {
                    // Someday goes last: the maybe-work sits under the
                    // real columns. A remembered section that is not on
                    // this board any more falls back to Today.
                    const sections: TodoBoardColumn[] = [
                      ...visibleColumnOrder,
                      ...(somedayEnabled ? (["someday"] as const) : []),
                    ];
                    const open = sections.includes(openStackColumn)
                      ? openStackColumn
                      : "today";
                    return sections.map((column) =>
                      renderBoardColumn(column, false, column !== open)
                    );
                  })()
                ) : (
                  <>
                    {/* Someday leads a wide board and follows a stacked one.
                        Across, it is the rail on the left, before the work
                        proper. Down, first means at the top — the maybe-work
                        above everything being done today, which is not what
                        a rail on the left says at all. */}
                    {somedayEnabled && !boardStacked
                      ? renderBoardColumn("someday", !somedayExpanded)
                      : null}
                    {boardOpenColumns.map((column) =>
                      renderBoardColumn(column, false)
                    )}
                    {showTodayRail ? renderBoardColumn("today", true) : null}
                    {somedayEnabled && boardStacked
                      ? renderBoardColumn("someday", !somedayExpanded)
                      : null}
                  </>
                )}
              </div>
            ) : view === "favourites" && openTasks.length === 0 ? (
              <div className="favourites-empty">
                <HeartIcon size={22} />
                <p className="favourites-empty-title">{t("noFavouritesTitle")}</p>
                <p className="favourites-empty-hint">{t("noFavouritesHint")}</p>
              </div>
            ) : (
              (view === "lists" ? flatListTasks : openTasks).map(renderTask)
            )}
          </div>

          {view === "lists" &&
          !showBoard &&
          (activeList || isAllListsView) ? (
            <div className="add-task-container" id="add-task-container">
              {boardNudgeOpen ? (
                <BoardViewNudge
                  count={flatListTasks.length}
                  lang={lang}
                  t={t}
                  onTry={() => answerBoardNudge(true)}
                  onDecline={() => answerBoardNudge(false)}
                />
              ) : null}
              <AddTaskComposer
                inputId="new-task-input"
                placeholder={t("addTaskPlaceholder")}
                addLabel={t("addTask")}
                minutesLabel={t("minutes")}
                onSubmit={(draft) => {
                  addedInListViewRef.current = true;
                  void addTask("week", draft);
                }}
                uploadImageForList={uploaderForList}
                resolveImageSrc={resolveBasecampImage}
                people={state.people}
                assignEnabled={assignEnabled}
                onEditPeople={() => setPeopleEditorOpen(true)}
                lists={lists}
                defaultList={addTargetList}
                lang={lang}
                t={t}
              />
            </div>
          ) : null}
          </div>

          {(() => {
            if (focusMode) return null;
            const syncBasecamp = isAllListsView
              ? lists.some((l) => Boolean(l.basecampListId))
              : Boolean(activeList?.basecampListId);
            const syncReminders = isAllListsView
              ? lists.some(
                  (l) => Boolean(l.remindersListId) && remindersConnected
                )
              : Boolean(activeList?.remindersListId && remindersConnected);
            const canSync =
              view === "lists" && (syncBasecamp || syncReminders);
            const showDone = filteredDoneTasks.length > 0 && !isSearching;
            const filteredDoneSeconds = filteredDoneTasks.reduce(
              (sum, t) => sum + (t.timeSpentSeconds || 0),
              0
            );
            if (!canSync && !showDone) return null;
            const syncBtn = canSync
              ? renderSyncControls({
                  basecamp: syncBasecamp,
                  reminders: syncReminders,
                  stopPropagation: true,
                })
              : null;
            if (!showDone) {
              return <div className="done-heading-row">{syncBtn}</div>;
            }
            return (
            <div
              className={`done-container ${doneCollapsed ? "collapsed" : ""}`}
              id="done-container"
              style={{
                display: "flex",
                // Collapsed, the box holds the heading row alone and takes
                // the height that row needs (see .done-container.collapsed
                // in todo-shell.css). No cap, so nothing is cut off.
                maxHeight: doneCollapsed ? undefined : 260,
              }}
            >
              <div className="done-heading-row" ref={doneHeadingRowRef}>
                {syncBtn}
                <div
                  className="done-heading"
                  id="done-heading"
                  onClick={() => setDoneCollapsed((v) => !v)}
                >
                  <div className="done-toggle">
                    <span>{t("done")}</span>
                    <DoneChevron />
                  </div>
                </div>
              </div>
              <div className="done-summary">
                <span className="done-task-count">
                  {filteredDoneTasks.length}{" "}
                  {filteredDoneTasks.length === 1 ? "task" : "tasks"}
                </span>
                {filteredDoneSeconds > 0 ? (
                  <span className="done-time-spent">
                    {timeSpentLabel(filteredDoneSeconds)}
                  </span>
                ) : null}
                {!doneCollapsed ? (
                  <button
                    className="delete-all-btn"
                    title={t("deleteAllCompleted")}
                    onClick={clearDone}
                  >
                    {t("clearAll")}
                  </button>
                ) : null}
              </div>
              {/* The pile reads as the mail list does: a heading per
                  stretch of days, newest first, and none for a stretch
                  with nothing in it. */}
              <div className="done-tasks" ref={doneTasksRef}>
                {(view === "plan" ? [] : groupDoneTasks(filteredDoneTasks)).map((group) => (
                  <React.Fragment key={group.bucket}>
                    <div className="done-day-heading">{t(group.bucket)}</div>
                    {group.tasks.map(renderTask)}
                  </React.Fragment>
                ))}
              </div>
            </div>
            );
          })()}
        </div>

        {planEnabled && view === "plan" ? (
          <TodoPlannerView
            lang={lang}
            people={state.people}
            onAddPerson={(name) => addBoardPerson({ name })}
            tasks={state.tasks}
            lists={state.lists}
            mePersonId={mePersonIds[0] ?? null}
            t={t}
            onEditPeople={() => setPeopleEditorOpen(true)}
            onTaskDueChange={(taskId, dueOn) => mutateTask(taskId, dueDatePatch(dueOn))}
            onTaskOpen={(taskId, anchor) => {
              // A click on the task whose card is up puts the card away. The
              // press of that click closed it a moment ago, so it stays closed.
              const closed = calendarCardClosedRef.current;
              if (closed && closed.taskId === taskId && Date.now() - closed.at < 500) return;
              setCalendarNew(null);
              setCalendarCard({ taskId, anchor });
            }}
            onTaskCreate={(request) => {
              setCalendarCard(null);
              setCalendarNew(request);
            }}
          />
        ) : null}

        {/* The line belongs to the store app. Inside the planner the board is
            one tab of the user's own tool, and it says nothing there. */}
        {!focusMode && standalone ? (
          <div className="footer">
            <span className="footer-text">
              {t("madeWith")} <span className="heart">♥</span> {t("by")}{" "}
              <a
                href="https://digitalhabits.org"
                target="_blank"
                rel="noreferrer"
              >
                digitalhabits.org
              </a>
            </span>
          </div>
        ) : null}
      </div>

      {renderCalendarCard()}
      {renderNotesOverlay()}

      {listModal ? (
        <div
          id="tab-name-modal"
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !importingGroup) setListModal(null);
          }}
        >
          <div className="modal-content">
            <h3>
              {listModal.kind === "group"
                ? listModal.mode === "create"
                  ? t("enterGroupName")
                  : "Rename group"
                : listModal.mode === "create"
                  ? t("enterListName")
                  : t("renameList")}
            </h3>
            <input
              autoFocus
              type="text"
              id="tab-name-input"
              placeholder={listModal.kind === "group" ? "My Group" : "My to-do list"}
              maxLength={50}
              value={modalName}
              disabled={importingGroup}
              onChange={(e) => setModalName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitListModal();
                if (e.key === "Escape" && !importingGroup) setListModal(null);
              }}
            />
            {listModal.kind === "list" ? (
              <ListAppearancePicker
                emoji={modalEmoji}
                colour={modalColour}
                onEmojiChange={setModalEmoji}
                onColourChange={setModalColour}
                emojiLabel={t("listEmoji")}
                colourLabel={t("listColour")}
              />
            ) : (
              <div className="tab-color-selection">
                <div className="bc-label">{t("tabColor")}</div>
                <div className="color-swatches">
                  <button
                    type="button"
                    className={`color-swatch ${modalColour === "" ? "selected" : ""}`}
                    data-color=""
                    title="None"
                    onClick={() => setModalColour("")}
                  />
                  {COLOR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.key}
                      type="button"
                      className={`color-swatch ${modalColour === swatch.key ? "selected" : ""}`}
                      data-color={swatch.key}
                      title={swatch.title}
                      style={{ backgroundColor: swatch.display }}
                      onClick={() => setModalColour(swatch.key)}
                    />
                  ))}
                  <label
                    className={`color-swatch color-swatch-custom ${
                      modalColour.startsWith("#") ? "selected" : ""
                    }`}
                    data-color="custom"
                    title="Custom color"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v8" />
                      <path d="M8 12h8" />
                    </svg>
                    <input
                      type="color"
                      id="custom-color-input"
                      aria-label="Custom tab color"
                      value={
                        modalColour.startsWith("#") ? modalColour : "#2a9d8f"
                      }
                      onChange={(e) => setModalColour(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}
            {(listModal.kind === "list" ||
              (listModal.kind === "group" && listModal.mode === "create")) &&
            bcConnected ? (
              <div className="basecamp-selection">
                <div className="bc-label">{t("basecampProject")}</div>
                <TodoSelect
                  aria-label={t("basecampProject")}
                  value={modalBcProjectId}
                  disabled={importingGroup}
                  placeholder={t("selectBasecampProject")}
                  options={bcProjects.map((p) => ({
                    value: p.id,
                    label: p.name,
                  }))}
                  onChange={(id) => void selectBcProject(id)}
                />
                {listModal.kind === "list" && modalBcProjectId ? (
                  <>
                    <div className="bc-label">Basecamp List</div>
                    <TodoSelect
                      aria-label="Basecamp List"
                      value={modalBcListId}
                      placeholder="Select a list..."
                      options={bcTodolists.map((l) => ({
                        value: l.id,
                        label: l.name,
                      }))}
                      onChange={selectBcList}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
            {listModal.kind === "list" && remindersConnected ? (
              <div className="basecamp-selection">
                <div className="bc-label">{t("appleReminders")}</div>
                <TodoSelect
                  aria-label={t("appleReminders")}
                  value={modalRemindersListId}
                  placeholder="Select a list..."
                  options={remindersLists.map((l) => ({
                    value: l.id,
                    label: l.groupName ? `${l.groupName} — ${l.name}` : l.name,
                  }))}
                  onChange={selectRemindersList}
                />
              </div>
            ) : null}
            <div className="modal-buttons">
              <button
                className="modal-btn cancel-btn"
                disabled={importingGroup}
                onClick={() => setListModal(null)}
              >
                {t("cancel")}
              </button>
              <button
                className="modal-btn create-btn"
                disabled={importingGroup}
                onClick={() => void submitListModal()}
              >
                {importingGroup
                  ? t("importing")
                  : listModal.kind === "group" &&
                      listModal.mode === "create" &&
                      modalBcProjectId
                    ? t("importListsFromProject")
                    : listModal.mode === "create"
                      ? listModal.kind === "group"
                        ? t("createGroup")
                        : t("create")
                      : t("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <TodoPeopleEditor
        open={peopleEditorOpen}
        people={state.people}
        t={t}
        onClose={() => setPeopleEditorOpen(false)}
        onAdd={addBoardPerson}
        onRemove={removeBoardPerson}
        onSearch={searchPeopleCandidates}
        onSetPhoto={setPersonPhoto}
        meIds={mePersonIds}
        // In the planner the login says who the reader is.
        onSetMe={standalone ? markMe : undefined}
      />

      {confirmModal ? (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmModal(null);
          }}
        >
          <div className="modal-content">
            <h3>{confirmModal.title}</h3>
            <p className="settings-desc" style={{ marginBottom: 20, lineHeight: 1.5 }}>
              {confirmModal.message}
            </p>
            <div className="modal-buttons">
              <button className="modal-btn cancel-btn" onClick={() => setConfirmModal(null)}>
                {t("cancel")}
              </button>
              <button
                className={`modal-btn ${confirmModal.danger ? "delete-confirm-btn" : "create-btn"}`}
                onClick={() => {
                  const action = confirmModal.onConfirm;
                  setConfirmModal(null);
                  action();
                }}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <TodoSettingsModal
          t={t}
          lang={lang}
          onLangChange={(l) => {
            setLang(l);
            persistPref(LANG_KEY, l);
          }}
          theme={theme}
          onThemeChange={(th) => {
            setTheme(th);
            persistPref(THEME_KEY, th);
          }}
          zoom={zoom}
          onZoomChange={(z) => {
            setZoom(z);
            persistPref(ZOOM_KEY, String(z));
          }}
          onExport={exportData}
          onImport={importData}
          onClose={() => setSettingsOpen(false)}
          appVersion={appVersion}
          kanbanEnabled={kanbanEnabled}
          onKanbanEnabledChange={(enabled) => {
            setKanbanEnabled(enabled);
            persistPref(KANBAN_KEY, enabled ? "1" : "0");
          }}
          somedayEnabled={somedayEnabled}
          onSomedayEnabledChange={(enabled) => {
            if (!enabled) {
              for (const task of tasksRef.current) {
                if (!task.completed && task.isSomeday) {
                  void mutateTask(task.id, boardColumnPatch("backlog"));
                }
              }
            }
            setSomedayEnabled(enabled);
            persistPref(SOMEDAY_ENABLED_KEY, enabled ? "1" : "0");
          }}
          assignEnabled={assignEnabled}
          onAssignEnabledChange={(enabled) => {
            // The assignees stay on the tasks. Only the controls go.
            if (!enabled) {
              setAssigneeFilterIds([]);
              closeAssignMenu();
              setPeopleEditorOpen(false);
            }
            setAssignEnabled(enabled);
            persistPref(ASSIGN_ENABLED_KEY, enabled ? "1" : "0");
          }}
          focusTimerAlways={focusTimerAlways}
          onFocusTimerAlwaysChange={(always) => {
            setFocusTimerAlways(always);
            persistPref(FOCUS_TIMER_ALWAYS_KEY, always ? "1" : "0");
            // A focus window is a page of its own. Tell the open ones.
            focusChannelRef.current?.postMessage({
              type: FOCUS_TIMER_PREF_MESSAGE,
              always,
            });
          }}
          groupsEnabled={groupsEnabled}
          onGroupsEnabledChange={handleGroupsEnabledChange}
          planEnabled={planEnabled}
          onPlanEnabledChange={(enabled) => {
            setPlanEnabled(enabled);
            persistPref(PLAN_ENABLED_KEY, enabled ? "1" : "0");
          }}
        />
      ) : null}

      {sessionIds ? (
        <TodayFocusSession
          tasks={
            sessionIds
              .map((id) => state.tasks.find((task) => task.id === id))
              .filter((task): task is TodoTask => Boolean(task))
          }
          t={t}
          canPopOut={nativeShell}
          focusTaskIds={activeFocusTaskIds}
          people={state.people}
          assignEnabled={assignEnabled}
          timerAlways={focusTimerAlways}
          subtasksOf={(taskId) => subtasksByTask.get(taskId) ?? []}
          handlers={{
            onComplete: (task) => void mutateTask(task.id, { completed: true }),
            onUncomplete: uncompleteSessionTask,
            onToggleFocus: toggleTaskFocusPopout,
            onToggleNotes: toggleNotes,
            renderNotes: renderNotesEditor,
            onToggleAssignee: toggleTaskAssignee,
            onEditPeople: () => setPeopleEditorOpen(true),
            onSetDuration: (task, minutes) =>
              void mutateTask(task.id, { expectedDurationMinutes: minutes }),
            onSkip: skipSessionTask,
            onReorder: (taskIds) =>
              setSessionIds((ids) =>
                ids
                  ? [...taskIds, ...ids.filter((id) => !taskIds.includes(id))]
                  : ids
              ),
            onAddTask: (text, durationMinutes) =>
              void addSessionTask(text, durationMinutes),
            onPersistTime: (taskId, totalSeconds) =>
              void mutateTask(taskId, { timeSpentSeconds: totalSeconds }),
            onEditText: (task, text) => void mutateTask(task.id, { text }),
            onExpand: openTaskOverlay,
            onToggleSubtask: (subtask) => {
              const completing = !subtask.completed;
              const patch: TodoTaskPatch = { completed: completing };
              if (completing && subtask.parentTaskId) {
                // The freshest tick reads first in the done pile, as on the board.
                const done = (subtasksByTask.get(subtask.parentTaskId) ?? []).filter(
                  (st) => st.completed && st.id !== subtask.id
                );
                if (done.length) {
                  const top = Math.min(...done.map((st) => st.position));
                  if (subtask.position >= top) patch.position = top - 1;
                }
              }
              void mutateTask(subtask.id, patch);
            },
            onExit: () => setSessionIds(null),
          }}
        />
      ) : null}

      {undoState ? (
        <div className="undo-toast">
          <span>{undoState.message}</span>
          <button
            className="undo-btn"
            onClick={() => {
              const restore = undoState.restore;
              lastUndoRef.current = null;
              setUndoState(null);
              restore();
            }}
          >
            {t("undo")}
          </button>
          <button className="close-undo-btn" onClick={() => setUndoState(null)}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
