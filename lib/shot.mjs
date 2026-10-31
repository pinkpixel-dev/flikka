// Screenshots that look good: pick a region or window, then the shot is
// placed on a wallpaper with rounded corners and a shadow, saved, and copied to the clipboard.
// The frame is drawn by the flikka browser (off-screen), so it uses the same backgrounds as the videos.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {outputDir, run, probe} from './common.mjs';
import {backgrounds} from './project.mjs';
import {capturePage} from './render.mjs';

export const shotsDir = path.join(outputDir, 'shots');

async function hasBinary(name) {
  for (const folder of (process.env.PATH || '').split(':').filter(Boolean)) {
    try {
      await fs.access(path.join(folder, name), fs.constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

async function copy(file) {
  if (await hasBinary('wl-copy')) {
    const {spawn} = await import('node:child_process');
    const {createReadStream} = await import('node:fs');
    return new Promise(resolve => {
      const child = spawn('wl-copy', ['--type', 'image/png'], {stdio: ['pipe', 'ignore', 'ignore']});
      child.on('error', () => resolve());
      child.on('close', () => resolve());
      createReadStream(file).pipe(child.stdin);
    });
  }
  if (await hasBinary('xclip')) {
    const {spawn} = await import('node:child_process');
    const child = spawn('xclip', ['-selection', 'clipboard', '-target', 'image/png', '-i', file], {detached: true, stdio: 'ignore'});
    child.unref();
  }
}

// A shot by file name (or path) inside shots/, nothing outside it.
async function findShot(name) {
  const file = path.join(shotsDir, path.basename(String(name || '')));
  if (!/\.png$/i.test(file) || !await fs.access(file).then(() => true, () => false)) throw new Error(`No screenshot ${name} in ${shotsDir}`);
  return file;
}

async function captureInteractive(raw) {
  if (process.env.FLIKKA_SCREENSHOT_CMD) {
    const command = process.env.FLIKKA_SCREENSHOT_CMD.replace(/%o/g, raw);
    await run('sh', ['-c', command]).catch(() => {});
    return fs.access(raw).then(() => true, () => false);
  }

  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();

  // Desktop-specific preferred tools first
  if (desktop.includes('cosmic') || await hasBinary('cosmic-screenshot')) {
    const before = Date.now();
    const stdout = await run('cosmic-screenshot', ['--notify=false']).catch(() => '');
    const candidate = stdout.trim().split('\n').map(s => s.trim()).filter(s => s.endsWith('.png')).pop();
    if (candidate && await fs.access(candidate).then(() => true, () => false)) {
      await fs.copyFile(candidate, raw);
      return true;
    }
    // Fallback: check standard COSMIC screenshot directory if stdout didn't include the path
    const picturesDir = path.join(os.homedir(), 'Pictures/Screenshots');
    const recent = (await fs.readdir(picturesDir).catch(() => []))
      .filter(name => name.endsWith('.png'))
      .map(name => path.join(picturesDir, name));
    for (const file of recent) {
      const stat = await fs.stat(file).catch(() => null);
      if (stat && stat.mtimeMs >= before - 1000) {
        await fs.copyFile(file, raw);
        return true;
      }
    }
    return false;
  }

  if (desktop.includes('kde') || await hasBinary('spectacle')) {
    await run('spectacle', ['-r', '-b', '-n', '-o', raw]).catch(() => {});
    return fs.access(raw).then(() => true, () => false);
  }

  if (desktop.includes('gnome') || await hasBinary('gnome-screenshot')) {
    await run('gnome-screenshot', ['-a', '-f', raw]).catch(() => {});
    return fs.access(raw).then(() => true, () => false);
  }

  if (await hasBinary('slurp') && await hasBinary('grim')) {
    const geometry = (await run('slurp', []).catch(() => '')).trim();
    if (geometry) {
      await run('grim', ['-g', geometry, raw]).catch(() => {});
      return fs.access(raw).then(() => true, () => false);
    }
    return false;
  }

  if (await hasBinary('flameshot')) {
    await run('flameshot', ['gui', '-p', raw]).catch(() => {});
    return fs.access(raw).then(() => true, () => false);
  }

  if (await hasBinary('maim')) {
    await run('maim', ['-s', raw]).catch(() => {});
    return fs.access(raw).then(() => true, () => false);
  }

  throw new Error('No supported screenshot tool found (install cosmic-screenshot, spectacle, gnome-screenshot, flameshot, or grim + slurp, or set FLIKKA_SCREENSHOT_CMD)');
}

// flikka shot [--from image] [--background aurora|<css>] [--plain] [--out file] [--no-copy] | list | copy <file> | remove <file>
export async function shotCommand(args) {
  if (args[0] === 'list') {
    const names = (await fs.readdir(shotsDir).catch(() => [])).filter(name => /\.png$/i.test(name));
    const shots = await Promise.all(names.map(async name => ({name, file: path.join(shotsDir, name), created: (await fs.stat(path.join(shotsDir, name))).mtimeMs})));
    return shots.sort((first, second) => second.created - first.created);
  }
  if (args[0] === 'copy') { const file = await findShot(args[1]); await copy(file); return {copied: file}; }
  if (args[0] === 'remove') {
    const file = await findShot(args[1]);
    if (await hasBinary('gio')) await run('gio', ['trash', file]).catch(() => fs.rm(file));
    else if (await hasBinary('trash')) await run('trash', [file]).catch(() => fs.rm(file));
    else await fs.rm(file);
    return {trashed: file};
  }
  const option = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-shot-'));
  try {
    let raw = option('--from') && path.resolve(option('--from'));
    if (!raw) {
      raw = path.join(work, 'raw.png');
      const captured = await captureInteractive(raw);
      if (!captured || !await fs.access(raw).then(() => true, () => false)) return {cancelled: true};
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const out = path.resolve(option('--out') || path.join(shotsDir, `shot-${stamp}.png`));
    await fs.mkdir(path.dirname(out), {recursive: true});
    if (args.includes('--plain')) await fs.copyFile(raw, out);
    else await frame(raw, out, backgrounds[option('--background')] || option('--background') || backgrounds.aurora, work);
    if (!args.includes('--no-copy')) await copy(out);
    return {output: out, copied: !args.includes('--no-copy')};
  } finally { await fs.rm(work, {recursive: true, force: true}); }
}

async function frame(raw, out, background, work) {
  const video = (await probe(raw)).streams[0];
  const [width, height] = [video.width, video.height];
  // Sizes scale with the shot, so a small region and a full Retina screen look alike.
  const padding = Math.round(Math.max(width, height) * 0.07);
  const radius = Math.max(10, Math.round(Math.min(width, height) * 0.018));
  const shadow = Math.round(padding * 0.5);
  await fs.copyFile(raw, path.join(work, 'shot.png'));
  await fs.writeFile(path.join(work, 'frame.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${width + 2 * padding}px;height:${height + 2 * padding}px;overflow:hidden}
body{background:${background};display:flex;align-items:center;justify-content:center}
img{display:block;width:${width}px;height:${height}px;border-radius:${radius}px;box-shadow:0 ${Math.round(shadow * 0.4)}px ${shadow}px #0009,0 0 0 1px #ffffff1f}
</style></head><body><img src="shot.png"></body></html>`);
  await fs.writeFile(out, await capturePage(`file://${path.join(work, 'frame.html')}`, width + 2 * padding, height + 2 * padding));
}
