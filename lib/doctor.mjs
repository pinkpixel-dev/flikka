// flikka app doctor: what flikka needs on this system, what is missing, and the command that installs it.
// Tools flikka downloads by itself (ffmpeg, uv, deep-filter, the render Chrome) only count as missing if the
// download would fail: they show as "downloads on first use".
import fs from 'node:fs/promises';
import path from 'node:path';
import {binDir} from './common.mjs';
import {knownLinux} from './browser.mjs';

async function onPath(names) {
  for (const name of names) {
    if (name.startsWith('/')) { if (await fs.access(name, fs.constants.X_OK).then(() => true, () => false)) return name; continue; }
    for (const folder of [...(process.env.PATH || '').split(':').filter(Boolean), binDir]) {
      const file = path.join(folder, name);
      if (await fs.access(file, fs.constants.X_OK).then(() => true, () => false)) return file;
    }
  }
  return null;
}

// arch, debian or fedora (by ID and ID_LIKE in /etc/os-release); null for anything else.
async function family() {
  const release = await fs.readFile('/etc/os-release', 'utf8').catch(() => '');
  const ids = [...release.matchAll(/^(?:ID|ID_LIKE)="?([^"\n]+)"?$/gm)].flatMap(match => match[1].split(/\s+/));
  return ['arch', 'debian', 'ubuntu', 'fedora', 'rhel'].find(id => ids.includes(id))?.replace('ubuntu', 'debian').replace('rhel', 'fedora') || null;
}

const gsrSource = 'https://git.dec05eba.com/gpu-screen-recorder/about/';

export async function doctorCommand() {
  const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY);
  const distro = await family();
  // packages: repo package names per family; aur: Arch packages from the AUR (or the distro's own repo).
  const checks = [
    {name: 'Node.js 22 or newer', for: 'everything', found: Number(process.versions.node.split('.')[0]) >= 22 ? process.execPath : null,
      packages: {arch: 'nodejs', debian: 'nodejs', fedora: 'nodejs'}},
    {name: 'curl', for: 'downloading ffmpeg, uv and deep-filter on first use', binaries: ['curl'], packages: {arch: 'curl', debian: 'curl', fedora: 'curl'}},
    {name: 'ffmpeg', for: 'cutting, mixing and checking video', binaries: ['ffmpeg'], downloads: true},
    {name: 'uv', for: 'the Python environment for narration and transcription', binaries: ['uv'], downloads: true},
    {name: 'deep-filter', for: 'removing background noise from the mic', binaries: ['deep-filter'], downloads: true},
    {name: 'Render Chrome (chrome-headless-shell)', for: 'rendering videos, stills and framed screenshots', render: true},
    {name: 'Chrome, Chromium, Brave, Edge or Vivaldi', for: 'flikka record browser', binaries: knownLinux.flatMap(browser => browser.execs),
      packages: {arch: 'chromium', debian: 'chromium', fedora: 'chromium'}},
    {name: 'gpu-screen-recorder', for: 'recording the screen, a window or a region', binaries: ['gpu-screen-recorder'], aur: 'gpu-screen-recorder',
      other: `not in Debian or Fedora repos: build it from source (${gsrSource}) or use the unofficial Copr (Fedora) or Pacstall (Ubuntu) package`},
    ...(wayland ? [
      {name: 'slurp', for: 'dragging out a region to record (Wayland)', binaries: ['slurp'], packages: {arch: 'slurp', debian: 'slurp', fedora: 'slurp'}},
      {name: 'wl-copy', for: 'copying a finished video to the clipboard (Wayland)', binaries: ['wl-copy'], packages: {arch: 'wl-clipboard', debian: 'wl-clipboard', fedora: 'wl-clipboard'}},
    ] : [
      {name: 'xclip', for: 'copying a finished video to the clipboard (X11)', binaries: ['xclip'], packages: {arch: 'xclip', debian: 'xclip', fedora: 'xclip'}},
    ]),
    {name: 'python3', for: 'terminal recordings', binaries: ['python3'], packages: {arch: 'python', debian: 'python3', fedora: 'python3'}},
    {name: 'zsh', for: 'terminal recordings (the shell they run)', binaries: ['zsh'], packages: {arch: 'zsh', debian: 'zsh', fedora: 'zsh'}},
    {name: 'xdg-open', for: 'opening the panel and finished videos', binaries: ['xdg-open'], packages: {arch: 'xdg-utils', debian: 'xdg-utils', fedora: 'xdg-utils'}},
    {name: 'gio', for: 'moving deleted projects to the trash and showing files', binaries: ['gio'], packages: {arch: 'glib2', debian: 'libglib2.0-bin', fedora: 'glib2'}},
  ];
  for (const check of checks) {
    if (check.render) {
      const {resolveHeadlessShellPath} = await import('@hyperframes/engine');
      check.found = (() => { try { return resolveHeadlessShellPath({}) || null; } catch { return null; } })();
      check.downloads = true;
    } else if (check.binaries) check.found = await onPath(check.binaries);
  }

  const missing = checks.filter(check => !check.found && !check.downloads);
  const packages = missing.map(check => check.packages?.[distro]).filter(Boolean);
  const aur = missing.map(check => check.aur).filter(Boolean);
  const fix = [];
  if (packages.length) fix.push({arch: `sudo pacman -S --needed ${packages.join(' ')}`, debian: `sudo apt install ${packages.join(' ')}`, fedora: `sudo dnf install ${packages.join(' ')}`}[distro]);
  if (aur.length) fix.push(distro === 'arch' ? `paru -S --needed ${aur.join(' ')}` : missing.find(check => check.aur).other);
  if (missing.length && !distro) fix.push(`install these with your package manager: ${missing.map(check => check.name).join(', ')}`);

  return {
    ok: missing.length === 0,
    system: {distro: distro || 'unknown', session: wayland ? 'wayland' : 'x11'},
    checks: checks.map(check => ({name: check.name, for: check.for,
      status: check.found ? 'ok' : check.downloads ? 'downloads on first use' : 'missing', ...(check.found && {path: check.found})})),
    ...(fix.length && {fix}),
  };
}
