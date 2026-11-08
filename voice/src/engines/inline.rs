//! Inline pronunciation markup: `[read](red)` says "read" like "red" in this one place, and
//! `[read](/ɹˈɛd/)` gives exact Misaki phonemes, the same syntax upstream Misaki uses.
//!
//! Each marked word is swapped for a placeholder word, and the placeholder gets a lexicon entry for
//! the length of one request. Misaki still reads the whole sentence at once, and each engine's own
//! text handling (Kitten's abbreviations and sentence split) never sees the brackets.

/// How a marked word should be said.
#[derive(Debug, Clone, PartialEq)]
pub enum Say {
    SoundsLike(String),
    Phonemes(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Mark {
    /// The word as written inside the brackets.
    pub word: String,
    /// The letters-only word that stands in for it in `Marked::text`.
    pub placeholder: String,
    pub say: Say,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Marked {
    /// The text with each mark replaced by its placeholder.
    pub text: String,
    pub marks: Vec<Mark>,
}

impl Marked {
    /// `text` with placeholders put back as the words they stand for, for measuring its length.
    pub fn restore(&self, text: &str) -> String {
        self.marks
            .iter()
            .rev()
            .fold(text.to_string(), |out, mark| out.replace(&mark.placeholder, &mark.word))
    }
}

/// Letters only, so Misaki reads it as one word and never spells it out or splits it.
/// Later marks get the longer names, and `restore` replaces them first, so "narrainlineaa" is
/// never hit by "narrainlinea".
fn placeholder(index: usize) -> String {
    let mut suffix = String::new();
    let mut n = index;
    loop {
        suffix.insert(0, (b'a' + (n % 26) as u8) as char);
        n /= 26;
        if n == 0 {
            break;
        }
        n -= 1;
    }
    format!("narrainline{suffix}")
}

/// Finds `[word](say)` marks. Anything that does not form a complete mark stays as written.
pub fn parse(text: &str) -> Marked {
    let mut out = String::with_capacity(text.len());
    let mut marks = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        out.push_str(&rest[..open]);
        let after = &rest[open..];
        match mark_at(after) {
            Some((word, say, len)) => {
                let placeholder = placeholder(marks.len());
                out.push_str(&placeholder);
                marks.push(Mark { word, placeholder, say });
                rest = &after[len..];
            }
            None => {
                out.push('[');
                rest = &after[1..];
            }
        }
    }
    out.push_str(rest);
    Marked { text: out, marks }
}

/// Reads one mark at the start of `s`, which begins with `[`. Returns the word, how to say it,
/// and how many bytes the mark takes up.
fn mark_at(s: &str) -> Option<(String, Say, usize)> {
    let close = s.find(']')?;
    let word = &s[1..close];
    if word.contains(['[', '\n']) || word.trim().is_empty() {
        return None;
    }
    let after = &s[close + 1..];
    let inner = after.strip_prefix('(')?;
    let end = inner.find(')')?;
    let target = inner[..end].trim();
    if target.is_empty() || target.contains(['(', '\n']) {
        return None;
    }
    let say = match target.strip_prefix('/').and_then(|t| t.strip_suffix('/')) {
        Some(phonemes) if !phonemes.trim().is_empty() => Say::Phonemes(phonemes.trim().to_string()),
        Some(_) => return None,
        None => Say::SoundsLike(target.to_string()),
    };
    Some((word.trim().to_string(), say, close + 2 + end + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sounds(word: &str, placeholder: &str, like: &str) -> Mark {
        Mark { word: word.into(), placeholder: placeholder.into(), say: Say::SoundsLike(like.into()) }
    }

    #[test]
    fn replaces_marks_with_placeholders() {
        let marked = parse("I [read](red) it, then [read](/ɹˈid/) it again.");
        assert_eq!(marked.text, "I narrainlinea it, then narrainlineb it again.");
        assert_eq!(
            marked.marks,
            vec![
                sounds("read", "narrainlinea", "red"),
                Mark { word: "read".into(), placeholder: "narrainlineb".into(), say: Say::Phonemes("ɹˈid".into()) },
            ]
        );
    }

    #[test]
    fn keeps_punctuation_and_possessives_around_marks() {
        let marked = parse("[Narra](vox see)'s turn. [Dr.](doctor) Lee!");
        assert_eq!(marked.text, "narrainlinea's turn. narrainlineb Lee!");
        assert_eq!(marked.marks[1], sounds("Dr.", "narrainlineb", "doctor"));
    }

    #[test]
    fn trims_space_inside_brackets_and_allows_phrases() {
        let marked = parse("See [ New York ]( noo york ).");
        assert_eq!(marked.text, "See narrainlinea.");
        assert_eq!(marked.marks, vec![sounds("New York", "narrainlinea", "noo york")]);
    }

    #[test]
    fn leaves_incomplete_markup_alone() {
        for text in [
            "a [read] b",
            "a [read] (red) b",
            "a [read](red b",
            "a [](red) b",
            "a [read]() b",
            "a [read](//) b",
            "a [re\nad](red) b",
            "a [read](re\nd) b",
            "[a [read](red)",
        ] {
            let marked = parse(text);
            if text == "[a [read](red)" {
                assert_eq!(marked.text, "[a narrainlinea");
                continue;
            }
            assert_eq!(marked.text, text, "{text:?} should stay as written");
            assert!(marked.marks.is_empty());
        }
    }

    #[test]
    fn restore_puts_the_words_back() {
        let marked = parse("I [read](red) and [led](lead) it.");
        assert_eq!(marked.restore("I narrainlinea and narrainlineb it."), "I read and led it.");
        assert_eq!(marked.restore("narrainlineb it."), "led it.");
    }

    #[test]
    fn placeholders_stay_unique_past_the_alphabet() {
        assert_eq!(placeholder(0), "narrainlinea");
        assert_eq!(placeholder(25), "narrainlinez");
        assert_eq!(placeholder(26), "narrainlineaa");
        assert_eq!(placeholder(27), "narrainlineab");
        let text = "[a](b) ".repeat(30);
        let marked = parse(&text);
        assert_eq!(marked.marks.len(), 30);
        assert_eq!(marked.restore(&marked.text), "a ".repeat(30));
    }
}
