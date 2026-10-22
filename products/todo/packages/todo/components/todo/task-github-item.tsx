"use client";

/*
 * The task menu's GitHub offer, on a list linked to a repository.
 *
 * A task that is not on GitHub can be marked "Public on GitHub": the next
 * sync makes it an issue. It is off by default, because on a public
 * repository the title, the note and the subtasks are published. A task
 * that is on GitHub opens its issue instead. Subtasks have no offer: they
 * go as checkboxes in their task's issue.
 */

import { fillText } from "@/lib/todo/i18n";
import type { TodoList, TodoTask, TodoTaskPatch } from "@/lib/todo/types";

/**
 * A task was just made public: sync its list now (use-sync listens). The
 * issue was made only at the next sync, up to ten minutes on, and until
 * then the menu said "on" with no issue number and the card had no mark
 * (2026-10-19). Detail: `{ listId }`.
 */
export const GITHUB_PUBLISH_EVENT = "todo-github-publish";

function GithubMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function TaskGithubItem({
  task,
  list,
  t,
  mutateTask,
  closeMenu,
}: {
  task: TodoTask;
  list: TodoList | undefined;
  t: (key: string) => string;
  mutateTask: (id: string, patch: TodoTaskPatch) => unknown;
  closeMenu: () => void;
}) {
  if (!list?.githubRepo || task.parentTaskId) return null;
  if (task.githubNumber && task.githubRepo) {
    // A review task names a pull request; the rest, issues.
    const review = task.githubKind === "review";
    const url = githubTaskUrl(task) as string;
    // A plain link: both apps open a new-window link in the browser.
    return (
      <a
        role="menuitem"
        className="task-menu-item"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          closeMenu();
        }}
      >
        <GithubMark />
        {fillText(t(review ? "openGithubPull" : "openGithubIssue"), {
          number: String(task.githubNumber),
        })}
      </a>
    );
  }
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={Boolean(task.githubPublic)}
      className="task-menu-item"
      title={t("publicOnGithubHint")}
      onClick={(e) => {
        e.stopPropagation();
        closeMenu();
        const publish = !task.githubPublic;
        void Promise.resolve(mutateTask(task.id, { githubPublic: publish })).then(() => {
          if (!publish || !list) return;
          window.dispatchEvent(new CustomEvent(GITHUB_PUBLISH_EVENT, { detail: { listId: list.id } }));
        });
      }}
    >
      <GithubMark />
      {task.githubPublic ? t("publicOnGithubOn") : t("publicOnGithub")}
    </button>
  );
}

/** The address of a task's issue, or of the pull request a review task names. */
export function githubTaskUrl(task: TodoTask): string | null {
  if (!task.githubNumber || !task.githubRepo) return null;
  const kind = task.githubKind === "review" ? "pull" : "issues";
  return `https://github.com/${task.githubRepo}/${kind}/${task.githubNumber}`;
}

/**
 * The GitHub mark at a linked card's bottom right, in front of the list
 * icon (on the All tab): always on screen, so a linked task can be seen
 * at a glance, and it opens the issue, or the pull request of a review task.
 */
export function TaskGithubLink({ task, t }: { task: TodoTask; t: (key: string) => string }) {
  const url = githubTaskUrl(task);
  if (!url || task.parentTaskId) return null;
  const label = fillText(t(task.githubKind === "review" ? "openGithubPull" : "openGithubIssue"), {
    number: String(task.githubNumber),
  });
  return (
    <a
      className="task-github-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <GithubMark />
    </a>
  );
}

