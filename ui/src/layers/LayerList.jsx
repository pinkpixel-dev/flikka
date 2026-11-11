import React, {useEffect, useRef, useState} from 'react';
import {ArrowDownToLine, ArrowUpToLine, Film, Image, Square, Trash2, Type} from 'lucide-react';
import {clock} from '../lib/format.js';
import {Button, Range, Section} from '../components/ui.jsx';
import {label} from './LayerStage.jsx';

// A recording's overlay layers (project.layers, lib/layers.mjs) as the timeline places them: add text, a box, or
// an image or video at the playhead, choose one (its box shows on the player), and set how it looks. Each change
// is one edit through the same options the CLI has (flikka project edit --layer-set …).
const icons = {text: Type, solid: Square, image: Image, video: Film};
const weights = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];
const hex = /^#[0-9a-f]{6}$/i;

// A picture's box: a third of the video's height (no wider than 60%), shaped like the picture, in the middle.
const fitted = (width, height, ratio) => {
  let h = 0.3, w = h * (width / height) / ratio;
  if (w > 0.6) { h *= 0.6 / w; w = 0.6; }
  return {x: +(0.5 - w / 2).toFixed(4), y: +(0.5 - h / 2).toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4)};
};
const measure = file => new Promise(resolve => {
  const url = URL.createObjectURL(file);
  const done = size => { URL.revokeObjectURL(url); resolve(size); };
  if (file.type.startsWith('video/')) {
    const video = document.createElement('video');
    video.onloadedmetadata = () => done([video.videoWidth, video.videoHeight]);
    video.onerror = () => done(null);
    video.preload = 'metadata'; video.src = url;
  } else {
    const picture = new window.Image();
    picture.onload = () => done([picture.naturalWidth, picture.naturalHeight]);
    picture.onerror = () => done(null);
    picture.src = url;
  }
});

export function LayerList({layers, chosen, time, ratio, first, last, onChoose, onSeek, onEdit, onUpload}) {
  const picker = useRef(null);
  const [adding, setAdding] = useState(false);
  const layer = layers.find(item => item.id === chosen);
  // New layers start at the playhead (inside the recording part), for 3 seconds or what's left.
  const span = seconds => { const from = Math.max(first, Math.min(time, last - 0.2)); return {from, to: Math.min(last, from + seconds)}; };
  const add = async what => {
    setAdding(true);
    try { await onEdit([{add: {...span(3), ...what}}], true); } catch {} finally { setAdding(false); }
  };
  const upload = async file => {
    if (!file) return;
    const type = file.type.startsWith('video/') ? 'video' : 'image';
    const size = await measure(file);
    setAdding(true);
    try { await onUpload(file, {type, ...span(type === 'video' ? 5 : 3), ...(size?.[0] && size[1] && fitted(size[0], size[1], ratio))}); } catch {}
    finally { setAdding(false); }
  };

  return <>
    <Section title="Layers" aside={<div className="button-row">
      <Button size="small" variant="ghost" icon={Type} tip="Add text at the playhead" disabled={adding} onClick={() => add({type: 'text', text: 'Text', x: 0.1, y: 0.42, w: 0.8, h: 0.16})}/>
      <Button size="small" variant="ghost" icon={Square} tip="Add a box at the playhead" disabled={adding} onClick={() => add({type: 'solid', x: 0.3, y: 0.3, w: 0.4, h: 0.4, color: '#18181b'})}/>
      <Button size="small" variant="ghost" icon={Image} tip="Add an image or video at the playhead (copied into the project)" disabled={adding} onClick={() => picker.current?.click()}/>
      <input ref={picker} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/quicktime,video/webm,.m4v"
        onChange={event => { upload(event.target.files[0]); event.target.value = ''; }}/>
    </div>}>
      {layers.length === 0 ? <p className="hint">Text, boxes, images and videos over the video. Add one at the playhead.</p>
        : <ul className="layer-list">{[...layers].reverse().map(item => {
          const Icon = icons[item.type] || Square;
          return <li key={item.id}><button type="button" className={`layer-row ${item.id === chosen ? 'chosen' : ''}`} aria-pressed={item.id === chosen}
            onClick={() => { onChoose(item.id === chosen ? null : item.id); if (item.id !== chosen && (time < item.from || time > item.to)) onSeek(item.from); }}>
            <Icon size={14} strokeWidth={1.8} aria-hidden/><span className="layer-name">{label(item)}</span>
            {item.keyframes?.length > 0 && <span className="chip" data-tip="Keyframes animate it. Moving its box moves the whole path.">{item.keyframes.length} kf</span>}
            <span className="layer-when">{clock(item.from)}–{clock(item.to)}</span></button></li>;
        })}</ul>}
      {layers.length > 1 && <p className="hint">Top of the list is in front.</p>}
    </Section>
    {layer && <LayerFields key={layer.id} layer={layer} onEdit={onEdit} onDone={() => onChoose(null)}/>}
  </>;
}

function LayerFields({layer, onEdit, onDone}) {
  const set = values => onEdit([{set: {layer: layer.id, ...values}}]).catch(() => {});
  const [text, setText] = useState(layer.text || '');
  useEffect(() => setText(layer.text || ''), [layer.text]);
  const saveText = () => { if (text.trim() && text !== layer.text) set({text}); };
  return <Section title={label(layer)} aside={<div className="button-row">
    <Button size="small" variant="ghost" icon={ArrowUpToLine} tip="Bring to front" onClick={() => set({order: 'front'})}/>
    <Button size="small" variant="ghost" icon={ArrowDownToLine} tip="Send to back" onClick={() => set({order: 'back'})}/>
    <Button size="small" variant="ghost" icon={Trash2} tip="Remove this layer (Delete on the player, Ctrl+Z undoes)" onClick={() => { onDone(); onEdit([{remove: layer.id}]).catch(() => {}); }}/>
  </div>}>
    {layer.type === 'text' && <>
      <textarea className="layer-text" aria-label="Words" rows={2} value={text} onChange={event => setText(event.target.value)} onBlur={saveText}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveText(); } }}/>
      <Range label="Size" tip="Font size, as a share of the video's height" value={Math.round((layer.size || 0.05) * 1000) / 10} min={1} max={30} step={0.5} unit="%" onCommit={value => set({size: value / 100})}/>
      <label className="line" data-tip="How heavy the letters are"><span>Weight</span><select value={layer.weight || 600} onChange={event => set({weight: Number(event.target.value)})}>
        {weights.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <div className="line"><span>Align</span><div className="segmented" role="radiogroup" aria-label="Align">
        {['left', 'center', 'right'].map(side => <button key={side} type="button" role="radio" aria-checked={(layer.align || 'center') === side} aria-selected={(layer.align || 'center') === side}
          onClick={() => set({align: side})}>{side[0].toUpperCase() + side.slice(1)}</button>)}</div></div>
      <ColorField label="Color" tip="The letters' color" value={layer.color} fallback="#fafafa" onSave={color => set({color})}/>
      <ColorField label="Background" tip="A box behind the words (empty: none)" value={layer.background} fallback="#000000" clearable onSave={background => set({background})}/>
    </>}
    {layer.type === 'solid' && <ColorField label="Color" tip="The box's color (#rrggbbaa or rgba() for see-through)" value={layer.color} fallback="#18181b" onSave={color => set({color})}/>}
    {['image', 'video'].includes(layer.type) && <label className="line" data-tip="Contain shows it all, cover fills the box"><span>Fit</span>
      <select value={layer.fit || 'contain'} onChange={event => set({fit: event.target.value})}><option value="contain">Contain</option><option value="cover">Cover</option></select></label>}
    <Range label="Opacity" tip="How see-through the layer is" value={Math.round((layer.opacity ?? 1) * 100)} min={0} max={100} unit="%" onCommit={value => set({opacity: value / 100})}/>
    <Range label="Turn" tip="Rotation in degrees (or drag the round handle on the player)" value={Math.round(layer.rotation || 0)} min={-180} max={180} unit="°" onCommit={rotation => set({rotation})}/>
    <Range label="Corners" tip="Corner radius in pixels" value={layer.radius || 0} min={0} max={200} unit=" px" onCommit={radius => set({radius})}/>
    <p className="hint">Drag the box on the player to move it, its handles to resize or turn it.</p>
  </Section>;
}

// A color: the swatch picks one, the text takes any CSS color (with see-through ones like #00000088).
function ColorField({label: name, tip, value, fallback, clearable, onSave}) {
  const [draft, setDraft] = useState(value || '');
  const timer = useRef();
  useEffect(() => setDraft(value || ''), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = next => { clearTimeout(timer.current); if (next !== (value || '')) { if (next || clearable) onSave(next); else setDraft(value || ''); } };
  // The swatch saves a moment after the picking stops, keeping a see-through color's alpha (#rrggbbaa).
  const pick = picked => {
    const next = picked + (/^#[0-9a-f]{8}$/i.test(draft) ? draft.slice(7) : '');
    setDraft(next); clearTimeout(timer.current); timer.current = setTimeout(() => save(next), 400);
  };
  return <label className="line color-line" data-tip={tip}><span>{name}</span><span className="color-input">
    <input type="color" aria-label={`${name} swatch`} value={hex.test(draft) ? draft : hex.test(draft.slice(0, 7)) ? draft.slice(0, 7) : fallback}
      onChange={event => pick(event.target.value)}/>
    <input type="text" aria-label={name} value={draft} placeholder={clearable ? 'None' : fallback} spellCheck={false}
      onChange={event => setDraft(event.target.value)} onBlur={() => save(draft.trim())} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(draft.trim()); } }}/>
  </span></label>;
}
