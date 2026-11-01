/**
 * A change made in task details shows on the task's card at once.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, cardOf, click, editTaskTitle, closeTaskDetails, press, settle, typeInto, until } = await import('./page-walk.mjs');
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Oil the hinges' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Sweep the floor' });
  await page.mount();
  await until(() => Boolean(cardOf('Oil the hinges')));
  const box = await editTaskTitle('Oil the hinges');
  // While the words are typed: the card follows, and only that card is
  // drawn again (TaskCard), not the board.
  const drawn = new Map();
  globalThis.__todoCardDrawn = (id) => drawn.set(id, (drawn.get(id) ?? 0) + 1);
  typeInto(box, 'Oil the ga');
  check('the card shows the words as they are typed', await until(() => Boolean(cardOf('Oil the ga'))));
  const sweep = cardOf('Sweep the floor').getAttribute('data-task-id');
  check('and no other card is drawn again for it', !drawn.has(sweep), JSON.stringify([...drawn]));
  delete globalThis.__todoCardDrawn;
  press(box, 'Escape');
  check('Escape puts the old title back on the card', await until(() => Boolean(cardOf('Oil the hinges'))));
  await settle(300);
  click($('.notes-overlay-title'));
  await until(() => Boolean($('.notes-overlay-title-input')));
  const again = $('.notes-overlay-title-input');
  typeInto(again, 'Oil the gate');
  press(again, 'Enter');
  check('the new title is saved', await until(() => page.board.query('SELECT id FROM todo_tasks WHERE text = ?', ['Oil the gate']).length === 1));
  check('and the card shows it while details are open', await until(() => Boolean(cardOf('Oil the gate'))), [...document.querySelectorAll('.task-item .task-text')].map((e) => e.textContent).join(' | '));
  await closeTaskDetails();
  check('and after they close', Boolean(cardOf('Oil the gate')));
});
