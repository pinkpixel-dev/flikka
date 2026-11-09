// Overlay layers' keyframes: plain JavaScript shared by the renderer (render/layers.jsx) and the node side
// (lib/layers.mjs checks easings with the same parser the frames use).

// What a layer can animate, with the value it has when it doesn't say.
export const animated = {x: 0, y: 0, w: 1, h: 1, opacity: 1, rotation: 0};
export const easings = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
// The CSS curves, as cubic-bezier points.
const named = {ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1]};

// "ease-out", "cubic-bezier(0.2, 0, 0, 1)" → [x1, y1, x2, y2], "linear" → null. Anything else → undefined.
export function parseEasing(text = 'ease') {
  if (text === 'linear') return null;
  if (named[text]) return named[text];
  const match = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,)]+)\)$/.exec(String(text).trim());
  if (!match) return undefined;
  const points = match.slice(1).map(Number);
  // x1 and x2 must stay in 0–1 (the curve has to keep moving forward in time), y can overshoot.
  if (points.some(value => !Number.isFinite(value)) || [points[0], points[2]].some(value => value < 0 || value > 1)) return undefined;
  return points;
}

// progress (0–1 of time) → progress of the value along the curve, like CSS. Newton steps, then halving.
export function eased(points, progress) {
  if (!points) return progress;
  const [x1, y1, x2, y2] = points;
  const curve = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const slope = (a, b, t) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  let t = progress;
  for (let step = 0; step < 8; step++) {
    const error = curve(x1, x2, t) - progress;
    if (Math.abs(error) < 1e-6) return curve(y1, y2, t);
    const tilt = slope(x1, x2, t);
    if (Math.abs(tilt) < 1e-6) break;
    t -= error / tilt;
  }
  let [lower, upper] = [0, 1];
  t = progress;
  for (let step = 0; step < 30; step++) {
    const x = curve(x1, x2, t);
    if (Math.abs(x - progress) < 1e-6) break;
    if (x < progress) lower = t; else upper = t;
    t = (lower + upper) / 2;
  }
  return curve(y1, y2, t);
}

// A layer's box, opacity and rotation `time` seconds after it appears. The layer's own values hold at 0 unless a
// keyframe at 0 says otherwise. Each keyframe sets some values; between two keyframes that set a value it moves
// along the later one's easing, and after the last one it stays.
export function layerAt(layer, time) {
  const state = {};
  const keyframes = [...(layer.keyframes || [])].sort((a, b) => a.at - b.at);
  for (const [key, fallback] of Object.entries(animated)) {
    const points = [{at: 0, value: layer[key] ?? fallback}];
    for (const keyframe of keyframes) {
      if (!(key in keyframe)) continue;
      if (keyframe.at <= 0) points[0] = {at: 0, value: keyframe[key]};
      else points.push({at: keyframe.at, value: keyframe[key], ease: keyframe.ease});
    }
    const next = points.findIndex(point => point.at > time);
    if (next < 0) { state[key] = points.at(-1).value; continue; }
    if (next === 0) { state[key] = points[0].value; continue; }
    const [from, to] = [points[next - 1], points[next]];
    const progress = eased(parseEasing(to.ease) ?? null, (time - from.at) / (to.at - from.at));
    state[key] = from.value + (to.value - from.value) * progress;
  }
  return state;
}
