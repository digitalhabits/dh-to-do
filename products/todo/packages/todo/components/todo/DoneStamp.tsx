"use client";

import * as React from "react";

import { doneStamp } from "@/lib/todo/done-groups";
import type { TodoLang } from "@/lib/todo/i18n";

const noSubscribe = () => () => {};

/**
 * When a task was finished, on its row (see `doneStamp`).
 *
 * Written in the browser only. The stamp is the reader's clock: their time
 * zone, and in English their machine's 12- or 24-hour form. The planner's
 * server has neither. It wrote "04:40 PM" where the browser wrote "16:40",
 * and React threw the page's first render away over it. So the server
 * writes nothing here, and the stamp comes in once the page has loaded.
 * The desktop app has no server; there it shows at once.
 */
export function DoneStamp({ completedAt, lang }: { completedAt: string; lang: TodoLang }) {
  const inBrowser = React.useSyncExternalStore(noSubscribe, () => true, () => false);
  return <span className="task-done-stamp">{inBrowser ? doneStamp(completedAt, lang) : null}</span>;
}
