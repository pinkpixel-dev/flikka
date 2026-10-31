import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {root, outputDir, projectsDir, build, run, readJSON, writeJSON, request, sleep, trace, traceFile, stepLog, python} from './common.mjs';

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

const helps = {
  help: `🎬 flikka - record your screen, then let an agent edit it. Every command prints JSON.

  flikka record    make a video: the screen, a window, the flikka browser or a terminal, and act in it
  flikka project   what you made: list, edit, render. A project is one recording or a film of many scenes
  flikka shot      framed screenshots
  flikka voice     your own voices, for narration
  flikka app       the review panel

  flikka <word> help    each one in full, with examples. This help is the documentation: read it first.

How it fits: \`record … stop\` makes a project and prints its id. Recordings are cut (idle time) and zoomed (on
clicks) when they stop, so \`flikka project render <id>\` already gives a good video. A film is a project too: its
film.json lists scenes (recordings, titles, pictures, numbers) with narration. Projects live in
~/.flikka/projects/<id>/, finished videos in ~/Documents/flikka/<name>-<id>.mp4. The user watches it all in the panel
and names projects by id ("edit project 3f9a1c2e: …").

Before saying done: look at 2–3 frames of the result; when someone talked, check the sound
(ffmpeg -i <video> -vn -af volumedetect -f null - → mean_volume well above -60 dB). Report the video's path.
Every flikka process logs what it does, with times, to ~/.flikka/trace.log.
`,
  record: `flikka record - make a video. Each recording becomes a project: stop prints its id.

Start one (the options below work with each):
  flikka record screen [index]          a whole display (flikka record sources lists displays, windows, mics, cameras)
  flikka record window <id>             one window; keep it visible, a covered window stops updating
  flikka record region x,y,w,h          part of a display, in points
  flikka record browser [url]           the flikka browser: a copy of your browser with your logins, recorded inside the page,
                                      so it records fine while covered. The best way for an agent to record itself
  flikka record terminal [--blur re]    your own shell in the flikka browser; --blur hides matching text (API keys),
                                      --color 'word=#5bb0ff,#22d3c5' paints a word (a brand) in one color or a gradient

  --name <name>   --mic <name|default>   --system-audio (the browser: only its sound)   --camera <name|default>
  --fps 24|30|60  --countdown <s>   --no-zoom (no zoom on clicks)   --no-cursor (hide mouse pointer)   --max-width <px>   --native-cursor
  browser only:   --hide <text> (hides the row holding it)  --blur <regex>  (both repeatable)
                  --run <js> --for <s> (one step: run a trigger, record s seconds, stop)

While it records:
  flikka record stop | pause | resume | status [id]
  flikka record mark <label> [--at x,y]     a moment to zoom on (x,y from 0 to 1); browser clicks mark themselves

Act in the flikka browser. It all works without recording too, to set a page up first.
The mouse glides and text is typed like a person, so the video looks real:
  flikka record open <url>                  a new tab (starts the browser; --refresh-login copies your logins again)
  flikka record look                        the page's buttons, links and fields, numbered, and its text
  flikka record click <target>              target = a number from look, visible text, or a CSS selector
  flikka record type [<target>] "text"      click a field, replace what it holds, type (\\n = new line)
  flikka record paste [<target>] "text"     long text at once, like Ctrl+V
  flikka record key Enter                   Enter Tab Escape Backspace Space ArrowUp/Down/Left/Right
  flikka record wait "text" [--gone] [--timeout s]   until the text (or a CSS selector) shows up, or goes
  flikka record scroll [px] | hover <target> | drag <from> <to> | select <target> <option> | upload <file> [<target>]
  flikka record go <url> | back | forward | tabs | switch <tab> | shot [file.png] | eval <js>
  flikka record mask --hide <text> --blur <regex>   hide things on the page (before a shot)

Act in the terminal:
  flikka record open terminal [--blur re] [--cwd dir] [--title t]   (record terminal opens it too)
  flikka record run "<command>" [--timeout s]   types it key by key, waits, returns output and exit code
  flikka record send "text"                 types into what runs now, no wait; \n = Enter
  flikka record close terminal

Rules:
  - An agent records itself in the flikka browser (record browser), never the user's own browser. It starts with the
    user's logins. When a site still asks to log in, ask the user to do it in the flikka browser's window (never
    type a password yourself): the flikka browser keeps it. open --refresh-login copies their logins again.
  - Look before you act: look, then click or type by number. After an action that loads something, wait "text",
    not sleep. Numbers expire when the page changes: look again.
  - Look like a person: viewers spot an agent at once (text that appears without typing, a jumping mouse, a page
    that snaps). Act only with click/type/paste/scroll/select/drag, never with eval. Short text: type; long: paste.
    Give the viewer a beat (sleep 1) after each result.
  - Keep secrets out: --hide/--blur when starting, mask before a shot. Terminal: --blur, and pass keys through the
    environment, never type them.
  - Screen and window recordings show the real screen: anything on it ends up in the video.

Example:
  flikka record browser https://en.wikipedia.org --name wiki
  flikka record look; flikka record type 3 "Clapperboard"; flikka record key Enter; flikka record wait "Clapperboard"
  flikka record stop                        → {"id": "3f9a1c2e", …}: flikka project render 3f9a1c2e
`,
  project: `flikka project - what you made. A project is a video: one recording, or a film of many scenes
(recordings, titles, pictures, numbers) narrated in a voice. Give a project by id or by name (newest wins).

  flikka project list                        every project, newest first
  flikka project show <id>                   its kind, files and finished video
  flikka project render <id> [--out file]    the finished video, checked → ~/Documents/flikka/<name>-<id>.mp4
    --presets square,vertical,landscape (each shape as its own file)   --transparent [webm|mov] (no backdrop, alpha channel)
  flikka project export <id> --format gif|webm [--width px] [--fps n] [--from s --to s]   from the finished video
  flikka project poster <id> [--at s] [--out file.jpg|png]   a still of the finished video, for a thumbnail
  flikka project preview <id> [--frame n]    a recording: one frame. A film: a picture per scene + a layout check
  flikka project rename <id> <name> | remove <id>   (remove moves it to the Trash)

A recording (it is cut and zoomed when it stops; change it with edit):
  flikka project timeline <id>               what happens in the finished video, in its seconds: parts, cuts, zooms, clicks, speech
  flikka project frames <id> [--from s --to s | --at s,s] [--every s]   labelled frames of the edit in one picture
  flikka project edit <id> [options]   several options in one call, then render:
    --cut-idle (still picture, nobody talks)  --cut-silence (pauses in speech)  --cut start,end  --reset
    --auto-zoom  --zooms on|off  --clicks on|off  --cursor on|off  --keys on|off (typing sounds; on for terminals)  --mic|--system-audio|--webcam on|off
    --speed 1.5 (whole video, 0.5–4) | --speed 2,start,end (one part)    --ramp 0.5|off (ease between speeds over 0.2–2 s)
    --trim start,end (keep only that)  --freeze at,seconds (hold that moment: a still, no sound)   --preset vertical|portrait|square|landscape
    --crop x,y,w,h|off (show only that area: 0–1, or pixels of the recording)   --zoom start,end,x,y[,scale] (zoom in there; replaces overlapping zooms)
    --unzoom at (remove the zoom showing at that moment)
    --spotlight start,end,x,y,w,h|off (dim everything but that area)   --auto-zoom also follows typing, to the field being typed in
    --callout start,end,x,y,"text"  --step start,end,x,y,"text" (numbered in time order)  --arrow start,end,x,y,x2,y2
    --box start,end,x,y,w,h (highlight)  --annotations off   --keystrokes on|off (shortcuts pressed, shown in a corner)
    --redact start,end,x,y,w,h[,solid] | all,x,y,w,h[,solid] | off (blur an area; solid covers it: use solid for secrets)
    --chapter at,"label" (chapters in the file and a list for YouTube)  --chapters off
    --intro "text" | "seconds,text" | off   --outro (the same, at the end)   --transition fade|wipe|slide|zoom|off (at every cut)
    --music on|off|<file> (on: generated; ducked under the voice)   --music-volume 0.1–4 (1: a quiet bed)
    --background aurora|sunset|ocean|meadow|graphite|midnight|<css>     --camera round=on,size=0.22,position=bottom-right
  flikka project captions <id>               a transcript with word times (only when someone talks)
    --output-time (the call's times are in the finished video, as timeline shows: --cut 1:20,1:25)  --dry-run (show what would change)
  flikka project undo <id>                   back to before the last saved edit (repeat to go further back)
  Times are seconds or m:ss, in the recording's own seconds unless --output-time; anything else is a direct edit
  of its recording.project.json.

A film:
  flikka project new <name> [--with <id>,<id>]   a new film; --with starts it with those recordings as scenes
  flikka project schema [--path]             every film.json field, described: read it before writing a film
  flikka project styles                      looks for films (yours: ~/.flikka/styles)
  flikka project live <id>                   play it in the browser now, no export; reloads on every save
  flikka project frames <id> [--scene n | --from s --to s | --at s,s] [--every s]   labelled frames in one picture
  flikka project check <id>                  the check of the last render again (render runs it)

Rules:
  - Times the user says ("at 1:20") are in the rendered video: read flikka project timeline, then edit with
    --output-time so they need no converting. Try a big edit with --dry-run first; flikka project undo takes it back.
  - Test renders take --out <file>, so the user's finished video isn't replaced.
  - Videos are square by default (1080×1080): big on social platforms, phone, and desktop.
  - Films: the schema is the reference (unknown fields are errors with a "did you mean"). In text, *muted words*
    render grey and [accent words] in the accent color. Write "say" as plain spoken sentences, numbers spelled as
    they are read, and only real numbers. "voice": {"name": "af_heart"} speaks in a Kokoro neural voice (flikka voice list).
  - Loop: preview (~20 s), then render. Always read the check at the end of a render: each issue has a time, a
    scene and a frame to look at. Fix and render again until it is empty.

Example:
  flikka project new launch --with wiki      → {"id": "7c1e09aa", "film": "…/film.json"}: write the scenes, then
  flikka project preview launch; flikka project render launch
`,
  app: `flikka app - review panel and desktop integration.

  flikka app install                         set up flikka on Linux: ~/.local/bin/flikka, desktop entry, agent skills
  flikka app update                          pull latest code and refresh installation
  flikka app doctor                          check what flikka needs on this system, with the command to install what's missing
  flikka app uninstall                       remove desktop entry and symlinks
  flikka app panel [--no-open] [--project <id> | --shots]   the panel: projects, screenshots, voices
`,
};
helps.shot = `flikka shot - framed screenshots.

  flikka shot [--background b] [--plain] [--from file.png] [--no-copy]   pick an area or a window: framed, saved, copied
  flikka shot list | copy <file> | remove <file>                          the ones in ~/Documents/flikka/shots
  An agent's own: flikka record shot page.png, then flikka shot --from page.png --no-copy. Remove only when the user asks.
`;
helps.voice = `flikka voice - high quality neural voices via Kokoro and Whisper on CUDA/CPU.

  flikka voice list
  flikka voice say <name> "text" [--out file.wav]
  A film speaks in one with "voice": {"name": "<name>"}.
`;

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
    const terminal = await readJSON(path.join(outputDir, '.terminal.json')).catch(() => { throw new Error('Open the terminal first: flikka record open terminal'); });
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
  throw new Error(`Unknown: flikka record ${action}\n${helps.record}`);
}

async function project() {
  const projects = await import('./project.mjs');
  if (action === 'list') return projects.listProjects();
  if (action === 'new') return projects.newFilm(rest.filter((item, index) => item !== '--with' && rest[index - 1] !== '--with').join(' '), value(rest, '--with')?.split(',') || []);
  if (action === 'schema') { const {schemaFile} = await import('./film.mjs'); return rest.includes('--path') ? schemaFile : JSON.parse(await fs.readFile(schemaFile, 'utf8')); }
  if (action === 'styles') return (await import('./style.mjs')).listStyles();
  if (!rest[0]) throw new Error(`Usage: flikka project ${action || '<command>'} <id>\n${helps.project}`);
  if (action === 'rename') return projects.renameProject((await projects.openProject(rest[0])).id, rest.slice(1).join(' '));
  if (action === 'remove') return projects.removeProject((await projects.openProject(rest[0])).id);
  const found = await projects.openProject(rest[0]);
  const options = rest.slice(1);
  const film = found.kind === 'film';
  const only = kind => { if (found.kind !== kind) throw new Error(`flikka project ${action} is for a ${kind}; ${rest[0]} is a ${found.kind}${film ? ': edit its film.json, ' + found.file : ''}`); };
  if (action === 'show') return found.id ? {...await projects.describeProject(found.id), folder: found.folder} : found;
  if (action === 'edit') { only('recording'); return projects.editProject(found.file, options); }
  if (action === 'timeline') { only('recording'); return projects.timelineProject(found.file); }
  if (action === 'undo') { only('recording'); return projects.undoProject(found.file); }
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
    await (await import('./voice.mjs')).transcribeAudio(input, outJson, process.env.FLIKKA_WHISPER_MODEL || 'tiny');
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
    const make = () => import('./film.mjs').then(({renderFilm}) => renderFilm(found.file, {preview: action === 'preview', output, check: !options.includes('--no-check')}));
    if (action === 'preview' || !found.id || output) return make();
    // The panel shows the render running, and the finished video.
    return stepLog(found.folder, 'render')('Render the film', async () => projects.publishFilm(found.id, await make()));
  }
  only('film');
  if (action === 'live') return (await import('./film.mjs')).serveLive(found.file, {open: !options.includes('--no-open')});
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
  throw new Error(`Unknown: flikka project ${action}\n${helps.project}`);
}

try {
  if (['help', '--help', '-h'].includes(command)) console.log(helps.help);
  else if (['version', '--version', '-v'].includes(command)) {
    const pkg = await readJSON(path.join(root, 'package.json'));
    console.log(pkg.version);
  }
  else if (helps[command] && (action === 'help' || args.includes('--help') || args.includes('-h'))) console.log(helps[command]);
  else if (command === 'record') {
    if (!action) console.log(helps.record);
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
    if (!action) console.log(helps.project);
    else if (action === 'live') await project();
    else print(await project());
  } else if (command === 'app') {
    if (action === 'install') print(await (await import('./app.mjs')).installCommand(rest));
    else if (action === 'uninstall') print(await (await import('./app.mjs')).uninstallCommand());
    else if (action === 'update') print(await (await import('./app.mjs')).updateCommand());
    else if (action === 'doctor') print(await (await import('./doctor.mjs')).doctorCommand());
    else if (action === 'panel') await (await import('./ui.mjs')).serveUI({open: !rest.includes('--no-open'), project: value(rest, '--project') || null, shots: rest.includes('--shots')});
    else console.log(helps.app);
  } else if (command === 'shot') print(await (await import('./shot.mjs')).shotCommand(args));
  else if (command === 'voice') print(await (await import('./voice.mjs')).voiceCommand(args));
  else throw new Error(`Unknown command: ${command}\n${helps.help}`);
} catch (error) { console.error(JSON.stringify({error: error.message})); process.exitCode = 1; }
