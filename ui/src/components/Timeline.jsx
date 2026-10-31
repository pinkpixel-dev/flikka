import React, {useEffect, useRef, useState} from 'react';
import {clock, timecode} from '../lib/format.js';

// Under the player: what the finished video holds (flikka project timeline), in its own seconds. Clips with the
// cuts between them, camera moves, overlays, clicks and markers, and the words spoken. Click or drag to scrub;
// with the strip focused, ← → move a frame and Shift a second.
const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const at = (seconds, duration) => `${(seconds / duration) * 100}%`;
const span = (from, to, duration) => ({left: at(from, duration), width: `max(2px, ${((to - from) / duration) * 100}%)`});

export function Timeline({timeline, time, onSeek, fps, stale}) {
  const strip = useRef();
  const [width, setWidth] = useState(800);
  const dragging = useRef(false);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(strip.current);
    return () => observer.disconnect();
  }, []);
  const duration = Math.max(0.01, timeline.duration);
  const tick = steps.find(step => (step / duration) * width >= 72) || steps.at(-1);
  const ticks = Array.from({length: Math.floor(duration / tick) + 1}, (_, index) => index * tick);

  const seekTo = event => {
    const box = strip.current.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * duration);
  };
  const keys = event => {
    const by = {ArrowLeft: -1, ArrowRight: 1}[event.key];
    if (by) { event.preventDefault(); event.stopPropagation(); onSeek(event.shiftKey ? time + by : (Math.round(time * fps) + by) / fps); }
    if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); onSeek(0); }
    if (event.key === 'End') { event.preventDefault(); event.stopPropagation(); onSeek(duration); }
  };

  const camera = [...timeline.zooms.map(item => ({...item, kind: 'zoom', label: `Zoom ${item.scale}×`})), ...timeline.spotlights.map(item => ({...item, kind: 'spotlight', label: 'Spotlight'}))];
  const overlays = [...timeline.annotations.map(item => ({...item, kind: 'note', label: item.text || {arrow: 'Arrow', box: 'Box', callout: 'Callout', step: 'Step'}[item.type] || 'Note'})), ...timeline.redactions.map(item => ({...item, kind: 'redact', label: 'Blurred'}))];
  const events = timeline.clicks.length + timeline.markers.length + (timeline.keystrokes?.length || 0);
  const rows = [
    {name: 'Clips', show: true, items: <>
      {timeline.intro && <Block className="card-block" {...span(timeline.intro.from, timeline.intro.to, duration)} tip={`Intro · ${timeline.intro.text || ''}`}>Intro</Block>}
      {timeline.parts.map((part, index) => <Block key={index} className={`clip ${part.freeze ? 'freeze' : ''} ${part.ramp ? 'ramp' : ''}`} {...span(part.from, part.to, duration)}
        tip={`${clock(part.source[0])}–${clock(part.source[1])} of the recording${part.freeze ? ' · held' : part.ramp ? ` · ${part.speed[0]}× to ${part.speed[1]}×` : part.speed && part.speed !== 1 ? ` · ${part.speed}×` : ''}`}>
        {part.freeze ? 'Hold' : part.ramp ? `${part.speed[0]}→${part.speed[1]}×` : part.speed && part.speed !== 1 ? `${part.speed}×` : ''}</Block>)}
      {timeline.cuts.map((cut, index) => <span key={'c' + index} className="cut" style={{left: at(cut.at, duration)}} data-tip={`Cut ${(cut.source[1] - cut.source[0]).toFixed(1)} s (${clock(cut.source[0])}–${clock(cut.source[1])} of the recording)`}/>)}
      {timeline.outro && <Block className="card-block" {...span(timeline.outro.from, timeline.outro.to, duration)} tip={`Outro · ${timeline.outro.text || ''}`}>Outro</Block>}
    </>},
    {name: 'Camera', show: camera.length > 0, items: camera.map((item, index) => <Block key={index} className={item.kind} {...span(item.from, item.to, duration)} tip={`${item.label} · ${timecode(item.from)}–${timecode(item.to)}`}/>)},
    {name: 'Overlays', show: overlays.length > 0, items: overlays.map((item, index) => <Block key={index} className={item.kind} {...span(item.from, item.to, duration)} tip={item.label}>{item.label}</Block>)},
    {name: 'Events', show: events > 0, items: <>
      {timeline.clicks.map((click, index) => <span key={index} className="click" style={{left: at(click.at, duration)}} data-tip={`Click at ${timecode(click.at)}`}/>)}
      {(timeline.keystrokes || []).map((key, index) => <span key={'k' + index} className="keystroke" style={{left: at(key.at, duration)}} data-tip={key.keys}/>)}
      {timeline.markers.map((marker, index) => <span key={'m' + index} className="marker" style={{left: at(marker.at, duration)}} data-tip={marker.label || 'Marker'}/>)}
    </>},
    {name: 'Speech', show: timeline.speech.length > 0, items: timeline.speech.map((line, index) => <Block key={index} className={`speech ${line.partlyCut ? 'partly' : ''}`} {...span(line.from, line.to, duration)} tip={line.text}>{line.text}</Block>)},
  ].filter(row => row.show);

  return <div className={`timeline ${stale ? 'stale' : ''}`}>
    <div className="timeline-labels" aria-hidden><span/>{rows.map(row => <span key={row.name}>{row.name}</span>)}</div>
    <div className="timeline-track" ref={strip} role="slider" tabIndex={0} aria-label="Timeline" aria-valuemin={0} aria-valuemax={+duration.toFixed(2)} aria-valuenow={+time.toFixed(2)} aria-valuetext={timecode(time)}
      onKeyDown={keys}
      onPointerDown={event => { if (event.button !== 0) return; dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); seekTo(event); }}
      onPointerMove={event => dragging.current && seekTo(event)}
      onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
      <div className="ruler">{ticks.map(second => <span key={second} style={{left: at(second, duration)}}>{clock(second)}</span>)}</div>
      {rows.map(row => <div className="lane" key={row.name}>{row.items}</div>)}
      <div className="playhead" style={{transform: `translateX(${Math.min(1, time / duration) * width}px)`}} aria-hidden/>
    </div>
  </div>;
}

function Block({className, left, width, tip, children}) {
  return <span className={`block ${className}`} style={{left, width}} data-tip={tip}>{children && <span>{children}</span>}</span>;
}
