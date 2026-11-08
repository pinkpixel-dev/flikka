import React, {useEffect, useRef, useState} from 'react';
import {AudioLines, Ear, Pause, Play, RotateCcw, Speech, X} from 'lucide-react';
import {api, narrationClipURL} from '../lib/api.js';
import {useToast} from '../lib/toast.js';
import {sayItems, editSay} from '../../../lib/say.mjs';
import {Button, Section} from '../components/ui.jsx';
import {SayAs, sayAsTarget} from './SayAs.jsx';
import {VoiceOptions, findWord, speeds} from './Lines.jsx';

// A film's narration, sentence by sentence (lib/say.mjs): each scene's sentences with their own voice and speed,
// play, speak again, Say as, and the words check. Edits go into film.json through the film page's save (history,
// undo); speaking and checking run flikka project speak and check --lines in the panel's queue.

// One sentence. `status`: what the server knows about it (spoken, misheard), when it still matches.
function SentenceCard({project, scene, at, item, filmVoice, filmSpeed, voices, status, speaking, playing, onPlay, onSpeak, onChange, onPronounce}) {
  const toast = useToast();
  const [draft, setDraft] = useState(item.text);
  const [sayAs, setSayAs] = useState(null);
  const box = useRef(null);
  useEffect(() => setDraft(item.text), [item.text]);
  const voice = item.voice || filmVoice;
  const cloned = voices.some(entry => entry.own && entry.name === voice);
  const made = status?.made;
  const save = () => { if (draft.replace(/\s+/g, ' ').trim() !== item.text) onChange({text: draft}); };
  const openSayAs = () => {
    const area = box.current;
    const target = area && sayAsTarget(draft, area.selectionStart, area.selectionEnd);
    if (target) setSayAs(target); else area?.focus();
  };
  const keys = event => {
    if (event.key === 'Escape') { setDraft(item.text); event.currentTarget.blur(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSayAs(); return; }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); }
  };

  return <li className="line-card">
    <div className="line-head">
      <span className="line-id">{at + 1}</span>
      {speaking ? <span className="chip rendering">Speaking…</span> : !made && <span className="chip">Not spoken</span>}
      <span className="line-head-end">
        {made && <Button size="small" variant="ghost" icon={playing ? Pause : Play} tip={playing ? 'Stop' : 'Play this sentence'} onClick={onPlay}/>}
        <Button size="small" variant="ghost" icon={made ? RotateCcw : AudioLines} disabled={speaking} tip={made ? 'Speak it again' : 'Speak this sentence'} onClick={() => onSpeak(made)}/>
      </span>
    </div>
    <textarea ref={box} className="line-text" rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 34)))} value={draft} aria-label={`Scene ${scene + 1}, sentence ${at + 1}`}
      data-tip="Enter saves (empty removes the sentence). Ctrl+K says a word differently."
      onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={keys}/>
    {sayAs && <SayAs project={project} who={{scene: scene + 1, sentence: at + 1}} text={draft} target={sayAs} ownVoice={cloned} onClose={() => { setSayAs(null); box.current?.focus(); }}
      onSave={text => onChange({text})} onPronounce={onPronounce}/>}
    {status?.misheard?.length > 0 && <div className="line-misheard">
      <span>May be misheard:</span>
      {status.misheard.map(word => <button key={word} type="button" className="chip word-chip" data-tip={`Say "${word}" differently`} onClick={() => {
        const found = findWord(draft, word);
        const target = found >= 0 && sayAsTarget(draft, found, found + word.length);
        if (target) setSayAs(target); else toast(`"${word}" isn’t in the words any more`);
      }}>{word}</button>)}
    </div>}
    <div className="line-controls">
      <select aria-label="Voice" data-tip="Who reads this sentence" value={item.voice || ''} onChange={event => onChange({voice: event.target.value})}>
        <option value="">Film’s voice</option>
        <VoiceOptions voices={voices}/>
      </select>
      <select aria-label="Speed" className="line-speed" data-tip="How fast this sentence is read" value={item.speed == null ? '' : String(item.speed)} onChange={event => onChange({speed: event.target.value})}>
        <option value="">{filmSpeed}×</option>
        {speeds.filter(value => value !== filmSpeed).map(value => <option key={value} value={String(value)}>{value}×</option>)}
      </select>
      <Button size="small" variant="ghost" icon={Speech} tip="Say a word differently: put the cursor on it first (Ctrl+K)" aria-pressed={Boolean(sayAs)}
        onMouseDown={event => event.preventDefault()} onClick={() => sayAs ? setSayAs(null) : openSayAs()}/>
    </div>
  </li>;
}

// film: the film as it is now (with an unsaved scene draft). lines: /film-lines (the saved film's sentences and
// what's known about each). timing: where each scene starts. onSave(film) resolves true when saved.
export function FilmNarration({project, film, lines, timing, onSave, onSeek, onChanged}) {
  const toast = useToast();
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(new Set());
  const [playing, setPlaying] = useState(null);
  const audio = useRef(null);
  useEffect(() => { api('voices').then(setVoices).catch(failure => toast('Voices: ' + failure.message)); }, []);
  useEffect(() => () => audio.current?.pause(), []);
  const filmVoice = film.voice?.name || lines?.voice || 'af_heart';
  const filmSpeed = film.voice?.speed || 1;
  // A sentence's status only counts while its words, voice and speed still match what the server spoke.
  const statusOf = (scene, at, item) => {
    const known = lines?.scenes?.[scene]?.lines?.[at];
    return known && known.text === item.text && known.voice === (item.voice || filmVoice) && known.speed === (item.speed ?? filmSpeed) ? known : null;
  };
  const scenes = film.scenes.map((scene, index) => ({index, scene, items: sayItems(scene.say)})).filter(entry => entry.items.length);
  const unspoken = scenes.reduce((sum, entry) => sum + entry.items.filter((item, at) => !statusOf(entry.index, at, item)?.made).length, 0);
  const spoken = scenes.reduce((sum, entry) => sum + entry.items.length, 0) - unspoken;

  const busy = (key, task) => async () => {
    setSpeaking(old => new Set(old).add(key));
    try { await task(); onChanged(); } catch (failure) { toast(failure.message); }
    finally { setSpeaking(old => { const next = new Set(old); next.delete(key); return next; }); }
  };
  const speak = (scene, at, again) => busy(`${scene}.${at}`, () => api('narration-speak', {id: project.id, scene: scene + 1, sentence: at + 1, again}))();
  const speakAll = busy('all', () => api('narration-speak', {id: project.id}));
  const check = busy('check', async () => {
    const result = await api('narration-check', {id: project.id});
    const flagged = result.scenes.flatMap(scene => scene.lines).filter(line => line.misheard).length;
    toast(flagged ? `${flagged === 1 ? '1 sentence' : flagged + ' sentences'} may be misheard: click a word to say it differently` : 'Every spoken sentence sounds right');
  });
  const play = (scene, at) => {
    const key = `${scene}.${at}`;
    audio.current?.pause();
    if (playing === key) { setPlaying(null); return; }
    const sound = new Audio(narrationClipURL(project.id, null, {scene: scene + 1, sentence: at + 1}));
    audio.current = sound;
    sound.onended = sound.onerror = () => setPlaying(current => current === key ? null : current);
    sound.play().then(() => setPlaying(key), failure => { setPlaying(null); toast('Couldn’t play it: ' + failure.message); });
  };
  const withSay = (current, scene, at, change) => {
    const scenes = [...current.scenes];
    const next = {...scenes[scene], say: editSay(scenes[scene].say, at, change)};
    if (next.say === undefined) delete next.say;
    scenes[scene] = next;
    return {...current, scenes};
  };
  const change = (scene, at, value) => onSave(withSay(film, scene, at, value));
  // Everywhere: the film's pronunciations (voice.pronounce); a mark on this spot comes off.
  const pronounce = (scene, at) => (word, say, unmarked) => {
    const base = unmarked ? withSay(film, scene, at, {text: unmarked}) : film;
    const voice = {...base.voice, pronounce: {...base.voice?.pronounce}};
    if (say) voice.pronounce[word] = say; else delete voice.pronounce[word];
    if (!Object.keys(voice.pronounce).length) delete voice.pronounce;
    return onSave({...base, voice});
  };

  return <Section title={`${spoken + unspoken} sentence${spoken + unspoken === 1 ? '' : 's'}`} aside={<div className="button-row">
    {spoken > 0 && <Button size="small" icon={Ear} disabled={speaking.has('check')} tip="Listen to the spoken sentences with Whisper and flag words a listener may mishear"
      onClick={check}>{speaking.has('check') ? 'Checking…' : 'Check'}</Button>}
    {unspoken > 0 && <Button size="small" icon={AudioLines} disabled={speaking.has('all')} tip="Speak every sentence that isn’t spoken yet"
      onClick={speakAll}>{speaking.has('all') ? 'Speaking…' : `Speak ${unspoken}`}</Button>}
  </div>}>
    {film.voice?.pronounce && <div className="pronounce">
      <span className="field-label">Said this way everywhere</span>
      <ul>{Object.entries(film.voice.pronounce).map(([word, sound]) => <li key={word}>
        <span>{word}</span><span className={'pronounce-sound' + (sound.startsWith('/') ? ' phonemes' : '')}>{sound}</span>
        <Button size="small" variant="ghost" icon={X} tip={`Say ${word} the usual way again`} onClick={() => pronounce(0, 0)(word, '', null)}/>
      </li>)}</ul>
    </div>}
    {scenes.length ? scenes.map(({index, scene, items}) => <div key={index} className="scene-group">
      <button type="button" className="scene-head" data-tip="Jump to this scene" disabled={!timing?.[index]} onClick={() => onSeek(timing[index].start)}>
        <span className="line-time">{index + 1}</span><span>{scene.title ? String(scene.title).replace(/[*\[\]]/g, '') : scene.type}</span>
      </button>
      <ol className="line-list">{items.map((item, at) => <SentenceCard key={`${index}.${at}`} project={project} scene={index} at={at} item={item} filmVoice={filmVoice} filmSpeed={filmSpeed}
        voices={voices} status={statusOf(index, at, item)} speaking={speaking.has(`${index}.${at}`) || (speaking.has('all') && !statusOf(index, at, item)?.made)} playing={playing === `${index}.${at}`}
        onPlay={() => play(index, at)} onSpeak={again => speak(index, at, again)} onChange={value => change(index, at, value)} onPronounce={pronounce(index, at)}/>)}</ol>
    </div>) : <p className="hint">No narration yet. Give a scene something to say.</p>}
  </Section>;
}
