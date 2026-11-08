// Narration lines on the timeline: where a dragged line is drawn, and the change that saves it. All in seconds of
// the finished video. The project keeps a line's moment in recording seconds, and lib/ui.mjs converts.

// The shortest a trim leaves a line, and how long a line not spoken yet is drawn (about 2.6 words a second).
const shortest = 0.1;
export const guessLength = text => Math.max(0.6, text.trim().split(/\s+/).length / 2.6);

// A line as drawn: from, to, its trims, and the whole clip's length (null for a line not spoken yet).
export function lineShape(line) {
  const trimStart = line.trimStart || 0, trimEnd = line.trimEnd || 0;
  const spoken = line.to !== null;
  const length = spoken ? line.to - line.from : guessLength(line.text);
  return {from: line.from, to: line.from + length, trimStart, trimEnd, full: spoken ? length + trimStart + trimEnd : null};
}

// The line mid-drag. move: both ends go by the pointer's travel (shift), and whichever end lands near an edge
// snaps to it. trim-start or trim-end: that end follows the pointer (now, already snapped), only over audio the
// clip has, and never closer than `shortest` to the other end. first and last: the recording part of the video.
export function dragShape(line, {mode, shift, now}, {edges, reach, frame, first, last}) {
  const shape = lineShape(line);
  if (mode === 'line') {
    const length = shape.to - shape.from;
    let by = frame(shape.from + shift) - shape.from, best = reach;
    for (const edge of edges) for (const end of [shape.from, shape.to]) {
      const off = Math.abs(end + shift - edge);
      if (off < best) { best = off; by = edge - end; }
    }
    const from = Math.max(first, Math.min(last - Math.min(length, 0.05), shape.from + by));
    return {...shape, from, to: from + length};
  }
  if (mode === 'trim-start') {
    const from = Math.max(first, shape.from - shape.trimStart, Math.min(now, shape.to - shortest));
    return {...shape, from, trimStart: shape.trimStart + from - shape.from};
  }
  const to = Math.max(shape.from + shortest, Math.min(now, shape.from + shape.full - shape.trimStart));
  return {...shape, to, trimEnd: Math.max(0, shape.full - shape.trimStart - (to - shape.from))};
}

// What to save for a drawn shape, or null when nothing moved. A move takes the line's until along (the room it has
// stays the same); a trim at the start moves its moment with it, so the audio left still starts where it's drawn.
export function lineChange(line, mode, shape) {
  const before = lineShape(line);
  const near = (one, two) => Math.abs(one - two) < 0.0005;
  if (mode === 'line') {
    if (near(shape.from, before.from)) return null;
    return {set: {line: line.id, at: shape.from, ...(line.room !== undefined && {until: shape.from + line.room})}};
  }
  if (mode === 'trim-start') return near(shape.trimStart, before.trimStart) ? null : {set: {line: line.id, at: shape.from, trimStart: shape.trimStart}};
  return near(shape.trimEnd, before.trimEnd) ? null : {set: {line: line.id, trimEnd: shape.trimEnd}};
}
