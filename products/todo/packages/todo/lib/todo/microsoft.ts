/**
 * The To-Do board and Microsoft To Do, two ways, built the way the Google
 * Tasks sync is built (google.ts): the sync is shared code that runs
 * against the store through todoDb, and the connection (sign-in and HTTP)
 * is a transport the app installs.
 *
 * Only the desktop app installs one, so task data from Microsoft stays on
 * the person's computer. The planner has no route for it.
 *
 * The code is in the microsoft-*.ts files beside this one: the connection
 * (client), the calls (tasks), the base and the due day (merge), which
 * list is linked (link) and the sync of a list (sync). The word that a
 * list changed is the Google sync's (google-push.ts): it names lists, not
 * a service. This file names what the rest of the app uses.
 */

export {
  MICROSOFT_TASKS_SCOPE,
  type MicrosoftAccount,
  type MicrosoftTransport,
  accountCanSyncTasks,
  setMicrosoftTransport,
  microsoftTransport,
  setMicrosoftBackoffStep,
} from "./microsoft-client";

export {
  type MicrosoftTask,
  type MicrosoftTaskList,
  listMicrosoftTaskLists,
} from "./microsoft-tasks";

export { type MicrosoftBase, dueFromMicrosoft, dueToMicrosoft } from "./microsoft-merge";

export {
  type MicrosoftListLink,
  getMicrosoftLink,
  setMicrosoftLink,
  withMicrosoftLinks,
} from "./microsoft-link";

export {
  MICROSOFT_REMOVE_LIMIT,
  type MicrosoftSyncOptions,
  type MicrosoftSyncResult,
  syncMicrosoftList,
} from "./microsoft-sync";
