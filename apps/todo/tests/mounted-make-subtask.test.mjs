/**
 * A task's ⋮ menu makes it a subtask of another task: the reverse of a
 * subtask's Convert to task. A search box finds the task to go into.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, $$, cardOf, click, settle, typeInto, until } = await import('./page-walk.mjs');
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  const { task: gate } = await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Mend the gate' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Sweep the floor' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Buy hinges', dueOn: '2030-01-02', notesHtml: '<div>Brass</div>' });
  const { task: shelf } = await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Fix the shelf' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, parentTaskId: shelf.id, text: 'Find screws' });
  await page.mount();
  await until(() => Boolean(cardOf('Buy hinges')));

  const items = () => $$('.task-menu .task-menu-item').map((b) => b.textContent.trim());
  const openMenu = async (words) => {
    click(cardOf(words).querySelector('.task-row-more, .task-menu-btn'));
    return until(() => items().length > 0);
  };
  const rows = (sql, args = []) => page.board.query(sql, args);

  // A task with steps of its own cannot become one: steps have no steps.
  await openMenu('Fix the shelf');
  check('a task with subtasks is not offered it', !items().includes('Make subtask of...'), items().join(', '));
  click(document.body);
  await settle();

  await openMenu('Buy hinges');
  const offer = $$('.task-menu .task-menu-item').find((b) => b.textContent.trim() === 'Make subtask of...');
  check('the ⋮ menu offers Make subtask of...', Boolean(offer), items().join(', '));
  click(offer);
  check('which lists the other open tasks', await until(() => $$('.task-menu .task-parent-item').length === 3), items().join(', '));
  check('but not the task itself', !items().includes('Buy hinges'));
  check('under the list name', $('.task-menu .list-menu-heading')?.textContent === 'Shed');

  const box = $('.task-menu .list-menu-search input');
  check('with a search box', Boolean(box));
  typeInto(box, 'gate');
  check('that keeps the tasks it matches', await until(() => items().join() === 'Mend the gate'), items().join(', '));
  click($$('.task-menu .task-parent-item')[0]);

  check('picking one makes it a subtask there', await until(() => rows('SELECT parent_task_id FROM todo_tasks WHERE text = ?', ['Buy hinges'])[0]?.parent_task_id === gate.id), JSON.stringify(rows('SELECT id, parent_task_id FROM todo_tasks WHERE text = ?', ['Buy hinges'])));
  check('only once: the old task is gone', rows('SELECT id FROM todo_tasks WHERE text = ?', ['Buy hinges']).length === 1);
  const moved = rows('SELECT due_on, notes_html FROM todo_tasks WHERE text = ?', ['Buy hinges'])[0];
  check('keeping its date and notes', moved?.due_on === '2030-01-02' && /Brass/.test(moved?.notes_html ?? ''), JSON.stringify(moved));
  check('and its card leaves the board', await until(() => !cardOf('Buy hinges')));
});
