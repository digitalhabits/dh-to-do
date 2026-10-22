/**
 * A repository and a username as the store keeps them. Client-safe: no
 * GitHub calls here, only the shape GitHub gives each.
 */

import { PlanError } from "@/lib/plan/errors";

/** "owner/name", from that or from the repository's address. Null for none. */
export function normalizeGithubRepo(value: string | null): string | null {
  const repo = value?.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\/+$/, "");
  if (!repo) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new PlanError("A GitHub repository is written as owner/name", 400);
  }
  return repo;
}

/**
 * A login, lower-cased: GitHub logins are not case-sensitive, and the sync
 * compares them lower-cased. A leading "@" is taken off. Null for none.
 */
export function normalizeGithubLogin(value: string | null | undefined): string | null {
  const login = value?.trim().replace(/^@/, "").toLowerCase() || null;
  if (login && !/^[a-z0-9-]{1,39}$/.test(login)) {
    throw new PlanError("That is not a GitHub username", 400);
  }
  return login;
}
