/**
 * A note's words as paragraphs, for the peek at it (lib/todo/notes-text.ts).
 */
import { installDom } from './mounted-dom.mjs';
import { check, suite } from './harness.mjs';
installDom();

suite(async () => {
  const { notesParagraphs } = await import('@/lib/todo/notes-text');
  check('blocks and line breaks make paragraphs',
    JSON.stringify(notesParagraphs('<div>Jane: slide 32.</div><div>Ingrid: had <strong>a few</strong> problems.<br>Next week.</div>')) ===
    JSON.stringify(['Jane: slide 32.', 'Ingrid: had a few problems.', 'Next week.']),
    JSON.stringify(notesParagraphs('<div>Jane: slide 32.</div><div>Ingrid: had <strong>a few</strong> problems.<br>Next week.</div>')));
  check('pictures and empty lines are left out',
    JSON.stringify(notesParagraphs('<div>Before</div><figure><img src="x.png"><figcaption>cap</figcaption></figure><div><br></div><div>After</div>')) ===
    JSON.stringify(['Before', 'After']));
  check('a script is words, never run', notesParagraphs('<script>window.ran = 1</script><div>Safe</div>').join() === 'Safe' && !window.ran);
  check('no note, no paragraphs', notesParagraphs(null).length === 0 && notesParagraphs('').length === 0);
});
