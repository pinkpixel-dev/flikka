import React, {useCallback, useEffect, useState} from 'react';
import {api} from './lib/api.js';
import {ToastContext} from './lib/toast.js';
import {useHash, usePoll} from './lib/hooks.js';
import {monitor} from './lib/monitor.js';
import {Sidebar} from './components/Sidebar.jsx';
import {Tooltips} from './components/ui.jsx';
import {NewRecording} from './views/NewRecording.jsx';
import {Project} from './views/Project.jsx';
import {Shots} from './views/Shots.jsx';
// Voices (your own, cloned) is hidden until there's a model that can clone them: views/Voices.jsx waits for it.
import {Settings} from './views/Settings.jsx';

export function App() {
  const hash = useHash();
  const [projectId] = hash.match(/^project\/([\w-]+)$/)?.slice(1) || [];
  const view = projectId ? 'project' : ['shots', 'settings'].includes(hash) ? hash : 'new';
  const [projects, setProjects] = useState(null);
  const [counts, setCounts] = useState({shots: 0});
  const [message, setMessage] = useState('');
  const toast = useCallback(text => setMessage(text || ''), []);

  // The list every 3 s: an agent may record or render meanwhile.
  const loadList = useCallback(() => api('projects').then(setProjects), []);
  usePoll(loadList, 3000);
  // The render queue, each second: it moves on its own.
  const [renders, setRenders] = useState([]);
  const loadRenders = useCallback(() => api('renders').then(next => setRenders(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)), []);
  usePoll(loadRenders, 1000);
  const queue = action => body => api(action, body).catch(failure => toast(failure.message)).finally(() => { loadRenders(); loadList(); });
  usePoll(() => api('shots').then(list => setCounts(old => ({...old, shots: list.length}))), 3000);
  useEffect(() => { toast(''); if (['shots', 'settings'].includes(view)) monitor.stop(); }, [hash]);
  useEffect(() => { if (!location.hash) history.replaceState(null, '', '#new'); }, []);

  return <ToastContext.Provider value={toast}>
    <div className={`shell view-${view}`}>
      <Sidebar projects={projects} current={projectId} view={view} counts={counts} renders={renders}
        onCancelRender={id => queue('render-cancel')({id})} onClearRenders={() => queue('renders-clear')()}/>
      <main className="main">
        {message && <div className="toast" role="alert"><span>{message}</span><button type="button" className="toast-close" aria-label="Dismiss" data-tip="Dismiss" onClick={() => toast('')}>×</button></div>}
        {view === 'new' && <NewRecording/>}
        {view === 'project' && <Project key={projectId} id={projectId} onChange={loadList}/>}
        {view === 'shots' && <Shots onCount={shots => setCounts(old => ({...old, shots}))}/>}
        {view === 'settings' && <Settings/>}
      </main>
    </div>
    <Tooltips/>
  </ToastContext.Provider>;
}
