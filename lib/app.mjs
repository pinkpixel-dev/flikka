// flikka app install | update | uninstall | skills: sets flikka up on this Linux system.
// - From a git clone: flikka CLI symlinked into ~/.local/bin/flikka (npm and system packages bring their own).
// - flikka.desktop and flikka.png in ~/.local/share, unless a system package already installed them in /usr/share.
// - flikka skill in ~/.agents/skills (most agents), ~/.claude/skills, ~/.codex/skills and ~/.gemini/config/skills
//   (Antigravity), for the agents installed here: linked from a git clone so edits show up at once, copied otherwise
//   so it survives Node version switches. flikka app skills places (or removes) just the skill, for some agents or all.
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

const iconsDir = path.join(home, '.local/share/icons/hicolor/512x512/apps');
const iconFile = path.join(iconsDir, 'flikka.png');

const skillTarget = path.join(root, 'skills/flikka');
// Where each agent looks for skills. agents: the shared folder most other agents read.
const agentSkillDirs = {
  claude: path.join(home, '.claude/skills/flikka'),
  codex: path.join(home, '.codex/skills/flikka'),
  antigravity: path.join(home, '.gemini/config/skills/flikka'),
  agents: path.join(home, '.agents/skills/flikka'),
};
const skillDirs = Object.values(agentSkillDirs);
// How to tell an agent is installed: any of these folders exists. Gemini CLI also uses ~/.gemini, so Antigravity
// is told by its own folders in it. The shared ~/.agents folder always gets the skill.
const agentHomes = {
  claude: [path.join(home, '.claude')],
  codex: [path.join(home, '.codex')],
  antigravity: [path.join(home, '.gemini/antigravity'), path.join(home, '.gemini/config')],
};
async function installedAgents() {
  const found = [];
  for (const name of Object.keys(agentSkillDirs)) {
    if (!agentHomes[name]) { found.push(name); continue; }
    for (const folder of agentHomes[name]) if (await exists(folder)) { found.push(name); break; }
  }
  return found;
}
// Marks a copied skill folder as ours, so update replaces it and uninstall removes it.
const skillMarker = '.installed-by-flikka';

const exists = file => fs.access(file).then(() => true, () => false);
const fromClone = () => exists(path.join(root, '.git'));

const iconSource = path.join(root, 'assets/flikka.png');

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
  // A system install's files can be read-only, and cp keeps that: make the copy ours to update and remove.
  for (const name of ['', ...await fs.readdir(place, {recursive: true})]) {
    const item = path.join(place, name);
    await fs.chmod(item, (await fs.stat(item)).isDirectory() ? 0o755 : 0o644);
  }
  await fs.writeFile(path.join(place, skillMarker), `${skillTarget}\n`, 'utf8');
  return 'copied';
}

// The skill in each folder: linked from a git clone, copied otherwise. Folder → what happened.
async function placeSkills(dirs) {
  const clone = await fromClone();
  const placed = {};
  for (const skillDir of dirs) placed[skillDir] = clone ? await link(skillTarget, skillDir) : await copySkill(skillDir);
  return placed;
}

// Flikka's own skill out of each folder (a link to it, or a copy it marked); anything else is left alone.
async function removeSkills(dirs) {
  const removed = [];
  for (const skillDir of dirs) {
    if (await fs.readlink(skillDir).catch(() => null) === skillTarget) {
      await fs.rm(skillDir, {force: true});
      removed.push(skillDir);
    } else if (await exists(path.join(skillDir, skillMarker))) {
      await fs.rm(skillDir, {recursive: true, force: true});
      removed.push(skillDir);
    }
  }
  return removed;
}

// flikka app skills [--agent claude,codex,antigravity,agents] [--remove]: just the agent skill, for the agents named,
// without the command link or the desktop entry. Without --agent: the agents installed here (removing: all four).
export async function skillsCommand(args = []) {
  const at = args.indexOf('--agent');
  const remove = args.includes('--remove');
  const named = at >= 0 ? String(args[at + 1] || '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean)
    : remove ? Object.keys(agentSkillDirs) : await installedAgents();
  const unknown = named.filter(name => !agentSkillDirs[name]);
  if (!named.length || unknown.length) throw new Error(`--agent takes ${Object.keys(agentSkillDirs).join(', ')} (several with commas)${unknown.length ? `, not ${unknown.join(', ')}` : ''}`);
  const dirs = named.map(name => agentSkillDirs[name]);
  const agentOf = dir => named.find(name => agentSkillDirs[name] === dir);
  if (remove) {
    const removed = await removeSkills(dirs);
    return {removed, message: removed.length ? `Removed the Flikka skill for ${removed.map(agentOf).join(', ')}.` : 'There was no Flikka skill to remove there.'};
  }
  const skills = await placeSkills(dirs);
  const ready = dirs.filter(dir => ['linked', 'copied'].includes(skills[dir])).map(agentOf);
  const skipped = dirs.filter(dir => !['linked', 'copied'].includes(skills[dir])).map(agentOf);
  const missing = at < 0 ? Object.keys(agentSkillDirs).filter(name => !named.includes(name)) : [];
  return {skills, from: skillTarget, ...(missing.length && {notInstalled: missing}), message: [ready.length && `The Flikka skill is ready for ${ready.join(', ')}. Start a new agent session to pick it up.`,
    skipped.length && `Left ${skipped.join(', ')} alone: a skill folder named flikka that Flikka didn't make is already there.`,
    missing.length && `Skipped ${missing.join(', ')}: not installed here (add it anyway with --agent ${missing.join(',')}).`].filter(Boolean).join(' ')};
}

export async function installCommand(args = []) {
  await fs.chmod(binaryTarget, 0o755).catch(() => {});
  const clone = await fromClone();
  const installed = {};

  // 1. CLI: npm and system packages put flikka on the PATH themselves.
  if (clone) installed[binaryLink] = await link(binaryTarget, binaryLink);

  // 2. Skills, for the agents installed here (flikka app skills --agent adds one anyway).
  const agents = await installedAgents();
  Object.assign(installed, await placeSkills(agents.map(name => agentSkillDirs[name])));

  // 3. Icon and desktop entry, unless a system package already provides them.
  const systemDesktop = await exists(systemDesktopFile);
  if (!systemDesktop) {
    await fs.mkdir(iconsDir, {recursive: true});
    // Replaced, not overwritten, and made writable: the source can be read-only in a system install.
    await fs.rm(iconFile, {force: true});
    await fs.copyFile(iconSource, iconFile);
    await fs.chmod(iconFile, 0o644);

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
Keywords=screen;recorder;video;hyperframes;flikka;
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
    ...(agents.length < skillDirs.length && {skippedAgents: Object.keys(agentSkillDirs).filter(name => !agents.includes(name)).map(name => `${name}: not installed here (flikka app skills --agent ${name} adds it anyway)`)}),
    status: 'installed',
    message: 'Flikka is installed. You can run `flikka` anywhere or launch Flikka from your application menu.',
  };
}

// From a git clone: pull and reinstall. Installed by a package manager: say which command updates it
// (pacman owns the files of an AUR install), then `flikka app install` refreshes the copied skills.
export async function updateCommand() {
  if (!await fromClone()) {
    const aur = await hasBinary('pacman') && await run('pacman', ['-Qqo', path.join(root, 'package.json')]).then(() => true, () => false);
    const command = aur ? 'paru -Syu flikka   (or yay -Syu flikka)' : 'npm install -g @pinkpixel/flikka@latest';
    return {status: 'not-updated', installedWith: aur ? 'AUR package' : 'npm', update: command, then: 'flikka app install',
      message: `Flikka was installed with ${aur ? 'pacman from the AUR' : 'npm'}: update it with \`${command}\`, then run \`flikka app install\` to refresh the agent skills.`};
  }
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
  removed.push(...await removeSkills(skillDirs));
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
