// Compositions: a folder HyperFrames can render, a player can play and a headless Chrome can take stills of.
// index.html (the stage, the props, the page script), preview.html (the same, with the HyperFrames runtime,
// which the producer adds by itself when it renders), flikka.js (render/ bundled with esbuild) and media/
// (links to the recordings, images and sounds the props point to).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {root, cacheDir, launch, trace} from './common.mjs';
import {assetServer} from './render.mjs';

// A file next to a package's main script (both packages keep theirs in dist/).
const besideMain = (name, file) => path.join(path.dirname(fileURLToPath(import.meta.resolve(name))), file);
export const runtimeScript = besideMain('@hyperframes/core', 'hyperframe.runtime.iife.js');
export const playerScript = besideMain('@hyperframes/player', 'hyperframes-player.global.js');
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const exists = file => fs.access(file).then(() => true, () => false);

// The page script: render/ plus a film's custom scenes ("flikka" = render/kit.jsx), once per version of them.
// customs: [{name, file}].
export async function bundle(customs = []) {
  const digest = createHash('sha256').update(await fs.readFile(path.join(root, 'package-lock.json')));
  for (const name of (await fs.readdir(path.join(root, 'render'))).sort()) digest.update(name).update(await fs.readFile(path.join(root, 'render', name)));
  for (const item of customs) digest.update(item.name).update(await fs.readFile(item.file));
  const key = digest.digest('hex').slice(0, 16);
  const folder = path.join(cacheDir, 'bundles');
  const output = path.join(folder, `${key}.js`);
  if (!await exists(output)) {
    await fs.mkdir(folder, {recursive: true});
    // Imports run first, in order: the scenes are registered before start() draws the first frame.
    const entry = path.join(folder, `entry-${key}.jsx`);
    await fs.writeFile(entry, [
      `import {registerScene} from ${JSON.stringify(path.join(root, 'render/film.jsx'))};`,
      `import {start} from ${JSON.stringify(path.join(root, 'render/index.jsx'))};`,
      ...customs.map((item, index) => `import Scene${index} from ${JSON.stringify(item.file)};`),
      ...customs.map((item, index) => `registerScene(${JSON.stringify(item.name)}, Scene${index});`),
      'start();', ''].join('\n'));
    const {build} = await import('esbuild');
    await build({entryPoints: [entry], bundle: true, minify: true, format: 'iife', jsx: 'automatic', loader: {'.jsx': 'jsx', '.js': 'jsx'},
      define: {'process.env.NODE_ENV': '"production"'}, alias: {flikka: path.join(root, 'render/kit.jsx')}, nodePaths: [path.join(root, 'node_modules')],
      outfile: output, logLevel: 'silent'});
    await fs.rm(entry, {force: true});
  }
  // Forget bundles not used for two weeks.
  const now = new Date();
  await fs.utimes(output, now, now);
  for (const name of await fs.readdir(folder)) {
    const old = path.join(folder, name);
    if (now - (await fs.stat(old)).mtimeMs > 14 * 864e5) await fs.rm(old, {force: true});
  }
  return output;
}

// A composition folder (a fresh one in the cache, or `folder` emptied). url(file) links a file into media/ and
// returns the address the page loads it from; write() then writes the pages.
export async function workspace(folder) {
  if (folder) { await fs.rm(folder, {recursive: true, force: true}); await fs.mkdir(folder, {recursive: true}); }
  else { await fs.mkdir(path.join(cacheDir, 'compose'), {recursive: true}); folder = await fs.mkdtemp(path.join(cacheDir, 'compose', 'job-')); }
  const media = path.join(folder, 'media');
  await fs.mkdir(media);
  const linked = new Map();
  const linking = [];
  return {
    folder,
    url(file) {
      file = path.resolve(file);
      if (!linked.has(file)) {
        const name = `${hash(file)}${path.extname(file).toLowerCase()}`;
        linked.set(file, `media/${name}`);
        // Linked, not copied: recordings are big. HyperFrames follows the link.
        linking.push(fs.symlink(file, path.join(media, name)).catch(error => { if (error.code !== 'EEXIST') throw error; }));
      }
      return linked.get(file);
    },
    // kind: 'demo' or 'film'; config: {fps, width, height, durationInFrames}.
    async write({kind, props, config, customs = [], fontUrl}) {
      await Promise.all(linking);
      await fs.copyFile(await bundle(customs), path.join(folder, 'flikka.js'));
      await fs.copyFile(runtimeScript, path.join(folder, 'runtime.js'));
      const {width, height, fps, durationInFrames} = config;
      const data = JSON.stringify({kind, props, config}).replace(/</g, '\\u003c');
      const page = runtime => `<!doctype html>
<html><head><meta charset="utf-8">
${fontUrl ? `<link rel="stylesheet" href="${fontUrl.replace(/"/g, '&quot;')}">` : ''}
<style>*{box-sizing:border-box}html,body{margin:0;background:#000}#stage{position:relative;overflow:hidden;width:${width}px;height:${height}px}#app{position:absolute;inset:0}</style>
${runtime ? '<script src="runtime.js"></script>' : ''}
</head><body>
<div id="stage" data-composition-id="flikka" data-start="0" data-width="${width}" data-height="${height}" data-duration="${durationInFrames / fps}"><div id="app"></div></div>
<script>window.FLIKKA = ${data}</script>
<script src="flikka.js"></script>
</body></html>
`;
      await fs.writeFile(path.join(folder, 'index.html'), page(false));
      await fs.writeFile(path.join(folder, 'preview.html'), page(true));
      return folder;
    },
    // Every file of the folder by its address, for a server (assetServer's map, or the panel's).
    async files(prefix = '') {
      const found = new Map();
      for (const name of await fs.readdir(folder, {recursive: true})) {
        const file = path.join(folder, name);
        if ((await fs.stat(file).catch(() => null))?.isFile()) found.set(`${prefix}/${name}`, file);
      }
      return found;
    },
    remove: () => fs.rm(folder, {recursive: true, force: true}),
  };
}

// The headless Chrome that renders and takes stills: HyperFrames' own, else Puppeteer's, else downloaded once
// (into HyperFrames' folder, where its renderer looks too).
let chromePath;
export async function chrome() {
  if (chromePath) return chromePath;
  const {resolveHeadlessShellPath} = await import('@hyperframes/engine');
  chromePath = resolveHeadlessShellPath({});
  if (!chromePath) {
    console.error('flikka: downloading the headless Chrome renderer, once');
    const {install, resolveBuildId, detectBrowserPlatform, Browser} = await import('@puppeteer/browsers');
    const platform = detectBrowserPlatform();
    const buildId = await resolveBuildId(Browser.CHROMEHEADLESSSHELL, platform, 'stable');
    trace('render', `downloading chrome-headless-shell ${buildId}`);
    chromePath = (await install({browser: Browser.CHROMEHEADLESSSHELL, buildId, platform, cacheDir: path.join(os.homedir(), '.cache/hyperframes/chrome')})).executablePath;
  }
  // The producer looks for it by itself; this makes sure it uses the same one.
  process.env.HYPERFRAMES_BROWSER_PATH = chromePath;
  return chromePath;
}

// A headless Chrome for `work(at)`, `at` being its debugging address; closed afterwards.
export async function headless(work) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-page-'));
  const {child} = launch(await chrome(), ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank']);
  try {
    let port;
    for (let tries = 0; !port && tries < 100; tries++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
    }
    if (!port) throw new Error('The headless Chrome did not start');
    return await work(`http://127.0.0.1:${port}`);
  } finally { child.kill(); await fs.rm(profile, {recursive: true, force: true, maxRetries: 5}); }
}

// Stills of a written composition: shots [{time, output}] (seconds, PNG file). query: added to the page's
// address (?stamp for frame sheets). layout: also measure each shot's layout (render/film.jsx layoutIssues).
// Returns the layout issues of each shot.
export async function stills(space, {width, height}, shots, {query = '', layout = false} = {}) {
  const {server, origin} = await assetServer(await space.files());
  try {
    const {withPage} = await import('./browser.mjs');
    return await headless(at => withPage(at, `${origin}/preview.html${query}`, width, height, async page => {
        // Wait for the runtime, the fonts and the media.
        for (let tries = 0; !await page.evaluate('Boolean(window.__renderReady && window.__player)') && tries < 300; tries++) await new Promise(resolve => setTimeout(resolve, 100));
        const found = [];
        for (const shot of shots) {
          found.push(await page.evaluate(`(async () => {
            await window.__player.renderSeek(${Number(shot.time)});
            await window.__hfWaitForSeekCompletion?.();
            await document.fonts.ready;
            await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
            return ${layout ? 'window.flikkaLayout()' : 'null'};
          })()`));
          await fs.writeFile(shot.output, await page.screenshot());
        }
        return found;
      }));
  } finally { server.closeAllConnections(); server.close(); }
}

// A written composition to an MP4 without sound (flikka mixes the sound itself). progress(0…1).
export async function renderVideo(space, output, {fps, crf, progress = () => {}}) {
  await chrome();
  const {createRenderJob, executeRenderJob} = await import('@hyperframes/producer');
  const log = level => message => trace('render', `${level} ${message}`);
  const logger = {error: log('error'), warn: log('warn'), info: log('info'), debug: () => {}, isLevelEnabled: level => level !== 'debug'};
  // PNG frames from the recordings: screen text stays sharp (JPEG blurs it).
  const job = createRenderJob({fps, quality: 'high', ...(crf && {crf}), videoFrameFormat: 'png', logger});
  await executeRenderJob(job, space.folder, output, current => progress(Math.min(1, (current.progress || 0) / 100)));
}
