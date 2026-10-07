import * as React from "react";

/**
 * State that a host can fix in place.
 *
 * Unlocked, it is React's own state. Locked, the value is `lockedValue` and
 * the setter does nothing, so no saved preference, setting or link can move
 * it. The Planner's Calendar tab shows the To-Do page locked to its Calendar
 * View this way (TodoPage's `calendarOnly`): the same calendar as the To-Do
 * tab's, with the same tasks, and with nothing that leads off it.
 */
export function useLockedState<T>(
  locked: boolean,
  lockedValue: T,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = React.useState<T>(locked ? lockedValue : initial);
  const ignore = React.useCallback<React.Dispatch<React.SetStateAction<T>>>(() => {}, []);
  return locked ? [lockedValue, ignore] : [value, setValue];
}
