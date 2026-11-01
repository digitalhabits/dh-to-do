/**
 * A subtask's ⋮ menu in task details: Move to top and Move to bottom where
 * they apply, Convert to task, and Delete.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, $$, cardOf, click, openTaskDetails, settle, until } = await import('./page-walk.mjs');
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  const { task: parent } = await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Mend the gate' });
  for (const text of ['Buy hinges', 'Oil the latch', 'Paint the posts']) {
    await page.call('/api/todo/tasks', 'POST', { listId: list.id, parentTaskId: parent.id, text });
  }
  await page.mount();
  await until(() => Boolean(cardOf('Mend the gate')));
  await openTaskDetails('Mend the gate');
  await until(() => $$('.task-subtask-row[data-subtask-id]').length === 3);

  const rowOf = (words) => $$('.task-subtask-row[data-subtask-id]').find((r) => r.querySelector('textarea')?.value === words);
  const shown = () => $$('.task-subtask-row[data-subtask-id] textarea').map((t) => t.value);
  const items = () => $$('.task-menu .task-menu-item').map((b) => b.textContent.trim());
  const openMenu = async (words) => {
    click(rowOf(words).querySelector('.task-subtask-more'));
    return until(() => items().length > 0);
  };
  const choose = (label) => click($$('.task-menu .task-menu-item').find((b) => b.textContent.trim() === label));

  check('a subtask has no × of its own', !$('.task-subtask-row[data-subtask-id] .task-subtask-delete'));
  check('the ⋮ opens its menu', await openMenu('Buy hinges'));
  check('the first offers Move to bottom, not to top', items().includes('Move to bottom') && !items().includes('Move to top'), items().join(', '));
  check('and Convert to task and Delete', items().includes('Convert to task') && items().includes('Delete'), items().join(', '));
  choose('Move to bottom');
  check('Move to bottom puts it last', await until(() => shown().join() === 'Oil the latch,Paint the posts,Buy hinges'), shown().join());

  await openMenu('Buy hinges');
  check('the last offers Move to top, not to bottom', items().includes('Move to top') && !items().includes('Move to bottom'), items().join(', '));
  choose('Move to top');
  check('Move to top puts it first', await until(() => shown().join() === 'Buy hinges,Oil the latch,Paint the posts'), shown().join());

  await openMenu('Oil the latch');
  check('a middle one offers both moves', items().includes('Move to top') && items().includes('Move to bottom'), items().join(', '));
  choose('Convert to task');
  const row = (words) => page.board.query('SELECT id, parent_task_id, list_id FROM todo_tasks WHERE text = ?', [words]);
  check('Convert to task makes a task of it', await until(() => row('Oil the latch').length === 1 && row('Oil the latch')[0].parent_task_id === null), JSON.stringify(row('Oil the latch')));
  check('on the parent\'s list', row('Oil the latch')[0]?.list_id === list.id);
  check('and the subtask is gone', await until(() => shown().join() === 'Buy hinges,Paint the posts'), shown().join());
  await settle();
  check('with no Undo for the delete half of it', !$('.undo-toast'));

  await openMenu('Paint the posts');
  choose('Delete');
  check('Delete takes it away', await until(() => row('Paint the posts').length === 0 && shown().join() === 'Buy hinges'), shown().join());
});
