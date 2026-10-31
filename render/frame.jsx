// flikka's frame kit: React components drawn from one number, the frame, on a HyperFrames composition.
// HyperFrames seeks the page (a render one frame at a time, the player as it plays) and sends an "hf-seek"
// event with the time; the whole tree is drawn again for that frame before the event returns, so what is
// captured is always the frame asked for. Media become HyperFrames clips (data-start, data-media-start…):
// HyperFrames plays, seeks and hides them, so every Sequence stays mounted and is only hidden outside its time.
import React, {createContext, useContext} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';

const Video_ = createContext({fps: 30, width: 1920, height: 1080, durationInFrames: 1});
const Frame = createContext(0);
// The current Sequence: where it starts on the composition's timeline, and for how many frames.
const Span = createContext({from: 0, duration: Infinity});

export const useVideoConfig = () => useContext(Video_);
export const useCurrentFrame = () => useContext(Frame) - useContext(Span).from;

// Draw `Component` with `props` into `element`, and again on every seek.
export function mount(element, Component, props, config) {
  const root = createRoot(element);
  let shown = -1;
  const draw = frame => {
    if (frame === shown) return;
    shown = frame;
    flushSync(() => root.render(<Video_.Provider value={config}><Frame.Provider value={frame}><Component {...props}/></Frame.Provider></Video_.Provider>));
  };
  draw(0);
  addEventListener('hf-seek', event => draw(Math.max(0, Math.min(config.durationInFrames - 1, Math.round(event.detail.time * config.fps)))));
}

export function AbsoluteFill({style, children, ...rest}) {
  return <div style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', ...style}} {...rest}>{children}</div>;
}

// Children see frames counted from `from`. layout="none" adds no box, and so can't hide: use it for sound.
export function Sequence({from = 0, durationInFrames = Infinity, layout, style, children}) {
  const parent = useContext(Span);
  const frame = useContext(Frame);
  const start = parent.from + from;
  const duration = Math.max(0, Math.min(durationInFrames, parent.from + parent.duration - start));
  const span = <Span.Provider value={{from: start, duration}}>{children}</Span.Provider>;
  if (layout === 'none') return span;
  const shown = frame >= start && frame < start + duration;
  return <AbsoluteFill style={{...style, ...(shown ? {} : {display: 'none'})}}>{span}</AbsoluteFill>;
}

export const Img = props => <img {...props}/>;

// Where a Sequence's media sits on the composition's timeline, in seconds.
function window_() {
  const {fps, durationInFrames} = useVideoConfig();
  const {from, duration} = useContext(Span);
  return {start: from / fps, seconds: (Math.min(from + duration, durationInFrames) - from) / fps};
}

// A video or sound clip. trimBefore (frames) skips the start of the file. HyperFrames has no looping,
// so with loop and loopSeconds (the file's length) the file is laid end to end to fill the Sequence.
function Media({tag: Tag, src, trimBefore = 0, playbackRate = 1, loop, loopSeconds, volume, muted, objectFit, style, ...rest}) {
  const {fps} = useVideoConfig();
  const {start, seconds} = window_();
  const offset = trimBefore / fps;
  const length = loop && loopSeconds ? (loopSeconds - offset) / playbackRate : seconds;
  const count = Math.max(1, Math.ceil(seconds / Math.max(0.1, length) - 1e-6));
  return <>{Array.from({length: count}, (_, index) => <Tag key={index} {...rest} src={src} muted={muted} playsInline
    data-start={start + index * length} data-duration={Math.min(length, seconds - index * length)} data-media-start={index ? 0 : offset} data-playback-rate={playbackRate !== 1 ? playbackRate : undefined}
    data-volume={volume !== undefined ? volume : undefined} data-has-audio={Tag === 'video' && !muted ? 'true' : undefined}
    style={{objectFit, ...style}}/>)}</>;
}
export const Video = props => <Media tag="video" {...props}/>;
export const Audio = props => <Media tag="audio" {...props}/>;

// The usual helpers for custom scenes.
export function interpolate(input, inputRange, outputRange, {easing = value => value, extrapolateLeft = 'extend', extrapolateRight = 'extend'} = {}) {
  let index = 1;
  while (index < inputRange.length - 1 && input > inputRange[index]) index++;
  const [inLow, inHigh] = [inputRange[index - 1], inputRange[index]];
  const [outLow, outHigh] = [outputRange[index - 1], outputRange[index]];
  let progress = (input - inLow) / (inHigh - inLow || 1);
  if (progress < 0 && extrapolateLeft !== 'extend') progress = extrapolateLeft === 'clamp' ? 0 : progress;
  if (progress > 1 && extrapolateRight !== 'extend') progress = extrapolateRight === 'clamp' ? 1 : progress;
  if (extrapolateLeft === 'identity' && input < inputRange[0]) return input;
  if (extrapolateRight === 'identity' && input > inputRange.at(-1)) return input;
  return outLow + (outHigh - outLow) * easing(progress);
}

const bezier = (x1, y1, x2, y2) => value => {
  // Solve x(t) = value for t (Newton steps, then bisection), return y(t).
  const curve = (a, b, t) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  let t = value;
  for (let step = 0; step < 8; step++) {
    const slope = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * (1 - t) * t + 3 * (1 - x2) * t ** 2;
    if (Math.abs(slope) < 1e-6) break;
    t -= (curve(x1, x2, t) - value) / slope;
  }
  t = Math.min(1, Math.max(0, t));
  return curve(y1, y2, t);
};
export const Easing = {
  linear: value => value, quad: value => value * value, cubic: value => value ** 3,
  sin: value => 1 - Math.cos(value * Math.PI / 2), circle: value => 1 - Math.sqrt(1 - value * value),
  exp: value => value === 0 ? 0 : 2 ** (10 * (value - 1)), ease: bezier(0.42, 0, 1, 1), bezier,
  in: easing => easing, out: easing => value => 1 - easing(1 - value),
  inOut: easing => value => value < 0.5 ? easing(value * 2) / 2 : 1 - easing((1 - value) * 2) / 2,
};

// A damped spring from `from` to `to`, `frame` frames after it starts.
export function spring({frame, fps, config = {}, from = 0, to = 1}) {
  const {damping = 10, mass = 1, stiffness = 100, overshootClamping = false} = config;
  const time = Math.max(0, frame) / fps;
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let moved;
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    moved = 1 - Math.exp(-zeta * omega * time) * (Math.cos(damped * time) + zeta * omega / damped * Math.sin(damped * time));
  } else moved = 1 - Math.exp(-omega * time) * (1 + omega * time);
  if (overshootClamping) moved = Math.min(1, moved);
  return from + (to - from) * moved;
}
