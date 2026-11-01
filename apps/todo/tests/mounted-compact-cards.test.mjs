/**
 * Cards are Loose by default: a card is its name, then its details under it,
 * at any width. Settings > General > Cards: Compact makes them one line.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, cardOf, click, settle, until } = await import('./page-walk.mjs');
  localStorage.removeItem('redd-plan-todo-compact-cards');
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Oil the hinges' });
  await page.mount();
  await until(() => Boolean(cardOf('Oil the hinges')));
  const shell = () => $('.todo-shell');
  check('cards are not one line unless picked', !shell().classList.contains('todo-cards-one-line'));

  if (!$('#settings-modal')) click($('.title-bar-settings-btn'));
  await until(() => Boolean($('#settings-modal')));
  const option = (name) => [...document.querySelectorAll('#settings-modal [role="radiogroup"] [role="radio"]')].find((b) => b.textContent.trim() === name);
  check('General offers Cards: Loose or Compact, on Loose', option('Loose')?.getAttribute('aria-checked') === 'true' && option('Compact')?.getAttribute('aria-checked') === 'false');
  click(option('Compact'));
  check('Compact makes cards one line', await until(() => shell().classList.contains('todo-cards-one-line')));
  check('and the choice is kept on this device', localStorage.getItem('redd-plan-todo-compact-cards') === '1');
  check('with Compact marked', option('Compact')?.getAttribute('aria-checked') === 'true');
  click(option('Loose'));
  check('Loose makes them two lines again', await until(() => !shell().classList.contains('todo-cards-one-line')));
  localStorage.removeItem('redd-plan-todo-compact-cards');
});
