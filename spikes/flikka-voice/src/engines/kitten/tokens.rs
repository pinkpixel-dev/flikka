//! Text chunks and espeak-style phonemes to Kitten token ids.
//! Contract from KittenML/KittenTTS 0.8.1 `kittentts/onnx_model.py` and `preprocess.py`, with the
//! sentence boundaries from the newer `preprocess.py` on Kitten's main branch.

use std::collections::HashMap;

use super::abbreviations::is_abbreviation;

/// Kitten phonemizes and speaks one chunk at a time, and splits sentences longer than this.
const MAX_CHUNK_CHARS: usize = 400;
/// Token 10 is `…`. Kitten ends every chunk with it, then the pad token.
const END_TOKEN: i64 = 10;

// Copied byte for byte from Kitten's `TextCleaner`. Ids are positions in this list, so every
// character matters, duplicates included.
const PAD: &str = "$";
const PUNCTUATION: &str = ";:,.!?\u{a1}\u{bf}\u{2014}\u{2026}\"\u{ab}\u{bb}\"\" ";
const LETTERS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LETTERS_IPA: &str = "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'\u{0329}'ᵻ";

pub struct Symbols(HashMap<char, i64>);

impl Symbols {
    pub fn new() -> Self {
        // A Python dict built in list order, so a later duplicate wins.
        let mut ids = HashMap::new();
        for (i, c) in [PAD, PUNCTUATION, LETTERS, LETTERS_IPA].concat().chars().enumerate() {
            ids.insert(c, i as i64);
        }
        Self(ids)
    }

    /// Kitten's spacing, then one id per character, framed by its start and end tokens.
    /// Characters outside the table are skipped, as Kitten's own cleaner does.
    pub fn encode(&self, phonemes: &str) -> Vec<i64> {
        let mut ids = vec![0];
        ids.extend(spaced(phonemes).chars().filter_map(|c| self.0.get(&c).copied()));
        ids.extend([END_TOKEN, 0]);
        ids
    }
}

/// Kitten's `basic_english_tokenize` (`\w+|[^\w\s]`), then one space between tokens. Python's
/// `\w` is `str.isalnum()` plus `_`, and IPA letters, stress marks, and `ː` all count.
fn spaced(phonemes: &str) -> String {
    let mut tokens: Vec<String> = Vec::new();
    let mut word = String::new();
    for c in phonemes.chars() {
        if c.is_alphanumeric() || c == '_' {
            word.push(c);
            continue;
        }
        if !word.is_empty() {
            tokens.push(std::mem::take(&mut word));
        }
        if !c.is_whitespace() {
            tokens.push(c.to_string());
        }
    }
    if !word.is_empty() {
        tokens.push(word);
    }
    tokens.join(" ")
}

/// Kitten's `chunk_text`: one chunk per sentence, long sentences split between words, and every
/// chunk ending in punctuation (a comma if it has none). A sentence ends at `.`, `!`, or `?`
/// followed by whitespace, except a period after an abbreviation such as "Dr" or "Fig".
pub fn chunks(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let at_boundary = chars.peek().is_none_or(|&(_, next)| next.is_whitespace());
        let word_before = text[..i].rsplit(|ch: char| !ch.is_alphabetic()).next().unwrap_or("");
        let abbreviation = c == '.' && is_abbreviation(word_before);
        if matches!(c, '.' | '!' | '?') && at_boundary && !abbreviation {
            sentences.push(&text[start..i + c.len_utf8()]);
            start = i + c.len_utf8();
        }
    }
    sentences.push(&text[start..]);

    let mut out = Vec::new();
    for sentence in sentences.into_iter().map(str::trim).filter(|s| !s.is_empty()) {
        if sentence.chars().count() <= MAX_CHUNK_CHARS {
            out.push(end_with_punctuation(sentence));
            continue;
        }
        let mut current = String::new();
        for word in sentence.split_whitespace() {
            if !current.is_empty() && current.chars().count() + word.chars().count() + 1 > MAX_CHUNK_CHARS {
                out.push(end_with_punctuation(&current));
                current.clear();
            }
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        }
        if !current.is_empty() {
            out.push(end_with_punctuation(&current));
        }
    }
    out
}

fn end_with_punctuation(chunk: &str) -> String {
    if chunk.ends_with(['.', '!', '?', ',', ';', ':']) {
        chunk.to_string()
    } else {
        format!("{chunk},")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ids from Kitten's own Python `TextCleaner` for "wˈɛlkʌm tə vˈɑːksi .", with its ends.
    #[test]
    fn ids_match_kittens_text_cleaner() {
        assert_eq!(Symbols::new().0.len(), 175);
        assert_eq!(
            Symbols::new().encode("wˈɛlkʌm tə vˈɑːksi."),
            [0, 65, 156, 86, 54, 53, 138, 55, 16, 62, 83, 16, 64, 156, 69, 158, 53, 61, 51, 16, 4, 10, 0]
        );
    }

    #[test]
    fn spaces_like_kitten() {
        // Kitten's own spacing of espeak output, from the spike's reference file.
        assert_eq!(spaced("θɹˈiː:fˈɔːɹɾi fˈaɪv"), "θɹˈiː : fˈɔːɹɾi fˈaɪv");
        // The syllabic mark is not a word character, so it splits off, the same as in Python.
        assert_eq!(spaced("bˈʌʔn\u{0329}"), "bˈʌʔn \u{0329}");
    }

    #[test]
    fn chunks_by_sentence_and_adds_punctuation() {
        assert_eq!(chunks("  Hi there. Costs $1.50 now  "), vec!["Hi there.", "Costs $1.50 now,"]);
        assert_eq!(chunks("Really?! Yes"), vec!["Really?!", "Yes,"]);
        assert!(chunks("   ").is_empty());
    }

    #[test]
    fn abbreviations_do_not_end_sentences() {
        assert_eq!(chunks("Ask Dr. Smith. See Fig. A now."), vec!["Ask Dr. Smith.", "See Fig. A now."]);
        assert_eq!(chunks("Smith et al. found it. Done."), vec!["Smith et al. found it.", "Done."]);
    }

    #[test]
    fn splits_long_sentences_between_words() {
        let sentence = "word ".repeat(150) + "end.";
        let out = chunks(&sentence);
        assert!(out.len() > 1);
        // A chunk may gain one comma past the limit, as in Kitten.
        assert!(out.iter().all(|c| c.chars().count() <= MAX_CHUNK_CHARS + 1), "{out:?}");
        let words: Vec<&str> = out.iter().flat_map(|c| c.trim_end_matches(',').split_whitespace()).collect();
        assert_eq!(words.join(" "), sentence.trim_end_matches('.').to_string() + ".");
    }
}
