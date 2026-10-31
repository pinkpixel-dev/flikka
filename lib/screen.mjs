import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {readJSON, run, sleep} from './common.mjs';

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

  const showCursor = !options.noCursor;

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
