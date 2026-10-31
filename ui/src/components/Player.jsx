import React, {useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX} from 'lucide-react';
import {timecode} from '../lib/format.js';
import {Button} from './ui.jsx';

// The big player: a <hyperframes-player> for the exported video (video mode) or the live composition. It keeps
// its moment when a new version of the source loads. `fps` is what a frame step moves by.
export function Player({src, video, width, height, fps, onTime, ref, note, children}) {
  const element = useRef(null);
  const [state, setState] = useState({time: 0, duration: 0, playing: false, muted: false, ready: false});
  const resume = useRef(0);

  // What the page drives: the transport here, the timeline and the keyboard shortcuts.
  const controls = useMemo(() => ({
    seek: time => { const player = element.current; if (!player) return; const clamped = Math.max(0, Math.min(time, player.duration || time)); player.seek(clamped); report(clamped); },
    toggle: () => { const player = element.current; if (!player?.ready) return; player.paused ? player.play() : player.pause(); },
    step: frames => { const player = element.current; if (!player) return; player.pause(); controls.seek((Math.round(player.currentTime * fps) + frames) / fps); },
    mute: () => { const player = element.current; if (!player) return; player.muted = !player.muted; setState(old => ({...old, muted: player.muted})); },
    get time() { return element.current?.currentTime || 0; },
    get duration() { return element.current?.duration || 0; },
  }), [fps]);
  useImperativeHandle(ref, () => controls, [controls]);

  const timeListener = useRef(onTime);
  timeListener.current = onTime;
  const report = time => { setState(old => ({...old, time})); timeListener.current?.(time); };

  // A new source (an edit rewrote the preview): come back to the same moment once it's ready.
  useEffect(() => {
    const player = element.current;
    if (!player) return;
    resume.current = state.time;
    setState(old => ({...old, ready: false, playing: false}));
    const ready = event => {
      setState(old => ({...old, ready: true, duration: event.detail?.duration || player.duration || 0}));
      if (resume.current) player.seek(Math.min(resume.current, player.duration || resume.current));
    };
    const duration = event => setState(old => ({...old, duration: event.detail?.duration || player.duration || 0}));
    const play = () => setState(old => ({...old, playing: true}));
    const pause = () => { setState(old => ({...old, playing: false})); report(player.currentTime); };
    const events = {ready, durationchange: duration, play, pause, ended: pause, timeupdate: () => report(player.currentTime)};
    for (const [name, listener] of Object.entries(events)) player.addEventListener(name, listener);
    return () => { for (const [name, listener] of Object.entries(events)) player.removeEventListener(name, listener); };
  }, [src]);

  // The playhead every frame while it plays (timeupdate only comes about 10 times a second).
  useEffect(() => {
    if (!state.playing) return;
    let frame;
    const tick = () => { report(element.current?.currentTime || 0); frame = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [state.playing]);

  return <div className="player-wrap">
    <div className="player-stage textured">
      {src ? <hyperframes-player ref={element} key={video ? 'video' : 'live'} src={src} width={width} height={height} type={video ? 'video/mp4' : undefined}
        style={{aspectRatio: `${width} / ${height}`, width: `min(100cqw, ${(width / height).toFixed(4)} * 100cqh)`}}/> : <div className="stage-note">{note || 'Preparing the preview…'}</div>}
      {src && !state.ready && <div className="stage-loading" aria-hidden/>}
    </div>
    <div className="transport" role="group" aria-label="Playback">
      <Button icon={state.playing ? Pause : Play} variant="ghost" tip={state.playing ? 'Pause (Space)' : 'Play (Space)'} disabled={!state.ready} onClick={() => controls.toggle()}/>
      <Button icon={ChevronLeft} variant="ghost" size="small" tip="Back one frame (←)" disabled={!state.ready} onClick={() => controls.step(-1)}/>
      <Button icon={ChevronRight} variant="ghost" size="small" tip="Forward one frame (→)" disabled={!state.ready} onClick={() => controls.step(1)}/>
      <span className="timecode" aria-live="off"><b>{timecode(state.time)}</b><span>/ {timecode(state.duration)}</span></span>
      <span className="frame-count" data-tip="Frame at this moment">f {Math.round(state.time * fps)}</span>
      <span className="grow"/>
      {children}
      <Button icon={state.muted ? VolumeX : Volume2} variant="ghost" size="small" tip={state.muted ? 'Sound on (M)' : 'Mute (M)'} disabled={!state.ready} onClick={controls.mute}/>
    </div>
  </div>;
}
