/**
 * The icons the board and the add row draw, each as it was drawn when it
 * moved out of TodoPage.tsx. An icon is markup no walk reads, so a change
 * to one would pass every other suite. Each icon's markup is held here by
 * a short hash: a new picture must change the hash here too, on purpose.
 */

import { createHash } from "node:crypto";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as icons from "@/components/todo/task-icons";
import { check, report } from "./harness.mjs";

const DRAWN = {
  ClockIcon: "a05083a04a7b",
  DoneChevron: "3347c0ab0b7b",
  FocusIcon: "115b17bbbf39",
  FocusModeIcon: "10ab80aa5927",
  "FocusModeIcon on": "1b7db52d7abf",
  HeartIcon: "c0bb4b818c75",
  "HeartIcon filled 18": "eacc455a7a44",
  ListsIcon: "2fc9b8ee795e",
  MenuDotsIcon: "c6b2b1163039",
  MoveIcon: "9e47ef2e0910",
  MoveToBottomIcon: "1b623487a460",
  MoveToTopIcon: "dda0437fbcbf",
  NotesIcon: "6082c58bf8be",
  PlanViewIcon: "4d04e18588d1",
  SettingsGearIcon: "aa622e9ea618",
  TrashIcon: "e58bfdedbb3c",
};

const PROPS = {
  "FocusModeIcon on": ["FocusModeIcon", { on: true }],
  FocusModeIcon: ["FocusModeIcon", { on: false }],
  "HeartIcon filled 18": ["HeartIcon", { size: 18, filled: true }],
};

const hash = (markup) => createHash("sha256").update(markup).digest("hex").slice(0, 12);

for (const [name, expected] of Object.entries(DRAWN)) {
  const [component, props] = PROPS[name] ?? [name, {}];
  const Icon = icons[component];
  const markup = Icon ? renderToStaticMarkup(React.createElement(Icon, props)) : "";
  check(`${name} is drawn as before`, markup.startsWith("<svg") && hash(markup) === expected, hash(markup));
}
check("no icon is left out of this list", Object.keys(icons).every((name) => name in DRAWN));
report();
