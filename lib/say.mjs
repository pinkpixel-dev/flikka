// A film scene's "say": a string, or a list of strings and {text, voice, speed} items for sentences with their own
// voice or speed (lib/film.schema.json). Plain JavaScript with no imports, so the panel bundles it too.

// Sentences end with . ! ? and also Japanese and Chinese 。！？ and the Hindi danda ।, with any closing quotes.
// A say-as mark (lib/marks.mjs) is one piece, so the period in [St.](saint) doesn't end a sentence: a [ that starts
// a mark can only be read as the whole mark.
const piece = String.raw`(?:\[[^\[\]]+\]\([^()]+\)|\[(?![^\[\]]+\]\([^()]+\))|[^.!?。！？।\[])`;
const sentencePattern = new RegExp(String.raw`${piece}+[.!?。！？।]+["”'’)\]」』）]*|${piece}+$`, 'g');
export function sentences(text = '') {
  return (text.match(sentencePattern) || []).map(item => item.trim()).filter(Boolean);
}

// One item per sentence, in the order they're spoken: {text}, with voice and speed when the sentence has its own.
export const sayItems = say => (say === undefined ? [] : [].concat(say)).flatMap(item => typeof item === 'string'
  ? sentences(item).map(text => ({text}))
  : sentences(item.text).map(text => ({text, ...(item.voice && {voice: item.voice}), ...(item.speed != null && {speed: item.speed})})));

// Items back to a "say": a plain string when no sentence has its own voice or speed, else the list form.
// Undefined when nothing is left to say.
export function sayFrom(items) {
  const kept = items.map(item => ({...item, text: item.text.replace(/\s+/g, ' ').trim()})).filter(item => item.text);
  if (!kept.length) return undefined;
  if (kept.every(item => !item.voice && item.speed == null)) return kept.map(item => item.text).join(' ');
  return kept.map(item => item.voice || item.speed != null ? item : item.text);
}

// One sentence of a say changed: {text} (empty removes it), {voice} or {speed} ('' or null goes back to the film's).
export function editSay(say, index, change) {
  const items = sayItems(say);
  const item = items[index];
  if (!item) throw new Error(`There is no sentence ${index + 1} in this scene`);
  if ('text' in change) item.text = String(change.text ?? '');
  if ('voice' in change) { if (change.voice) item.voice = change.voice; else delete item.voice; }
  if ('speed' in change) { if (change.speed != null && change.speed !== '') item.speed = Number(change.speed); else delete item.speed; }
  return sayFrom(items);
}
