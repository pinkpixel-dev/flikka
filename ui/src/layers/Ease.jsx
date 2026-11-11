import React, {useEffect, useRef, useState} from 'react';
import {easings, parseEasing} from '../../../render/keyframes.js';

// How a keyframe eases in: one of the CSS names, or a cubic-bezier drawn as a curve with its two handles to drag
// (x stays 0–1, y can overshoot) and its four numbers. Saves when a handle is let go, a number is left, or a
// name is picked. value: the keyframe's ease (missing means ease).
const names = {linear: 'Linear', ease: 'Ease', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in-out'};
const size = 132, pad = 26, top = 0.5;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const tidy = value => +value.toFixed(2);
const text = points => `cubic-bezier(${points.map(tidy).join(',')})`;
// Graph space: x 0–1 across, y from -top to 1 + top up the side.
const toX = x => pad + x * (size - 2 * pad);
const toY = y => size - pad - y * (size - 2 * pad);

export function Ease({value = 'ease', onSave}) {
  const custom = !easings.includes(value);
  const [points, setPoints] = useState(() => parseEasing(value) || [0, 0, 1, 1]);
  const [open, setOpen] = useState(custom);
  const [drag, setDrag] = useState(null);
  const graph = useRef(null);
  useEffect(() => { setPoints(parseEasing(value) || [0, 0, 1, 1]); if (!easings.includes(value)) setOpen(true); }, [value]);

  const save = next => { const saved = text(next); if (saved !== value) onSave(saved); };
  const pointAt = event => {
    const box = graph.current.getBoundingClientRect(), scale = box.width / size;
    const x = ((event.clientX - box.left) / scale - pad) / (size - 2 * pad);
    const y = (size - pad - (event.clientY - box.top) / scale) / (size - 2 * pad);
    return [tidy(clamp(x, 0, 1)), tidy(clamp(y, -top, 1 + top))];
  };
  const move = event => {
    if (drag === null) return;
    const [x, y] = pointAt(event), next = [...points];
    next[drag * 2] = x; next[drag * 2 + 1] = y;
    setPoints(next);
  };
  const pick = name => {
    if (name === 'custom') { setOpen(true); return; }
    setOpen(false); if (name !== value) onSave(name === 'ease' ? '' : name);
  };
  const curve = `M${toX(0)},${toY(0)} C${toX(points[0])},${toY(points[1])} ${toX(points[2])},${toY(points[3])} ${toX(1)},${toY(1)}`;

  return <div className="ease">
    <select aria-label="Easing" data-tip="How it eases into this keyframe" value={custom || open ? 'custom' : value} onChange={event => pick(event.target.value)}>
      {easings.map(name => <option key={name} value={name}>{names[name]}</option>)}<option value="custom">Curve…</option></select>
    {(custom || open) && <div className="ease-editor">
      <svg ref={graph} viewBox={`0 0 ${size} ${size}`} className={`ease-graph ${drag !== null ? 'dragging' : ''}`} role="img" aria-label={text(points)}
        onPointerMove={move} onPointerUp={() => { if (drag !== null) { setDrag(null); save(points); } }} onPointerCancel={() => setDrag(null)}>
        <rect x={toX(0)} y={toY(1)} width={toX(1) - toX(0)} height={toY(0) - toY(1)} className="ease-frame"/>
        <line x1={toX(0)} y1={toY(0)} x2={toX(points[0])} y2={toY(points[1])} className="ease-arm"/>
        <line x1={toX(1)} y1={toY(1)} x2={toX(points[2])} y2={toY(points[3])} className="ease-arm"/>
        <path d={curve} className="ease-curve"/>
        {[0, 1].map(index => <circle key={index} cx={toX(points[index * 2])} cy={toY(points[index * 2 + 1])} r={6} className="ease-handle"
          onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.ownerSVGElement.setPointerCapture(event.pointerId); setDrag(index); }}/>)}
      </svg>
      <div className="ease-numbers">{['x1', 'y1', 'x2', 'y2'].map((name, index) => <label key={name}><span>{name}</span>
        <input type="number" step="0.05" min={index % 2 ? -top : 0} max={index % 2 ? 1 + top : 1} value={points[index]}
          onChange={event => { const next = [...points]; next[index] = Number(event.target.value); setPoints(next); }}
          onBlur={() => { const next = points.map((point, at) => tidy(clamp(Number.isFinite(point) ? point : 0, at % 2 ? -top : 0, at % 2 ? 1 + top : 1))); setPoints(next); save(next); }}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/></label>)}</div>
    </div>}
  </div>;
}
