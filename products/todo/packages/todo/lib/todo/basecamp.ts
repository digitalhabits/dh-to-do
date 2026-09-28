/**
 * Server-side Basecamp 3 client for the To-Do board, ported from redd-do's
 * app.js client (auth refresh, 429 backoff, RFC5988 pagination, grouped
 * todos). redd-do ran this in the webview against localStorage tokens; here
 * it runs on the server against the team-shared connection row, so it works
 * from every browser with no CORS shims or client secrets in the client.
 *
 * The code is in the basecamp-*.ts files beside this one: the connection
 * (client), the calls (todos), the people (assignees), the push of one
 * action (push) and the sync of a list (sync). This file names what the
 * rest of the app uses, so the app still imports from here.
 */

export {
  type BasecampTransport,
  setBasecampTransport,
  type BasecampConnection,
  getBasecampConnection,
  saveBasecampConnection,
  deleteBasecampConnection,
  connectBasecampWithTokens,
  basecampAuthorizeUrl,
  exchangeBasecampCode,
  fetchBasecampIdentity,
} from "./basecamp-client";

export {
  type BasecampProject,
  type BasecampTodolist,
  type BasecampPerson,
  type BasecampTodo,
  type BasecampStep,
  createBasecampStep,
  updateBasecampStepTitle,
  setBasecampStepCompletion,
  trashBasecampStep,
  listBasecampProjectPeople,
  listBasecampProjects,
  listBasecampTodolists,
  fetchAllBasecampTodos,
  normalizeBasecampNotes,
  createBasecampTodo,
  setBasecampTodoCompletion,
  getBasecampTodo,
  updateBasecampTodo,
  trashBasecampTodo,
} from "./basecamp-todos";

export {
  attachLocalMedia,
  pushBasecampAction,
} from "./basecamp-push";

export {
  reconcileSteps,
  type BasecampSyncResult,
  syncBasecampList,
} from "./basecamp-sync";
