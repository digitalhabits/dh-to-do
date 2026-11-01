/**
 * Steps due today, on the board: a step due today or before, of a task not
 * in Today, shows as a card of its own at the top of the Today column
 * (lib/todo/step-due.ts). Its tick marks the step done and it goes; a
 * parent in Today keeps its steps to itself. Every list and task is
 * invented.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $$, click, until } = await import('./page-walk.mjs');
  const { todayDueOn } = await import('@/lib/todo/task-draft');
  localStorage.setItem('redd-plan-todo-kanban', '1');
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('todo-shell') ? 1600 : 100; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('todo-shell') ? 900 : 20; } });
  const page = await desktopPage();
  const today = todayDueOn();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  const later = (await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Paint the fence' })).task;
  const now = (await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Sweep the yard', isToday: true })).task;
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, parentTaskId: later.id, text: 'Buy the paint', dueOn: today });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, parentTaskId: later.id, text: 'Sand the boards', dueOn: '2099-01-01' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, parentTaskId: now.id, text: 'Find the broom', dueOn: today });
  await page.mount();
  const stepCards = () => $$('.board-column[data-board-column="today"] .board-column-steps .task-item');
  const words = () => stepCards().map((c) => c.querySelector('.task-text')?.textContent).join(' | ');
  check('a step due today, of a task not in Today, is a card in Today', await until(() => words() === 'Buy the paint'), words());
  check('with its task above its name', stepCards()[0]?.querySelector('.task-step-parent')?.textContent === 'Paint the fence');
  check('and no ⋮, as it has no column or list to move to', !stepCards()[0]?.querySelector('.task-row-more'));
  check('a task in Today keeps its own steps (Find the broom is not a card)', !words().includes('Find the broom'));
  check('the column\'s own list leaves it out', !$$('.board-column[data-board-column="today"] .board-column-tasks .task-item').some((c) => c.textContent.includes('Buy the paint')));
  click(stepCards()[0].querySelector('.task-checkbox'));
  check(
    'its tick marks the step done',
    await until(() => page.board.query('SELECT completed FROM todo_tasks WHERE text = ?', ['Buy the paint'])[0]?.completed === 1)
  );
  check('and it leaves the column', await until(() => stepCards().length === 0), words());
  localStorage.removeItem('redd-plan-todo-kanban');
});
