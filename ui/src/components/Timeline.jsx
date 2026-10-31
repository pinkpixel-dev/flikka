import React, {useEffect, useRef, useState} from 'react';
import {Scissors, Trash2, X} from 'lucide-react';
import {clock, timecode} from '../lib/format.js';
import {Button} from './ui.jsx';

// Under the player: what the finished video holds (flikka project timeline), in its own seconds. Clips with the
// cuts between them, camera moves, overlays, clicks and markers, and the words spoken.
//   Ruler and the other lanes: click or drag to scrub.
//   Clips: drag across a part to select it, then Cut (or Enter).
//   Camera: drag on empty space for a new zoom, drag a zoom to move it or its edges to resize it, click one to
//   change its scale or remove it (Delete).
// Edges snap to the playhead, clip edges and other zooms, then to whole frames.
const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const scales = [1.25, 1.5, 2, 2.5, 3];
const at = (seconds, duration) => `${(seconds / duration) * 100}%`;
const span = (from, to, duration) => ({left: at(from, duration), width: `max(2px, ${((to - from) / duration) * 100}%)`});

export function Timeline({timeline, time, onSeek, onEdit, fps, stale}) {
  const strip = useRef();
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState(null);
  const [selection, setSelection] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [saving, setSaving] = useState(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(strip.current);
    return () => observer.disconnect();
  }, []);
  // A new timeline (after an edit, or an agent's): what was drawn while saving is now real.
  useEffect(() => { setSaving(null); setChosen(null); setSelection(null); }, [timeline]);

  const duration = Math.max(0.01, timeline.duration);
  const tick = steps.find(step => (step / duration) * width >= 72) || steps.at(-1);
  const ticks = Array.from({length: Math.floor(duration / tick) + 1}, (_, index) => index * tick);
  // Edits stay in the recording part of the video, not the intro or outro cards.
  const first = timeline.intro?.to || 0, last = timeline.outro?.from ?? duration;
  const frame = value => Math.round(value * fps) / fps;
  const clamp = value => Math.max(first, Math.min(last, value));

  const timeAt = (clientX, skip) => {
    const box = strip.current.getBoundingClientRect();
    const raw = Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * duration;
    const reach = (6 / box.width) * duration;
    const edges = [time, first, last, ...timeline.parts.flatMap(part => [part.from, part.to]), ...timeline.zooms.flatMap((zoom, index) => index === skip ? [] : [zoom.from, zoom.to])];
    const near = edges.reduce((best, edge) => Math.abs(edge - raw) < Math.abs(best - raw) ? edge : best, Infinity);
    return Math.abs(near - raw) <= reach ? near : frame(raw);
  };

  const save = async (body, draft) => {
    setSaving(draft); setSelection(null);
    try { await onEdit(body); } catch { setSaving(null); }
  };

  // One pointer handler for the whole strip: what was pressed decides what a drag does.
  const down = event => {
    if (event.button !== 0 || saving) return;
    const target = event.target;
    const zoom = target.closest('[data-zoom]')?.dataset.zoom;
    const lane = target.closest('[data-lane]')?.dataset.lane;
    const start = timeAt(event.clientX);
    const mode = target.dataset.edge || (zoom !== undefined ? 'move' : lane === 'clips' ? 'select' : lane === 'camera' ? 'create' : 'scrub');
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === 'scrub') { setChosen(null); onSeek(start); }
    setDrag({mode, zoom: zoom === undefined ? null : Number(zoom), x: event.clientX, start, now: start, moved: false});
  };
  const move = event => {
    if (!drag) return;
    const moved = drag.moved || Math.abs(event.clientX - drag.x) > 4;
    const now = timeAt(event.clientX, drag.zoom);
    if (drag.mode === 'scrub') onSeek(now);
    setDrag({...drag, now, moved});
  };
  const up = () => {
    if (!drag) return;
    setDrag(null);
    const {mode, start, now, moved} = drag;
    const zoom = drag.zoom === null ? null : timeline.zooms[drag.zoom];
    if (mode === 'scrub') return;
    if (!moved) {
      if (zoom) setChosen(drag.zoom); else { setChosen(null); setSelection(null); onSeek(start); }
      return;
    }
    if (mode === 'select') {
      const [from, to] = [clamp(Math.min(start, now)), clamp(Math.max(start, now))];
      if (to - from >= 1 / fps) setSelection({from, to});
      return;
    }
    if (mode === 'create') {
      const [from, to] = [clamp(Math.min(start, now)), clamp(Math.max(start, now))];
      if (to - from < 0.2) return;
      // Aim at the last click inside it, else the middle.
      const click = timeline.clicks.filter(item => item.at >= from && item.at <= to).at(-1);
      const made = {from, to, x: click?.x ?? 0.5, y: click?.y ?? 0.5, scale: 1.5};
      save({zoom: made}, {...made, index: null});
      return;
    }
    // Move or resize: the zoom is removed and put back where it now is (one edit, one undo).
    const [from, to] = placed(zoom, mode, start, now);
    if (to - from < 0.2 || (from === zoom.from && to === zoom.to)) return;
    save({unzoom: (zoom.from + zoom.to) / 2, zoom: {from, to, x: zoom.x, y: zoom.y, scale: zoom.scale}}, {from, to, index: drag.zoom});
  };
  const placed = (zoom, mode, start, now) => {
    const shift = now - start;
    if (mode === 'move') { const by = Math.max(first - zoom.from, Math.min(last - zoom.to, shift)); return [frame(zoom.from + by), frame(zoom.to + by)]; }
    if (mode === 'start') return [clamp(Math.min(now, zoom.to - 0.2)), zoom.to];
    return [zoom.from, clamp(Math.max(now, zoom.from + 0.2))];
  };

  const cut = () => selection && save({cut: [selection.from, selection.to]}, {cut: selection});
  const remove = index => { const zoom = timeline.zooms[index]; save({unzoom: (zoom.from + zoom.to) / 2}, {removed: index}); };
  const rescale = (index, scale) => { const zoom = timeline.zooms[index]; save({unzoom: (zoom.from + zoom.to) / 2, zoom: {...zoom, scale}}, {index, from: zoom.from, to: zoom.to}); };
  const keys = event => {
    const by = {ArrowLeft: -1, ArrowRight: 1}[event.key];
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (by) { handled(); onSeek(event.shiftKey ? time + by : (Math.round(time * fps) + by) / fps); }
    else if (event.key === 'Home') { handled(); onSeek(0); }
    else if (event.key === 'End') { handled(); onSeek(duration); }
    else if (event.key === 'Enter' && selection) { handled(); cut(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && chosen !== null) { handled(); remove(chosen); }
    else if (event.key === 'Escape' && (selection || chosen !== null)) { handled(); setSelection(null); setChosen(null); }
  };

  // Zooms as they show right now: mid-drag, saving, or saved.
  const zooms = timeline.zooms.map((zoom, index) => {
    if (drag && drag.zoom === index && drag.moved) { const [from, to] = placed(zoom, drag.mode, drag.start, drag.now); return {...zoom, from, to, live: true}; }
    if (saving?.removed === index) return null;
    if (saving?.index === index) return {...zoom, from: saving.from, to: saving.to, live: true};
    return zoom;
  });
  if (saving && 'x' in saving && saving.index === null) zooms.push({...saving, live: true});
  if (drag?.mode === 'create' && drag.moved) zooms.push({from: clamp(Math.min(drag.start, drag.now)), to: clamp(Math.max(drag.start, drag.now)), scale: 1.5, live: true});
  const marked = drag?.mode === 'select' && drag.moved ? {from: clamp(Math.min(drag.start, drag.now)), to: clamp(Math.max(drag.start, drag.now))} : selection || saving?.cut;

  const overlays = [...timeline.annotations.map(item => ({...item, kind: 'note', label: item.text || {arrow: 'Arrow', box: 'Box', callout: 'Callout', step: 'Step'}[item.type] || 'Note'})),
    ...timeline.redactions.map(item => ({...item, kind: 'redact', label: 'Blurred'}))];
  const events = timeline.clicks.length + timeline.markers.length + (timeline.keystrokes?.length || 0);
  const rows = [
    {name: 'Clips', lane: 'clips', tip: 'Drag across the clips to select a part to cut', show: true, items: <>
      {timeline.intro && <Block className="card-block" {...span(timeline.intro.from, timeline.intro.to, duration)} tip={`Intro · ${timeline.intro.text || ''}`}>Intro</Block>}
      {timeline.parts.map((part, index) => <Block key={index} className={`clip ${part.freeze ? 'freeze' : ''} ${part.ramp ? 'ramp' : ''}`} {...span(part.from, part.to, duration)}
        tip={`${clock(part.source[0])}–${clock(part.source[1])} of the recording${part.freeze ? ' · held' : part.ramp ? ` · ${part.speed[0]}× to ${part.speed[1]}×` : part.speed && part.speed !== 1 ? ` · ${part.speed}×` : ''}`}>
        {part.freeze ? 'Hold' : part.ramp ? `${part.speed[0]}→${part.speed[1]}×` : part.speed && part.speed !== 1 ? `${part.speed}×` : ''}</Block>)}
      {timeline.cuts.map((item, index) => <span key={'c' + index} className="cut" style={{left: at(item.at, duration)}} data-tip={`Cut ${(item.source[1] - item.source[0]).toFixed(1)} s (${clock(item.source[0])}–${clock(item.source[1])} of the recording)`}/>)}
      {timeline.outro && <Block className="card-block" {...span(timeline.outro.from, timeline.outro.to, duration)} tip={`Outro · ${timeline.outro.text || ''}`}>Outro</Block>}
      {marked && <span className={`range ${saving?.cut ? 'saving' : ''}`} style={span(marked.from, marked.to, duration)} aria-hidden/>}
    </>},
    {name: 'Camera', lane: 'camera', tip: 'Drag to add a zoom. Drag a zoom to move it, or its edges to resize it.', show: true, items: <>
      {zooms.map((zoom, index) => zoom && <span key={index} className={`block zoom ${zoom.live ? 'live' : ''} ${chosen === index ? 'chosen' : ''}`} style={span(zoom.from, zoom.to, duration)}
        data-zoom={index < timeline.zooms.length ? index : undefined} data-tip={zoom.live || chosen === index ? undefined : `Zoom ${zoom.scale}× · ${timecode(zoom.from)}–${timecode(zoom.to)}`}>
        {index < timeline.zooms.length && <><span className="edge start" data-edge="start"/><span className="edge end" data-edge="end"/></>}
        <span>{zoom.scale}×</span></span>)}
      {timeline.spotlights.map((item, index) => <Block key={'s' + index} className="spotlight" {...span(item.from, item.to, duration)} tip={`Spotlight · ${timecode(item.from)}–${timecode(item.to)}`}/>)}
    </>},
    {name: 'Overlays', show: overlays.length > 0, items: overlays.map((item, index) => <Block key={index} className={item.kind} {...span(item.from, item.to, duration)} tip={item.label}>{item.label}</Block>)},
    {name: 'Events', show: events > 0, items: <>
      {timeline.clicks.map((click, index) => <span key={index} className="click" style={{left: at(click.at, duration)}} data-tip={`Click at ${timecode(click.at)}`}/>)}
      {(timeline.keystrokes || []).map((key, index) => <span key={'k' + index} className="keystroke" style={{left: at(key.at, duration)}} data-tip={key.keys}/>)}
      {timeline.markers.map((marker, index) => <span key={'m' + index} className="marker" style={{left: at(marker.at, duration)}} data-tip={marker.label || 'Marker'}/>)}
    </>},
    {name: 'Speech', show: timeline.speech.length > 0, items: timeline.speech.map((line, index) => <Block key={index} className={`speech ${line.partlyCut ? 'partly' : ''}`} {...span(line.from, line.to, duration)} tip={line.text}>{line.text}</Block>)},
  ].filter(row => row.show);

  const chosenZoom = chosen !== null && !saving ? timeline.zooms[chosen] : null;
  const tools = selection && !saving ? {where: (selection.from + selection.to) / 2, row: 'clips'} : chosenZoom ? {where: (chosenZoom.from + chosenZoom.to) / 2, row: 'camera'} : null;
  return <div className={`timeline ${stale ? 'stale' : ''} ${drag?.moved ? 'dragging' : ''}`}>
    <div className="timeline-labels"><span/>{rows.map(row => <span key={row.name} data-tip={row.tip}>{row.name}</span>)}</div>
    <div className="timeline-track" ref={strip} role="slider" tabIndex={0} aria-label="Timeline" aria-valuemin={0} aria-valuemax={+duration.toFixed(2)} aria-valuenow={+time.toFixed(2)}
      aria-valuetext={timecode(time)} onKeyDown={keys} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <div className="ruler">{ticks.map(second => <span key={second} style={{left: at(second, duration)}}>{clock(second)}</span>)}</div>
      {rows.map(row => <div className="lane" key={row.name} data-lane={row.lane}>{row.items}</div>)}
      <div className="playhead" style={{transform: `translateX(${Math.min(1, time / duration) * width}px)`}} aria-hidden/>
      {tools && <div className={`timeline-tools on-${tools.row}`} style={{left: `clamp(110px, ${at(tools.where, duration)}, calc(100% - 110px))`}} onPointerDown={event => event.stopPropagation()}>
        {selection ? <>
          <Button size="small" variant="record" icon={Scissors} tip="Cut this part out of the video (Enter)" onClick={cut}>Cut {(selection.to - selection.from).toFixed(2)} s</Button>
          <Button size="small" variant="ghost" icon={X} tip="Clear the selection (Esc)" onClick={() => setSelection(null)}/>
        </> : <>
          <select aria-label="Zoom scale" value={chosenZoom.scale} onChange={event => rescale(chosen, Number(event.target.value))}>
            {[...new Set([...scales, chosenZoom.scale])].sort((a, b) => a - b).map(scale => <option key={scale} value={scale}>{scale}×</option>)}</select>
          <Button size="small" variant="ghost" icon={Trash2} tip="Remove this zoom (Delete)" onClick={() => remove(chosen)}/>
          <Button size="small" variant="ghost" icon={X} tip="Done (Esc)" onClick={() => setChosen(null)}/>
        </>}
      </div>}
    </div>
  </div>;
}

function Block({className, left, width, tip, children}) {
  return <span className={`block ${className}`} style={{left, width}} data-tip={tip}>{children && <span>{children}</span>}</span>;
}
