import React, {useState} from 'react';
import {Clipboard, FolderOpen, Trash2} from 'lucide-react';
import {api, shotURL} from '../lib/api.js';
import {when} from '../lib/format.js';
import {useFlash, usePoll} from '../lib/hooks.js';
import {useToast} from '../lib/toast.js';
import {Button, ConfirmButton} from '../components/ui.jsx';

// Screenshots from flikka shot, newest first. The list is read again every 3 s.
export function Shots({onCount}) {
  const toast = useToast();
  const [shots, setShots] = useState(null);
  const [copied, flash] = useFlash();
  const load = () => api('shots').then(list => { setShots(old => JSON.stringify(old) === JSON.stringify(list) ? old : list); onCount(list.length); });
  usePoll(load, 3000);
  return <div className="page">
    <header className="page-head"><h1>Screenshots</h1><span className="muted">Take one with <code>flikka shot</code>. Saved in ~/Documents/flikka/shots.</span></header>
    {shots?.length === 0 && <div className="empty">No screenshots yet. Run <code>flikka shot</code> to pick an area or a window.</div>}
    <div className="shot-grid">
      {shots?.map(shot => <figure key={shot.name} className="shot">
        <a href={shotURL(shot.name)} target="_blank" rel="noreferrer" data-tip={shot.name}><img src={shotURL(shot.name)} alt={shot.name} loading="lazy"/></a>
        <figcaption>
          <small>{when(shot.created)}</small>
          <Button size="small" icon={Clipboard} tip="Copy the picture" onClick={() => api('shot-copy', {name: shot.name}).then(() => flash(shot.name)).catch(failure => toast(failure.message))}>{copied === shot.name ? 'Copied' : null}</Button>
          <Button size="small" icon={FolderOpen} tip="Show in its folder" onClick={() => api('shot-reveal', {name: shot.name}).catch(failure => toast(failure.message))}/>
          <ConfirmButton size="small" icon={Trash2} tip="Delete" armed="Sure?" onConfirm={() => api('shot-remove', {name: shot.name}).then(load).catch(failure => toast(failure.message))}/>
        </figcaption>
      </figure>)}
    </div>
  </div>;
}
