import test from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { buildLaunchAgentPlist, DEFAULT_SCHEDULE, LABEL } from '../scripts/ideasSchedule.ts';

const nodePath = '/Users/me/.nvm/versions/node/v24.15.0/bin/node';
const base = { label: LABEL, nodePath, projectDir: '/Users/me/content builder', logDir: '/Users/me/content builder/ideas/logs', schedule: DEFAULT_SCHEDULE };

function parse(xml: string) {
  return new XMLParser({ ignoreAttributes: false }).parse(xml);
}

test('buildLaunchAgentPlist', async (t) => {
  const xml = buildLaunchAgentPlist(base);

  await t.test('is a valid plist with one calendar entry per slot (Mon/Wed/Fri 08:00)', () => {
    const doc = parse(xml);
    assert.ok(doc.plist);
    assert.equal(DEFAULT_SCHEDULE.length, 3);
    assert.deepEqual(DEFAULT_SCHEDULE.map((s) => s.weekday), [1, 3, 5]);
    assert.ok(DEFAULT_SCHEDULE.every((s) => s.hour === 8 && s.minute === 0));
    assert.equal((xml.match(/<key>Weekday<\/key>/g) ?? []).length, 3);
    assert.match(xml, /<key>StartCalendarInterval<\/key>\s*<array>/);
  });

  await t.test('runs the absolute node path first, with tsx and the project .env', () => {
    const args = [...xml.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    const i = args.indexOf(nodePath);
    assert.ok(i >= 0);
    assert.deepEqual(args.slice(i, i + 6), [
      nodePath, '--env-file', '/Users/me/content builder/.env', '--import', 'tsx', '/Users/me/content builder/src/discovery/cli.ts',
    ]);
  });

  await t.test('PATH starts with the node directory (launchd does not load the shell PATH)', () => {
    assert.match(xml, /<key>PATH<\/key>\s*<string>\/Users\/me\/\.nvm\/versions\/node\/v24\.15\.0\/bin:/);
  });

  await t.test('paths with spaces are kept verbatim and & is escaped', () => {
    assert.ok(xml.includes('<string>/Users/me/content builder</string>'));
    const amp = buildLaunchAgentPlist({ ...base, projectDir: '/tmp/a&b' });
    assert.ok(amp.includes('/tmp/a&amp;b'));
    assert.ok(!amp.includes('/tmp/a&b'));
  });

  await t.test('logs go to <logDir>/ideas.log', () => {
    assert.match(xml, /<key>StandardOutPath<\/key>\s*<string>\/Users\/me\/content builder\/ideas\/logs\/ideas\.log<\/string>/);
  });
});
