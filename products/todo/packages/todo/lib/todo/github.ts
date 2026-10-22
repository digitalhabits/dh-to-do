/**
 * The To-Do board and GitHub issues, two ways, built the way the Basecamp
 * sync is built (basecamp.ts): the sync is shared code that runs against
 * the store through todoDb, and the connection — sign-in and HTTP — is a
 * transport each app installs. The planner installs a GitHub App
 * (github-app-auth.ts). The standalone app can install its own and keep
 * every line below.
 *
 * The code is in the github-*.ts files beside this one: the connection
 * (client), the calls (issues), the note and the body (markdown), the
 * three-copy rule (merge), the people (people), the push of a delete
 * (push) and the sync of a list (sync). This file names what the rest of
 * the app uses.
 */

export {
  type GithubTransport,
  setGithubTransport,
  githubTransport,
} from "./github-client";

export {
  type GithubIssue,
  listIssueChanges,
  getIssue,
  createIssue,
  updateIssue,
  listAssignableLogins,
} from "./github-issues";

export {
  htmlToMarkdown,
  markdownToHtml,
  splitIssueBody,
  joinIssueBody,
} from "./github-markdown";

export { pushGithubAction } from "./github-push";

export {
  TODO_GITHUB_CLIENT_ID,
  TODO_GITHUB_APP_SLUG,
  githubInstallUrl,
  type DeviceCode,
  type DevicePoll,
  startDeviceFlow,
  pollDeviceFlow,
  fetchGithubLogin,
  listUserRepositories,
  type GithubConnection,
  getGithubConnection,
  saveGithubConnection,
  deleteGithubConnection,
} from "./github-device";

export { type GithubSyncResult, syncGithubList } from "./github-sync";
