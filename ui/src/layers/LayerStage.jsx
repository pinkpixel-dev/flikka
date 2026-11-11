import React, {useEffect, useRef, useState} from 'react';
import {boxAt, boxChange, dragBox, handles, keyChange, keyMoment} from './geometry.js';

// The chosen layer's box over the player, at the playhead: drag it to move it (its edges and middle snap to the
// video's, Shift: no snapping), a handle to resize it (Shift on a corner keeps its shape), the round handle above
// to turn it (Shift: 15° steps). Arrows nudge it (Shift: more), Delete removes it, Escape lets it go. Other layers
// showing at this moment can be clicked to choose them. Each drag is one edit; a run of nudges is one too.
// With autoKey on, a drag or nudge writes a keyframe at the playhead instead (the box's values there), and the box
// can't be moved while the playhead is off the layer.
// layers: the timeline's (video seconds), ratio: the video's width / height, fps: what a keyframe's moment rounds to.
export function LayerStage({layers, chosen, time, ratio, fps, autoKey, onChoose, onSave, onRemove, onDone}) {
  const frame = useRef(null);
  const boxRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [draft, setDraft] = useState(null);
  const nudge = useRef(null);
  const layer = layers.find(item => item.id === chosen);
  // A new timeline (the edit saved, or an agent's) or another layer: what was drawn while saving is real now.
  useEffect(() => { setDraft(null); setDrag(null); }, [layer]);
  useEffect(() => () => clearTimeout(nudge.current?.timer), []);
  useEffect(() => { boxRef.current?.focus({preventScroll: true}); }, [chosen]);
  if (!layer) return null;

  const showing = time >= layer.from && time <= layer.to;
  const here = boxAt(layer, time);
  const shown = draft || (drag?.moved ? drag.box : here);
  const size = () => { const area = frame.current.getBoundingClientRect(); return {width: area.width, height: area.height, left: area.left, top: area.top}; };
  const point = (event, area) => ({x: event.clientX - area.left, y: event.clientY - area.top});

  const save = async after => {
    const change = autoKey ? keyChange(layer, time, fps, here, after) : boxChange(layer, here, after);
    if (!change) { setDraft(null); return; }
    setDraft(after);
    try { await onSave([change]); } catch { setDraft(null); }
  };
  const down = event => {
    if (event.button !== 0 || draft) return;
    event.stopPropagation();
    if (autoKey && keyMoment(layer, time, fps) === null) return;
    const area = size();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({mode: event.target.dataset.handle || 'move', from: point(event, area), start: here, box: here, moved: false});
  };
  const move = event => {
    if (!drag) return;
    const area = size(), now = point(event, area);
    const moved = drag.moved || Math.hypot(now.x - drag.from.x, now.y - drag.from.y) > 3;
    setDrag({...drag, moved, box: moved ? dragBox(drag.start, {mode: drag.mode, from: drag.from, now, shift: event.shiftKey}, area) : drag.box});
  };
  const up = () => {
    if (!drag) return;
    setDrag(null);
    if (drag.moved) save(drag.box);
  };
  const keys = event => {
    const step = event.shiftKey ? 0.05 : 0.005;
    const by = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[event.key];
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (by) {
      handled();
      if ((draft && !nudge.current) || (autoKey && keyMoment(layer, time, fps) === null)) return;
      // Nudges add up and save half a second after the last one.
      const base = nudge.current?.box || here;
      const box = {...base, x: Math.round((base.x + by[0]) * 1e4) / 1e4, y: Math.round((base.y + by[1]) * 1e4) / 1e4};
      clearTimeout(nudge.current?.timer);
      nudge.current = {box, timer: setTimeout(() => { nudge.current = null; save(box); }, 500)};
      setDraft(box);
    } else if (event.key === 'Delete' || event.key === 'Backspace') { handled(); onRemove(layer.id); }
    else if (event.key === 'Escape') { handled(); onDone(); }
  };

  const place = box => ({left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`,
    transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined});
  const others = layers.filter(item => item.id !== chosen && time >= item.from && time <= item.to);
  return <div className="layer-stage">
    <div ref={frame} className="layer-frame" style={{aspectRatio: ratio, width: `min(100cqw, ${ratio.toFixed(4)} * 100cqh)`}}>
      {others.map(item => <span key={item.id} className="layer-other" style={place(boxAt(item, time))} data-tip={`${label(item)} · click to choose`}
        onPointerDown={event => { if (event.button === 0) { event.stopPropagation(); onChoose(item.id); } }}/>)}
      <div ref={boxRef} className={`layer-box ${autoKey ? 'keying' : ''} ${showing ? '' : 'outside'} ${drag?.moved ? 'dragging' : ''} ${draft ? 'saving' : ''}`} style={place(shown)} tabIndex={0}
        role="application" aria-label={`${label(layer)}. Drag to move, arrows nudge, Delete removes, Escape lets go.`}
        data-tip={showing || drag ? undefined : autoKey ? 'Not showing at the playhead: move the playhead onto it to key it' : 'Not showing at the playhead: this is where it starts or ends'}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onKeyDown={keys}>
        {handles.map(handle => <span key={handle} className={`layer-handle ${handle}`} data-handle={handle} aria-hidden/>)}
        <span className="layer-handle rotate" data-handle="rotate" data-tip="Turn (Shift: 15° steps)" aria-hidden/>
        {drag?.moved && drag.mode === 'rotate' && <span className="layer-readout">{Math.round(shown.rotation || 0)}°</span>}
      </div>
    </div>
  </div>;
}

// How a layer is named in the panel: its words, or its kind.
export const label = layer => layer.type === 'text' ? (layer.text || 'Text') : {image: 'Image', video: 'Video', solid: 'Box'}[layer.type] || 'Layer';
