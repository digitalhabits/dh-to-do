/**
 * The anonymous daily usage count (src/usage-ping.ts).
 *
 * When it sends: once per UTC day, on the first of the main window showing
 * at start, the window coming to the front, or the welcome screen being
 * accepted. Only in a store build, after the welcome screen, with the
 * switch on, and with a key it could keep. The hourly timer only retries a
 * failed day, with the same key. fetch, localStorage, the clock and the
 * Tauri window are fakes here.
 */

import { writeUsagePingEnabled } from "@/lib/todo/usage-ping-setting";

import { acceptEula, EULA_KEY } from "../src/eula";
import { resetUsagePingForTests, startUsagePing } from "../src/usage-ping";

import { check, suite } from "./harness.mjs";

const store = new Map();
let storage = "ok"; // or "throws", or "drops" (takes a write and keeps nothing)
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (storage === "throws") throw new Error("QuotaExceededError");
    if (storage === "ok" || k !== "todo_usage_ping") store.set(k, String(v));
  },
  removeItem: (k) => store.delete(k),
};

const sent = [];
let answer = 204;
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), init, body: JSON.parse(init.body) });
  if (answer === "offline") throw new TypeError("Load failed");
  return new Response(null, { status: answer });
};

let now = "2026-10-01T12:00:00Z";
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [now]));
  }
};

/** A fresh main window: a Tauri window that can be focused, and an hourly timer. */
function mainWindow({ shown }) {
  const w = new EventTarget();
  const onFocus = [];
  const hourly = [];
  w.setInterval = (fn) => hourly.push(fn);
  w.__TAURI__ = {
    window: {
      getCurrentWindow: () => ({
        isVisible: async () => shown,
        onFocusChanged: async (fn) => onFocus.push(fn),
      }),
    },
  };
  globalThis.window = w;
  return {
    w,
    focus: (focused = true) => onFocus.forEach((fn) => fn({ payload: focused })),
    hour: () => hourly.forEach((fn) => fn()),
  };
}

/** A new page on `day`: nothing started, nothing sent from it yet. */
function page(day, { shown = false } = {}) {
  now = `${day}T12:00:00Z`;
  resetUsagePingForTests();
  return mainWindow({ shown });
}

const settle = () => new Promise((r) => setTimeout(r, 0));

suite(async () => {
  let win = page("2026-10-01", { shown: true });
  acceptEula();
  startUsagePing(undefined);
  startUsagePing("linux");
  await settle();
  win.focus();
  win.hour();
  await settle();
  check("not a store build: nothing is sent", sent.length === 0, sent.length);
  check("and Settings has no switch to show", win.w.__TODO_USAGE_PING__ === undefined);

  store.delete(EULA_KEY);
  win = page("2026-10-01", { shown: true });
  startUsagePing("mac");
  await settle();
  win.focus();
  win.hour();
  await settle();
  check("a store build, before the welcome screen: nothing is sent", sent.length === 0, sent.length);
  check("but Settings shows the switch", win.w.__TODO_USAGE_PING__ === "mac");
  acceptEula();
  await settle();
  check("accepting the welcome screen sends one count", sent.length === 1, sent.length);
  const body = sent[0].body;
  check(
    "with three things and nothing more: the product, the store, a random key",
    Object.keys(body).sort().join() === "key,platform,product" &&
      body.product === "todo" && body.platform === "mac" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.key),
    JSON.stringify(body)
  );
  check("and no cookies", sent[0].init.credentials === "omit");
  win.focus();
  win.hour();
  await settle();
  check("then focus and the hourly timer the same day send nothing", sent.length === 1, sent.length);

  page("2026-10-01", { shown: true });
  startUsagePing("mac");
  await settle();
  check("a new page the same day sends nothing", sent.length === 1, sent.length);

  win = page("2026-10-02", { shown: true });
  startUsagePing("windows");
  await settle();
  check("the main window showing at start sends one count", sent.length === 2, sent.length);
  check("the platform is the store flag, whatever the user agent", sent[1].body.platform === "windows", sent[1].body.platform);
  check("the same month keeps the key", sent[1].body.key === body.key);

  win = page("2026-10-03");
  startUsagePing("mac");
  await settle();
  win.hour();
  await settle();
  check("a start with the window not showing sends nothing", sent.length === 2, sent.length);
  win.focus(false);
  await settle();
  check("nor does the window losing focus", sent.length === 2, sent.length);
  win.focus();
  win.focus();
  await settle();
  check("bringing it to the front sends one count", sent.length === 3, sent.length);
  now = "2026-10-04T09:00:00Z";
  win.hour();
  await settle();
  check("a window left open into the next day sends nothing on the hour", sent.length === 3, sent.length);
  win.focus();
  await settle();
  check("bringing it to the front that day sends one count", sent.length === 4, sent.length);

  win = page("2026-10-05");
  startUsagePing("mac");
  answer = "offline";
  win.focus();
  await settle();
  answer = 204;
  win.hour();
  await settle();
  check("a failed send is retried on the hour", sent.length === 6, sent.length);
  check("with the same key", sent[5].body.key === sent[4].body.key && sent[5].body.key === body.key);
  win.hour();
  await settle();
  check("and once it went, the hour sends nothing more", sent.length === 6, sent.length);

  win = page("2026-10-06");
  startUsagePing("mac");
  answer = 500;
  win.focus();
  await settle();
  answer = 204;
  resetUsagePingForTests();
  win = mainWindow({ shown: true });
  startUsagePing("mac");
  await settle();
  check("a refused send is sent again from the next page, with the same key", sent.length === 8 && sent[7].body.key === sent[6].body.key, sent.length);

  win = page("2026-11-01");
  startUsagePing("mac");
  storage = "throws";
  win.focus();
  win.hour();
  await settle();
  check("a key that cannot be saved: nothing is sent", sent.length === 8, sent.length);
  storage = "drops";
  win.focus();
  win.hour();
  await settle();
  check("a key the storage does not keep: nothing is sent", sent.length === 8, sent.length);
  storage = "ok";

  writeUsagePingEnabled(false);
  win.focus();
  await settle();
  check("the switch off: nothing is sent", sent.length === 8, sent.length);
  writeUsagePingEnabled(true);
  win.focus();
  await settle();
  check("the switch on again: the next focus sends", sent.length === 9, sent.length);
  check("a new month has a new key", sent[8].body.key !== body.key);
});
