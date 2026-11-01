/**
 * The line between the list and task details changes their width: by the
 * arrow keys here (a drag needs real layout, so it is checked in a
 * browser). The width is kept per device, and a double-click forgets it.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, cardOf, click, closeTaskDetails, openTaskDetails, press, until } = await import('./page-walk.mjs');
  // A wide app, so details stand beside the list.
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('todo-shell') ? 1400 : 100; } });
  // This page has Board View off: details stand beside a list, which has
  // its own kept width and opens at half the app (details-width.ts).
  localStorage.removeItem('redd-plan-todo-details-width-list');
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Oil the hinges' });
  await page.mount();
  await until(() => Boolean(cardOf('Oil the hinges')));

  const width = () => $('.todo-shell').style.getPropertyValue('--task-details-width');
  const stored = () => localStorage.getItem('redd-plan-todo-details-width-list');
  await openTaskDetails('Oil the hinges');
  const line = $('.task-details-resizer');
  check('details beside the list have a line to drag', Boolean(line) && line.getAttribute('role') === 'separator');
  check('at half the app first, beside a list', width() === '700px', width());
  press(line, 'ArrowLeft');
  check('the left arrow makes details wider', await until(() => width() === '724px'), width());
  check('and the width is kept on this device', stored() === '724', stored());
  check('for the list only, not Board View', localStorage.getItem('redd-plan-todo-details-width') === null);
  press($('.task-details-resizer'), 'ArrowRight');
  press($('.task-details-resizer'), 'ArrowRight');
  check('the right arrow makes them narrower, a step each press', await until(() => width() === '676px'), width());
  await closeTaskDetails();
  check('closed details leave the list its whole width', width() === '');
  await openTaskDetails('Oil the hinges');
  check('details open again at the kept width', width() === '676px', width());
  $('.task-details-resizer').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  check('a double-click goes back to the standard width', await until(() => width() === '700px'), width());
  check('and forgets the kept one', stored() === null, stored());
  await closeTaskDetails();
});
