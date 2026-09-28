/**
 * Product version of "Digital Habits: To-Do" — independent of the planner's
 * own version. Shown in the settings modal in both the planner tab and the
 * desktop app. Read from apps/todo/package.json, the file a release bumps,
 * so Settings always shows the version that shipped.
 */
import todoApp from "../../../../../../apps/todo/package.json";

export const TODO_APP_VERSION: string = todoApp.version;
