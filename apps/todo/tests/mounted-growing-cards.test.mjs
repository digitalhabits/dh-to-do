/**
 * A long column draws its cards as they come near the screen
 * (GrowingCards): 40 at first, room kept for the rest, and 40 more each
 * time that room comes near. Every task is invented.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  // A stand-in IntersectionObserver: the test says when the room is near.
  const observers = [];
  globalThis.IntersectionObserver = window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.els = []; observers.push(this); }
    observe(el) { this.els.push(el); }
    disconnect() { this.els = []; }
    unobserve() {}
  };
  const watching = () => observers.filter((o) => o.els.length);
  let told = 0;
  /** The room is near: once a column is watching for it, with a watcher
      made since the last time (each growth makes a new one). */
  const near = async (until) => {
    await until(() => observers.length > told && watching().some((o) => observers.indexOf(o) >= told));
    const fresh = watching().filter((o) => observers.indexOf(o) >= told);
    told = observers.length;
    for (const o of fresh) o.callback(o.els.map((target) => ({ target, isIntersecting: true })));
  };
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $$, until } = await import('./page-walk.mjs');
  localStorage.setItem('redd-plan-todo-kanban', '1');
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('todo-shell') ? 1600 : 100; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('todo-shell') ? 900 : 20; } });
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  for (let i = 0; i < 100; i++) {
    await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: `Invented chore ${i}`, isBacklog: true });
  }
  await page.mount();
  const column = () => document.querySelector('.board-column[data-board-column="backlog"] .board-column-tasks');
  const cards = () => (column() ? column().querySelectorAll(':scope > .task-item').length : 0);
  check('a column of 100 draws 40 cards at first', await until(() => cards() === 40), cards());
  check('and keeps room for the rest', Boolean(column()?.querySelector(':scope > .cards-not-drawn')));
  await near(until);
  check('the room coming near draws 40 more', await until(() => cards() === 80), cards());
  await near(until);
  check('and then the last 20, with no room left', await until(() => cards() === 100 && !column().querySelector('.cards-not-drawn')), cards());
  localStorage.removeItem('redd-plan-todo-kanban');
});
