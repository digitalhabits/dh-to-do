/**
 * Board View turned on in Settings: once Settings is closed, a To-Do
 * window too narrow for the columns grows until they stand side by side.
 * Not while Settings is open, and a wide window stays as it is.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, $$, click, installShell, settle, until } = await import('./page-walk.mjs');
  const { settingsSwitch } = await import('./walk-lists.mjs');
  const { BOARD_FIT_WIDTH } = await import('@/components/todo/board-window-fit');

  let shellWidth = 700;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('todo-shell') ? shellWidth : 100; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('todo-shell') ? 800 : 20; } });
  Object.defineProperty(window.screen, 'availWidth', { configurable: true, get: () => 1440 });

  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Oil the hinges' });
  // The window: 700 points wide at x 600, on a 2x screen.
  let position = { x: 1200, y: 200 };
  installShell({
    'plugin:window|inner_size': () => ({ width: shellWidth * 2, height: 1600 }),
    'plugin:window|outer_position': () => position,
    'plugin:window|scale_factor': 2,
  });
  localStorage.setItem('redd-plan-todo-kanban', '0');
  await page.mount();
  await until(() => $$('.task-item').length > 0);

  const sizes = () => page.board.commands.filter((c) => c.command === 'plugin:window|set_size').map((c) => c.args.value.Logical);
  const moves = () => page.board.commands.filter((c) => c.command === 'plugin:window|set_position').map((c) => c.args.value.Logical);
  const flipBoard = async () => {
    if (!$('#settings-modal')) click($('.title-bar-settings-btn'));
    await until(() => Boolean($('#settings-modal')));
    settingsSwitch('Board View').click();
    await settle(150);
  };
  const closeSettings = async () => {
    click($('#settings-modal .settings-sheet-back'));
    await until(() => !$('#settings-modal'));
    await settle(150);
  };

  // On and off again before Settings is closed: nothing changes.
  await flipBoard();
  await flipBoard();
  await closeSettings();
  check('on and off again in Settings leaves the window', sizes().length === 0, JSON.stringify(sizes()));

  await flipBoard();
  check('not while Settings is still open', sizes().length === 0, JSON.stringify(sizes()));
  await closeSettings();
  check('closing Settings with Board View turned on widens a narrow window', await until(() => sizes().length === 1), JSON.stringify(page.board.commands.slice(-5)));
  check('to just past where the columns stand side by side', sizes()[0]?.width === BOARD_FIT_WIDTH, JSON.stringify(sizes()));
  check('keeping its height', sizes()[0]?.height === 800, JSON.stringify(sizes()));
  // 600 + 920 passes the 1440 screen by 80: the window moves left by as much.
  check('and moving it left to stay on the screen', moves()[0]?.x === 520, JSON.stringify(moves()));

  // Off, then on again in a window that is already wide.
  await flipBoard();
  shellWidth = 1200;
  position = { x: 0, y: 0 };
  await flipBoard();
  await closeSettings();
  check('a wide window is left as it is', sizes().length === 1, JSON.stringify(sizes()));
  localStorage.removeItem('redd-plan-todo-kanban');
});
