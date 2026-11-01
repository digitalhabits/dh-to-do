/**
 * Focus mode hides the list tabs and the footer, but the DONE pile stays.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, cardOf, click, until } = await import('./page-walk.mjs');
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  await page.call('/api/todo/lists', 'POST', { name: 'Garden' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Oil the hinges' });
  const { task } = await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Sweep the floor' });
  await page.call('/api/todo/tasks', 'PATCH', { id: task.id, completed: true });
  await page.mount();
  await until(() => Boolean(cardOf('Oil the hinges')));
  check('the DONE pile shows', await until(() => Boolean($('.done-heading'))));

  click($('.title-bar-focus-btn'));
  check('focus mode turns on', await until(() => $('.todo-shell')?.classList.contains('focus-mode')));
  check('and the DONE pile still shows', Boolean($('.done-heading')));
});
