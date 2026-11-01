/**
 * With Board View off, the list has its own "⇅" order, as a board column
 * does: manual until another is picked, kept per device.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, $$, cardOf, click, until } = await import('./page-walk.mjs');
  localStorage.removeItem('redd-plan-todo-column-sort-2');
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  // Made in this order; the names run the other way round.
  for (const text of ['Sweep the floor', 'Oil the hinges', 'Mend the gate']) {
    await page.call('/api/todo/tasks', 'POST', { listId: list.id, text });
  }
  await page.mount();
  await until(() => Boolean(cardOf('Mend the gate')));
  const shown = () => $$('.task-item:not(.completed-task) .task-text').map((e) => e.textContent);
  const before = shown().join();

  check('the list has its own order control', Boolean($('.list-sort-bar .board-sort-btn')));
  check('which starts on manual', /manual/i.test($('.list-sort-bar .board-sort-btn').getAttribute('aria-label')), $('.list-sort-bar .board-sort-btn').getAttribute('aria-label'));
  click($('.list-sort-bar .board-sort-btn'));
  await until(() => $$('.board-sort-menu .board-sort-item').length > 0);
  const az = $$('.board-sort-menu .board-sort-item').find((b) => /A.?–?.?Z|alpha|name/i.test(b.textContent));
  check('its menu offers the orders a column has', Boolean(az), $$('.board-sort-menu .board-sort-item').map((b) => b.textContent).join(', '));
  click(az);
  check('picking one reorders the list', await until(() => shown().join() === 'Mend the gate,Oil the hinges,Sweep the floor'), `${before} -> ${shown().join()}`);
  const kept = JSON.parse(localStorage.getItem('redd-plan-todo-column-sort-2') ?? '{}');
  check('and it is kept for the list', kept.list?.sort === 'alpha', JSON.stringify(kept));
  check('not for the board columns', !kept.today || kept.today.sort !== 'alpha', JSON.stringify(kept));
});
