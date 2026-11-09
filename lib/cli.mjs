import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {helpText, isGroup, hasAction} from './help.mjs';
import {root, flikkaHome, projectsDir, setting, build, run, readJSON, writeJSON, request, sleep, trace, traceFile, stepLog, python} from './common.mjs';

// Old commands (before record / project / app) still work: the panel calls some of them.
const moved = {
  start: rest => ['record', ...rest],
  ...Object.fromEntries(['stop', 'pause', 'resume', 'status', 'mark', 'sources'].map(name => [name, rest => ['record', name, ...rest]])),
  ...Object.fromEntries(['edit', 'render', 'preview', 'captions', 'frames', 'check', 'schema', 'styles'].map(name => [name, rest => ['project', name, ...rest]])),
  film: rest => ['project', rest.includes('--live') ? 'live' : rest.includes('--preview') ? 'preview' : 'render', ...rest.filter(item => !['--live', '--preview'].includes(item))],
  browser: rest => ['record', ...(!rest[0] || rest[0].startsWith('--') || /^(https?|file):/.test(rest[0]) ? ['open'] : []), ...rest],
  terminal: rest => ['record', ...(['open', 'close'].includes(rest[0]) ? [rest[0], 'terminal', ...rest.slice(1)] : rest)],
  ui: rest => ['app', 'panel', ...rest], install: rest => ['app', 'install', ...rest], update: rest => ['app', 'update', ...rest], uninstall: rest => ['app', 'uninstall', ...rest], doctor: rest => ['app', 'doctor', ...rest],
};
let [command = 'help', ...args] = process.argv.slice(2);
if (moved[command]) [command, ...args] = moved[command](args);
const [action, ...rest] = args;
if (command !== 'help') trace('cli', [command, ...args].join(' '));
const print = value => console.log(JSON.stringify(value, null, 2));
const latestFile = path.join(projectsDir, 'latest.json');
const value = (list, name) => list.includes(name) ? list[list.indexOf(name) + 1] : undefined;

function captureOptions(values) {
  const capture = {display: 0, microphone: null, systemAudio: false, cursorVisible: false, fps: 60, maxWidth: 2560};
  let name = 'rec';
  let countdown = 0;
  const then = {};
  for (let index = 0; index < values.length; index++) {
    const option = values[index];
    if (option === '--no-mic') capture.microphone = null;
    else if (option === '--system-audio') capture.systemAudio = true;
    else if (option === '--no-zoom') capture.noZoom = true;
    else if (option === '--no-cursor' || option === '--hide-cursor') capture.noCursor = true;
    else if (option === '--native-cursor') capture.cursorVisible = true;
    else if (option === '--browser') capture.browser = {tab: values[index + 1] && !values[index + 1].startsWith('--') ? values[++index] : null};
    else if (option === '--terminal') capture.browser = {terminal: true};
    else {
      const value = values[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
      if (option === '--display') capture.display = Number(value);
      else if (option === '--display-id') capture.displayID = Number(value);
      else if (option === '--window') capture.window = /^\d+$/.test(value) ? Number(value) : value;
      else if (option === '--region') capture.region = value.split(',').map(Number);
      else if (option === '--mic') capture.microphone = value;
      else if (option === '--camera') capture.camera = value;
      else if (option === '--fps') capture.fps = Number(value);
      else if (option === '--max-width') capture.maxWidth = Number(value);
      else if (option === '--name') name = value;
      else if (option === '--countdown') countdown = Number(value);
      else if (option === '--url') then.url = value;
      else if (option === '--run') then.run = value;
      else if (option === '--for') then.seconds = Number(value);
      else if (option === '--hide') ((capture.mask ||= {hide: [], blur: []}).hide).push(value);
      else if (option === '--blur') { new RegExp(value); ((capture.mask ||= {hide: [], blur: []}).blur).push(value); }
      else throw new Error(`Unknown capture option: ${option}`);
    }
  }
  if (!/^[\w -]{1,80}$/.test(name)) throw new Error('Name must contain 1–80 letters, numbers, spaces, underscores or hyphens');
  if (![24, 30, 60].includes(capture.fps)) throw new Error('FPS must be 24, 30 or 60');
  if (!Number.isInteger(capture.display) || capture.display < 0) throw new Error('Display index must be a nonnegative integer');
  if (capture.window !== undefined && typeof capture.window === 'number' && (!Number.isInteger(capture.window) || capture.window < 1)) throw new Error('Window ID must be a positive integer');
  if (!Number.isInteger(capture.maxWidth) || capture.maxWidth < 320 || capture.maxWidth > 7680) throw new Error('Maximum width must be 320–7680');
  if (capture.region && (capture.region.length !== 4 || !capture.region.every(Number.isFinite))) throw new Error('Region must be x,y,width,height');
  if (!Number.isFinite(countdown) || countdown < 0 || countdown > 30) throw new Error('Countdown must be 0–30 seconds');
  if (capture.browser) {
    if (capture.camera) throw new Error('--browser does not support --camera yet');
    if (!values.includes('--max-width')) capture.maxWidth = 3840;
  }
  if ((then.url || then.run) && !capture.browser) throw new Error('--url and --run need --browser');
  if (then.seconds !== undefined && !(then.seconds > 0 && then.seconds <= 3600)) throw new Error('--for must be 1–3600 seconds');
  return {capture, name, countdown, then};
}

async function getSession(id) {
  if (!id) ({id} = await readJSON(latestFile));
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid session ID');
  return readJSON(path.join(projectsDir, id, 'session.json'));
}

async function start(values) {
  // ponytail: the trace keeps one old file; 5 MB is weeks of recordings.
  await fs.stat(traceFile).then(stat => stat.size > 5e6 && fs.rename(traceFile, traceFile.replace(/\.log$/, '.old.log')), () => {});
  const {capture, name, countdown, then} = captureOptions(values);
  // Scripted captures are timed on purpose (waiting can be the point): no idle cuts.
  if (then.seconds) capture.scripted = true;
  // A terminal recording is a browser recording of the flikka terminal's page. Its pauses
  // are reading time (no idle cuts) and it has no mouse (no pointer drawn).
  if (capture.browser?.terminal) {
    Object.assign(capture, {scripted: true, terminal: true});
    const terminal = await readJSON(path.join(flikkaHome, 'terminal.json')).catch(() => { throw new Error('Open the terminal first: flikka record open terminal'); });
    capture.browser = {tab: `127.0.0.1:${terminal.port}`};
  }
  if (then.url) await (await import('./browser.mjs')).browserCommand(['open', then.url]);
  const state = await startSession(capture, name, countdown);
  // One step for agents: run a trigger in the page, wait, stop, return the saved recording.
  if (then.run) await (await import('./browser.mjs')).browserCommand(['eval', then.run]);
  if (!then.seconds) return state;
  await sleep(then.seconds * 1000);
  const saved = await request(await getSession(state.id), 'stop');
  return {...saved, token: undefined};
}

async function startSession(capture, name, countdown) {
  trace('cli', `start, ${(performance.now() / 1000).toFixed(2)} s after node began`);
  const binary = process.execPath;
  const binaryArgs = capture.browser
    ? [path.join(root, 'lib/browser.mjs'), 'record']
    : [path.join(root, 'lib/screen.mjs'), 'record'];
  // A short id the user can hand to an agent ("edit project 3f9a1c2e"); every file of the recording lives in its folder.
  const id = randomUUID().slice(0, 8);
  trace('cli', `${id} recorder ready (${path.basename(binary)}), starting the session`);
  const directory = path.join(projectsDir, id);
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  const output = path.join(directory, 'recording.mp4');
  const configFile = path.join(directory, 'config.json');
  await writeJSON(configFile, {id, name, output, capture, binary, binaryArgs, requested: performance.timeOrigin / 1000});
  if (countdown) { console.error(`Recording begins in ${countdown} seconds`); await sleep(countdown * 1000); }
  const log = await fs.open(path.join(directory, 'worker.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'lib/session.mjs'), configFile], {detached: true, stdio: ['ignore', log.fd, log.fd]});
  child.unref(); await log.close();
  const deadline = Date.now() + 50000;
  while (Date.now() < deadline) {
    const state = await readJSON(path.join(directory, 'session.json')).catch(() => null);
    if (state?.state === 'error') { trace('cli', `${id} failed: ${state.error}`); throw new Error(state.error); }
    if (state?.state === 'recording') {
      trace('cli', `${id} recording, ${(performance.now() / 1000).toFixed(2)} s after node began`);
      await writeJSON(latestFile, {id});
      return {...state, token: undefined};
    }
    await sleep(100);
  }
  trace('cli', `${id} gave up waiting`);
  throw new Error(`Recording startup timed out; inspect ${directory}`);
}

const browserActions = ['open', 'look', 'click', 'type', 'paste', 'key', 'wait', 'scroll', 'hover', 'drag', 'select', 'upload', 'go', 'back', 'forward', 'tabs', 'switch', 'shot', 'mask', 'eval'];
const terminalOptions = ['--blur', '--color', '--cwd', '--title', '--font-size'];

// flikka record <place> [value] [options]: the place becomes the capture options start() reads.
async function record() {
  const values = [...rest];
  const next = () => values[0] && !values[0].startsWith('--') ? values.shift() : undefined;
  if (action === 'screen') return start(['--display', next() ?? '0', ...values]);
  if (action === 'window') {
    const where = next();
    return start(['--window', where || 'portal', ...values]);
  }
  if (action === 'region') {
    let where = next();
    if (!where) {
      const {run} = await import('./common.mjs');
      const geometry = (await run('slurp', ['-f', '%x,%y,%w,%h']).catch(() => '')).trim();
      if (!geometry) throw new Error('Region selection cancelled');
      where = geometry;
    }
    return start(['--region', where, ...values]);
  }
  if (action === 'browser') { const url = next(); return start(['--browser', ...(url ? ['--url', url] : []), ...values]); }
  if (action === 'terminal') {
    // Its own options open a fresh terminal; otherwise the open one is recorded (or a new one opened).
    const own = values.flatMap((item, index) => terminalOptions.includes(item) ? [item, values[index + 1]] : []);
    const others = values.filter((item, index) => !terminalOptions.includes(item) && !terminalOptions.includes(values[index - 1]));
    const {terminalCommand, terminalState} = await import('./terminal.mjs');
    if (own.length || !await terminalState()) await terminalCommand(['open', ...own]);
    return start(['--terminal', ...others]);
  }
  // The panel passes the capture options itself.
  if (!action || action.startsWith('--')) return start(args);
  throw new Error(`Unknown: flikka record ${action}. Every action: flikka record help`);
}

async function project() {
  const projects = await import('./project.mjs');
  if (action === 'list') return projects.listProjects();
  if (action === 'new') return projects.newFilm(rest.filter((item, index) => item !== '--with' && rest[index - 1] !== '--with').join(' '), value(rest, '--with')?.split(',') || []);
  if (action === 'schema') { const {schemaFile} = await import('./film.mjs'); return rest.includes('--path') ? schemaFile : JSON.parse(await fs.readFile(schemaFile, 'utf8')); }
  if (action === 'styles') return (await import('./style.mjs')).listStyles();
  if (!rest[0]) throw new Error(`Usage: flikka project ${action || '<command>'} <id> (flikka project ${action} help)`);
  if (action === 'rename') return projects.renameProject((await projects.openProject(rest[0])).id, rest.slice(1).join(' '));
  if (action === 'remove') return projects.removeProject((await projects.openProject(rest[0])).id);
  const found = await projects.openProject(rest[0]);
  const options = rest.slice(1);
  const film = found.kind === 'film';
  const only = kind => { if (found.kind !== kind) throw new Error(`flikka project ${action} is for a ${kind}; ${rest[0]} is a ${found.kind}${film ? ': edit its film.json, ' + found.file : ''}`); };
  if (action === 'show') return found.id ? {...await projects.describeProject(found.id), folder: found.folder} : found;
  if (action === 'edit') { only('recording'); return projects.editProject(found.file, options); }
  if (action === 'timeline') { only('recording'); return projects.timelineProject(found.file); }
  if (action === 'check' && !film) return projects.checkRecording(found.file, {line: value(options, '--line') || null});
  // A film's sentences outside a render: --scene and --sentence count from 1.
  const sentenceOptions = () => ({scene: value(options, '--scene') ? Number(value(options, '--scene')) : undefined, sentence: value(options, '--sentence') ? Number(value(options, '--sentence')) : undefined});
  if (action === 'check' && film && options.includes('--lines')) return (await import('./film.mjs')).checkFilmLines(found.file, sentenceOptions());
  if (action === 'speak' && film) return (await import('./film.mjs')).speakFilm(found.file, {...sentenceOptions(), again: options.includes('--again')});
  if (action === 'fit') { only('recording'); return projects.fitProject(found.file, {line: value(options, '--line') || null}); }
  if (action === 'speak') { only('recording'); return projects.speakProject(found.file, {line: value(options, '--line') || null, again: options.includes('--again')}); }
  if (action === 'undo') return film ? (await import('./film.mjs')).undoFilm(found.file) : projects.undoProject(found.file);
  if (action === 'frames' && !film) {
    // Frames of the finished edit, in its own seconds (what flikka project timeline shows).
    const {seconds} = await import('../render/timing.js');
    const time = name => value(options, name) !== undefined ? seconds(value(options, name)) : undefined;
    return (await import('./render.mjs')).renderProjectFrames(found.file, {from: time('--from'), to: time('--to'), every: time('--every'),
      at: value(options, '--at')?.split(',').map(seconds), output: value(options, '--out') && path.resolve(value(options, '--out'))});
  }
  if (action === 'captions') {
    only('recording');
    const {directory, project: loaded} = await projects.loadProject(found.file);
    const input = path.resolve(directory, loaded.source), base = path.basename(input, path.extname(input));
    const outJson = path.join(path.dirname(input), `${base}.json`);
    await (await import('./voice.mjs')).transcribeAudio(input, outJson, setting('whisper-model'));
    return {transcript: outJson};
  }
  // The project's finished video, for export and poster.
  const finishedVideo = async () => {
    const video = film ? (await (await import('./film.mjs')).filmOutput(found.file)).output : (await readJSON(found.file.replace(/\.project\.json$/, '.render.json')).catch(() => ({}))).output;
    if (!video || !await fs.access(video).then(() => true, () => false)) throw new Error(`Render it first: flikka project render ${rest[0]}`);
    return video;
  };
  if (action === 'export') {
    const {seconds} = await import('../render/timing.js');
    const time = name => value(options, name) !== undefined ? seconds(value(options, name)) : undefined;
    return (await import('./export.mjs')).exportVideo(await finishedVideo(), {format: value(options, '--format'), width: Number(value(options, '--width')) || undefined,
      fps: Number(value(options, '--fps')) || undefined, from: time('--from'), to: time('--to'), output: value(options, '--out')});
  }
  if (action === 'poster') {
    const {seconds} = await import('../render/timing.js');
    const intro = film ? 0 : (await projects.loadProject(found.file)).project.intro?.duration || 0;
    return (await import('./export.mjs')).posterFrame(await finishedVideo(), {at: value(options, '--at') !== undefined ? seconds(value(options, '--at')) : undefined, intro, output: value(options, '--out')});
  }
  if (action === 'render' && !film && (options.includes('--presets') || options.includes('--transparent'))) {
    // Variants: each shape as its own file, or one without a backdrop. The project's own video stays as it is.
    const {renderProject} = await import('./render.mjs');
    if (options.includes('--transparent')) {
      const kind = value(options, '--transparent');
      return renderProject(found.file, {transparent: kind === 'mov' ? 'mov' : 'webm', output: value(options, '--out')});
    }
    const names = String(value(options, '--presets') || '').split(',').filter(Boolean);
    if (!names.length || names.some(name => !projects.presets[name])) throw new Error(`--presets takes a list of ${Object.keys(projects.presets).join(', ')}`);
    const results = [];
    for (const preset of names) results.push(await renderProject(found.file, {size: projects.presets[preset], preset}));
    return results;
  }
  if (action === 'render' || action === 'preview') {
    const output = value(options, '--out');
    if (!film) {
      const settings = action === 'preview' ? {frame: Number(value(options, '--frame') || 0), output: output || found.file.replace(/\.json$/, '.preview.png')} : {output};
      return (await import('./render.mjs')).renderProject(found.file, settings);
    }
    const make = progress => import('./film.mjs').then(({renderFilm}) => renderFilm(found.file, {preview: action === 'preview', output, check: !options.includes('--no-check'), progress}));
    if (action === 'preview' || !found.id || output) return make();
    // The panel shows the render running, and the finished video.
    return stepLog(found.folder, 'render')('Render the film', async update => projects.publishFilm(found.id, await make(update)));
  }
  only('film');
  // The film in the panel: live preview, scene strip and editor.
  if (action === 'live') {
    if (!found.id) throw new Error(`flikka project live opens a film in the panel, which shows Flikka's own projects (flikka project new). For ${found.file}, use flikka project preview or render`);
    return (await import('./ui.mjs')).serveUI({open: !options.includes('--no-open'), project: found.id});
  }
  if (action === 'frames') {
    const number = name => value(options, name) && Number(value(options, name));
    const frames = {scene: number('--scene'), from: number('--from'), to: number('--to'), every: number('--every'), at: value(options, '--at')?.split(',').map(Number), output: value(options, '--out') && path.resolve(value(options, '--out'))};
    return (await import('./film.mjs')).renderFilm(found.file, {frames});
  }
  if (action === 'check') {
    const {output} = await (await import('./film.mjs')).filmOutput(found.file);
    const report = await readJSON(`${output}.report.json`).catch(() => { throw new Error(`Render it first: flikka project render ${rest[0]}`); });
    return (await import('./check.mjs')).checkFilm(report);
  }
  throw new Error(`Unknown: flikka project ${action}. Every action: flikka project help`);
}

try {
  // flikka help [command [action]], flikka <command> help, flikka <command> <action> help (or --help, -h).
  const asking = list => list.length === 1 && list[0] === 'help' || list.includes('--help') || list.includes('-h');
  if (['help', '--help', '-h'].includes(command)) console.log(helpText(args[0], args[1]));
  else if (['version', '--version', '-v'].includes(command)) {
    const pkg = await readJSON(path.join(root, 'package.json'));
    console.log(pkg.version);
  }
  else if (isGroup(command) && (asking(args) || asking(rest))) console.log(helpText(command, hasAction(command, action) && asking(rest) ? action : undefined));
  else if (command === 'record') {
    if (!action) console.log(helpText('record'));
    else if (action === 'sources') {
      const {getSources} = await import('./screen.mjs');
      print(await getSources());
    }
    else if (['status', 'stop', 'pause', 'resume'].includes(action)) {
      const state = await getSession(rest[0]);
      if (state.state === 'error') throw new Error(`Recording failed: ${state.error}. Partial files: ${path.join(projectsDir, state.id)}`);
      if (state.state === 'saved') print({...state, token: undefined});
      else print(await request(state, action));
    } else if (action === 'mark') {
      const [label, ...options] = rest;
      let id; const body = {label};
      for (let index = 0; index < options.length; index += 2) {
        if (options[index] === '--id') id = options[index + 1];
        else if (options[index] === '--at') [body.x, body.y] = options[index + 1].split(',').map(Number);
        else if (options[index] === '--page') body.page = options[index + 1].split(',').map(Number);
        else throw new Error(`Unknown marker option: ${options[index]}`);
      }
      print(await request(await getSession(id), 'mark', body));
    } else if (action === 'open' && rest[0] === 'terminal') print(await (await import('./terminal.mjs')).terminalCommand(['open', ...rest.slice(1)]));
    else if (action === 'close' && rest[0] === 'terminal') print(await (await import('./terminal.mjs')).terminalCommand(['close']));
    else if (action === 'run' || action === 'send') print(await (await import('./terminal.mjs')).terminalCommand(args));
    else if (browserActions.includes(action)) print(await (await import('./browser.mjs')).browserCommand(args));
    else print(await record());
  } else if (command === 'project') {
    if (!action) console.log(helpText('project'));
    else if (action === 'live') await project();
    else print(await project());
  } else if (command === 'app') {
    if (action === 'install') print(await (await import('./app.mjs')).installCommand(rest));
    else if (action === 'uninstall') print(await (await import('./app.mjs')).uninstallCommand());
    else if (action === 'skills') print(await (await import('./app.mjs')).skillsCommand(rest));
    else if (action === 'update') print(await (await import('./app.mjs')).updateCommand());
    else if (action === 'config') print(await (await import('./settings.mjs')).configCommand(rest));
    else if (action === 'doctor') print(await (await import('./doctor.mjs')).doctorCommand());
    else if (action === 'panel') await (await import('./ui.mjs')).serveUI({open: !rest.includes('--no-open'), project: value(rest, '--project') || null, shots: rest.includes('--shots')});
    else console.log(helpText('app'));
  } else if (command === 'shot') print(await (await import('./shot.mjs')).shotCommand(args));
  else if (command === 'voice') print(await (await import('./voice.mjs')).voiceCommand(args));
  else throw new Error(`Unknown command: ${command}. Every command: flikka help`);
} catch (error) { console.error(JSON.stringify({error: error.message})); process.exitCode = 1; }
