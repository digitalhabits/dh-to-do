/**
 * What a board write tells GitHub at once, before the next sync.
 *
 * Only a delete. Every other change waits for the sync, which settles it
 * with the three-copy rule. A delete cannot wait: after it the board no
 * longer knows the issue, and the next change on GitHub would bring the
 * task back. So the issue is closed as "not planned", which anybody can
 * undo on GitHub.
 *
 * Part of github.ts, which re-exports what the rest of the app uses.
 */

import { githubTransport } from "./github-client";
import { updateIssue } from "./github-issues";

type DeleteAction = {
  type: string;
  github?: { repo: string; number: number; kind?: string | null } | null;
};

/** Best effort: a failure never stops the delete the reader made. */
export async function pushGithubAction(action: DeleteAction): Promise<void> {
  if (action.type !== "delete" || !action.github) return;
  // A review task names a pull request. Deleting the task must never
  // close somebody's pull request.
  if (action.github.kind) return;
  if (!githubTransport().configured()) return;
  try {
    await updateIssue(action.github.repo, action.github.number, {
      state: "closed",
      state_reason: "not_planned",
    });
  } catch (err) {
    console.warn("[todo] GitHub push failed:", err);
  }
}
