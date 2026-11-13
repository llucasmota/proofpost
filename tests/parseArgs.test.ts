import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, loadContextFiles } from '../src/cli/parseArgs.ts';

test('parseCliArgs', async (t) => {
  await t.test('no args opens the interactive menu', () => {
    assert.deepEqual(parseCliArgs([], {}), { mode: 'interactive' });
  });

  await t.test('positional args are joined into the instruction', () => {
    const r = parseCliArgs(['Explain', 'X'], {});
    assert.equal(r.mode, 'post');
    if (r.mode !== 'post') return;
    assert.equal(r.instruction, 'Explain X');
    assert.equal(r.postType, 'deep');
    assert.deepEqual(r.userContext, []);
    assert.deepEqual(r.contextFiles, []);
  });

  await t.test('CONTEXTO: splits instruction and context; only instruction URLs count', () => {
    const r = parseCliArgs(['Explain https://x.dev/a\nCONTEXTO:\nminhas notas\nhttps://y.dev'], {});
    if (r.mode !== 'post') return assert.fail('expected post');
    assert.equal(r.instruction, 'Explain https://x.dev/a');
    assert.deepEqual(r.userContext, ['minhas notas\nhttps://y.dev']);
    assert.deepEqual(r.urls, ['https://x.dev/a']);
  });

  await t.test('CONTEXT: and lowercase contexto: also split', () => {
    for (const sep of ['CONTEXT:', 'contexto:']) {
      const r = parseCliArgs([`Do it\n${sep}\nnotes`], {});
      if (r.mode !== 'post') return assert.fail('expected post');
      assert.equal(r.instruction, 'Do it');
      assert.deepEqual(r.userContext, ['notes']);
    }
  });

  await t.test('--context is repeatable', () => {
    const r = parseCliArgs(['X', '--context', 'n.md', '--context', 'm.md'], {});
    if (r.mode !== 'post') return assert.fail('expected post');
    assert.deepEqual(r.contextFiles, ['n.md', 'm.md']);
    assert.equal(r.instruction, 'X');
  });

  await t.test('--quick sets the post type', () => {
    const r = parseCliArgs(['X', '--quick'], {});
    if (r.mode !== 'post') return assert.fail('expected post');
    assert.equal(r.postType, 'quick');
  });

  await t.test('--idea N and --ideas-file', () => {
    assert.deepEqual(parseCliArgs(['--idea', '3'], {}), { mode: 'idea', ideaNumber: 3 });
    assert.deepEqual(parseCliArgs(['--idea', '3', '--ideas-file', 'ideas/a.json'], {}), {
      mode: 'idea', ideaNumber: 3, ideasFile: 'ideas/a.json',
    });
  });

  await t.test('--idea with a non-number fails with a message naming --idea', () => {
    assert.throws(() => parseCliArgs(['--idea', 'abc'], {}), /--idea/);
  });

  await t.test('npm fallback when the user forgot "--"', () => {
    assert.deepEqual(parseCliArgs(['3'], { npm_config_idea: 'true' }), { mode: 'idea', ideaNumber: 3 });
    const r = parseCliArgs(['X'], { npm_config_quick: 'true' });
    if (r.mode !== 'post') return assert.fail('expected post');
    assert.equal(r.postType, 'quick');
  });
});

test('loadContextFiles rejects a missing file with its path in the message', async () => {
  await assert.rejects(loadContextFiles(['/nao/existe.md']), /\/nao\/existe\.md/);
});
