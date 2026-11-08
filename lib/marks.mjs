// Say-as marks in narration text, the same syntax Narra and upstream Misaki use: [read](red) says "read" like
// "red" in that one place, and [GIF](/ʤˈɪf/) gives exact phonemes. Plain JavaScript with no imports, so the panel
// bundles it too.
//
// Who reads what: Kokoro's Misaki reads exact-phoneme marks itself but ignores sounds-like ones, so kokoroText()
// swaps those for their respelling. Your own voices (flikka-voice) get the marks as written: Narra's code there
// reads the respelling, and the plain word for phonemes, since Chatterbox reads text. Captions and the check use
// plainText().
const markPattern = /\[([^\[\]]+)\]\(([^()]+)\)/g;

export const isPhonemes = say => /^\/.+\/$/.test(say.trim());

// Every mark: where it sits in the text, the word, and how it's said.
export const marks = text => [...String(text).matchAll(markPattern)].map(match => ({start: match.index, end: match.index + match[0].length, word: match[1], say: match[2].trim()}));

// The text as it's written: each mark is its word.
export const plainText = text => String(text).replace(markPattern, (_, word) => word);

// True when `at` falls inside a mark, so a split there would break it.
export const insideMark = (text, at) => marks(text).some(mark => at > mark.start && at < mark.end);

// What Kokoro reads: sounds-like marks become their respelling. English (a, b) keeps exact phonemes for Misaki;
// the other languages don't read marks, so there a phoneme mark is just its word.
export const kokoroText = (text, language = 'a') => String(text).replace(markPattern, (all, word, say) =>
  isPhonemes(say) ? (['a', 'b'].includes(language) ? all : word) : say.trim());

// "word=how it sounds" (or "word=/phonemes/") marks the first place the word stands on its own outside a mark;
// "word=" takes the mark off it. The text, changed, or null when the word isn't there.
export function markWord(text, word, say = '') {
  word = word.trim();
  const existing = marks(text).find(mark => mark.word === word);
  if (!say.trim()) return existing ? text.slice(0, existing.start) + word + text.slice(existing.end) : null;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');
  for (const match of String(text).matchAll(pattern)) {
    if (marks(text).some(mark => match.index >= mark.start && match.index < mark.end)) continue;
    return text.slice(0, match.index) + `[${word}](${say.trim()})` + text.slice(match.index + word.length);
  }
  return existing ? text.slice(0, existing.start) + `[${word}](${say.trim()})` + text.slice(existing.end) : null;
}
