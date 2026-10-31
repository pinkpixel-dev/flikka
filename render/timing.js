// Timing shared by the renderer (render/*.jsx) and the node side (lib/): plain JavaScript, no JSX.
export const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
export const ease = value => { value = clamp(value, 0, 1); return value * value * (3 - 2 * value); };

// A part's playback speed: its own, the whole video's, or as recorded (lib/render.mjs does the same for the sound).
export const speedOf = (project, clip) => clip.speed || project.speed || 1;

// What plays, in order: the kept clips with their speed (0 for a freeze, a {start = end, hold} clip that shows one
// moment for `hold` seconds), and, with project.ramp (seconds), short constant-speed slices easing between two
// touching parts at different speeds. A slice is ~0.1 s of output; speeds step logarithmically, so 1→4 passes 2
// halfway. Each side gives up at most a third of its own length to the ramp.
export function playedClips(project) {
  const clips = project.clips.map(clip => ({...clip, speed: clip.hold ? 0 : speedOf(project, clip)}));
  if (!project.ramp) return clips;
  const played = [];
  for (const [index, a] of clips.entries()) {
    const b = clips[index + 1];
    if (!b || a.hold || b.hold || Math.abs(a.end - b.start) > 1e-6 || a.speed === b.speed) { played.push(a); continue; }
    const [before, after] = [Math.min(project.ramp / 2 * a.speed, (a.end - a.start) / 3), Math.min(project.ramp / 2 * b.speed, (b.end - b.start) / 3)];
    const [from, to] = [a.end - before, b.start + after];
    a.end = from; b.start = to;
    played.push(a);
    const count = Math.max(3, Math.round(project.ramp / 0.1));
    for (let step = 0; step < count; step++) {
      played.push({start: from + (to - from) * step / count, end: from + (to - from) * (step + 1) / count, speed: a.speed * (b.speed / a.speed) ** ((step + 0.5) / count), ramp: true});
    }
  }
  return played;
}

// A played clip's length in frames: a freeze lasts its hold, anything else its source length at its speed.
export const clipFrames = (clip, fps) => Math.max(1, Math.round((clip.hold ? clip.hold : (clip.end - clip.start) / clip.speed) * fps));

export const demoFrames = (project, fps = project.export.fps) => playedClips(project).reduce((total, clip) => total + clipFrames(clip, fps), 0)
  + Math.round(((project.intro?.duration || 0) + (project.outro?.duration || 0)) * fps);

// Where each played part of a recording lands in the finished video, in seconds. Frame-exact like the render
// (clipFrames), after the intro's frames. A freeze has speed 0: its whole span shows the same moment.
export function segments(project, fps = project.export.fps) {
  let frame = Math.round((project.intro?.duration || 0) * fps);
  return playedClips(project).map((clip, index) => {
    const frames = clipFrames(clip, fps);
    const part = {index, start: clip.start, end: clip.end, speed: clip.speed, from: frame / fps, to: (frame + frames) / fps,
      ...(clip.hold && {hold: clip.hold}), ...(clip.ramp && {ramp: true})};
    frame += frames;
    return part;
  });
}

// A recording's moment (source seconds) in the finished video, or null when it was cut.
export function toOutput(project, time, fps = project.export.fps) {
  const parts = segments(project, fps);
  // A freeze comes first at its own moment: the viewer sees that moment when the freeze starts.
  const part = parts.find(item => item.hold ? Math.abs(time - item.start) < 1e-6 : time >= item.start && time < item.end) || (parts.at(-1)?.end === time ? parts.at(-1) : null);
  if (!part) return null;
  return part.hold ? part.from : Math.min(part.to, part.from + (time - part.start) / part.speed);
}

// A moment of the finished video in the recording's own seconds, or null in the intro or outro.
// end: the time ends a range, so a moment on a boundary belongs to the part before it.
export function toSource(project, time, {end = false, fps = project.export.fps} = {}) {
  const part = segments(project, fps).find(item => end ? time > item.from && time <= item.to : time >= item.from && time < item.to);
  return part ? Math.min(part.end, part.start + (time - part.from) * part.speed) : null;
}

// "80", "80.5", "1:20", "1:20.5" or "1:02:03" → seconds (NaN when it isn't a time).
export function seconds(text) {
  const parts = String(text).trim().split(':');
  if (parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part))) return NaN;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

// Seconds as m:ss.ss, for timelines and frame stamps.
export const clock = value => `${Math.floor(value / 60)}:${(value % 60).toFixed(2).padStart(5, '0')}`;
