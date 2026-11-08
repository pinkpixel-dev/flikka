// Settings people can change without touching environment variables: for now, where files go. Saved in
// ~/.config/flikka/config.json, read by the CLI, the panel and agents alike. An environment variable still wins
// over the file, for one run or a script.
import fs from 'node:fs/promises';
import path from 'node:path';
import {folderKinds, folderSources, readSettings, settingsFile, loadFolders, expandHome, writeJSON} from './common.mjs';

// Every folder: where it is, where that came from, and its default.
export function folderSettings() {
  const sources = folderSources(), {problem} = readSettings();
  return {file: settingsFile, problem, folders: Object.entries(folderKinds).map(([key, kind]) =>
    ({key, label: kind.label, about: kind.about, ...sources[key], default: kind.default(), variables: kind.env}))};
}

// Puts a folder somewhere else (made if it's new, and checked that it can be written), or back to its default
// (`value` null). Files already in the old folder stay there.
export async function setFolder(key, value) {
  if (!folderKinds[key]) throw new Error(`No setting "${key}". Folders: ${Object.keys(folderKinds).join(', ')}`);
  const {settings, problem} = readSettings();
  if (problem) throw new Error(`${problem}. Fix or remove it first.`);
  const before = folderSources()[key].path;
  const folders = {...settings.folders};
  if (value == null || value === '') delete folders[key];
  else {
    const text = String(value).trim();
    if (!path.isAbsolute(text) && !/^~(\/|$)/.test(text)) throw new Error('Use a full path, like ~/Videos/demos or /mnt/media/flikka');
    const folder = expandHome(text);
    try { await fs.mkdir(folder, {recursive: true}); await fs.access(folder, fs.constants.W_OK); }
    catch (error) { throw new Error(`Can't use ${folder}: ${error.code === 'EACCES' ? 'no permission to write there' : error.message}`); }
    folders[key] = folder;
  }
  await writeJSON(settingsFile, {...settings, folders});
  loadFolders();
  const now = folderSources()[key];
  return {key, ...now,
    ...(now.from === 'env' && {note: `${now.variable} is set in the environment, so it still decides this folder.`}),
    ...(now.path !== before && {moved: {from: before, note: 'Files already in the old folder stay there. Move them yourself to keep them together.'}})};
}

// flikka app config [set <folder> <path> | unset <folder>]
export async function configCommand(args) {
  const [action, key, value] = args;
  if (!action) return folderSettings();
  if (action === 'set') {
    if (!key || !value) throw new Error('Usage: flikka app config set <folder> <path>');
    return setFolder(key, path.isAbsolute(value) || value.startsWith('~') ? value : path.resolve(value));
  }
  if (action === 'unset') {
    if (!key) throw new Error('Usage: flikka app config unset <folder>');
    return setFolder(key, null);
  }
  throw new Error('Usage: flikka app config [set <folder> <path> | unset <folder>]');
}
