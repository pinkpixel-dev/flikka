import React, {useEffect, useRef, useState} from 'react';
import {Copy, FolderOpen, Pencil, Trash2} from 'lucide-react';
import {api} from '../lib/api.js';
import {clock, recordingStates, states, when} from '../lib/format.js';
import {useFlash, usePoll} from '../lib/hooks.js';
import {useToast} from '../lib/toast.js';
import {Button, ConfirmButton} from '../components/ui.jsx';
import {LiveRecording} from './LiveRecording.jsx';
import {Studio} from './Studio.jsx';

// One project: recording live, or its video with the timeline and the edits. Read again every 0.7 s (steps,
// the timer, an agent's edits and renders).
export function Project({id, onChange}) {
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [copied, flash] = useFlash();
  const [renaming, setRenaming] = useState(false);
  const missing = useRef(false);
  const load = () => api('project', {id}).then(next => { missing.current = false; setProject(old => JSON.stringify(old) === JSON.stringify(next) ? old : next); })
    .catch(failure => { if (!missing.current) toast(failure.message); missing.current = true; });
  usePoll(load, 700, [id]);

  // The recording goes on in the background, but the page shouldn't close by accident.
  useEffect(() => {
    const warn = event => { if (project && ['recording', 'paused'].includes(project.state)) { event.preventDefault(); event.returnValue = 'The recording keeps going in the background.'; } };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [project?.state]);

  if (!project) return <div className="page"><div className="page-head"><h1 className="placeholder">Loading…</h1></div></div>;
  const live = recordingStates.includes(project.state);
  const rename = async name => {
    setRenaming(false);
    name = name.trim();
    if (!name || name === project.name) return;
    try { await api('project-rename', {id, name}); await load(); onChange(); } catch (failure) { toast(failure.message); }
  };

  return <div className={`page project ${live ? 'is-live' : 'is-studio'}`}>
    <header className="project-head">
      <div className="title-block">
        {renaming ? <input className="rename" type="text" defaultValue={project.name} maxLength={80} autoFocus aria-label="Project name"
          onFocus={event => event.target.select()} onBlur={event => rename(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.target.blur(); if (event.key === 'Escape') setRenaming(false); }}/>
          : <h1><button type="button" className="title-button" data-tip="Rename" onClick={() => setRenaming(true)}>{project.name}<Pencil size={15} aria-hidden/></button></h1>}
        <div className="meta">
          <span className={`chip ${project.state}`}><span className="dot"/>{states[project.state] || project.state}</span>
          <span>{when(project.created)}{project.duration ? ' · recorded ' + clock(project.duration) : ''}</span>
          <button type="button" className="id" data-tip="Copy the project id for your agent" onClick={() => navigator.clipboard.writeText(project.id).then(() => flash('id'))}>
            <code>{project.id}</code>{copied === 'id' ? 'Copied' : <Copy size={13} aria-hidden/>}</button>
        </div>
      </div>
      <div className="button-row">
        <Button size="small" icon={FolderOpen} tip="Open the project folder" onClick={() => api('reveal', {id, kind: 'folder'}).catch(failure => toast(failure.message))}>Folder</Button>
        <ConfirmButton size="small" icon={Trash2} tip="Delete the project and its files (moved to the trash)"
          onConfirm={() => api('project-remove', {id}).then(() => { location.hash = '#new'; onChange(); }).catch(failure => toast(failure.message))}>Delete</ConfirmButton>
      </div>
    </header>
    {live ? <LiveRecording project={project} refresh={load} onChange={onChange}/> : <Studio project={project} refresh={load} onChange={onChange}/>}
  </div>;
}
