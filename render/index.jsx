// A composition's page script (lib/compose.mjs writes the page): a recording's edit (Demo) or a film,
// drawn from the props the page carries. Custom scenes are registered before start() runs.
import React from 'react';
import {mount, useCurrentFrame, useVideoConfig} from './frame.jsx';
import {Demo} from './parts.jsx';
import {segments, clock} from './timing.js';
import {Film, layoutIssues} from './film.jsx';

// Frame sheets of a recording: the time in the finished video, and the recording's own second it shows.
function StampedDemo(props) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const time = frame / fps;
  const part = segments(props.project, fps).find(item => time >= item.from && time < item.to);
  const source = part ? clock(part.start + (time - part.from) * part.speed) : 'intro/outro';
  return <><Demo {...props}/><div style={{position: 'absolute', left: 18, top: 18, padding: '8px 16px', borderRadius: 10, background: '#000000b0', color: '#fff', fontFamily: 'ui-monospace, monospace', fontSize: 40}}>{clock(time)} · rec {source}</div></>;
}

export function start() {
  const {kind, props, config} = window.FLIKKA;
  // Frame sheets ask for the timecode stamp in the address: the same composition serves both.
  const stamp = new URLSearchParams(location.search).has('stamp');
  if (kind === 'film') props.film = {...props.film, stamp};
  window.flikkaLayout = () => layoutIssues(config.width, config.height);
  mount(document.getElementById('app'), kind === 'film' ? Film : stamp ? StampedDemo : Demo, props, config);
}
