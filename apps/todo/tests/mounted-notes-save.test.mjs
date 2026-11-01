/**
 * Closing task details saves the notes only when they changed.
 *
 * A save of the same words was a write and a redraw on every close.
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { desktopPage } = await import('./desktop-page.mjs');
  const { $, closeTaskDetails, installFakeTrix, noteEditor, openTaskDetails, settle, until, writeNote } = await import('./page-walk.mjs');
  installFakeTrix();
  const page = await desktopPage();
  const { list } = await page.call('/api/todo/lists', 'POST', { name: 'Shed' });
  const { task } = await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Oil the hinges' });
  await page.call('/api/todo/tasks', 'PATCH', { id: task.id, notesHtml: '<div>Use the thin oil</div>' });
  await page.call('/api/todo/tasks', 'POST', { listId: list.id, text: 'Sweep the floor' });
  await page.mount();
  await until(() => Boolean($('.task-item')));

  // Every SQL statement the store sends, as the fake board answers it.
  const sent = [];
  const bridge = window.__TAURI_INTERNALS__;
  const answer = bridge.invoke;
  bridge.invoke = (command, args = {}) => {
    if (command === 'todo_sql_query') sent.push(args.statement.sql);
    if (command === 'todo_sql_batch') for (const st of args.statements) sent.push(st.sql);
    return answer(command, args);
  };
  const noteWrites = () => sent.filter((sql) => /UPDATE\s+todo_tasks/i.test(sql) && /notes_html/i.test(sql)).length;
  const notesOf = (words) => page.board.query('SELECT notes_html FROM todo_tasks WHERE text = ?', [words])[0]?.notes_html ?? null;

  let before = noteWrites();
  await openTaskDetails('Oil the hinges');
  await noteEditor('.notes-overlay-body trix-editor');
  await closeTaskDetails();
  await settle();
  check('closing with the notes unchanged writes nothing', noteWrites() === before, `${noteWrites() - before} writes`);
  check('and the notes are as they were', notesOf('Oil the hinges') === '<div>Use the thin oil</div>', notesOf('Oil the hinges'));

  before = noteWrites();
  await openTaskDetails('Sweep the floor');
  await noteEditor('.notes-overlay-body trix-editor');
  await closeTaskDetails();
  await settle();
  check('closing a task with no notes, still none, writes nothing', noteWrites() === before, `${noteWrites() - before} writes`);

  before = noteWrites();
  await openTaskDetails('Oil the hinges');
  writeNote(await noteEditor('.notes-overlay-body trix-editor'), '<div>Use the thick oil</div>');
  await closeTaskDetails();
  check('changed notes are still saved on close', await until(() => notesOf('Oil the hinges')?.includes('thick oil')), notesOf('Oil the hinges'));
  check('with one write', noteWrites() === before + 1, `${noteWrites() - before} writes`);
});
