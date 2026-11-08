import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readJSON, run, sleep, root, binDir, flikkaHome, trace, fetchLater} from './common.mjs';

// The helper that logs the pointer during a Wayland screen recording (cursor/), or null when it isn't installed.
// Never waited on here: starting a recording shouldn't hang on a download (startPointer fetches it for next time).
export async function cursorHelper() {
  const places = [process.env.FLIKKA_CURSOR_BIN, '/usr/lib/flikka/flikka-cursor', path.join(root, 'cursor/target/release/flikka-cursor'), path.join(binDir, 'flikka-cursor')].filter(Boolean);
  for (const file of places) if (await fs.access(file, fs.constants.X_OK).then(() => true, () => false)) return file;
  return null;
}

// Starts flikka-cursor for a full-screen recording and waits until positions flow (the first run waits on the
// portal's picker). Null when it can't, and the recording then keeps the pointer in the video like before.
async function startPointer(log, display) {
  const helper = await cursorHelper();
  // Missing: this recording keeps the pointer in the video, and the helper downloads for the next one.
  if (!helper) {
    if (fetchLater('flikka-cursor')) trace('cursor', 'flikka-cursor not installed: downloading it for the next recording');
    return null;
  }
  const raw = `${log}.pointer`;
  const child = spawn(helper, ['--out', raw, '--token', path.join(flikkaHome, 'cursor.token')], {stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  const lines = createInterface({input: child.stdout});
  const exited = new Promise(resolve => child.once('exit', resolve));
  const ready = await new Promise(resolve => {
    // The first ever run waits on the picker; the session gives the whole start 45 s.
    const timer = setTimeout(() => resolve({event: 'error', message: 'no answer in 40 s'}), 40000);
    lines.on('line', line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.event === 'ready' || event.event === 'error') { clearTimeout(timer); resolve(event); }
    });
    exited.then(() => { clearTimeout(timer); resolve({event: 'error', message: stderr.trim() || 'it stopped'}); });
  });
  // The portal stream should be the monitor being recorded: same shape (its size can be logical on a scaled screen).
  const sameShape = ready.width > 0 && Math.abs(ready.width / ready.height - display.width / display.height) < 0.005;
  if (ready.event !== 'ready' || !sameShape) {
    trace('cursor', ready.event === 'ready' ? `picked ${ready.width}×${ready.height}, recording ${display.width}×${display.height}: not logging the pointer` : `not logging the pointer (${ready.code || 'error'}): ${ready.message}`);
    child.kill('SIGKILL');
    await fs.rm(raw, {force: true});
    return null;
  }
  return {raw, child, exited};
}

// flikka-cursor's log (wall-clock t) as a segment's cursor events, in seconds from when the recording started. The
// last position before the start comes first, at 0, so the pointer is there from the first frame. Broken lines (a
// helper killed mid-write) are skipped.
export function alignPointer(text, startedAt) {
  const events = text.split('\n').filter(Boolean).flatMap(line => {
    try { const event = JSON.parse(line); return Number.isFinite(event.t) ? [event] : []; } catch { return []; }
  });
  const before = events.filter(event => event.t < startedAt).at(-1);
  return [...(before ? [{...before, t: startedAt}] : []), ...events.filter(event => event.t >= startedAt)]
    .map(event => ({...event, t: Math.round((event.t - startedAt) * 1000) / 1000}));
}

// Stops the helper and writes its log as the segment's cursor file.
async function stopPointer(pointer, log, startedAt) {
  pointer.child.kill('SIGINT');
  await Promise.race([pointer.exited, sleep(2000)]);
  pointer.child.kill('SIGKILL');
  const events = alignPointer(await fs.readFile(pointer.raw, 'utf8').catch(() => ''), startedAt);
  await fs.writeFile(log, events.map(event => JSON.stringify(event) + '\n').join(''));
  await fs.rm(pointer.raw, {force: true});
  return events.length;
}

// Enumerate connected monitors, microphones, and video capture devices on Linux.
export async function getSources() {
  const displays = [];
  const microphones = [{id: 'default_input', name: 'Default input'}];
  const cameras = [];

  try {
    const rawMonitors = await run('gpu-screen-recorder', ['--list-monitors']).catch(() => '');
    const lines = rawMonitors.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.includes('|')) {
        const [name, res] = line.split('|');
        const [width, height] = (res || '1920x1080').split('x').map(Number);
        displays.push({
          index: displays.length,
          id: name,
          name,
          width: width || 1920,
          height: height || 1080
        });
      }
    }
  } catch {}

  if (!displays.length) {
    displays.push({index: 0, id: 'eDP-1', name: 'eDP-1', width: 2560, height: 1600});
  }

  try {
    const rawAudio = await run('gpu-screen-recorder', ['--list-audio-devices']).catch(() => '');
    const lines = rawAudio.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.includes('|')) {
        const [id, label] = line.split('|');
        if (id !== 'default_input' && id !== 'default_output' && (id.includes('source') || id.includes('input') || id.includes('Mic'))) {
          microphones.push({id, name: label || id});
        }
      }
    }
  } catch {}

  try {
    const devEntries = await fs.readdir('/dev').catch(() => []);
    for (const name of devEntries) {
      if (name.startsWith('video') && /^\d+$/.test(name.slice(5))) {
        cameras.push({id: `/dev/${name}`, name: `Camera (/dev/${name})`});
      }
    }
  } catch {}

  return {displays, windows: [], microphones, cameras};
}

// Recorder process for full-screen and region captures on Linux via gpu-screen-recorder.
export async function recordScreen(configFile) {
  const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
  const options = await readJSON(configFile);

  const sources = await getSources();
  const displayIndex = Number.isInteger(options.display) ? options.display : 0;
  const display = sources.displays.find(d => d.index === displayIndex) || sources.displays[0];

  let target = display.name;
  let targetRegion = null;
  let width = display.width;
  let height = display.height;

  if (options.region) {
    target = 'region';
    const [rx, ry, rw, rh] = options.region;
    width = rw - (rw % 2);
    height = rh - (rh % 2);
    targetRegion = `${width}x${height}+${rx}+${ry}`;
  } else if (options.window !== undefined) {
    if (process.env.WAYLAND_DISPLAY || options.window === 'portal') {
      target = 'portal';
    } else {
      target = String(options.window);
    }
  }

  const fps = [24, 30, 60].includes(options.fps) ? options.fps : 60;

  // Initialize cursor file
  if (options.cursor) {
    await fs.mkdir(options.cursor.replace(/\/[^/]+$/, ''), {recursive: true});
    await fs.writeFile(options.cursor, '');
  }

  // A full screen on Wayland is recorded without the pointer when flikka-cursor can log it, so it can be shown or
  // hidden after recording. With --no-cursor too: it's still logged, just hidden by default. A later part of a
  // recording follows its first part (pointerOnly or pointerBaked), so the parts don't disagree.
  const pointer = options.cursor && !options.region && options.window === undefined && process.env.WAYLAND_DISPLAY && !options.pointerBaked
    ? await startPointer(options.cursor, display) : null;
  const showCursor = !options.noCursor && !pointer && !options.pointerOnly;

  const gsrArgs = [
    '-w', target,
    ...(targetRegion ? ['-region', targetRegion] : []),
    '-f', String(fps),
    '-k', 'h264',
    '-c', 'mp4',
    '-cursor', showCursor ? 'yes' : 'no',
    '-o', options.output
  ];

  if (options.microphone) {
    const mic = options.microphone === 'default' ? 'default_input' : options.microphone;
    gsrArgs.push('-a', mic);
  }
  if (options.systemAudio) {
    gsrArgs.push('-a', 'default_output');
  }

  const child = spawn('gpu-screen-recorder', gsrArgs, {stdio: ['ignore', 'pipe', 'pipe']});
  let started = false;
  let startedAt = Date.now() / 1000;

  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    if (!started && (text.includes('update fps') || text.includes('gsr info:'))) {
      started = true;
      startedAt = Date.now() / 1000;
      emit({event: 'recording', startedAt});
      emit({event: 'capture', width, height, fps, bounds: [0, 0, width, height]});
    }
  });

  child.on('error', err => {
    pointer?.child.kill('SIGKILL');
    emit({event: 'error', message: err.message});
    process.exit(1);
  });

  // Fallback in case stderr output format differs
  const startTimer = setTimeout(() => {
    if (!started) {
      started = true;
      startedAt = Date.now() / 1000;
      emit({event: 'recording', startedAt});
      emit({event: 'capture', width, height, fps, bounds: [0, 0, width, height]});
    }
  }, 1200);

  // Wait for stop signal from session coordinator
  await new Promise(resolve => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
  clearTimeout(startTimer);

  // Ignore subsequent signals during teardown
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});

  // Send SIGINT to gpu-screen-recorder to cleanly finalize the MP4
  child.kill('SIGINT');
  await new Promise(resolve => child.on('close', resolve));
  await sleep(150);
  // This part's video has no pointer in it, whatever the helper managed to log.
  if (pointer) emit({event: 'pointer', moves: await stopPointer(pointer, options.cursor, startedAt)});

  emit({event: 'finished', output: options.output});
  process.exit(0);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const action = process.argv[2];
  if (action === 'sources') {
    getSources().then(res => console.log(JSON.stringify(res, null, 2))).catch(err => {
      process.stderr.write(String(err) + '\n');
      process.exit(1);
    });
  } else if (action === 'record') {
    recordScreen(process.argv[3]).catch(err => {
      process.stderr.write(String(err?.stack || err) + '\n');
      process.exit(1);
    });
  }
}
