import React, {useRef} from 'react';
import {timecode} from '../lib/format.js';

// The whole video in miniature, under the timeline (Narra's TimelineOverview). The box is the
// part in view: drag it to scroll, drag its edges to zoom, or click the strip to jump there. The box takes the
// arrow keys too (Shift: a whole view), and Home and End.
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function Overview({timeline, time, view, minWidth, onScrollTo, onShowRange}) {
  const strip = useRef(null);
  const drag = useRef(null);
  const duration = Math.max(0.01, timeline.duration);
  const percent = fraction => `${fraction * 100}%`;
  const at = seconds => percent(seconds / duration);

  const begin = (event, mode, start = view.start) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box?.width) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {mode, x: event.clientX, start, width: view.width, stripWidth: box.width};
  };
  const move = event => {
    const held = drag.current;
    if (!held) return;
    const by = (event.clientX - held.x) / held.stripWidth, end = held.start + held.width;
    if (held.mode === 'move') onScrollTo(clamp(held.start + by, 0, 1 - held.width));
    else if (held.mode === 'start') { const start = clamp(held.start + by, 0, end - minWidth); onShowRange(start, end - start); }
    else onShowRange(held.start, clamp(held.width + by, minWidth, 1 - held.start));
  };
  const end = () => { drag.current = null; };
  // A click on the strip centers the view there, then keeps dragging from that spot.
  const stripDown = event => {
    const box = strip.current?.getBoundingClientRect();
    if (!box?.width) return;
    const start = clamp((event.clientX - box.left) / box.width - view.width / 2, 0, 1 - view.width);
    onScrollTo(start);
    begin(event, 'move', start);
  };
  const keys = event => {
    const small = view.width * 0.1;
    const by = {ArrowLeft: -(event.shiftKey ? view.width : small), ArrowRight: event.shiftKey ? view.width : small, Home: -1, End: 1}[event.key];
    if (by === undefined) return;
    event.preventDefault(); event.stopPropagation();
    onScrollTo(clamp(view.start + by, 0, 1 - view.width));
  };

  return <div className="overview" ref={strip} onPointerDown={stripDown} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    {timeline.parts.map((part, index) => <span key={index} className="overview-part" style={{left: at(part.from), width: `calc(${at(part.to - part.from)} - 1px)`}}/>)}
    {(timeline.narration || []).filter(line => line.from !== null && line.to !== null).map(line =>
      <span key={line.id} className="overview-line" style={{left: at(line.from), width: at(line.to - line.from)}}/>)}
    <span className="overview-playhead" style={{left: at(Math.min(time, duration))}}/>
    <div className="overview-window" role="slider" tabIndex={0} aria-label="Part of the timeline in view"
      aria-valuemin={0} aria-valuemax={+(duration * (1 - view.width)).toFixed(2)} aria-valuenow={+(duration * view.start).toFixed(2)}
      aria-valuetext={`Showing ${timecode(duration * view.start)} to ${timecode(duration * (view.start + view.width))}`}
      data-tip="Drag to scroll the timeline, or drag the edges to zoom" onPointerDown={event => begin(event, 'move')} onKeyDown={keys}
      style={{left: percent(view.start), width: percent(view.width)}}>
      <span className="overview-edge start" onPointerDown={event => begin(event, 'start')}/>
      <span className="overview-edge end" onPointerDown={event => begin(event, 'end')}/>
    </div>
  </div>;
}
