import React, {useEffect, useState} from 'react';
import {FolderOpen, RotateCcw} from 'lucide-react';
import {api} from '../lib/api.js';
import {useToast} from '../lib/toast.js';
import {Button} from '../components/ui.jsx';

const home = text => String(text ?? '').replace(/^\/home\/[^/]+/, '~');
const show = item => item.value == null ? '' : ['folder', 'path', 'browser'].includes(item.type) ? home(item.value) : String(item.value);
const browserLabels = {auto: 'Your default browser', 'google-chrome': 'Google Chrome', chromium: 'Chromium', brave: 'Brave', edge: 'Microsoft Edge', vivaldi: 'Vivaldi'};

// One setting: a menu saves as soon as it's picked; text (a folder, a voice, a port, a command) saves on Enter or
// Save. Set by an environment variable, it's locked and says which.
function Setting({item, onSaved}) {
  const toast = useToast();
  const [text, setText] = useState(show(item));
  const [custom, setCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  useEffect(() => { setText(show(item)); setCustom(false); }, [item.value]);
  const locked = item.from === 'env';
  // Empty isn't a value: the reset button puts a setting back.
  const changed = text.trim() !== '' && text.trim() !== show(item);
  const save = async value => {
    setSaving(true); setNote(null);
    try { const result = await api('settings-set', {key: item.key, value}); setNote(result.moved?.note || result.note || null); onSaved(); }
    catch (failure) { toast(failure.message); }
    finally { setSaving(false); }
  };
  const tip = locked ? `${item.variable} is set in the environment, so it decides this` : undefined;
  const keys = event => { if (event.key === 'Enter' && changed) save(text); if (event.key === 'Escape') setText(show(item)); };
  const field = (extra = {}) => <input type="text" aria-label={item.label} value={text} disabled={locked || saving} spellCheck={false}
    placeholder={item.value == null ? item.shown : undefined} data-tip={tip || extra.tip} onChange={event => setText(event.target.value)} onKeyDown={keys} {...extra.props}/>;

  let control;
  if (item.type === 'choice') control = <select aria-label={item.label} value={item.value} disabled={locked || saving} data-tip={tip} onChange={event => save(event.target.value)}>
    {item.choices.map(choice => <option key={choice} value={choice}>{choice}{choice === item.default ? ' (default)' : ''}</option>)}</select>;
  else if (item.type === 'browser') {
    const byPath = custom || !item.choices.includes(item.value);
    control = <div className="setting-pair">
      <select aria-label={item.label} value={byPath ? 'path' : item.value} disabled={locked || saving} data-tip={tip}
        onChange={event => { if (event.target.value === 'path') { setCustom(true); setText(''); } else { setCustom(false); save(event.target.value); } }}>
        {item.choices.map(choice => <option key={choice} value={choice}>{browserLabels[choice] || choice}</option>)}
        <option value="path">Another browser (a path)…</option></select>
      {byPath && field({tip: 'The path to a Chromium-based browser. Enter saves.', props: {placeholder: '/usr/bin/thorium-browser'}})}
    </div>;
  } else if (item.type === 'voice') {
    // Kokoro's voices by language, each with Kokoro's own grade: the language comes with the voice.
    const languages = [...new Set(item.voices.map(voice => voice.language))];
    control = <select aria-label={item.label} value={item.value} disabled={locked || saving} data-tip={tip || 'Grades are Kokoro\u2019s own: A is best. Languages other than English are thin in Kokoro.'}
      onChange={event => save(event.target.value)}>
      {languages.map(language => <optgroup key={language} label={language}>
        {item.voices.filter(voice => voice.language === language).map(voice => <option key={voice.name} value={voice.name}>
          {voice.name} · {voice.gender}{voice.grade ? ` · ${voice.grade}` : ''}{voice.name === item.default ? ' (default)' : ''}</option>)}
      </optgroup>)}</select>;
  }
  else if (item.type === 'port') control = field({tip: 'A number from 1024 to 65535. Enter saves.', props: {type: 'number', min: 1024, max: 65535, inputMode: 'numeric'}});
  else control = field({tip: item.type === 'command' ? 'Use %o where it saves the PNG, like: grim -g "$(slurp)" %o' : 'A full path, like ~/Videos/demos. Enter saves.'});

  const source = locked ? `Set by ${item.variable}` : item.from === 'settings' ? 'Changed here' : 'Default';
  const typed = !['choice', 'voice'].includes(item.type) && !(item.type === 'browser' && !custom && item.choices.includes(item.value));
  return <div className="setting">
    <div className="setting-name"><b>{item.label}</b><small>{item.about}</small></div>
    <div className="setting-control">
      {control}
      <div className="button-row">
        {typed && changed && !locked && <Button size="small" variant="primary" disabled={saving} tip="Save this" onClick={() => save(text)}>{saving ? 'Saving…' : 'Save'}</Button>}
        {item.type === 'folder' && <Button size="small" variant="ghost" icon={FolderOpen} tip="Open the folder" onClick={() => api('settings-reveal', {key: item.key}).catch(failure => toast(failure.message))}/>}
        {item.from === 'settings' && <Button size="small" variant="ghost" icon={RotateCcw} disabled={saving}
          tip={`Back to the default: ${item.default == null ? item.shown : home(item.default)}`} onClick={() => save(null)}/>}
      </div>
    </div>
    <small className={`setting-source ${item.from}`}>{source}</small>
    {note && <p className="hint setting-note">{note}</p>}
  </div>;
}

// Settings: where files go, the voice, the demo browser, screenshots and the panel. The CLI and agents read the
// same file.
export function Settings() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const load = () => api('settings').then(setData).catch(failure => toast(failure.message));
  useEffect(() => { load(); }, []);
  const groups = data ? [...new Set(data.settings.map(item => item.group))] : [];
  return <div className="page settings">
    <header className="page-head"><h1>Settings</h1></header>
    {data?.problem && <div className="banner problem" role="alert">{data.problem}</div>}
    {groups.map(group => <section key={group} className="panel">
      <header className="settings-head"><h2>{group}</h2>{group === 'Folders' && <span className="muted">Files already saved stay where they are when you change one.</span>}</header>
      <div className="setting-list">{data.settings.filter(item => item.group === group).map(item => <Setting key={item.key} item={item} onSaved={load}/>)}</div>
    </section>)}
    {data && <p className="hint">Saved in <code>{home(data.file)}</code>, which <code>flikka app config</code> and your agent use too.</p>}
  </div>;
}
