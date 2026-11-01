/**
 * Board View: a task's ⋮ menu moves it to another column, as a drag does.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, $$, click, until } = await import('./page-walk.mjs');
  localStorage.setItem('redd-plan-todo-kanban', '1');
  // A wide app, so every column is drawn side by side.
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('todo-shell') ? 1600 : 100; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('todo-shell') ? 900 : 20; } });
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Oil the hinges', isBacklog: true });
  await page.mount();
  const cardIn = (col, words) => $$(`.board-column[data-board-column="${col}"] .task-item`).find((c) => c.querySelector('.task-text')?.textContent === words);
  await until(() => $$('.board-column').length > 0);
  check('the task starts in Backlog', await until(() => Boolean(cardIn('backlog', 'Oil the hinges'))));
  const items = () => $$('.task-menu .task-menu-item').map((b) => b.textContent.trim());
  click(cardIn('backlog', 'Oil the hinges').querySelector('.task-row-more'));
  await until(() => items().length > 0);
  const offer = $$('.task-menu .task-menu-item').find((b) => b.textContent.startsWith('Move to column...'));
  check('the ⋮ menu offers Move to column...', Boolean(offer), items().join(', '));
  check('naming the column it is in', offer?.querySelector('.task-menu-item-aside')?.textContent.length > 0, offer?.textContent);
  click(offer);
  check('which lists the columns', await until(() => $$('.task-menu .board-sort-item').length >= 3), items().join(', '));
  check('with its own ticked', $('.task-menu .board-sort-item.is-current')?.getAttribute('aria-checked') === 'true');
  // Today is listed first, as the nearest.
  const today = $$('.task-menu .board-sort-item')[0];
  click(today);
  check('picking one moves the task there', await until(() => page.board.query('SELECT is_today, is_backlog FROM todo_tasks WHERE text = ?', ['Oil the hinges'])[0]?.is_today === 1), JSON.stringify(page.board.query('SELECT is_today, is_backlog FROM todo_tasks WHERE text = ?', ['Oil the hinges'])));
  check('and the card is drawn in it', await until(() => Boolean(cardIn('today', 'Oil the hinges'))));
  localStorage.removeItem('redd-plan-todo-kanban');
});
