import React, {useEffect, useState} from 'react';
import {Pause, Play, Square} from 'lucide-react';
import {api} from '../lib/api.js';
import {clock} from '../lib/format.js';
import {useMicLevel} from '../lib/hooks.js';
import {monitor} from '../lib/monitor.js';
import {useToast} from '../lib/toast.js';
import {Button, Meter} from '../components/ui.jsx';

// While recording: the time, the mic, pause and finish. Finish stops (the recording is mixed, the cursor saved,
// the auto edit made), then renders; the project page shows the steps as they happen.
export function LiveRecording({project, refresh, onChange}) {
  const toast = useToast();
  const level = useMicLevel();
  const [now, setNow] = useState(Date.now());
  const [finishing, setFinishing] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  const paused = project.state === 'paused';
  const elapsed = (project.elapsed || 0) + (project.state === 'recording' && project.startedAt ? now / 1000 - project.startedAt : 0);

  const togglePause = () => api(paused ? 'resume' : 'pause', {id: project.id}).then(refresh).catch(failure => toast(failure.message));
  const finish = async () => {
    setFinishing(true); toast('');
    monitor.stop();
    try { await api('stop', {id: project.id}); await refresh(); await api('render', {id: project.id}); }
    catch (failure) { toast(failure.message); }
    finally { setFinishing(false); refresh(); onChange(); }
  };

  return <div className={`recording-live ${project.state}`}>
    <div className="live-state"><span className="dot"/>{project.state === 'starting' ? 'Starting' : paused ? 'Paused' : 'Recording'}</div>
    <div className="timer" aria-live="off">{clock(elapsed)}</div>
    <p className="muted">{paused ? 'Paused. This part won’t be in the video.' : 'Show what you’re building. Pause any time.'}</p>
    {monitor.stream && <div className="live-meter"><Meter level={level}/></div>}
    <div className="button-row center">
      <Button icon={paused ? Play : Pause} disabled={finishing || project.state === 'starting'} onClick={togglePause} tip={paused ? 'Keep recording' : 'Leave the next part out'}>{paused ? 'Resume' : 'Pause'}</Button>
      <Button variant="record" icon={Square} disabled={finishing} onClick={finish} tip="Stop, then render the video">{finishing ? 'Finishing…' : 'Finish'}</Button>
    </div>
  </div>;
}
