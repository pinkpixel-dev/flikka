import React, {useEffect, useRef, useState} from 'react';
import {Check, X} from 'lucide-react';
import {Button} from './ui.jsx';

// Aiming a zoom: the recording itself (the raw video, at the zoom's moment) over the player, with the frame the
// zoom will show. Click or drag to move it, arrows nudge it (Shift: more), Enter saves, Esc cancels. Positions
// are 0–1 of the whole recording, like every zoom; a crop only limits where the frame can go.
const scales = [1.25, 1.5, 2, 2.5, 3];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Where the recording is at a moment of the video (a freeze holds its moment).
export function sourceAt(timeline, time) {
  const part = timeline.parts.find(item => time >= item.from && time <= item.to) || timeline.parts.at(-1);
  if (!part) return 0;
  if (part.freeze) return part.source[0];
  return part.source[0] + (part.source[1] - part.source[0]) * (time - part.from) / Math.max(0.001, part.to - part.from);
}

// The frame a zoom shows: 1/scale of the (cropped) recording, kept inside it the way the renderer keeps it.
export function aimFrame(aim, crop = {x: 0, y: 0, w: 1, h: 1}) {
  const [w, h] = [crop.w / aim.scale, crop.h / aim.scale];
  return {w, h, x: clamp(aim.x, crop.x + w / 2, crop.x + crop.w - w / 2), y: clamp(aim.y, crop.y + h / 2, crop.y + crop.h - h / 2)};
}

export function AimStage({src, timeline, aim, onChange, onSave, onCancel}) {
  const box = useRef(null);
  const [ratio, setRatio] = useState(null);
  const [dragging, setDragging] = useState(false);
  const frame = aimFrame(aim, timeline.crop);
  const moment = sourceAt(timeline, (aim.zoom.from + aim.zoom.to) / 2);
  // Focus once it shows (it's hidden until the video knows its size, and hidden things can't take focus).
  useEffect(() => { if (ratio) box.current?.focus(); }, [ratio]);

  const place = event => {
    const area = box.current.getBoundingClientRect();
    onChange({x: clamp((event.clientX - area.left) / area.width, 0, 1), y: clamp((event.clientY - area.top) / area.height, 0, 1)});
  };
  const keys = event => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const by = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[event.key];
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    // From where the frame is now, so a nudge never sits still against an edge.
    if (by) { handled(); onChange({x: clamp(frame.x + by[0], 0, 1), y: clamp(frame.y + by[1], 0, 1)}); }
    else if (event.key === 'Enter') { handled(); onSave(); }
    else if (event.key === 'Escape') { handled(); onCancel(); }
  };

  return <div className="aim-stage">
    <div ref={box} className={`aim-box ${dragging ? 'dragging' : ''}`} tabIndex={0} role="application" aria-label="Where the zoom looks. Arrows move it, Enter saves, Escape cancels."
      style={ratio ? {aspectRatio: ratio, width: `min(100cqw, ${ratio.toFixed(4)} * 100cqh)`} : {visibility: 'hidden'}}
      onKeyDown={keys} onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); place(event); }}
      onPointerMove={event => dragging && place(event)} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}>
      <video src={src} muted playsInline preload="auto" onLoadedMetadata={event => { const video = event.currentTarget; setRatio(video.videoWidth / video.videoHeight); video.currentTime = moment; }}/>
      <span className="aim-frame" style={{left: `${(frame.x - frame.w / 2) * 100}%`, top: `${(frame.y - frame.h / 2) * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%`}} aria-hidden/>
    </div>
    {!ratio && <div className="stage-loading" aria-hidden/>}
  </div>;
}

// Under the player while aiming, in place of the usual buttons.
export function AimBar({aim, saving, onChange, onSave, onCancel}) {
  return <div className="aim-bar" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}>
    <span className="aim-hint">Click where the zoom should look</span>
    <select aria-label="Zoom scale" value={aim.scale} onChange={event => onChange({scale: Number(event.target.value)})}>
      {[...new Set([...scales, aim.scale])].sort((a, b) => a - b).map(scale => <option key={scale} value={scale}>{scale}×</option>)}</select>
    <Button size="small" variant="ghost" icon={X} tip="Cancel (Esc)" disabled={saving} onClick={onCancel}/>
    <Button size="small" variant="primary" icon={Check} tip="Save the zoom (Enter)" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</Button>
  </div>;
}
