/**
 * The Done pile under a search, and its summary (done-summary.tsx).
 *
 * A search reaches the pile: its matching done tasks show under the open
 * ones (reported 2026-10-04: searching used to hide the pile). And the
 * summary counts a day, a week, a month or all, part by part.
 */

import { doneTasksShown, searchQueryOf } from "@/lib/todo/search-groups";
import { doneStats } from "@/components/todo/done-summary";
import { check, report } from "./harness.mjs";

const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).toISOString();
const task = (id, text, completedAt, timeSpentSeconds = 0) => ({ id, text, completed: true, completedAt, timeSpentSeconds });

const done = [
  task("a", "Pump the tyres", at(2026, 10, 4, 9), 600),
  task("b", "Wipe the hob", at(2026, 10, 4, 15), 300),
  task("c", "Book the tyre fitter", at(2026, 10, 1)),
  task("d", "Paint the shed", at(2026, 9, 20), 1200),
  task("e", "Old one", at(2026, 5, 2)),
];

// --- Search ----------------------------------------------------------------
const q = searchQueryOf("  TYRE ");
check("a search keeps the done tasks that match", JSON.stringify(doneTasksShown(done, q).map((t) => t.id)) === '["a","c"]');
check("no search keeps them all", doneTasksShown(done, "").length === done.length);

// --- The summary -------------------------------------------------------------
const now = new Date(2026, 9, 4, 16); // Sunday 4 October 2026, 16:00
const day = doneStats(done, "day", now, "en");
check("Day counts today", day.count === 2 && day.seconds === 900);
check("and its parts are the hours from 8 to 22", day.bars.length === 15 && day.from === "8:00" && day.to === "22:00");
check("the hour now is the current part", day.bars.findIndex((b) => b.current) === 8);
check("hours to come are faint", day.bars.filter((b) => b.future).length === 6);
const week = doneStats(done, "week", now, "en");
check("Week counts Monday to now", week.count === 3 && week.bars.length === 7 && week.from === "Mon" && week.to === "Sun");
const month = doneStats(done, "month", now, "en");
check("Month counts the month", month.count === 3 && month.bars.length === 31);
check("and the days to come are faint", month.bars.filter((b) => b.future).length === 27);
const all = doneStats(done, "all", now, "en");
check("All counts everything, by month since the first", all.count === 5 && all.bars.length === 6 && all.from === "May" && all.to === "Oct");

report();
