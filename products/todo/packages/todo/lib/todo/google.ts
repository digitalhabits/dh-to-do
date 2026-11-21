/**
 * The To-Do board and Google Tasks, two ways, built the way the GitHub
 * sync is built (github.ts): the sync is shared code that runs against
 * the store through todoDb, and the connection (sign-in and HTTP) is a
 * transport the app installs.
 *
 * Only the desktop app installs one. We told Google that task data stays
 * on the person's computer, so the planner must not sync Google Tasks on
 * its server, and it has no route for it.
 *
 * The code is in the google-*.ts files beside this one: the connection
 * (client), the calls (tasks), the three-copy rule and the note (merge),
 * which list is linked (link), the word that a list changed (push) and
 * the sync of a list (sync). This file
 * names what the rest of the app uses.
 */

export {
  GOOGLE_TASKS_SCOPE,
  type GoogleAccount,
  type GoogleTransport,
  accountCanSyncTasks,
  setGoogleTransport,
  googleTransport,
  setGoogleBackoffStep,
} from "./google-client";

export {
  type GoogleTask,
  type GoogleTaskList,
  listGoogleTaskLists,
} from "./google-tasks";

export {
  type GoogleBase,
  htmlToPlain,
  plainToHtml,
  settleGoogleNotes,
} from "./google-merge";

export { noteGoogleBoardWrite, onGoogleBoardWrite } from "./google-push";

export {
  type GoogleListLink,
  assertGoogleListFree,
  getGoogleLink,
  setGoogleLink,
  withGoogleLinks,
} from "./google-link";

export {
  GOOGLE_REMOVE_LIMIT,
  type GoogleSyncOptions,
  type GoogleSyncResult,
  syncGoogleList,
} from "./google-sync";
