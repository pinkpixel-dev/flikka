// Timing shared by the renderer (render/*.jsx) and the node side (lib/): plain JavaScript, no JSX.
export const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
export const ease = value => { value = clamp(value, 0, 1); return value * value * (3 - 2 * value); };

// A part's playback speed: its own, the whole video's, or as recorded (lib/render.mjs does the same for the sound).
export const speedOf = (project, clip) => clip.speed || project.speed || 1;
export const demoFrames = (project, fps = project.export.fps) => project.clips.reduce((total, clip) => total + Math.max(1, Math.round((clip.end - clip.start) * fps / speedOf(project, clip))), 0)
  + Math.round(((project.intro?.duration || 0) + (project.outro?.duration || 0)) * fps);
