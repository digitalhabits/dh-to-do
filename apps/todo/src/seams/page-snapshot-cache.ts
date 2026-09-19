export const PAGE_CACHE_KEYS = {
  todo: "dh-todo-standalone-page-v1",
} as const;

export function setPageSnapshot<T>(_key: string, _data: T): void {
  /* prefs / snapshots optional in standalone */
}
