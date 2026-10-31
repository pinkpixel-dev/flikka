// Timing shared by the renderer (render/*.jsx) and the node side (lib/): plain JavaScript, no JSX.
export const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
export const ease = value => { value = clamp(value, 0, 1); return value * value * (3 - 2 * value); };

// A part's playback speed: its own, the whole video's, or as recorded (lib/render.mjs does the same for the sound).
export const speedOf = (project, clip) => clip.speed || project.speed || 1;
export const demoFrames = (project, fps = project.export.fps) => project.clips.reduce((total, clip) => total + Math.max(1, Math.round((clip.end - clip.start) * fps / speedOf(project, clip))), 0)
  + Math.round(((project.intro?.duration || 0) + (project.outro?.duration || 0)) * fps);

// Where each kept part of a recording lands in the finished video, in seconds. Frame-exact like the render:
// each part lasts max(1, round(seconds × fps / speed)) frames, after the intro's frames.
export function segments(project, fps = project.export.fps) {
  let frame = Math.round((project.intro?.duration || 0) * fps);
  return project.clips.map((clip, index) => {
    const speed = speedOf(project, clip);
    const frames = Math.max(1, Math.round((clip.end - clip.start) * fps / speed));
    const part = {index, start: clip.start, end: clip.end, speed, from: frame / fps, to: (frame + frames) / fps};
    frame += frames;
    return part;
  });
}

// A recording's moment (source seconds) in the finished video, or null when it was cut.
export function toOutput(project, time, fps = project.export.fps) {
  const parts = segments(project, fps);
  const part = parts.find(item => time >= item.start && time < item.end) || (parts.at(-1)?.end === time ? parts.at(-1) : null);
  return part ? Math.min(part.to, part.from + (time - part.start) / part.speed) : null;
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
