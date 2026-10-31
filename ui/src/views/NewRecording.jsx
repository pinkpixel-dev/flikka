import React, {useEffect, useRef, useState} from 'react';
import {Circle, RefreshCw, VideoOff} from 'lucide-react';
import {api} from '../lib/api.js';
import {useMicLevel, useMonitor} from '../lib/hooks.js';
import {monitor} from '../lib/monitor.js';
import {useToast} from '../lib/toast.js';
import {Button, Meter, Switch} from '../components/ui.jsx';

// The setup is remembered between visits (same keys as before the redesign).
const remembered = ['name', 'source', 'mic', 'camera', 'fps', 'delay', 'systemAudio', 'autoZoom', 'hideCursor'];
const defaults = {name: 'My demo', source: '', mic: '', camera: '', fps: '60', delay: '3', systemAudio: false, autoZoom: true, hideCursor: false, useRegion: false, region: {x: 0, y: 0, w: 1280, h: 720}};
const restore = () => { try { const saved = JSON.parse(localStorage.getItem('flikka-setup') || '{}'); return {...defaults, ...Object.fromEntries(remembered.filter(key => key in saved).map(key => [key, saved[key]]))}; } catch { return defaults; } };
const store = setup => { try { localStorage.setItem('flikka-setup', JSON.stringify(Object.fromEntries(remembered.map(key => [key, setup[key]])))); } catch {} };

// Screens and devices, once per page: every open tab asking at once (a panel restart reloads them all) could keep
// the capture service busy while a quick recording was starting.
let sourcesLoaded = null;
const loadSources = (again = false) => {
  if (again || !sourcesLoaded) sourcesLoaded = api('sources').catch(failure => { sourcesLoaded = null; throw failure; });
  return sourcesLoaded;
};

export function NewRecording() {
  const toast = useToast();
  const [setup, setSetup] = useState(restore);
  const [sources, setSources] = useState(null);
  const [count, setCount] = useState(0);
  const [starting, setStarting] = useState(false);
  const [deviceNote, setDeviceNote] = useState('');
  const [heard, setHeard] = useState(false);
  const stream = useMonitor();
  const level = useMicLevel();
  const video = useRef();

  const change = patch => setSetup(old => { const next = {...old, ...patch}; store(next); return next; });
  const names = (list, id) => list?.find(item => String(item.id) === String(id))?.name;

  const refresh = again => loadSources(again).then(data => {
    setSources(data);
    // A saved screen or window that is gone: the first screen.
    const options = [...data.displays.map(display => 'display:' + display.index), ...data.windows.map(item => 'window:' + item.id)];
    setSetup(old => ({...old, source: options.includes(old.source) ? old.source : options[0] || ''}));
  }).catch(failure => toast(failure.message));
  useEffect(() => { refresh(false); }, []);

  // The camera and mic check follows the picked devices.
  const mic = names(sources?.microphones, setup.mic), camera = names(sources?.cameras, setup.camera);
  useEffect(() => {
    if (!sources) return;
    setDeviceNote(''); setHeard(false);
    monitor.start({mic, camera}).catch(failure => setDeviceNote('Can’t open the mic or camera here: ' + failure.message));
  }, [sources, mic, camera]);
  // Leaving the page stops the check, unless a recording just started (its meter keeps the mic).
  const started = useRef(false);
  useEffect(() => () => { if (!started.current) monitor.stop(); }, []);
  useEffect(() => { if (video.current) video.current.srcObject = monitor.camera; }, [stream]);
  useEffect(() => { if (level > 0.05) setHeard(true); }, [level]);

  const start = async () => {
    if (starting) return;
    setStarting(true); toast('');
    try {
      for (let seconds = Number(setup.delay); seconds > 0; seconds--) { setCount(seconds); await new Promise(resolve => setTimeout(resolve, 1000)); }
      setCount(0);
      monitor.stop(true);  // the recorder takes the camera; the mic meter goes on into the recording
      const [kind, value] = setup.source.split(':');
      const body = {[kind]: Number(value), microphone: setup.mic, systemAudio: setup.systemAudio, autoZoom: setup.autoZoom, hideCursor: setup.hideCursor,
        camera: setup.camera, fps: Number(setup.fps), name: setup.name.trim() || 'My demo'};
      if (setup.useRegion) body.region = [setup.region.x, setup.region.y, setup.region.w, setup.region.h].join(',');
      const session = await api('start', body);
      started.current = true;
      location.hash = '#project/' + session.id;
    } catch (failure) {
      toast(failure.message); setCount(0); setStarting(false);
      monitor.start({mic, camera}).catch(() => {});
    }
  };

  const micNote = deviceNote || (!setup.mic ? 'Mic off: the recording will have no voice.' : heard ? 'Mic is picking up your voice.' : 'Say a few words.');
  return <div className="page new-recording">
    <header className="page-head"><h1>New recording</h1></header>
    <div className="setup-grid">
      <fieldset className="panel form" disabled={starting}>
        <label className="field"><span>Name</span><input type="text" value={setup.name} maxLength={80} onChange={event => change({name: event.target.value})}/></label>
        <div className="field">
          <span className="field-label" id="sourceLabel">What to record</span>
          <div className="with-action">
            <select aria-labelledby="sourceLabel" value={setup.source} onChange={event => change({source: event.target.value})}>
              {!sources && <option>Loading…</option>}
              {sources?.displays.map(display => <option key={'d' + display.index} value={'display:' + display.index}>Screen {display.index + 1} · {display.width} × {display.height}</option>)}
              {sources?.windows.map(item => <option key={'w' + item.id} value={'window:' + item.id}>{item.app} · {item.title || 'Untitled'}</option>)}
            </select>
            <Button icon={RefreshCw} tip="Refresh screens, windows and devices" onClick={() => refresh(true)}/>
          </div>
        </div>
        <Switch label="Only a region" tip="Crop inside the screen or window" checked={setup.useRegion} onChange={useRegion => change({useRegion})}/>
        {setup.useRegion && <div className="row four">
          {[['x', 'Left'], ['y', 'Top'], ['w', 'Width'], ['h', 'Height']].map(([key, label]) =>
            <label className="field" key={key}><span>{label}</span><input type="number" min={key === 'w' || key === 'h' ? 2 : 0} value={setup.region[key]}
              onChange={event => change({region: {...setup.region, [key]: Number(event.target.value)}})}/></label>)}
        </div>}
        <div className="row">
          <label className="field"><span>Microphone</span><select value={setup.mic} onChange={event => change({mic: event.target.value})}>
            <option value="">Off</option>{sources?.microphones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>Camera bubble</span><select value={setup.camera} onChange={event => change({camera: event.target.value})}>
            <option value="">Off</option>{sources?.cameras.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <div className="switches">
          <Switch label="System audio" tip="Desktop and app sound through PipeWire" checked={setup.systemAudio} onChange={systemAudio => change({systemAudio})}/>
          <Switch label="Zoom on clicks" tip="Moves in where you click. You can turn it off later too." checked={setup.autoZoom} onChange={autoZoom => change({autoZoom})}/>
          <Switch label="Hide cursor" tip="Record without the mouse pointer" checked={setup.hideCursor} onChange={hideCursor => change({hideCursor})}/>
        </div>
        <div className="row">
          <label className="field"><span>Frame rate</span><select value={setup.fps} onChange={event => change({fps: event.target.value})}>
            <option value="60">60 fps</option><option value="30">30 fps · smaller</option></select></label>
          <label className="field"><span>Countdown</span><select value={setup.delay} onChange={event => change({delay: event.target.value})}>
            <option value="3">3 s</option><option value="5">5 s</option><option value="0">None</option></select></label>
        </div>
      </fieldset>
      <div className="panel check">
        <div className="camera-stage textured">
          {monitor.camera ? <video ref={video} autoPlay muted playsInline/> : <div className="stage-note"><VideoOff size={22} strokeWidth={1.6} aria-hidden/>{setup.camera ? 'Starting camera…' : 'Camera off'}</div>}
          {count > 0 && <div className="countdown" aria-live="assertive">{count}</div>}
        </div>
        <div className="mic-check">
          <div className="field-label">Mic level</div>
          <Meter level={setup.mic ? level : 0}/>
          <small className={deviceNote ? 'bad' : 'muted'}>{micNote}</small>
        </div>
        <Button variant="record" className="start" icon={Circle} disabled={starting || !setup.source} onClick={start}
          tip="Starts after the countdown">{starting ? (count ? 'Get ready…' : 'Starting…') : 'Start recording'}</Button>
      </div>
    </div>
  </div>;
}
