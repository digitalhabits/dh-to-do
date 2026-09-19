/**
 * Whether Board View is on, for a reader who has not chosen.
 *
 * A new reader starts with one list: it is the simple thing, and it is what
 * a reader of version 2 knows. The app offers Board View one time, when a
 * list gets long (see BoardViewNudge.tsx), and it is in Settings.
 *
 * Before this rule, a reader with no saved choice had Board View on. Such a
 * reader keeps it: a board that goes away by itself looks like lost work.
 * They are known by the saved current list, which the board writes for every
 * reader who has used it, and which a fresh install and a reader who comes
 * from version 2 do not have yet.
 *
 * The answer is saved at once, so it is decided one time.
 *
 * No React in here, so a test can read it.
 */

export type BoardViewChoice = {
  /** The saved setting: "1", "0", or null when the reader has not chosen. */
  stored: string | null;
  /** The saved current list, or null when the board never wrote one. */
  savedCurrentList: string | null;
};

export function boardViewIsOn(choice: BoardViewChoice): boolean {
  if (choice.stored === "1") return true;
  if (choice.stored === "0") return false;
  return choice.savedCurrentList !== null;
}
