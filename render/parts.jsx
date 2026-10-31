// Shared pieces: the cursor and one clip of a recording, fitted into a box.
import React from 'react';
import {AbsoluteFill, Sequence, Video, Audio, Img, useCurrentFrame, useVideoConfig} from './frame.jsx';
import {clamp, ease, speedOf, demoFrames, playedClips, clipFrames, crossfades, transitionSeconds} from './timing.js';

export {clamp, ease, speedOf, demoFrames};

export function lastAt(events, time) {
  let lower = 0; let upper = events.length - 1; let found = -1;
  while (lower <= upper) {
    const middle = (lower + upper) >> 1;
    if (events[middle].t <= time) { found = middle; lower = middle + 1; } else upper = middle - 1;
  }
  return found;
}

// Glide toward the next event so the cursor lands on a click exactly when it happens.
export function cursorAt(events, time) {
  const found = lastAt(events, time);
  if (found < 0) return null;
  const current = events[found];
  const next = events[found + 1];
  if (!next) return current;
  const travel = Math.min(0.6, next.t - current.t);
  const amount = ease((time - (next.t - travel)) / travel);
  return {...current, x: current.x + (next.x - current.x) * amount, y: current.y + (next.y - current.y) * amount};
}

export function Cursor({events, clicks, time, width, height, style}) {
  const cursor = cursorAt(events, time);
  if (!cursor || cursor.visible === false) return null;
  const recent = clicks[lastAt(clicks, time)];
  const click = recent && time - recent.t < 0.5 ? recent : null;
  const pulse = click ? (time - click.t) / 0.5 : 1;
  return <>
    {click && <div style={{position: 'absolute', left: click.x * width, top: click.y * height, width: 24 + pulse * 60, height: 24 + pulse * 60, borderRadius: '50%', border: `3px solid ${style.clickColor}`, opacity: 1 - pulse, transform: 'translate(-50%, -50%)'}}/>}
    <svg width={style.cursorSize} height={style.cursorSize * 1.35} viewBox="0 0 24 32" style={{position: 'absolute', left: cursor.x * width, top: cursor.y * height, filter: 'drop-shadow(0 2px 3px #0008)'}}>
      <path d="M2 2 L2 25 L8 19 L13 30 L18 28 L13 17 L22 17 Z" fill="white" stroke="#171923" strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  </>;
}

// A spotlight: everything but one area of the screen dims for a while (x, y, w, h from 0 to 1, recording seconds).
function Spotlight({spots = [], time, width, height}) {
  const spot = spots.find(item => time >= item.start && time <= item.end);
  if (!spot) return null;
  const fade = Math.min(ease((time - spot.start) / 0.3), ease((spot.end - time) / 0.3));
  return <div style={{position: 'absolute', left: spot.x * width, top: spot.y * height, width: spot.w * width, height: spot.h * height, borderRadius: 14,
    boxShadow: `0 0 0 ${Math.round(2 * Math.max(width, height))}px rgba(0, 0, 0, ${(0.6 * fade).toFixed(3)})`, outline: `2px solid rgba(255, 255, 255, ${(0.35 * fade).toFixed(3)})`}}/>;
}

// Redactions: areas blurred or covered for a while (x, y, w, h from 0 to 1 of the recording; recording seconds).
function Redactions({items = [], time, width, height}) {
  return <>{items.filter(item => time >= item.start && time <= item.end).map((item, index) => {
    const box = {position: 'absolute', left: item.x * width, top: item.y * height, width: item.w * width, height: item.h * height, borderRadius: 6};
    return item.style === 'solid' ? <div key={index} style={{...box, background: '#18181b'}}/>
      : <div key={index} style={{...box, backdropFilter: `blur(${Math.round(width * 0.012)}px) saturate(0.6)`, background: '#18181b33'}}/>;
  })}</>;
}

// Callouts, numbered steps, arrows and highlight boxes, on the recording (they move with zooms). unit: 1% of the
// screen's width as shown, so text keeps one size whatever the recording's resolution.
function Annotations({items = [], time, width, height, unit, color}) {
  const steps = items.filter(item => item.type === 'step').sort((a, b) => a.start - b.start);
  const font = 'system-ui, sans-serif';
  return <>{items.filter(item => time >= item.start && time <= item.end).map((item, index) => {
    const shown = Math.min(ease((time - item.start) / 0.25), ease((item.end - time) / 0.25));
    const [x, y] = [item.x * width, item.y * height];
    if (item.type === 'box') return <div key={index} style={{position: 'absolute', left: x, top: y, width: item.w * width, height: item.h * height, borderRadius: unit,
      border: `${Math.max(2, unit * 0.35)}px solid ${color}`, boxShadow: `0 0 0 ${unit * 0.3}px ${color}33`, opacity: shown}}/>;
    if (item.type === 'arrow') {
      const [toX, toY] = [item.x2 * width, item.y2 * height];
      const angle = Math.atan2(toY - y, toX - x); const head = unit * 2.2; const stroke = Math.max(3, unit * 0.45);
      const along = shown; const [endX, endY] = [x + (toX - x) * along, y + (toY - y) * along];
      const wing = side => `${endX - head * Math.cos(angle + side * 0.5)},${endY - head * Math.sin(angle + side * 0.5)}`;
      return <svg key={index} width={width} height={height} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', filter: 'drop-shadow(0 2px 4px #0008)'}}>
        <line x1={x} y1={y} x2={endX} y2={endY} stroke={color} strokeWidth={stroke} strokeLinecap="round"/>
        <polygon points={`${endX},${endY} ${wing(1)} ${wing(-1)}`} fill={color}/>
      </svg>;
    }
    // A callout or step: a label beside its point, on the side with room.
    const left = item.x > 0.6;
    const number = item.type === 'step' ? steps.indexOf(item) + 1 : null;
    return <div key={index} style={{position: 'absolute', left: x, top: y, transform: `translate(${left ? '-100%' : '0'}, -50%) scale(${0.92 + 0.08 * shown})`,
      transformOrigin: left ? 'right center' : 'left center', opacity: shown, display: 'flex', alignItems: 'center', gap: unit * 0.8, flexDirection: left ? 'row-reverse' : 'row'}}>
      <div style={{width: unit * 1.2, height: unit * 1.2, borderRadius: '50%', background: color, boxShadow: `0 0 0 ${unit * 0.4}px ${color}44`, flex: 'none'}}/>
      <div data-check="text" style={{display: 'flex', alignItems: 'center', gap: unit * 0.8, padding: `${unit * 0.7}px ${unit * 1.3}px`, borderRadius: unit * 1.1, background: '#18181bf0',
        color: '#fafafa', fontFamily: font, fontWeight: 600, fontSize: unit * 2.1, lineHeight: 1.25, maxWidth: width * 0.5, boxShadow: '0 8px 30px #0009', whiteSpace: 'pre-wrap'}}>
        {number && <span style={{display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: unit * 2.6, height: unit * 2.6, borderRadius: '50%', background: color, color: '#fff', fontSize: unit * 1.6, flex: 'none'}}>{number}</span>}
        {item.text}
      </div>
    </div>;
  })}</>;
}

// Shortcuts as they're pressed (key events with a combo), each for a moment, newest last.
function Keystrokes({events, time, width, height}) {
  const shown = events.filter(event => event.combo && time >= event.t && time < event.t + 1.4).slice(-3);
  if (!shown.length) return null;
  const unit = width / 100;
  return <div style={{position: 'absolute', right: unit * 3, bottom: height * 0.07 + unit * 6, display: 'flex', gap: unit, alignItems: 'center'}}>
    {shown.map((event, index) => {
      const fade = Math.min(ease((time - event.t) / 0.12), ease((event.t + 1.4 - time) / 0.3));
      return <div key={index} style={{padding: `${unit * 0.8}px ${unit * 1.6}px`, borderRadius: unit, background: '#18181bf2', border: '1px solid #ffffff26', color: '#fafafa',
        fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: unit * 2.4, boxShadow: '0 8px 30px #0009', opacity: fade, transform: `translateY(${(1 - fade) * unit}px)`}}>{event.combo.replace(/\+/g, ' + ')}</div>;
    })}
  </div>;
}

// box: the area the screen is fitted into (the whole video, or half of it in a comparison).
// sound: the address of the sound to play with it (the live preview; a render adds the mixed sound with ffmpeg).
// A freeze (clip.hold) shows its still (holds: source second → picture) with the cursor where it was, in silence.
export function Clip({project, clip, sourceUrl, events, clicks, transcript, webcams, holds = {}, box, rate = 1, sound = null}) {
  if (clip.hold) rate = 0;
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const time = clip.start + frame * rate / fps;
  const padding = box?.padding ?? project.style.padding;
  // A crop shows part of the recording as the whole screen. Zooms, cursor and spotlights keep full-recording
  // coordinates; local() turns a full-recording point into one on the cropped screen.
  const crop = project.crop || {x: 0, y: 0, w: 1, h: 1};
  const [sourceWidth, sourceHeight] = [project.width * crop.w, project.height * crop.h];
  const local = point => ({...point, x: (point.x - crop.x) / crop.w, y: (point.y - crop.y) / crop.h});
  const [boxWidth, boxHeight] = [(box?.width ?? width) - 2 * padding, (box?.height ?? height) - 2 * padding];
  // A wide screen in a tall video (Shorts, Reels, X on a phone) fitted whole is a thin strip of tiny text. Instead it
  // fills a 4:5 window as tall as it can be, cropped to what's around the cursor, and the window follows it.
  // Only a tall video (vertical, portrait) crops: a square one shows the whole desktop, as it was recorded.
  const follow = boxHeight > boxWidth * 1.1 && sourceWidth / sourceHeight > 1.3 * boxWidth / boxHeight;
  const [fitWidth, fitHeight] = follow ? [boxWidth, Math.min(boxHeight, boxWidth * 5 / 4)] : [boxWidth, boxHeight];
  // At most 2 video pixels per recorded pixel: a small area on a non-Retina screen blown up more turns to mush.
  const ratio = follow ? Math.min(2, fitHeight / sourceHeight, fitWidth * 0.98 / (sourceWidth * 0.4)) : Math.min(2, boxWidth / sourceWidth, boxHeight / sourceHeight);
  const screenWidth = sourceWidth * ratio;
  const screenHeight = sourceHeight * ratio;
  const [fullWidth, fullHeight] = [project.width * ratio, project.height * ratio];
  const [viewWidth, viewHeight] = [Math.min(screenWidth, fitWidth), Math.min(screenHeight, fitHeight)];
  const index = project.zooms.findIndex(item => time >= item.start && time <= item.end);
  const zoom = project.zooms[index];
  // Zooms that touch are chained: no zoom out/in between them, just a pan.
  const previous = index > 0 && Math.abs(project.zooms[index - 1].end - zoom.start) < 0.05 ? project.zooms[index - 1] : null;
  const next = zoom && project.zooms[index + 1] && Math.abs(project.zooms[index + 1].start - zoom.end) < 0.05;
  const strength = zoom ? Math.min(previous ? 1 : ease((time - zoom.start) / 0.4), next ? 1 : ease((zoom.end - time) / 0.4)) : 0;
  const pan = previous ? ease((time - zoom.start) / 0.6) : 1;
  const focus = zoom && local(['x', 'y', 'scale'].reduce((values, key) => ({...values, [key]: previous ? previous[key] + (zoom[key] - previous[key]) * pan : zoom[key]}), {}));
  // Following, a click's zoom adds less: never past 2 video pixels per recorded one.
  const most = follow ? Math.max(1, 2 / ratio) : Infinity;
  const scale = zoom ? 1 + (Math.min(focus.scale, most) - 1) * strength : 1;
  let [moveX, moveY] = [0, 0];
  if (follow) {
    // The cursor over the last second and a bit ahead, averaged: the window glides instead of shaking.
    // Typed keys don't count: a terminal's carry no real pointer.
    const pointer = events.filter(event => event.type !== 'key');
    const seen = Array.from({length: 16}, (_, step) => cursorAt(pointer, time - 1.2 + step * 0.1)).filter(Boolean).map(local);
    // No pointer (a terminal): its left edge, where every line starts.
    const at = seen.length ? {x: seen.reduce((sum, item) => sum + item.x, 0) / seen.length, y: seen.reduce((sum, item) => sum + item.y, 0) / seen.length} : {x: 0, y: 0.5};
    const center = zoom ? {x: at.x + (focus.x - at.x) * strength, y: at.y + (focus.y - at.y) * strength} : at;
    moveX = clamp(viewWidth / 2 - center.x * screenWidth * scale, viewWidth - screenWidth * scale, 0);
    moveY = clamp(viewHeight / 2 - center.y * screenHeight * scale, viewHeight - screenHeight * scale, 0);
  } else if (zoom) {
    moveX = clamp(screenWidth / 2 - focus.x * screenWidth * focus.scale, screenWidth * (1 - focus.scale), 0) * strength;
    moveY = clamp(screenHeight / 2 - focus.y * screenHeight * focus.scale, screenHeight * (1 - focus.scale), 0) * strength;
  }
  const caption = project.captions?.enabled ? transcript.find(item => time >= item.start && time < item.end) : null;
  const webcam = webcams?.find(item => time >= item.start && time < item.end);
  return <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
    <div style={{width: viewWidth, height: viewHeight, overflow: 'hidden', position: 'relative', borderRadius: project.style.radius, boxShadow: project.style.shadow ? '0 24px 70px #0008, 0 0 0 1px #ffffff18' : undefined}}>
      <div style={{position: 'relative', overflow: 'hidden', width: screenWidth, height: screenHeight, transformOrigin: '0 0', transform: `translate(${moveX}px, ${moveY}px) scale(${scale})`}}>
        <div style={{position: 'absolute', left: -crop.x * fullWidth, top: -crop.y * fullHeight, width: fullWidth, height: fullHeight}}>
          {clip.hold ? <Img src={holds[clip.start.toFixed(3)]} style={{width: fullWidth, height: fullHeight, display: 'block'}}/>
            : <Video src={sourceUrl} muted playbackRate={rate} trimBefore={Math.round(clip.start * fps)} objectFit="fill" style={{width: fullWidth, height: fullHeight}}/>}
          {sound && !clip.hold && <Audio src={sound} playbackRate={rate} trimBefore={Math.round(clip.start * fps)}/>}
          <Redactions items={project.redactions} time={time} width={fullWidth} height={fullHeight}/>
          <Spotlight spots={project.spotlights} time={time} width={fullWidth} height={fullHeight}/>
          <Annotations items={project.annotations} time={time} width={fullWidth} height={fullHeight} unit={screenWidth / 100} color={project.style.clickColor || '#ff3b5c'}/>
          {!project.cursorBaked && project.cursorEnabled !== false && <Cursor events={events} clicks={clicks} time={time} width={fullWidth} height={fullHeight} style={project.style}/>}
        </div>
      </div>
    </div>
    {project.keystrokes && <Keystrokes events={events} time={time} width={width} height={height}/>}
    {webcam && !clip.hold && <div style={{position: 'absolute', [project.webcam.position?.startsWith('top') ? 'top' : 'bottom']: padding, [project.webcam.position?.endsWith('left') ? 'left' : 'right']: padding, width: width * project.webcam.size, height: width * project.webcam.size * (project.webcam.round === false ? 0.75 : 1), borderRadius: project.webcam.round === false ? width * 0.016 : '50%', overflow: 'hidden', boxShadow: '0 12px 40px #0009', border: '4px solid #ffffffcc'}}>
      <Sequence from={Math.max(0, Math.round((webcam.start - clip.start) * fps / rate))} layout="none" premountFor={fps}>
        <Video src={webcam.url} muted playbackRate={rate} trimBefore={Math.round((Math.max(0, clip.start - webcam.start) + (webcam.sourceOffset || 0)) * fps)} objectFit="cover" style={{width: '100%', height: '100%'}}/>
      </Sequence>
    </div>}
    {caption && <div style={{position: 'absolute', bottom: height * 0.07, maxWidth: width * 0.8, padding: '14px 24px', background: '#10121ee8', color: 'white', fontFamily: 'Arial, sans-serif', fontWeight: 600, fontSize: Math.round(width / 40), borderRadius: 12, textAlign: 'center', lineHeight: 1.35}}>{caption.text.trim()}</div>}
  </AbsoluteFill>;
}

// An intro or outro card: the text rises in, and fades out at the end (frames: how long it shows).
function Title({text, frames}) {
  const frame = useCurrentFrame();
  const {width} = useVideoConfig();
  const shown = Math.min(ease(frame / 12), ease((frames - frame) / 10));
  return <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', color: '#fafafa', fontFamily: 'system-ui, sans-serif', fontSize: Math.round(width / 15), fontWeight: 700,
    letterSpacing: '-0.02em', lineHeight: 1.1, textAlign: 'center', padding: width * 0.09, whiteSpace: 'pre-wrap', textShadow: '0 4px 40px #0008', opacity: shown, transform: `translateY(${(1 - ease(frame / 18)) * 20}px)`}}>{text}</AbsoluteFill>;
}

// Transition looks, progress from 0 to 1. leaving: the outgoing picture on top of the next (a recording's cuts).
// entering: the next picture on top of the outgoing one (a film's scenes).
export function leaving(style, progress) {
  if (style === 'wipe') return {clipPath: `inset(0 0 0 ${(progress * 100).toFixed(2)}%)`};
  if (style === 'slide') return {transform: `translateX(${(-progress * 100).toFixed(2)}%)`, opacity: 1 - 0.4 * progress};
  if (style === 'zoom') return {transform: `scale(${1 + 0.18 * progress})`, filter: `blur(${(progress * 14).toFixed(1)}px)`, opacity: 1 - progress};
  return {opacity: 1 - progress};
}
export function entering(style, progress) {
  if (style === 'wipe') return {clipPath: `inset(0 ${((1 - progress) * 100).toFixed(2)}% 0 0)`};
  if (style === 'slide') return {transform: `translateX(${((1 - progress) * 100).toFixed(2)}%)`};
  if (style === 'zoom') return {transform: `scale(${1.12 - 0.12 * progress})`, filter: `blur(${((1 - progress) * 14).toFixed(1)}px)`, opacity: progress};
  return {opacity: progress};
}

function Leaving({frames, style, children}) {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={leaving(style, ease(frame / frames))}>{children}</AbsoluteFill>;
}

// Background music in the live preview (a render mixes it with ffmpeg, ducked under the voice).
function Music({music}) {
  const {durationInFrames} = useVideoConfig();
  return <Sequence durationInFrames={durationInFrames} layout="none"><Audio src={music.url} loop loopSeconds={music.seconds} volume={0.12 * (music.volume ?? 1)}/></Sequence>;
}

// One recording edited: intro, the kept clips, outro. Also played live in the panel (render/preview.jsx).
export function Demo(props) {
  const {project} = props;
  const {fps} = useVideoConfig();
  let offset = project.intro ? Math.round(project.intro.duration * fps) : 0;
  const starts = [];
  const sequences = playedClips(project).map((clip, index) => {
    const duration = clipFrames(clip, fps);
    starts.push(offset);
    const sequence = <Sequence key={index} from={offset} durationInFrames={duration} premountFor={fps}><Clip {...props} clip={clip} rate={clip.speed}/></Sequence>;
    offset += duration;
    return sequence;
  });
  // A transition: the outgoing part, frozen at its last moment (zoom and cursor as they were), leaving on top.
  const seconds = transitionSeconds(project.transition);
  const fade = Math.round(seconds * fps);
  const quiet = {...project, captions: {enabled: false}, keystrokes: false};
  const fades = crossfades(project).map(({index, from}) => <Sequence key={`fade${index}`} from={starts[index]} durationInFrames={fade}>
    <Leaving frames={fade} style={project.transition}><Clip {...props} project={quiet} transcript={[]} webcams={[]} clip={{start: from, end: from, hold: seconds}} rate={0}/></Leaving>
  </Sequence>);
  return <AbsoluteFill style={{background: project.style.background}}>
    {project.intro && <Sequence durationInFrames={Math.round(project.intro.duration * fps)} premountFor={fps}><Title text={project.intro.text} frames={Math.round(project.intro.duration * fps)}/></Sequence>}
    {sequences}
    {fades}
    {props.music && <Music music={props.music}/>}
    {project.outro && <Sequence from={offset} durationInFrames={Math.round(project.outro.duration * fps)} premountFor={fps}><Title text={project.outro.text} frames={Math.round(project.outro.duration * fps)}/></Sequence>}
  </AbsoluteFill>;
}

