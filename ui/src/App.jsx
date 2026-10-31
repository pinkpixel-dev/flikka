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
import {Voices} from './views/Voices.jsx';

export function App() {
  const hash = useHash();
  const [projectId] = hash.match(/^project\/([\w-]+)$/)?.slice(1) || [];
  const view = projectId ? 'project' : ['shots', 'voices'].includes(hash) ? hash : 'new';
  const [projects, setProjects] = useState(null);
  const [counts, setCounts] = useState({shots: 0, voices: 0});
  const [message, setMessage] = useState('');
  const toast = useCallback(text => setMessage(text || ''), []);

  // The list every 3 s: an agent may record or render meanwhile.
  const loadList = useCallback(() => api('projects').then(setProjects), []);
  usePoll(loadList, 3000);
  usePoll(() => api('shots').then(list => setCounts(old => ({...old, shots: list.length}))), 3000);
  useEffect(() => { api('voices').then(list => setCounts(old => ({...old, voices: list.length}))).catch(() => {}); }, [view]);
  useEffect(() => { toast(''); if (view === 'shots' || view === 'voices') monitor.stop(); }, [hash]);
  useEffect(() => { if (!location.hash) history.replaceState(null, '', '#new'); }, []);

  return <ToastContext.Provider value={toast}>
    <div className={`shell view-${view}`}>
      <Sidebar projects={projects} current={projectId} view={view} counts={counts}/>
      <main className="main">
        {message && <div className="toast" role="alert"><span>{message}</span><button type="button" className="toast-close" aria-label="Dismiss" onClick={() => toast('')}>×</button></div>}
        {view === 'new' && <NewRecording/>}
        {view === 'project' && <Project key={projectId} id={projectId} onChange={loadList}/>}
        {view === 'shots' && <Shots onCount={shots => setCounts(old => ({...old, shots}))}/>}
        {view === 'voices' && <Voices onCount={voices => setCounts(old => ({...old, voices}))}/>}
      </main>
    </div>
    <Tooltips/>
  </ToastContext.Provider>;
}
