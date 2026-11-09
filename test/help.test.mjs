// The help: every command and action has a page, the overview lists every action, and the CLI finds each page
// however it's asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {helpText, actionNames} from '../lib/help.mjs';

const groups = ['record', 'project', 'shot', 'voice', 'app'];
const cli = (...args) => execFileSync(process.execPath, [new URL('../lib/cli.mjs', import.meta.url).pathname, ...args], {encoding: 'utf8'});

test('every action has a page, listed in the overview and on its command page', () => {
  const overview = helpText();
  for (const group of groups) {
    const page = helpText(group);
    assert.ok(actionNames(group).length > 0);
    for (const name of actionNames(group)) {
      const own = helpText(group, name);
      assert.match(own, new RegExp(`^flikka ${group} `));
      assert.ok(page.includes(own.split('\n')[0]), `${group} ${name} is on the ${group} page`);
      if (name !== 'take') assert.match(overview, new RegExp(`\\n  ${name} +`), `${group} ${name} is in the overview`);
    }
    assert.doesNotMatch(page, /\{(actions|edit|take|config)\}/);
  }
});

test('unknown commands and actions say where to look', () => {
  assert.throws(() => helpText('nope'), /Commands: record/);
  assert.throws(() => helpText('record', 'nope'), /Actions: screen/);
});

test('the CLI finds each page however it is asked for', () => {
  assert.equal(cli('help'), cli('--help'));
  assert.equal(cli('record', 'help'), cli('help', 'record'));
  assert.equal(cli('record', 'click', 'help'), cli('help', 'record', 'click'));
  assert.equal(cli('project', 'edit', 'some-id', '--help'), cli('project', 'edit', '-h'));
  assert.equal(cli('app', 'doctor', '--help'), cli('doctor', '--help'));
  assert.match(cli('shot', '--help'), /^flikka shot - /);
});
