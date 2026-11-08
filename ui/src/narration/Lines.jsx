import React, {useEffect, useRef, useState} from 'react';
import {AudioLines, Copy, Ear, Gauge, Pause, Play, Plus, RotateCcw, Speech, Trash2, Volume2, VolumeX, X} from 'lucide-react';
import {api, narrationClipURL} from '../lib/api.js';
import {clock} from '../lib/format.js';
import {useToast} from '../lib/toast.js';
import {useFlash} from '../lib/hooks.js';
import {plainText} from '../../../lib/marks.mjs';
import {Button, ConfirmButton, Section} from '../components/ui.jsx';
import {SayAs, sayAsTarget} from './SayAs.jsx';

// A recording's narration lines (project.narration, lib/narration.mjs), as the timeline places them: edit the
// words, voice and speed, play a line, speak it (or again), split at the cursor and merge up, remove it, and add
// one at the playhead. Every change goes through the same edit options the CLI has (flikka project edit).
const speeds = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

// What a line needs looked at, from the timeline (lib/narration.mjs placeLines).
const problems = line => [
  line.overrun && `${line.overrun.toFixed(1)} s too long for its moment`,
  line.overlaps && `Starts before ${line.overlaps} ends`,
  line.runsPast && 'Runs past the end',
  line.snapped && 'Its moment was cut',
].filter(Boolean);

// Fit stops here (lib/narration.mjs maxFitSpeed); past it the words need shortening.
const maxFitSpeed = 1.3;

// Shorten is your agent's job: a prompt with the line, how long it runs over and its word budget.
const shortenPrompt = (project, line) => `In Flikka project ${project.id}, narration line ${line.id} runs ${line.overrun.toFixed(1)} s too long for its moment. `
  + `Rewrite it in ${line.shortenTo} words or fewer, keeping what it says: "${plainText(line.text)}". `
  + (plainText(line.text) !== line.text ? `Its text has say-as marks, [word](how it sounds): keep them on any of those words you keep. The text as stored: "${line.text}". ` : '')
  + `Save it with flikka project edit ${project.id} --reword "${line.id},<new words>", then flikka project speak ${project.id} --line ${line.id} and check it fits with flikka project timeline ${project.id}.`;

// Where a word the check flagged sits in the text (any case, standing on its own), or -1.
const findWord = (text, word) => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.search(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu'));
};

// Where the cursor sits in the words as they'll be saved (spaces squeezed, the start trimmed), for a split.
const savedPosition = (text, at) => text.slice(0, at).replace(/\s+/g, ' ').trimStart().length;
const squeeze = text => text.replace(/\s+/g, ' ').trim();

function VoiceOptions({voices}) {
  const groups = [...new Set(voices.map(voice => voice.language))];
  return groups.map(group => <optgroup key={group} label={group}>
    {voices.filter(voice => voice.language === group).map(voice => <option key={voice.name} value={voice.name}>{voice.name}{voice.gender ? ` · ${voice.gender}` : ''}</option>)}
  </optgroup>);
}

function LineCard({project, line, first, voices, narrator, speaking, playing, onPlay, onSpeak, onFit, onEdit, onSeek}) {
  const toast = useToast();
  const [copied, flash] = useFlash();
  const [draft, setDraft] = useState(line.text);
  const [sayAs, setSayAs] = useState(null);
  const box = useRef(null);
  // Say as: the word under the cursor or selection (Ctrl+K or the button).
  const openSayAs = () => {
    const area = box.current;
    const target = area && sayAsTarget(draft, area.selectionStart, area.selectionEnd);
    if (target) setSayAs(target); else { area?.focus(); }
  };
  useEffect(() => setDraft(line.text), [line.text]);
  const changed = squeeze(draft) !== line.text;
  // The words as typed go in with a split or merge, so nothing typed is lost (one edit, one undo step).
  const withWords = change => [...(changed && squeeze(draft) ? [{reword: {line: line.id, text: draft}}] : []), change];
  const save = () => { if (changed && squeeze(draft)) onEdit([{reword: {line: line.id, text: draft}}]); else setDraft(line.text); };
  const keys = event => {
    const box = event.currentTarget;
    if (event.key === 'Escape') { setDraft(line.text); box.blur(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSayAs(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      const at = savedPosition(draft, box.selectionStart);
      if (at > 0 && at < squeeze(draft).length) onEdit(withWords({split: {line: line.id, at}}));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Backspace' && !first && box.selectionStart === 0 && box.selectionEnd === 0) {
      event.preventDefault();
      onEdit(withWords({merge: line.id}));
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); box.blur(); }
  };
  const issues = problems(line);
  const ownVoice = line.voice === narrator?.voice ? '' : line.voice;
  const cloned = voices.some(voice => voice.own && voice.name === line.voice);
  const ownSpeed = line.speed === narrator?.speed ? '' : String(line.speed);

  return <li className={'line-card' + (line.muted ? ' muted-line' : '')}>
    <div className="line-head">
      <button type="button" className="line-time" disabled={line.from == null} data-tip={line.from == null ? 'Lands once the lines before it are spoken' : 'Jump to this line'}
        onClick={() => onSeek(line.from)}>{line.from == null ? '–:––' : clock(line.from)}</button>
      <span className="line-id">{line.id}</span>
      {speaking ? <span className="chip rendering">Speaking…</span> : !line.made && <span className="chip">Not spoken</span>}
      {line.muted && <span className="chip">Muted</span>}
      <span className="line-head-end">
        {line.made && <Button size="small" variant="ghost" icon={playing ? Pause : Play} tip={playing ? 'Stop' : 'Play this line'} onClick={onPlay}/>}
        <Button size="small" variant="ghost" icon={line.made ? RotateCcw : AudioLines} disabled={speaking} tip={line.made ? 'Speak it again' : 'Speak this line'} onClick={() => onSpeak(line.id, line.made)}/>
        <Button size="small" variant="ghost" icon={line.muted ? VolumeX : Volume2} tip={line.muted ? 'Unmute: heard in the video again' : 'Mute: keeps its place, stays silent'}
          onClick={() => onEdit([{set: {line: line.id, muted: !line.muted}}])}/>
        <ConfirmButton size="small" variant="ghost" icon={Trash2} tip="Remove this line (Ctrl+Z undoes)" armed="Remove?" onConfirm={() => onEdit([{remove: line.id}])}/>
      </span>
    </div>
    <textarea ref={box} className="line-text" rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 34)))} value={draft} aria-label={`Line ${line.id}`}
      data-tip="Enter saves. Ctrl+K says a word differently. Ctrl+Enter splits at the cursor, Ctrl+Backspace at the start merges into the line above."
      onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={keys}/>
    {sayAs && <SayAs project={project} line={line} text={draft} target={sayAs} ownVoice={cloned} onEdit={onEdit} onClose={() => { setSayAs(null); box.current?.focus(); }}/>}
    {issues.length > 0 && <ul className="line-issues">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {line.misheard?.length > 0 && <div className="line-misheard">
      <span>May be misheard:</span>
      {line.misheard.map(word => <button key={word} type="button" className="chip word-chip" data-tip={`Say "${word}" differently`} onClick={() => {
        const at = findWord(draft, word);
        const target = at >= 0 && sayAsTarget(draft, at, at + word.length);
        if (target) setSayAs(target); else toast(`"${word}" isn’t in the words any more`);
      }}>{word}</button>)}
    </div>}
    {line.overrun > 0 && <div className="line-fix">
      <Button size="small" icon={Gauge} disabled={speaking || line.speed >= maxFitSpeed}
        tip={line.speed >= maxFitSpeed ? `Already at ${maxFitSpeed}×, as fast as Fit goes: shorten it` : `Read it faster until it fits (up to ${maxFitSpeed}×), then speak it again`} onClick={() => onFit(line.id)}>Fit</Button>
      {line.shortenTo && <Button size="small" icon={Copy} tip={`Copy a prompt asking your agent to say it in ${line.shortenTo} words or fewer`}
        onClick={() => navigator.clipboard.writeText(shortenPrompt(project, line)).then(() => flash('shorten'))}>{copied === 'shorten' ? 'Copied' : 'Shorten'}</Button>}
    </div>}
    <div className="line-controls">
      <select aria-label="Voice" data-tip="Who reads this line" value={ownVoice} onChange={event => onEdit([{set: {line: line.id, voice: event.target.value}}])}>
        <option value="">Narrator</option>
        <VoiceOptions voices={voices}/>
      </select>
      <select aria-label="Speed" className="line-speed" data-tip="How fast this line is read" value={ownSpeed} onChange={event => onEdit([{set: {line: line.id, speed: event.target.value ? Number(event.target.value) : ''}}])}>
        <option value="">{narrator ? `${narrator.speed}×` : '1×'}</option>
        {speeds.filter(speed => speed !== narrator?.speed).map(speed => <option key={speed} value={String(speed)}>{speed}×</option>)}
      </select>
      <Button size="small" variant="ghost" icon={Speech} tip="Say a word differently: put the cursor on it first (Ctrl+K)" aria-pressed={Boolean(sayAs)}
        onMouseDown={event => event.preventDefault()} onClick={() => sayAs ? setSayAs(null) : openSayAs()}/>
    </div>
  </li>;
}

// onEdit(changes): save and refresh. onSpoken(): lines were spoken, so the timeline and preview read them again.
export function Narration({project, timeline, time, onSeek, onEdit, onSpoken}) {
  const toast = useToast();
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(new Set());
  const [playing, setPlaying] = useState(null);
  const [said, setSaid] = useState('');
  const audio = useRef(null);
  useEffect(() => { api('voices').then(setVoices).catch(failure => toast('Voices: ' + failure.message)); }, []);
  useEffect(() => () => audio.current?.pause(), []);
  const lines = timeline?.narration || [];
  const narrator = timeline?.narrator;
  const unspoken = lines.filter(line => !line.made).length;

  const speak = async (line = null, again = false) => {
    const key = line || 'all';
    setSpeaking(old => new Set(old).add(key));
    try { await api('narration-speak', {id: project.id, line, again}); onSpoken(); }
    catch (failure) { toast(failure.message); }
    finally { setSpeaking(old => { const next = new Set(old); next.delete(key); return next; }); }
  };
  const fit = async line => {
    setSpeaking(old => new Set(old).add(line));
    try {
      const {fitted} = await api('narration-fit', {id: project.id, line});
      const result = fitted.find(item => item.id === line);
      if (result && !result.fits) toast(result.note);
      onSpoken();
    } catch (failure) { toast(failure.message); }
    finally { setSpeaking(old => { const next = new Set(old); next.delete(line); return next; }); }
  };
  // The words check: Whisper hears every spoken line not heard yet and the timeline shows what it may mishear.
  const check = async () => {
    setSpeaking(old => new Set(old).add('check'));
    try {
      const result = await api('narration-check', {id: project.id});
      const flagged = result.lines.filter(line => line.misheard.length).length;
      toast(flagged ? `${flagged === 1 ? '1 line' : flagged + ' lines'} may be misheard: click a word to say it differently` : 'Every spoken line sounds right');
      onSpoken();
    } catch (failure) { toast(failure.message); }
    finally { setSpeaking(old => { const next = new Set(old); next.delete('check'); return next; }); }
  };
  const play = id => {
    audio.current?.pause();
    if (playing === id) { setPlaying(null); return; }
    const sound = new Audio(narrationClipURL(project.id, id));
    audio.current = sound;
    sound.onended = sound.onerror = () => setPlaying(current => current === id ? null : current);
    sound.play().then(() => setPlaying(id), failure => { setPlaying(null); toast('Couldn’t play it: ' + failure.message); });
  };
  const add = event => {
    event.preventDefault();
    if (!squeeze(said)) return;
    onEdit([{add: {at: time, text: said}}]).then(saved => saved && setSaid(''));
  };

  const spoken = lines.length - unspoken;
  return <Section title={lines.length === 1 ? '1 line' : `${lines.length} lines`} aside={<div className="button-row">
    {spoken > 0 && <Button size="small" icon={Ear} disabled={speaking.has('check')} tip="Listen to the spoken lines with Whisper and flag words a listener may mishear"
      onClick={check}>{speaking.has('check') ? 'Checking…' : 'Check'}</Button>}
    {unspoken > 0 && <Button size="small" icon={AudioLines} disabled={speaking.has('all')} tip="Speak every line that isn’t spoken yet"
      onClick={() => speak()}>{speaking.has('all') ? 'Speaking…' : `Speak ${unspoken}`}</Button>}
  </div>}>
    {narrator && <label className="line" data-tip="Reads every line that doesn’t pick its own voice"><span>Narrator</span>
      <select value={narrator.voice} onChange={event => onEdit([{narrator: event.target.value}])}>
        {!voices.some(voice => voice.name === narrator.voice) && <option value={narrator.voice}>{narrator.voice}</option>}
        <VoiceOptions voices={voices}/>
      </select></label>}
    {narrator?.pronounce && <div className="pronounce">
      <span className="field-label">Said this way everywhere</span>
      <ul>{Object.entries(narrator.pronounce).map(([word, sound]) => <li key={word}>
        <span>{word}</span><span className={'pronounce-sound' + (sound.startsWith('/') ? ' phonemes' : '')}>{sound}</span>
        <Button size="small" variant="ghost" icon={X} tip={`Say ${word} the usual way again`} onClick={() => onEdit([{pronounce: {word, say: ''}}])}/>
      </li>)}</ul>
    </div>}
    {lines.length ? <ol className="line-list">{lines.map((line, index) => <LineCard key={line.id} project={project} line={line} first={index === 0} voices={voices} narrator={narrator}
      speaking={speaking.has(line.id) || (speaking.has('all') && !line.made)} playing={playing === line.id} onPlay={() => play(line.id)}
      onSpeak={speak} onFit={fit} onEdit={onEdit} onSeek={onSeek}/>)}</ol>
      : <p className="hint">No narration yet. Write a line and it’s read at the playhead.</p>}
    <form className="line-add" onSubmit={add}>
      <textarea rows={2} value={said} placeholder={`Say something at ${clock(time)}`} aria-label="New line"
        onChange={event => setSaid(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) add(event); }}/>
      <Button type="submit" size="small" icon={Plus} disabled={!squeeze(said)} tip="Add the line at the playhead">Add at {clock(time)}</Button>
    </form>
  </Section>;
}
