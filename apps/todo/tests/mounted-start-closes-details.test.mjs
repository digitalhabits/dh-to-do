/**
 * Start, with a task's details open: the details are put away (their note
 * saved) and the Today session shows, not the details full-screen over it.
 * Then a name in the session, or a click anywhere on its card off a
 * control, opens its details over the whole app.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, $$, click, until } = await import('./page-walk.mjs');
  localStorage.setItem('redd-plan-todo-kanban', '1');
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('todo-shell') ? 1600 : 100; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('todo-shell') ? 900 : 20; } });
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Oil the hinges', isToday: true });
  await page.mount();
  const card = () => $$('.board-column[data-board-column="today"] .task-item').find((c) => c.querySelector('.task-text')?.textContent === 'Oil the hinges');
  await until(() => Boolean(card()));
  click(card().querySelector('.task-text'));
  check('details open', await until(() => Boolean($('.task-details-panel'))));
  click($('.board-start-btn'));
  check('Start opens the Today session', await until(() => Boolean($('.today-session'))));
  check('and puts the details away', !$('.task-details-panel'));
  // A task's name in the session opens its details over the whole app,
  // even a wide one; Back is the way back to the session.
  click($('.today-session-now-title'));
  check('a name in the session opens its details', await until(() => Boolean($('.task-details-panel'))));
  check('over the whole app', $('.todo-shell').classList.contains('task-details-replace') && Boolean($('.today-session')));
  // Anywhere on the card that is not a control opens them too; a control
  // does its own thing.
  click($('.task-details-back'));
  check('Back closes them', await until(() => !$('.task-details-panel')));
  click($('.today-session-pause'));
  await new Promise((r) => setTimeout(r, 100));
  check('Pause does not open details', !$('.task-details-panel'));
  click($('.today-session-now-actions'));
  check('a click on the card, off its controls, opens details', await until(() => Boolean($('.task-details-panel'))));
  localStorage.removeItem('redd-plan-todo-kanban');
});
