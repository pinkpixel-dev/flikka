import React, {useEffect, useRef, useState} from 'react';
import {Plus, SlidersHorizontal} from 'lucide-react';
import {Button} from './ui.jsx';
import {title} from './SceneForm.jsx';

const plain = text => String(text ?? '').replace(/[*[\]]/g, '');

// What a scene shows, in a few words: its title, or the recording, picture or component it plays.
// `names`: recording ids to project names.
function sceneName(scene, names) {
  const recording = scene.recording || scene.before?.recording;
  return plain(scene.title || (recording && (names[recording] || recording)) || scene.image || scene.columns?.[0]?.title || scene.component);
}

// A film's scenes under the player, each as wide as it is long (once the live film says how long). Click one to
// open it and jump there, drag it (mouse, pen or touch) or press Alt+← → to move it. The scene playing fills up.
// `timing`: [{start, seconds}] per scene, or null while the film is being built again.
export function Scenes({scenes, timing, selected, time, names, kinds, onSelect, onMove, onAdd}) {
  const items = useRef([]);
  const drag = useRef(null);
  const skipClick = useRef(false);
  const focusNext = useRef(null);
  const [drop, setDrop] = useState(null);
  useEffect(() => { if (focusNext.current != null) { items.current[focusNext.current]?.focus(); focusNext.current = null; } });

  // Where the dragged scene lands: after every other scene whose middle is left of the pointer.
  const target = x => items.current.slice(0, scenes.length).reduce((count, element, index) => {
    if (!element || index === drag.current.from) return count;
    const box = element.getBoundingClientRect();
    return count + (box.left + box.width / 2 < x ? 1 : 0);
  }, 0);
  const down = (event, index) => {
    if (event.button !== 0) return;
    drag.current = {from: index, x: event.clientX, moved: false};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = event => {
    const current = drag.current;
    if (!current || (!current.moved && Math.abs(event.clientX - current.x) < 6)) return;
    current.moved = true;
    setDrop({from: current.from, to: target(event.clientX)});
  };
  const up = event => {
    const current = drag.current;
    if (!current) return;
    const to = current.moved ? target(event.clientX) : current.from;
    drag.current = null; setDrop(null);
    if (!current.moved) return;
    skipClick.current = true;
    if (to !== current.from) onMove(current.from, to);
  };
  const cancel = () => { drag.current = null; setDrop(null); };
  const keys = (event, index) => {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowLeft' ? -1 : 1);
    if (to < 0 || to >= scenes.length) return;
    focusNext.current = to;
    onMove(index, to);
  };

  // The drop mark sits between scenes in today's order: before the scene at `mark` (or after the last one).
  const mark = drop && drop.to !== drop.from ? (drop.to < drop.from ? drop.to : drop.to + 1) : null;
  const playing = timing ? timing.findIndex(part => time >= part.start && time < part.start + part.seconds) : -1;

  return <div className="scenes">
    <Button icon={SlidersHorizontal} tip="Film settings: voice, music, size, look" aria-pressed={selected === -1} onClick={() => onSelect(-1)}/>
    <ol className="scene-list" aria-label="Scenes">
      {scenes.map((scene, index) => {
        const part = timing?.[index];
        const name = sceneName(scene, names);
        return <li key={index} style={{flexGrow: part ? Math.max(1, part.seconds) : 4}}
          className={[mark === index && 'drop-before', mark === scenes.length && index === scenes.length - 1 && 'drop-after'].filter(Boolean).join(' ') || undefined}>
          <button type="button" ref={element => { items.current[index] = element; }} aria-pressed={index === selected}
            className={`scene-chip ${drop?.from === index ? 'lifted' : ''}`} data-tip="Drag to move it (Alt+← →)"
            onPointerDown={event => down(event, index)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onKeyDown={event => keys(event, index)}
            onClick={() => { if (skipClick.current) { skipClick.current = false; return; } onSelect(index); }}>
            {index === playing && <span className="scene-progress" style={{transform: `scaleX(${(time - part.start) / part.seconds})`}} aria-hidden/>}
            <span className="scene-kind">{index + 1} · {title(scene.type)}</span>
            <span className="scene-name">{name || 'Untitled'}</span>
            {part && <span className="scene-time">{part.seconds.toFixed(1)} s</span>}
          </button>
        </li>;
      })}
    </ol>
    <label className="scene-add">
      <Plus size={15} aria-hidden/>
      <select aria-label="Add a scene" data-tip="Add a scene after the open one" value="" onChange={event => onAdd(event.target.value)}>
        <option value="" disabled>Add</option>
        {kinds.map(kind => <option key={kind} value={kind}>{title(kind)}</option>)}
      </select>
    </label>
  </div>;
}
