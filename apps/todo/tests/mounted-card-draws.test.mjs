/**
 * A change to one card draws that card again, not the whole board.
 *
 * Cards are memoised (TaskCard in todo-task-card.tsx). React leaves the DOM
 * in place either way, so the drawings are counted through a hook the card
 * calls when one is set.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, cardOf, click, until, settle } = await import('./page-walk.mjs');
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  const words = ['Oil the hinges', 'Sweep the floor', 'Sort the screws', 'Paint the door'];
  for (const text of words) {
    const { task } = await page.call('/api/todo/tasks', 'POST', { listId: list.id, text });
    await page.call('/api/todo/tasks', 'PATCH', { id: task.id, dueOn: '2030-01-01' });
  }
  await page.mount();
  await until(() => words.every((w) => cardOf(w)));
  await settle();

  const drawn = new Map();
  globalThis.__todoCardDrawn = (id) => drawn.set(id, (drawn.get(id) ?? 0) + 1);
  const idOf = (w) => cardOf(w).getAttribute('data-task-id') ?? cardOf(w).closest('[data-task-id]')?.getAttribute('data-task-id');

  click(cardOf('Sweep the floor').querySelector('.task-chip-due'));
  check('the date picker opens on one card', await until(() => Boolean($('.due-popover'))));
  await settle();
  const others = words.filter((w) => w !== 'Sweep the floor');
  check('that card is drawn again', (drawn.get(idOf('Sweep the floor')) ?? 0) > 0, JSON.stringify([...drawn]));
  check('the other cards are not', others.every((w) => !drawn.has(idOf(w))), JSON.stringify([...drawn]));

  drawn.clear();
  click(cardOf('Sweep the floor').querySelector('.task-chip-due'));
  check('a second click on the chip closes the picker', await until(() => !$('.due-popover')));
  await settle();
  check('closing it leaves the other cards alone too', others.every((w) => !drawn.has(idOf(w))), JSON.stringify([...drawn]));
  const chip = () => cardOf('Sweep the floor').querySelector('.task-chip-due');
  check('and that card shows it closed, not a stale open chip', chip().getAttribute('aria-expanded') === 'false' && !cardOf('Sweep the floor').classList.contains('has-open-menu'), chip().outerHTML.slice(0, 160));

  // A change every card shows still reaches every card.
  drawn.clear();
  click(cardOf('Oil the hinges').querySelector('.task-checkbox'));
  check('a tick is saved', await until(() => page.board.query('SELECT completed FROM todo_tasks WHERE text = ?', ['Oil the hinges'])[0]?.completed === 1));
  await settle();
  check('the ticked card is drawn again', drawn.size > 0, JSON.stringify([...drawn]));
  delete globalThis.__todoCardDrawn;
});
