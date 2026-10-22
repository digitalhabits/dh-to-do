/**
 * A task made public on GitHub asks for its list's sync at once.
 *
 * The issue was made only at the next sync, up to ten minutes on, so the
 * menu said "Public on GitHub: on" with no issue number and the card had
 * no GitHub mark (2026-10-19). Now the menu item, once the task is saved,
 * tells the sync to run for that list. Renders the real menu item.
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

suite(async () => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { TaskGithubItem, GITHUB_PUBLISH_EVENT } = await import("@/components/todo/task-github-item");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const list = { id: "list-1", name: "Tools", githubRepo: "example-org/example-repo" };
  const heard = [];
  window.addEventListener(GITHUB_PUBLISH_EVENT, (e) => heard.push(e.detail));
  const saved = [];

  async function press(task) {
    heard.length = 0;
    saved.length = 0;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      React.createElement(TaskGithubItem, {
        task,
        list,
        t: (key) => key,
        mutateTask: async (id, patch) => {
          await sleep(20);
          saved.push({ id, patch });
        },
        closeMenu: () => {},
      })
    );
    await sleep(30);
    host.querySelector("button").click();
    await sleep(80);
    root.unmount();
    host.remove();
  }

  await press({ id: "t1", text: "A task", parentTaskId: null, githubPublic: false });
  check("making it public saves it", saved.length === 1 && saved[0].patch.githubPublic === true, JSON.stringify(saved));
  check("and asks for its list's sync after the save", heard.length === 1 && heard[0].listId === "list-1", JSON.stringify(heard));

  await press({ id: "t1", text: "A task", parentTaskId: null, githubPublic: true });
  check("turning it off asks for no sync", heard.length === 0, JSON.stringify(heard));
});
