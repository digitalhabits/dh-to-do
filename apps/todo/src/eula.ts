/**
 * The welcome screen ("Private by design"), accepted once on this device.
 * The usage count waits for it; accepting fires EULA_ACCEPTED_EVENT.
 */
export const EULA_KEY = "todo_eula";
export const EULA_REVISION = 1;
export const EULA_ACCEPTED_EVENT = "todo-eula-accepted";

export function eulaAccepted(): boolean {
  try {
    const stored = JSON.parse(localStorage.getItem(EULA_KEY) || "null") as { acceptedRevision?: number } | null;
    return stored?.acceptedRevision === EULA_REVISION;
  } catch {
    return false;
  }
}

export function acceptEula(): void {
  try {
    localStorage.setItem(EULA_KEY, JSON.stringify({ acceptedRevision: EULA_REVISION, acceptedAt: Date.now() }));
  } catch {
    /* the screen shows again next launch */
  }
  window.dispatchEvent(new Event(EULA_ACCEPTED_EVENT));
}
