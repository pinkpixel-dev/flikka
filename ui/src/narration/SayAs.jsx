import React, {useEffect, useRef, useState} from 'react';
import {Play, X} from 'lucide-react';
import {api, triedLineURL} from '../lib/api.js';
import {useToast} from '../lib/toast.js';
import {marks, isPhonemes} from '../../../lib/marks.mjs';
import {Button, Switch} from '../components/ui.jsx';

// The word a Say as opens on: the mark the cursor or selection is in, else the selected word, else the word at
// the cursor. {start, end, word, say} in the text, or null when there's no word there.
export function sayAsTarget(text, from, to) {
  const mark = marks(text).find(item => from >= item.start && to <= item.end && (from > item.start || to < item.end || from === to));
  if (mark) return mark;
  const isLetter = character => /[\p{L}\p{N}'’-]/u.test(character || '');
  let start = from, end = to;
  if (start === end) { while (start > 0 && isLetter(text[start - 1])) start--; while (end < text.length && isLetter(text[end])) end++; }
  while (start < end && !isLetter(text[start])) start++;
  while (end > start && !isLetter(text[end - 1])) end--;
  const word = text.slice(start, end);
  return word && !/[\[\]()]/.test(word) ? {start, end, word, say: ''} : null;
}

// How one word is said: like another spelling, or exact phonemes (Kokoro only), in this spot or everywhere in the
// project. Preview speaks the line with it, in the line's voice. `who`: which line, as /narration-try takes it
// ({line} for a recording, {scene, sentence} for a film). onSave(text) saves the words; onPronounce(word, say,
// unmarked) saves a pronunciation for every line (unmarked: the words without this spot's mark, or null). Both
// resolve true when saved.
export function SayAs({project, who, text, target, ownVoice, onSave, onPronounce, onClose}) {
  const toast = useToast();
  const [mode, setMode] = useState(isPhonemes(target.say) && !ownVoice ? 'phonemes' : 'sounds');
  const [value, setValue] = useState(target.say ? target.say.replace(/^\/|\/$/g, '') : '');
  const [everywhere, setEverywhere] = useState(false);
  const [trying, setTrying] = useState(false);
  const input = useRef(null);
  const audio = useRef(null);
  useEffect(() => { input.current?.focus(); return () => audio.current?.pause(); }, []);
  const say = mode === 'phonemes' ? `/${value.trim().replace(/^\/|\/$/g, '')}/` : value.trim();
  const ready = Boolean(value.trim()) && !/[\[\]()]/.test(value);
  const withMark = mark => text.slice(0, target.start) + mark + text.slice(target.end);
  const marked = withMark(`[${target.word}](${say})`);
  const unmarked = withMark(target.word);

  const preview = async () => {
    setTrying(true);
    try {
      await api('narration-try', {id: project.id, ...who, text: marked});
      audio.current?.pause();
      audio.current = new Audio(triedLineURL(project.id));
      await audio.current.play();
    } catch (failure) { toast(failure.message); }
    finally { setTrying(false); }
  };
  // In this spot: the mark goes in the line. Everywhere: a project pronunciation, and a mark here comes off.
  const apply = () => (everywhere ? onPronounce(target.word, say, target.say ? unmarked : null) : onSave(marked)).then(saved => saved && onClose());
  const keys = event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Enter' && ready) { event.preventDefault(); apply(); }
  };

  return <div className="say-as" role="group" aria-label={`Say ${target.word} as`} onKeyDown={keys}>
    <div className="say-as-head">
      <span>Say <strong>{target.word}</strong></span>
      <Button size="small" variant="ghost" icon={X} tip="Close (Esc)" onClick={onClose}/>
    </div>
      <div className="segmented" role="tablist" aria-label="How to write it">
        <button type="button" role="tab" aria-selected={mode === 'sounds'} data-tip="Spell it the way it sounds, like Mem-lake" onClick={() => setMode('sounds')}>Sounds like</button>
        <button type="button" role="tab" aria-selected={mode === 'phonemes'} disabled={ownVoice}
          data-tip={ownVoice ? 'Your own voices read text, so spell it the way it sounds instead' : 'Exact Misaki phonemes, like ʤˈɪf'} onClick={() => setMode('phonemes')}>Phonemes</button>
      </div>
    <input ref={input} type="text" value={value} aria-label={mode === 'phonemes' ? 'Phonemes' : 'Sounds like'} spellCheck={false}
      placeholder={mode === 'phonemes' ? 'ɹˈɛd' : 'red'} className={mode === 'phonemes' ? 'phonemes' : undefined} onChange={event => setValue(event.target.value)}/>
    <Switch label="Everywhere in this project" tip="Every line says it this way, not just this spot" checked={everywhere} onChange={setEverywhere}/>
    <div className="button-row">
      <Button size="small" icon={Play} disabled={!ready || trying} tip="Hear this line said this way" onClick={preview}>{trying ? 'Speaking…' : 'Preview'}</Button>
      {target.say && <Button size="small" tip="Say it the usual way again" onClick={() => onSave(unmarked).then(saved => saved && onClose())}>Remove</Button>}
      <Button size="small" variant="primary" disabled={!ready} tip="Use it (Enter)" onClick={apply}>Apply</Button>
    </div>
  </div>;
}
