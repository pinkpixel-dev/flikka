import React, {useEffect, useRef, useState} from 'react';
import {Circle, Square, Trash2, Upload, Volume2} from 'lucide-react';
import {api, uploadVoice, voiceURL} from '../lib/api.js';
import {when} from '../lib/format.js';
import {useToast} from '../lib/toast.js';
import {Button, ConfirmButton, Meter} from '../components/ui.jsx';

const script = 'Hi, I’m going to show you something I built. It records the screen, cuts the boring parts, and turns it into a short video in about two minutes. Let’s open the dashboard and look at the numbers.';

// Your own voices for narration. In a film: "voice": {"name": "…"}.
export function Voices({onCount}) {
  const toast = useToast();
  const [voices, setVoices] = useState(null);
  const load = () => api('voices').then(list => { setVoices(list); onCount(list.length); }).catch(failure => toast(failure.message));
  useEffect(() => { load(); }, []);
  return <div className="page">
    <header className="page-head"><h1>Voices</h1><span className="muted">Your own voices, for narration. In a film: <code>"voice": {'{'}"name": "…"{'}'}</code></span></header>
    <div className="voices-grid">
      <div className="voice-list">
        {voices?.length === 0 && <div className="panel empty">No voices yet. Add one: read the text aloud, or upload a voice note.</div>}
        {voices?.map(voice => <Voice key={voice.name + voice.created} voice={voice} onRemove={load}/>)}
      </div>
      <AddVoice onAdded={load}/>
    </div>
  </div>;
}

function Voice({voice, onRemove}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [said, setSaid] = useState(null);
  const result = useRef();
  const say = async () => {
    setSpeaking(true); toast('');
    try { await api('voice-say', {name: voice.name, text}); setSaid(Date.now()); }
    catch (failure) { toast(failure.message); }
    finally { setSpeaking(false); }
  };
  useEffect(() => { if (said) result.current?.play(); }, [said]);
  return <div className="panel voice">
    <header><h3>{voice.name}</h3>
      <ConfirmButton size="small" icon={Trash2} tip="Delete this voice" onConfirm={() => api('voice-remove', {name: voice.name}).then(onRemove).catch(failure => toast(failure.message))}>Delete</ConfirmButton></header>
    <p className="muted">Made {when(voice.created)} · “{voice.said}”</p>
    <audio controls preload="none" src={voiceURL(voice.name, voice.created)}/>
    <div className="say">
      <input type="text" placeholder="Type something to hear it in this voice" maxLength={600} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => event.key === 'Enter' && say()}/>
      <Button icon={Volume2} disabled={speaking} onClick={say} tip="Speak it in this voice">{speaking ? 'Speaking…' : 'Say it'}</Button>
    </div>
    {said && <audio ref={result} controls src={voiceURL(voice.name, said, 'try')}/>}
  </div>;
}

// Adding one: record in the page (stops by itself after 20 s) or pick a file; the server cleans it, trims it and
// checks the words.
function AddVoice({onAdded}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [note, setNote] = useState('The same name replaces that voice. A failed try keeps the old one.');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef(null);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const file = useRef();

  const add = async blob => {
    const chosen = name.trim() || 'me';
    if (!/^[\w-]+$/.test(chosen)) { toast('A voice name is letters, digits, - or _ (no spaces).'); return; }
    setBusy(true); toast('');
    setNote('Cleaning the sample and checking the words… about a minute.');
    try { const result = await uploadVoice(chosen, blob); setNote(`Added “${chosen}”. It heard: “${result.said}”`); onAdded(); }
    catch (failure) { setNote('Not added.'); toast(failure.message); }
    finally { setBusy(false); }
  };
  const record = async () => {
    if (recorder.current) { recorder.current.stop(); return; }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}});
      const parts = [], take = recorder.current = new MediaRecorder(mic);
      const context = new AudioContext(), analyser = context.createAnalyser(), buffer = new Float32Array(1024);
      analyser.fftSize = 1024; context.createMediaStreamSource(mic).connect(analyser);
      const started = Date.now();
      let alive = true;
      const tick = () => {
        if (!alive) return;
        analyser.getFloatTimeDomainData(buffer);
        setLevel(Math.min(1, Math.sqrt(buffer.reduce((total, value) => total + value * value, 0) / buffer.length) * 5));
        const elapsed = (Date.now() - started) / 1000;
        setSeconds(Math.floor(elapsed));
        if (elapsed >= 20) take.stop(); else requestAnimationFrame(tick);
      };
      take.ondataavailable = event => parts.push(event.data);
      take.onstop = () => {
        alive = false; mic.getTracks().forEach(track => track.stop()); context.close();
        recorder.current = null; setRecording(false); setLevel(0);
        add(new Blob(parts, {type: parts[0]?.type}));
      };
      take.start(); setRecording(true); setSeconds(0); tick();
      setNote('Recording: read the text, then press Stop.');
    } catch (failure) { toast('Can’t open the mic here: ' + failure.message); }
  };

  return <div className="panel add-voice">
    <h2>Add a voice</h2>
    <label className="field"><span>Name</span><input type="text" placeholder="me" maxLength={40} value={name} onChange={event => setName(event.target.value)}/></label>
    <div className="field-label">Read this aloud, in your normal demo voice (about 15 seconds)</div>
    <p className="script">{script}</p>
    <Meter level={level}/>
    <div className="button-row">
      <Button variant={recording ? undefined : 'record'} icon={recording ? Square : Circle} disabled={busy} onClick={record}
        tip={recording ? 'Stop and add it' : 'Record a sample (up to 20 s)'}>{recording ? `Stop · ${seconds} s` : 'Record'}</Button>
      <Button icon={Upload} disabled={busy || recording} onClick={() => file.current.click()} tip="A voice note or a video, any language">Upload a file</Button>
      <input ref={file} type="file" accept="audio/*,video/*" hidden onChange={event => { if (event.target.files[0]) add(event.target.files[0]); event.target.value = ''; }}/>
    </div>
    <p className="muted small">{note}</p>
  </div>;
}
