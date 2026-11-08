// Settings people can change without touching environment variables: folders, the default voice, the
// transcription model, the demo browser, the screenshot tool and the ports. Saved in ~/.config/flikka/config.json,
// read by the CLI, the panel and agents alike. An environment variable still wins over the file, for one run or a
// script.
import fs from 'node:fs/promises';
import path from 'node:path';
import {settingKinds, settingSources, readSettings, settingsFile, loadSettings, expandHome, writeJSON} from './common.mjs';
import {kokoroVoices, isKokoroVoice} from './kokoro.mjs';

const fullPath = text => {
  if (!path.isAbsolute(text) && !/^~(\/|$)/.test(text)) throw new Error('Use a full path, like ~/Videos/demos or /mnt/media/flikka');
  return expandHome(text);
};

// A value as it will be saved, or an error that says what would work.
async function checked(key, kind, text) {
  if (kind.type === 'folder') {
    const folder = fullPath(text);
    try { await fs.mkdir(folder, {recursive: true}); await fs.access(folder, fs.constants.W_OK); }
    catch (error) { throw new Error(`Can't use ${folder}: ${error.code === 'EACCES' ? 'no permission to write there' : error.message}`); }
    return folder;
  }
  if (kind.type === 'path') {
    const folder = fullPath(text);
    if (key === 'browser-source' && !await fs.access(folder).then(() => true, () => false)) throw new Error(`There's no ${folder}`);
    return folder;
  }
  if (kind.type === 'choice') {
    if (!kind.choices.includes(text)) throw new Error(`Pick one of ${kind.choices.join(', ')}`);
    return text;
  }
  if (kind.type === 'browser') {
    if (kind.choices.includes(text)) return text;
    const app = fullPath(text);
    if (!await fs.access(app, fs.constants.X_OK).then(() => true, () => false)) throw new Error(`${app} isn't a program that can run. Use auto, ${kind.choices.slice(1).join(', ')}, or the path to a Chromium-based browser`);
    return app;
  }
  if (kind.type === 'voice') {
    if (!isKokoroVoice(text)) throw new Error(`Kokoro has no voice "${text}". flikka voice list shows them all, e.g. af_heart or bf_emma`);
    return text;
  }
  if (kind.type === 'port') {
    const port = Number(text);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('A port is a whole number from 1024 to 65535');
    return port;
  }
  if (kind.type === 'command') {
    if (!text.includes('%o')) throw new Error('Put %o where the command saves the PNG, like: grim -g "$(slurp)" %o');
    return text;
  }
  throw new Error(`Can't set ${key}`);
}

// Every setting: its value, where that came from, and its default.
export function allSettings() {
  const sources = settingSources(), {problem} = readSettings();
  return {file: settingsFile, problem, settings: Object.entries(settingKinds).filter(([, kind]) => !kind.hidden).map(([key, kind]) =>
    ({key, group: kind.group, label: kind.label, about: kind.about, type: kind.type, choices: kind.choices, ...(kind.type === 'voice' && {voices: kokoroVoices}),
      ...sources[key], default: kind.default(), shown: kind.shown, variables: kind.env}))};
}

// Saves one setting, or puts it back to its default (`value` null or ''). A folder is made if it's new; files
// already in the old one stay there.
export async function setSetting(key, value) {
  const kind = settingKinds[key];
  if (!kind || kind.hidden) throw new Error(`No setting "${key}". Settings: ${Object.keys(settingKinds).filter(name => !settingKinds[name].hidden).join(', ')}`);
  const {settings, problem} = readSettings();
  if (problem) throw new Error(`${problem}. Fix or remove it first.`);
  const before = settingSources()[key].value;
  const next = {...settings};
  const text = value == null ? '' : String(value).trim();
  if (text) next[key] = await checked(key, kind, text); else delete next[key];
  await writeJSON(settingsFile, next);
  loadSettings();
  const now = settingSources()[key];
  return {key, ...now,
    ...(now.from === 'env' && {note: `${now.variable} is set in the environment, so it still decides this.`}),
    ...(kind.type === 'folder' && now.value !== before && {moved: {from: before, note: 'Files already in the old folder stay there. Move them yourself to keep them together.'}}),
    ...(key === 'panel-port' && now.value !== before && {note: 'The panel moves to this port the next time it starts.'})};
}

// flikka app config [set <setting> <value> | unset <setting>]
export async function configCommand(args) {
  const [action, key, ...words] = args;
  const value = words.join(' ');
  if (!action) return allSettings();
  if (action === 'set') {
    if (!key || !value) throw new Error('Usage: flikka app config set <setting> <value>');
    // A relative folder means one from here, in the CLI.
    const relative = ['folder', 'path'].includes(settingKinds[key]?.type) && !path.isAbsolute(value) && !value.startsWith('~');
    return setSetting(key, relative ? path.resolve(value) : value);
  }
  if (action === 'unset') {
    if (!key) throw new Error('Usage: flikka app config unset <setting>');
    return setSetting(key, null);
  }
  throw new Error('Usage: flikka app config [set <setting> <value> | unset <setting>]');
}
