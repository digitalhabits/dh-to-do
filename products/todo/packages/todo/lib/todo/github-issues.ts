/**
 * GitHub's issues, assignees and users: one call each.
 *
 * Part of github.ts, which re-exports what the rest of the app uses.
 */

import { ghFetch, githubApi, githubError, parseNextLink } from "./github-client";

export type GithubIssue = {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  state_reason?: string | null;
  updated_at: string;
  html_url?: string;
  assignees?: { login: string }[];
  /** Present on a pull request, which the issues list also returns. */
  pull_request?: unknown;
};

/** The issue fields a write may set. Assignees replace the whole set. */
export type GithubIssuePatch = {
  title?: string;
  body?: string;
  state?: "open" | "closed";
  state_reason?: "completed" | "not_planned" | "reopened";
  assignees?: string[];
};

function repoPath(repo: string): string {
  const [owner, name] = repo.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export type IssueChanges = {
  /** GitHub said 304: nothing changed since the ETag was given. */
  notModified: boolean;
  /** Issues only; pull requests are left out. */
  issues: GithubIssue[];
  /** The ETag of the first page, to send next time. */
  etag: string | null;
  /** GitHub's clock at the answer, for a cursor when no issue came. */
  serverDate: string | null;
};

/**
 * What changed in a repository's issues.
 *
 * With no cursor this is the first look: the open issues, and nothing
 * closed. After that it is every issue updated since a little before the
 * cursor, open or closed. The URL stays the same while the cursor does, so
 * the ETag can save the whole answer: GitHub answers 304 and charges
 * nothing.
 *
 * "A little before": GitHub's list can lag a few seconds behind a change
 * (measured against a real repository, 2026-10-18: a poll just after a
 * push did not have the new issue yet). Without the overlap, a change the
 * list showed late could fall behind the cursor and never come in. An
 * issue seen twice costs nothing: it equals its base.
 */
export const GITHUB_POLL_OVERLAP_MS = 2 * 60_000;

function sinceWithOverlap(cursor: string): string {
  const ms = Date.parse(cursor);
  if (Number.isNaN(ms)) return cursor;
  return new Date(ms - GITHUB_POLL_OVERLAP_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function listIssueChanges(
  repo: string,
  cursor: string | null,
  etag: string | null
): Promise<IssueChanges> {
  const params = new URLSearchParams({
    state: cursor ? "all" : "open",
    sort: "updated",
    direction: "asc",
    per_page: "100",
  });
  if (cursor) params.set("since", sinceWithOverlap(cursor));
  let next: string | null = githubApi(`${repoPath(repo)}/issues?${params}`);
  const issues: GithubIssue[] = [];
  let firstEtag: string | null = null;
  let serverDate: string | null = null;
  let first = true;
  const seen = new Set<string>();
  while (next && !seen.has(next)) {
    seen.add(next);
    const res: Response = await ghFetch(repo, next, {
      headers: first && etag ? { "If-None-Match": etag } : {},
    });
    if (first && res.status === 304) {
      return { notModified: true, issues: [], etag, serverDate: res.headers.get("Date") };
    }
    if (!res.ok) throw await githubError("the issue list", res);
    if (first) {
      firstEtag = res.headers.get("ETag");
      serverDate = res.headers.get("Date");
    }
    first = false;
    const page = (await res.json()) as GithubIssue[];
    if (Array.isArray(page)) issues.push(...page.filter((i) => !i.pull_request));
    next = parseNextLink(res.headers.get("Link"));
  }
  return { notModified: false, issues, etag: firstEtag, serverDate };
}

/** One issue, or null when it is gone (deleted, or moved to another repository). */
export async function getIssue(repo: string, number: number): Promise<GithubIssue | null> {
  const res = await ghFetch(repo, githubApi(`${repoPath(repo)}/issues/${number}`));
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw await githubError("an issue", res);
  return (await res.json()) as GithubIssue;
}

export async function createIssue(
  repo: string,
  fields: { title: string; body: string; assignees: string[] }
): Promise<GithubIssue> {
  const res = await ghFetch(repo, githubApi(`${repoPath(repo)}/issues`), {
    method: "POST",
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw await githubError("a new issue", res);
  return (await res.json()) as GithubIssue;
}

export async function updateIssue(
  repo: string,
  number: number,
  patch: GithubIssuePatch
): Promise<GithubIssue | null> {
  const res = await ghFetch(repo, githubApi(`${repoPath(repo)}/issues/${number}`), {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  // Deleted, or moved to a repository this connection cannot see.
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw await githubError("a change to an issue", res);
  return (await res.json()) as GithubIssue;
}

const ASSIGNABLE_TTL_MS = 5 * 60_000;
const assignableCache = new Map<string, { at: number; logins: Set<string> }>();

/**
 * Who may be put on an issue in this repository, lower-cased. GitHub
 * leaves out anybody else without a word, so the sync must know first.
 */
export async function listAssignableLogins(repo: string): Promise<Set<string>> {
  const cached = assignableCache.get(repo);
  if (cached && Date.now() - cached.at < ASSIGNABLE_TTL_MS) return cached.logins;
  const logins = new Set<string>();
  let next: string | null = githubApi(`${repoPath(repo)}/assignees?per_page=100`);
  const seen = new Set<string>();
  while (next && !seen.has(next)) {
    seen.add(next);
    const res: Response = await ghFetch(repo, next);
    if (!res.ok) throw await githubError("the people of the repository", res);
    for (const user of (await res.json()) as { login: string }[]) {
      logins.add(user.login.toLowerCase());
    }
    next = parseNextLink(res.headers.get("Link"));
  }
  assignableCache.set(repo, { at: Date.now(), logins });
  return logins;
}

/** A user's display name, when they give one. */
export async function getUserName(repo: string, login: string): Promise<string | null> {
  const res = await ghFetch(repo, githubApi(`/users/${encodeURIComponent(login)}`));
  if (!res.ok) return null;
  const user = (await res.json()) as { name?: string | null };
  return user.name?.trim() || null;
}

export type GithubPull = {
  number: number;
  title: string;
  state: "open" | "closed";
  draft?: boolean;
  html_url?: string;
  updated_at: string;
  user?: { login: string } | null;
  /** People asked to review and not yet done. Teams are left out. */
  requested_reviewers?: { login: string }[];
};

export type PullChanges = {
  notModified: boolean;
  pulls: GithubPull[];
  etag: string | null;
  /** The app may not read pull requests: it lacks that permission. */
  forbidden: boolean;
};

/**
 * The open pull requests of a repository, for review tasks. One list, with
 * an ETag, so a poll with no change is a 304 and costs nothing. A review
 * request asked or answered changes the list, and so its ETag.
 */
export async function listOpenPulls(repo: string, etag: string | null): Promise<PullChanges> {
  let next: string | null = githubApi(
    `${repoPath(repo)}/pulls?state=open&sort=updated&direction=desc&per_page=100`
  );
  const pulls: GithubPull[] = [];
  let firstEtag: string | null = null;
  let first = true;
  const seen = new Set<string>();
  while (next && !seen.has(next)) {
    seen.add(next);
    const res: Response = await ghFetch(repo, next, {
      headers: first && etag ? { "If-None-Match": etag } : {},
    });
    if (first && res.status === 304) return { notModified: true, pulls: [], etag, forbidden: false };
    // No "Pull requests: read" on the app, or no access for this person.
    if (first && (res.status === 403 || res.status === 404)) {
      return { notModified: false, pulls: [], etag: null, forbidden: true };
    }
    if (!res.ok) throw await githubError("the pull requests", res);
    if (first) firstEtag = res.headers.get("ETag");
    first = false;
    const page = (await res.json()) as GithubPull[];
    if (Array.isArray(page)) pulls.push(...page);
    next = parseNextLink(res.headers.get("Link"));
  }
  return { notModified: false, pulls, etag: firstEtag, forbidden: false };
}
