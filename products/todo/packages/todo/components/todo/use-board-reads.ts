"use client";

import * as React from "react";
import { toast } from "sonner";

import { loadTrix } from "@/components/todo/TrixNotesEditor";
import type { TodoApi } from "@/components/todo/use-write-tracking";
import { isOfflineNow } from "@/lib/offline/todo-offline";
import { PAGE_CACHE_KEYS, setPageSnapshot } from "@/lib/page-snapshot-cache";
import { describeError, isNetworkBlip } from "@/lib/todo/errors";
import { todayDueOn } from "@/lib/todo/task-draft";
import { normalizeTaskAssignees } from "@/lib/todo/task-helpers";
import type { TodoState } from "@/lib/todo/types";

export type TodoPageSnapshot = { state: TodoState };


export const EMPTY_STATE: TodoState = {
  groups: [],
  lists: [],
  tasks: [],
  people: [],
};


/**
 * How long `refresh` waits before reading the board.
 *
 * One gesture can send several writes — a drag renumbers every task it moves
 * past — and each one asks for a read. Long enough to gather a gesture, short
 * enough that a colleague's change still feels immediate.
 */
const REFRESH_COALESCE_MS = 120;


/**
 * Reading the board: the one read and its guard against a write in the
 * air, the refresh that gathers a burst of asks into one read, the first
 * read, a read when the page comes back to the front, the page's cached
 * copy, and the note editor fetched early.
 */
export function useBoardReads({
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
}: {
  state: TodoState;
  setState: React.Dispatch<React.SetStateAction<TodoState>>;
  api: TodoApi;
  inFlightWritesRef: React.RefObject<Set<Promise<unknown>>>;
  mutationSeqRef: React.RefObject<number>;
  boardLoadedRef: React.RefObject<boolean>;
  refreshRef: React.RefObject<() => Promise<void>>;
  editingTaskId: string | null;
  editingDurationTaskId: string | null;
  t: (key: string) => string;
}) {
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
  }, [api, inFlightWritesRef, mutationSeqRef, boardLoadedRef, setState]);

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

  /*
    The language of the words a failed read says. Held in a ref, so that
    refresh stays the same function when the language changes: a new
    refresh would read the board again (see the effect below it), and the
    saved language comes back just after the page starts.
  */
  const tRef = React.useRef(t);
  React.useLayoutEffect(() => {
    tRef.current = t;
  }, [t]);

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
            toast.error(tRef.current("loadTasksOffline"));
            return;
          }
        }
        toast.error(describeError(err, tRef.current("loadTasksFailed")));
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
  }, [refresh, refreshRef]);

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
  }, [editingTaskId, editingDurationTaskId, refreshRef]);

  return { refresh };
}
