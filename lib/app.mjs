// flikka app install | update | uninstall: sets flikka up on this Linux system.
// - From a git clone: flikka CLI symlinked into ~/.local/bin/flikka (npm and system packages bring their own).
// - flikka.desktop and flikka.svg in ~/.local/share, unless a system package already installed them in /usr/share.
// - flikka skill in ~/.agents/skills (most agents), ~/.claude/skills and ~/.codex/skills:
//   linked from a git clone so edits show up at once, copied otherwise so it survives Node version switches.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {root, run} from './common.mjs';

const home = os.homedir();
const binDir = path.join(home, '.local/bin');
const binaryTarget = path.join(root, 'flikka');
const binaryLink = path.join(binDir, 'flikka');

const desktopDir = path.join(home, '.local/share/applications');
const desktopFile = path.join(desktopDir, 'flikka.desktop');
const systemDesktopFile = '/usr/share/applications/flikka.desktop';

const iconsDir = path.join(home, '.local/share/icons/hicolor/scalable/apps');
const iconFile = path.join(iconsDir, 'flikka.svg');

const skillTarget = path.join(root, 'skills/flikka');
const skillDirs = [
  path.join(home, '.agents/skills/flikka'),
  path.join(home, '.claude/skills/flikka'),
  path.join(home, '.codex/skills/flikka'),
];
// Marks a copied skill folder as ours, so update replaces it and uninstall removes it.
const skillMarker = '.installed-by-flikka';

const exists = file => fs.access(file).then(() => true, () => false);
const fromClone = () => exists(path.join(root, '.git'));

const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="28" fill="#18181b"/>
  <rect x="24" y="44" width="80" height="56" rx="8" fill="#27272a" stroke="#3f3f46" stroke-width="2"/>
  <path d="M24 38 L104 38 L104 46 L24 46 Z" fill="#3f3f46"/>
  <path d="M34 38 L42 46 L34 46 L26 38 Z" fill="#fafafa"/>
  <path d="M54 38 L62 46 L54 46 L46 38 Z" fill="#fafafa"/>
  <path d="M74 38 L82 46 L74 46 L66 38 Z" fill="#fafafa"/>
  <path d="M94 38 L102 46 L94 46 L86 38 Z" fill="#fafafa"/>
  <circle cx="64" cy="72" r="16" fill="#ef4444"/>
  <polygon points="60,64 72,72 60,80" fill="#fafafa"/>
</svg>`;

async function hasBinary(name) {
  for (const folder of (process.env.PATH || '').split(':').filter(Boolean)) {
    try {
      await fs.access(path.join(folder, name), fs.constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

async function link(target, place) {
  const current = await fs.readlink(place).catch(error => error.code === 'ENOENT' ? null : 'other');
  if (current === target) return 'linked';
  if (current !== null && current !== 'other' && !await fs.access(place).then(() => true, () => false)) {
    await fs.rm(place, {force: true});
  } else if (current !== null) {
    return `left alone (${place} already exists)`;
  }
  await fs.mkdir(path.dirname(place), {recursive: true});
  await fs.symlink(target, place);
  return 'linked';
}

// A copy of the skill folder: it stays valid when the install folder moves (a Node version switch under nvm).
async function copySkill(place) {
  const current = await fs.lstat(place).catch(() => null);
  if (current) {
    const ours = current.isSymbolicLink()
      ? await fs.readlink(place) === skillTarget || !await exists(place)
      : await exists(path.join(place, skillMarker));
    if (!ours) return `left alone (${place} already exists)`;
    await fs.rm(place, {recursive: true, force: true});
  }
  await fs.mkdir(path.dirname(place), {recursive: true});
  await fs.cp(skillTarget, place, {recursive: true});
  await fs.writeFile(path.join(place, skillMarker), `${skillTarget}\n`, 'utf8');
  return 'copied';
}

export async function installCommand(args = []) {
  await fs.chmod(binaryTarget, 0o755).catch(() => {});
  const clone = await fromClone();
  const installed = {};

  // 1. CLI: npm and system packages put flikka on the PATH themselves.
  if (clone) installed[binaryLink] = await link(binaryTarget, binaryLink);

  // 2. Skills
  for (const skillDir of skillDirs) {
    installed[skillDir] = clone ? await link(skillTarget, skillDir) : await copySkill(skillDir);
  }

  // 3. Icon and desktop entry, unless a system package already provides them.
  const systemDesktop = await exists(systemDesktopFile);
  if (!systemDesktop) {
    await fs.mkdir(iconsDir, {recursive: true});
    await fs.writeFile(iconFile, svgIcon, 'utf8');

    // Launchers don't get the shell's PATH (nvm's node lives there), so outside a clone use absolute paths.
    const exec = clone ? binaryLink : `"${process.execPath}" "${path.join(root, 'lib/cli.mjs')}"`;
    await fs.mkdir(desktopDir, {recursive: true});
    const desktopContent = `[Desktop Entry]
Version=1.0
Type=Application
Name=Flikka
GenericName=Screen Recorder & Video Editor
Comment=Screen recorder and video editor for AI agents on Linux
Exec=${exec} app panel
Icon=flikka
Terminal=false
Categories=AudioVideo;Video;Recorder;AudioVideoEditing;
Keywords=screen;recorder;video;remotion;flikka;
StartupNotify=true
`;
    await fs.writeFile(desktopFile, desktopContent, 'utf8');

    if (await hasBinary('update-desktop-database')) {
      await run('update-desktop-database', [desktopDir]).catch(() => {});
    }
  }

  return {
    cli: clone ? binaryLink : 'provided by the package',
    desktop: systemDesktop ? systemDesktopFile : desktopFile,
    icon: systemDesktop ? 'provided by the package' : iconFile,
    skills: installed,
    status: 'installed',
    message: 'Flikka is installed. You can run `flikka` anywhere or launch Flikka from your application menu.',
  };
}

export async function updateCommand() {
  const before = (await run('git', ['-C', root, 'rev-parse', '--short', 'HEAD'])).trim();
  await run('git', ['-C', root, 'pull', '--ff-only', '--quiet']).catch(() => {});
  const after = (await run('git', ['-C', root, 'rev-parse', '--short', 'HEAD'])).trim();
  await run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--silent'], {cwd: root});
  return {from: before, to: after, ...await installCommand([])};
}

export async function uninstallCommand() {
  const removed = [];
  if (await fs.readlink(binaryLink).catch(() => null) === binaryTarget) {
    await fs.rm(binaryLink, {force: true});
    removed.push(binaryLink);
  }
  for (const skillDir of skillDirs) {
    if (await fs.readlink(skillDir).catch(() => null) === skillTarget) {
      await fs.rm(skillDir, {force: true});
      removed.push(skillDir);
    } else if (await exists(path.join(skillDir, skillMarker))) {
      await fs.rm(skillDir, {recursive: true, force: true});
      removed.push(skillDir);
    }
  }
  if (await fs.access(desktopFile).then(() => true, () => false)) {
    await fs.rm(desktopFile, {force: true});
    removed.push(desktopFile);
  }
  if (await fs.access(iconFile).then(() => true, () => false)) {
    await fs.rm(iconFile, {force: true});
    removed.push(iconFile);
  }
  if (await hasBinary('update-desktop-database')) {
    await run('update-desktop-database', [desktopDir]).catch(() => {});
  }
  return {removed, kept: 'projects, recordings and configuration in ~/.flikka'};
}
