import type * as React from "react";

import type { TodoTask } from "./types";

/**
 * What the Planner adds to the board for its CRM next steps (see the
 * Planner's components/todo-crm and lib/plan/crm-step-tasks.ts). A next
 * step is an ordinary task in a list of its own — Clients, Collaborations,
 * Facilitators, Applications — so it gets everything a task gets; the
 * extension only marks it and asks what comes next. The standalone app
 * passes none, and the board is as it was.
 */
export type TodoBoardExtensionContext = {
  /** The All tab is the one chosen. */
  allTab: boolean;
};

export type TodoBoardExtension = {
  /** A control at the right end of the row under the tabs. */
  renderToolbar: (ctx: TodoBoardExtensionContext) => React.ReactNode;
  /** Lists whose tasks the All tab leaves out (the switch is off). */
  hiddenListIdsOnAll: readonly string[];
  /** A line above a task's words: whose step it is. Null for most tasks. */
  renderTaskHeader: (task: TodoTask) => React.ReactNode;
  /** A task was ticked off on the board. `refresh` reads the board again. */
  onTaskCompleted: (task: TodoTask, refresh: () => Promise<void>) => void;
  /** A task was deleted on the board. */
  onTaskDeleted?: (task: TodoTask) => void;
};
