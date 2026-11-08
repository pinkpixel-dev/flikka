// Settings: the defaults (videos and screenshots in the desktop's own folders), a saved setting over that, an
// environment variable over both, every module sees a change at once, and bad values are refused with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('folders come from the environment, then settings, then the desktop folders', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-home-'));
  Object.assign(process.env, {HOME: home, XDG_CONFIG_HOME: path.join(home, '.config')});
  for (const name of Object.keys(process.env).filter(name => name.startsWith('FLIKKA_'))) delete process.env[name];
  await fs.mkdir(path.join(home, '.config'), {recursive: true});
  // A renamed Videos folder, and Pictures turned off (pointing at home).
  await fs.writeFile(path.join(home, '.config/user-dirs.dirs'), 'XDG_VIDEOS_DIR="$HOME/Vidéos"\nXDG_PICTURES_DIR="$HOME/"\n');
  try {
    const common = await import('../lib/common.mjs');
    const {setSetting, allSettings} = await import('../lib/settings.mjs');
    assert.equal(common.videosDir, path.join(home, 'Vidéos/flikka'));
    assert.equal(common.shotsDir, path.join(home, 'Pictures/flikka'));
    assert.equal(common.projectsDir, path.join(home, '.flikka/projects'));

    await assert.rejects(setSetting('videos', 'relative/demos'), /full path/);
    await assert.rejects(setSetting('music', '~/x'), /No setting "music"/);
    const saved = await setSetting('videos', '~/demos');
    assert.equal(saved.from, 'settings');
    assert.equal(saved.value, path.join(home, 'demos'));
    assert.equal(saved.moved.from, path.join(home, 'Vidéos/flikka'));
    // The live binding moved with it, and the folder exists.
    assert.equal(common.videosDir, path.join(home, 'demos'));
    await fs.access(path.join(home, 'demos'));

    process.env.FLIKKA_DIR = path.join(home, 'from-env');
    const overridden = await setSetting('screenshots', '~/shots');
    assert.equal(allSettings().settings.find(item => item.key === 'videos').from, 'env');
    assert.equal(overridden.from, 'settings');
    delete process.env.FLIKKA_DIR;

    await setSetting('videos', null);
    assert.equal(common.videosDir, path.join(home, 'Vidéos/flikka'));
    assert.deepEqual(JSON.parse(await fs.readFile(common.settingsFile, 'utf8')), {screenshots: path.join(home, 'shots')});

    // The other kinds: each checked, saved, and read back through setting().
    assert.equal(common.setting('voice'), 'af_heart');
    await assert.rejects(setSetting('voice', 'Nobody Here'), /There's no voice "Nobody Here"/);
    await assert.rejects(setSetting('voice', 'xx_madeup'), /There's no voice "xx_madeup"/);
    // The voices folder is back now that your own voices speak.
    assert.equal((await setSetting('voices', '~/v')).value, path.join(home, 'v'));
    assert.equal(common.voicesDir, path.join(home, 'v'));
    await setSetting('voices', null);
    await setSetting('voice', 'am_michael');
    assert.equal(common.setting('voice'), 'am_michael');
    await assert.rejects(setSetting('whisper-model', 'enormous'), /Pick one of tiny/);
    await assert.rejects(setSetting('panel-port', '80'), /1024 to 65535/);
    assert.equal((await setSetting('panel-port', '9400')).value, 9400);
    await assert.rejects(setSetting('screenshot-command', 'grim out.png'), /%o/);
    await assert.rejects(setSetting('browser', '/no/such/browser'), /isn't a program/);
    await setSetting('browser', 'brave');
    process.env.FLIKKA_DEFAULT_VOICE = 'bf_emma';
    common.loadSettings();
    assert.equal(common.setting('voice'), 'bf_emma');
    delete process.env.FLIKKA_DEFAULT_VOICE;
    await setSetting('voice', '');
    assert.equal(common.setting('voice'), 'af_heart');
  } finally { await fs.rm(home, {recursive: true, force: true}); }
});
