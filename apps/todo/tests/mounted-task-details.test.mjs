import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, cardOf, click, closeTaskDetails, installFakeTrix, noteEditor, openTaskDetails, press, typeInto, until, writeNote } = await import('./page-walk.mjs');
  installFakeTrix();
  let width = 1400;
  const watchers = new Set();
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { watchers.add(this); }
    disconnect() { watchers.delete(this); }
    unobserve() {}
  };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('todo-shell') ? width : 100; } });
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Review' });
  for (const text of ['First task', 'Second task']) await page.call('/api/todo/tasks', 'POST', { listId: list.id, text });
  const mounted = await page.mount();
  await until(() => Boolean(cardOf('First task')));
  // The row's own ⋮ (shown on hover) is the one menu button a row keeps.
  check('unset action toolbars are absent from list rows', !cardOf('First task').querySelector('.task-utility-pill, .task-menu-btn:not(.task-row-more), .task-chip.is-ghost, .task-expand-btn'));
  const opener = cardOf('First task').querySelector('.task-text');
  opener.focus();
  press(opener, 'Enter');
  await until(() => Boolean($('.task-details-panel')));
  check('task details name the section Subtasks', $('.task-details-subtasks-heading')?.textContent === 'Subtasks');
  check('keyboard opens details beside the list at wide widths', $('.todo-shell').classList.contains('task-details-open') && !$('.todo-shell').classList.contains('task-details-replace'));
  check('board layout uses the width remaining beside details', await until(() => $('.todo-shell').classList.contains('todo-w-stack')));
  const editor = await noteEditor('.notes-overlay-body trix-editor');
  writeNote(editor, '<div>Unsaved work survives resizing</div>');
  $('#normal-mode').scrollTop = 75;
  width = 390;
  for (const watcher of [...watchers]) watcher.callback([]);
  await until(() => $('.todo-shell').classList.contains('task-details-replace'));
  check('narrow details make the list inert', $('#normal-mode').hasAttribute('inert'));
  check('resizing keeps the same live editor', $('.notes-overlay-body trix-editor') === editor && editor.value.includes('Unsaved work'));
  width = 1400;
  for (const watcher of [...watchers]) watcher.callback([]);
  await until(() => !$('.todo-shell').classList.contains('task-details-replace'));
  await openTaskDetails('Second task');
  check('switching tasks saves the old live note', await until(() => page.board.query('SELECT notes_html FROM todo_tasks WHERE text = ?', ['First task'])[0]?.notes_html?.includes('Unsaved work')));
  const second = await noteEditor('.notes-overlay-body trix-editor');
  writeNote(second, '<div>Second task note</div>');
  press($('.task-details-back'), 'Escape');
  check('Escape closes the current task after a switch', await until(() => !$('.task-details-panel')));
  check('Escape saves to the current task', await until(() => page.board.query('SELECT notes_html FROM todo_tasks WHERE text = ?', ['Second task'])[0]?.notes_html?.includes('Second task note')));
  check('focus returns to the task title', await until(() => document.activeElement === cardOf('Second task').querySelector('.task-text')));
  await openTaskDetails('First task');
  await closeTaskDetails();
  check('Back retains the list DOM and scroll position', $('#normal-mode').scrollTop === 75);
  check('closing details restores the full board width', await until(() => !$('.todo-shell').classList.contains('todo-w-stack')));
  // Beside the list, a click on the list's empty space closes details, as
  // Back does; a click on another card opens that one instead.
  await openTaskDetails('First task');
  writeNote(await noteEditor('.notes-overlay-body trix-editor'), '<div>Saved by a click outside</div>');
  click(cardOf('Second task').querySelector('.task-text'));
  check('a click on another card keeps details open, on that card', await until(() => $('.task-details-panel .task-overlay-card')?.getAttribute('aria-label') === 'Second task'));
  await openTaskDetails('First task');
  writeNote(await noteEditor('.notes-overlay-body trix-editor'), '<div>Saved by a click outside</div>');
  click($('.task-area'));
  check("a click on the list's empty space closes details", await until(() => !$('.task-details-panel')));
  check('and saves the note', await until(() => page.board.query('SELECT notes_html FROM todo_tasks WHERE text = ?', ['First task'])[0]?.notes_html?.includes('Saved by a click outside')));
  await openTaskDetails('First task');
  click($('.task-details-panel .task-checkbox'));
  check('ticking it in details cheers, as on its card', document.querySelector('.task-completion-party')?.textContent === '🎉');
  await until(() => Boolean($('.task-details-panel .task-overlay-done-band')));
  const timeButton = Array.from(document.querySelectorAll('.task-details-panel button')).find(button => button.textContent === 'Add time spent');
  check('completed tasks offer time spent inside details', Boolean(timeButton));
  click(timeButton);
  await until(() => Boolean($('.task-details-panel input[aria-label="Time spent"]')));
  const time = $('.task-details-panel input[aria-label="Time spent"]');
  typeInto(time, '25m');
  press(time, 'Enter');
  check('time spent is saved without returning to the list', await until(() => page.board.query('SELECT time_spent_seconds FROM todo_tasks WHERE text = ?', ['First task'])[0]?.time_spent_seconds === 1500));
  // A done task is marked not done by unticking its box: no button for it.
  check('no Mark as not done button', !Array.from(document.querySelectorAll('.task-details-panel button')).some((b) => b.textContent === 'Mark as not done'));
  const tick = $('.task-details-panel .task-overlay-done-mark');
  check('the tick is a ticked box', tick?.getAttribute('role') === 'checkbox' && tick.getAttribute('aria-checked') === 'true');
  click(tick);
  check('unticking it marks the task not done', await until(() => page.board.query('SELECT completed FROM todo_tasks WHERE text = ?', ['First task'])[0]?.completed === 0));
  check('and the box shows unticked', await until(() => !$('.task-details-panel .task-overlay-done-band') && Boolean($('.task-details-panel .task-checkbox'))));
  mounted.unmount();
});
