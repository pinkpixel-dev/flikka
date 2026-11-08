// Where files go: the desktop's own folders by default, a saved setting over that, an environment variable over
// both, and every module sees a change at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('folders come from the environment, then settings, then the desktop folders', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-home-'));
  Object.assign(process.env, {HOME: home, XDG_CONFIG_HOME: path.join(home, '.config')});
  for (const name of ['FLIKKA_VIDEOS', 'FLIKKA_DIR', 'FLIKKA_SCREENSHOTS', 'FLIKKA_PROJECTS', 'FLIKKA_VOICES', 'FLIKKA_STYLES']) delete process.env[name];
  await fs.mkdir(path.join(home, '.config'), {recursive: true});
  // A renamed Videos folder, and Pictures turned off (pointing at home).
  await fs.writeFile(path.join(home, '.config/user-dirs.dirs'), 'XDG_VIDEOS_DIR="$HOME/Vidéos"\nXDG_PICTURES_DIR="$HOME/"\n');
  try {
    const common = await import('../lib/common.mjs');
    const {setFolder, folderSettings} = await import('../lib/settings.mjs');
    assert.equal(common.videosDir, path.join(home, 'Vidéos/flikka'));
    assert.equal(common.shotsDir, path.join(home, 'Pictures/flikka'));
    assert.equal(common.projectsDir, path.join(home, '.flikka/projects'));

    await assert.rejects(setFolder('videos', 'relative/demos'), /full path/);
    await assert.rejects(setFolder('music', '~/x'), /No setting "music"/);
    const saved = await setFolder('videos', '~/demos');
    assert.equal(saved.from, 'settings');
    assert.equal(saved.moved.from, path.join(home, 'Vidéos/flikka'));
    // The live binding moved with it, and the folder exists.
    assert.equal(common.videosDir, path.join(home, 'demos'));
    await fs.access(path.join(home, 'demos'));

    process.env.FLIKKA_DIR = path.join(home, 'from-env');
    const overridden = await setFolder('screenshots', '~/shots');
    assert.equal(folderSettings().folders.find(item => item.key === 'videos').from, 'env');
    assert.equal(overridden.from, 'settings');
    delete process.env.FLIKKA_DIR;

    await setFolder('videos', null);
    assert.equal(common.videosDir, path.join(home, 'Vidéos/flikka'));
    assert.deepEqual(JSON.parse(await fs.readFile(common.settingsFile, 'utf8')), {folders: {screenshots: path.join(home, 'shots')}});
  } finally { await fs.rm(home, {recursive: true, force: true}); }
});
