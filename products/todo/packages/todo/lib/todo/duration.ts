/**
 * Minutes as people type them.
 *
 * "45" and "45m" are minutes; "1h", "1.5h", "1h30", "1h 15m" and "2 hours"
 * are hours and minutes; "90 min" is minutes. Null when nothing readable
 * is there, or the result is not a positive whole number of minutes.
 */
export function parseDurationText(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/,/g, ".");
  if (!s) return null;
  const hoursThenMinutes =
    /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|t|time|timer)\s*(?:(\d+)\s*(?:m|min|mins|minutes|minutter)?)?$/;
  const minutesOnly = /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|minutter)?$/;
  let minutes: number | null = null;
  const hm = hoursThenMinutes.exec(s);
  if (hm) {
    minutes = Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0);
  } else {
    const m = minutesOnly.exec(s);
    if (m) minutes = Number(m[1]);
  }
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const rounded = Math.round(minutes);
  return rounded > 0 && rounded <= 999 ? rounded : null;
}

/**
 * Minutes, said short: "45m", "1h", "1.5h", "1h 15m".
 * `minuteUnit` and `hourUnit` are the language's letters ("m" / "h").
 */
export function formatDurationShort(
  minutes: number,
  minuteUnit: string,
  hourUnit: string
): string {
  if (minutes < 60) return `${minutes}${minuteUnit}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours}${hourUnit}`;
  if (rest === 30) return `${hours}.5${hourUnit}`;
  return `${hours}${hourUnit} ${rest}${minuteUnit}`;
}

/** The four presets that cover most tasks in one click. */
export const DURATION_PRESETS = [15, 30, 60, 120] as const;
