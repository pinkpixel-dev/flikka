import React, {useEffect, useState} from 'react';
import {FolderOpen, RotateCcw} from 'lucide-react';
import {api} from '../lib/api.js';
import {useToast} from '../lib/toast.js';
import {Button} from '../components/ui.jsx';

const home = path => path.replace(/^\/home\/[^/]+/, '~');

// One folder: its path (Enter or Save to move it), where that came from, open it, or put it back.
function Folder({folder, onSaved}) {
  const toast = useToast();
  const [text, setText] = useState(home(folder.path));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  useEffect(() => setText(home(folder.path)), [folder.path]);
  const locked = folder.from === 'env';
  const changed = text.trim() !== home(folder.path);
  const save = async value => {
    setSaving(true); setNote(null);
    try { const result = await api('settings-folder', {key: folder.key, path: value}); setNote(result.moved?.note || result.note || null); onSaved(); }
    catch (failure) { toast(failure.message); }
    finally { setSaving(false); }
  };
  const source = locked ? `Set by ${folder.variable}` : folder.from === 'settings' ? 'Changed here' : 'Default';
  return <div className="setting">
    <div className="setting-name"><b>{folder.label}</b><small>{folder.about}</small></div>
    <div className="setting-control">
      <input type="text" aria-label={`${folder.label} folder`} value={text} disabled={locked || saving} spellCheck={false}
        data-tip={locked ? `${folder.variable} is set in the environment, so it decides this folder` : 'A full path, like ~/Videos/demos. Enter saves.'}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && changed) save(text); if (event.key === 'Escape') setText(home(folder.path)); }}/>
      <div className="button-row">
        {changed && !locked && <Button size="small" variant="primary" disabled={saving} tip="Use this folder from now on" onClick={() => save(text)}>{saving ? 'Saving…' : 'Save'}</Button>}
        <Button size="small" variant="ghost" icon={FolderOpen} tip="Open the folder" onClick={() => api('settings-reveal', {key: folder.key}).catch(failure => toast(failure.message))}/>
        {folder.from === 'settings' && <Button size="small" variant="ghost" icon={RotateCcw} tip={`Back to the default, ${home(folder.default)}`} disabled={saving} onClick={() => save(null)}/>}
      </div>
    </div>
    <small className={`setting-source ${folder.from}`}>{source}</small>
    {note && <p className="hint setting-note">{note}</p>}
  </div>;
}

// Settings: for now, where Flikka puts things. The CLI and agents read the same file.
export function Settings() {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const load = () => api('settings').then(setSettings).catch(failure => toast(failure.message));
  useEffect(() => { load(); }, []);
  return <div className="page settings">
    <header className="page-head"><h1>Settings</h1></header>
    {settings?.problem && <div className="banner problem" role="alert">{settings.problem}</div>}
    <section className="panel">
      <header className="settings-head"><h2>Folders</h2><span className="muted">Files already saved stay where they are when you change one.</span></header>
      <div className="setting-list">{settings?.folders.map(folder => <Folder key={folder.key} folder={folder} onSaved={load}/>)}</div>
      {settings && <p className="hint">Saved in <code>{home(settings.file)}</code>, which <code>flikka app config</code> and your agent use too.</p>}
    </section>
  </div>;
}
