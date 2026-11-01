/**
 * A task row's ⋮: Move to top and Move to bottom where they apply,
 * Change list..., and Delete.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $$, cardOf, click, until } = await import('./page-walk.mjs');
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  await page.call('/api/todo/lists', 'POST', { name: 'Garden' });
  for (const text of ['Oil the hinges', 'Sweep the floor', 'Sort the screws']) {
    await page.call('/api/todo/tasks', 'POST', { listId: list.id, text });
  }
  await page.mount();
  await until(() => Boolean(cardOf('Sort the screws')));
  const items = () => $$('.task-menu .task-menu-item').map((b) => b.textContent.trim());
  const openMenu = async (words) => {
    click(cardOf(words).querySelector('.task-row-more'));
    return until(() => items().length > 0);
  };
  check('a task row has a ⋮', Boolean(cardOf('Sweep the floor').querySelector('.task-row-more')));
  check('it opens the task menu', await openMenu('Sweep the floor'));
  check('with Change list... and Delete', items().includes('Change list...') && items().includes('Delete'), items().join(', '));
  check('and not what details offer (notes, time, favourite)', !items().some((i) => /note|time|favourite/i.test(i)), items().join(', '));
  click($$('.task-menu .task-menu-item').find((b) => b.textContent.trim() === 'Delete'));
  check('Delete takes the task away', await until(() => !page.board.query('SELECT id FROM todo_tasks WHERE text = ?', ['Sweep the floor']).length));
});
