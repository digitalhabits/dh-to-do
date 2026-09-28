"use client";

import * as React from "react";

/** The page's API: a path, a method and a body, answered with JSON. */
export type TodoApi = (
  path: string,
  method: string,
  body?: unknown
) => Promise<Record<string, unknown>>;

/**
 * Tracks the writes the page sends: a running count, and the set still in
 * flight. `refresh` uses both. A GET that overlaps a write can read the
 * board before that write commits, so its result is older than the board
 * on screen, and `refresh` drops it. Without this, a drop that lands
 * during a focus refresh snaps back to the old order until each PATCH
 * response arrives.
 *
 * `api` is the page's API with the tracking on it. Reads go straight
 * through.
 */
export function useWriteTracking(offlineApi: TodoApi) {
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
  return { api, mutationSeqRef, inFlightWritesRef };
}
