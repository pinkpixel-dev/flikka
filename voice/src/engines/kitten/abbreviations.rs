//! Abbreviations, handled before Misaki the way KittenTTS's `preprocess.py` does (main branch,
//! Apache 2.0). Misaki already reads "Dr." as "Doctor", but it keeps the period as a pause, and the
//! chunker would end a sentence there. So titles, page and figure references, dated months, and
//! a.m. and p.m. are written out in full first, and `is_abbreviation` stops any that are left from
//! ending a sentence.

/// Always an abbreviation when followed by a period.
const TITLES: &[(&str, &str)] = &[
    ("dr", "Doctor"),
    ("prof", "Professor"),
    ("mr", "Mister"),
    ("mrs", "Misses"),
    // Misaki spells "Ms" out, the same as with the period. Kitten also only drops the period.
    ("ms", "Ms"),
];

/// Only written out before a number, as in "p. 12" or "Jan. 5". Kitten writes these out
/// everywhere, which turns the initial in "J. P. Morgan" into "page".
const BEFORE_NUMBER: &[(&str, &str)] = &[
    ("fig", "Figure"),
    ("figs", "Figures"),
    ("p", "page"),
    ("pp", "pages"),
    ("ch", "chapter"),
    ("sec", "section"),
    ("jan", "January"),
    ("feb", "February"),
    ("mar", "March"),
    ("apr", "April"),
    ("jun", "June"),
    ("jul", "July"),
    ("aug", "August"),
    ("sep", "September"),
    ("sept", "September"),
    ("oct", "October"),
    ("nov", "November"),
    ("dec", "December"),
];

/// Kitten's `_NON_BOUNDARY_ABBREVIATIONS`: a period after one of these never ends a sentence.
const NON_BOUNDARY: &[&str] = &[
    "dr", "prof", "mr", "mrs", "ms", "fig", "figs", "pp", "p", "ch", "sec", "jan", "feb", "mar", "apr", "jun", "jul",
    "aug", "sep", "sept", "oct", "nov", "dec", "al",
];

fn lookup(table: &[(&str, &'static str)], word: &str) -> Option<&'static str> {
    table.iter().find(|(short, _)| *short == word).map(|(_, full)| *full)
}

/// True when the word just before a period is one that does not end a sentence.
pub fn is_abbreviation(word: &str) -> bool {
    NON_BOUNDARY.contains(&word.to_lowercase().as_str())
}

/// The first non-space character from `from` on.
fn next_visible(chars: &[char], from: usize) -> Option<char> {
    chars.get(from..)?.iter().copied().find(|c| !c.is_whitespace())
}

/// Writes out the abbreviations listed above, and "a.m." and "p.m." as "AM" and "PM".
pub fn expand(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() + 16);
    let mut i = 0;
    while i < chars.len() {
        let starts_word = chars[i].is_alphabetic() && (i == 0 || !chars[i - 1].is_alphanumeric());
        if !starts_word {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let mut end = i;
        while end < chars.len() && chars[end].is_alphabetic() {
            end += 1;
        }
        let word: String = chars[i..end].iter().collect();
        let lower = word.to_lowercase();
        if chars.get(end) != Some(&'.') {
            out.push_str(&word);
            i = end;
            continue;
        }

        // "a.m." and "p.m." A final period ends the sentence only if a capital follows, as in Kitten.
        let is_m = chars.get(end + 1).is_some_and(|c| c.eq_ignore_ascii_case(&'m'));
        let m_ends = !chars.get(end + 2).is_some_and(|c| c.is_alphanumeric());
        if (lower == "a" || lower == "p") && is_m && m_ends {
            out.push_str(if lower == "a" { "AM" } else { "PM" });
            let mut next = end + 2;
            if chars.get(next) == Some(&'.') {
                next += 1;
                if next_visible(&chars, next).is_none_or(char::is_uppercase) {
                    out.push('.');
                }
            }
            i = next;
            continue;
        }

        let before_number = next_visible(&chars, end + 1).is_some_and(|c| c.is_ascii_digit());
        let full = lookup(TITLES, &lower).or_else(|| if before_number { lookup(BEFORE_NUMBER, &lower) } else { None });
        let et_al = lower == "al" && out.to_lowercase().ends_with("et ");
        match full {
            // At the very end, the period still ends the text.
            Some(full) if next_visible(&chars, end + 1).is_none() => {
                out.push_str(full);
                out.push('.');
            }
            Some(full) => out.push_str(full),
            None if et_al => out.push_str(&word),
            None => {
                out.push_str(&word);
                out.push('.');
            }
        }
        i = end + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_out_titles_and_references() {
        assert_eq!(expand("Dr. Smith met Mr. and Mrs. Lee."), "Doctor Smith met Mister and Misses Lee.");
        assert_eq!(expand("PROF. Oak and Ms. Kim"), "Professor Oak and Ms Kim");
        assert_eq!(expand("See Fig. 3 on p. 12, ch. 4, and pp. 5-9."), "See Figure 3 on page 12, chapter 4, and pages 5-9.");
        assert_eq!(expand("Due Jan. 5 or Sept. 30."), "Due January 5 or September 30.");
    }

    #[test]
    fn leaves_initials_and_other_words_alone() {
        assert_eq!(expand("J. P. Morgan said so."), "J. P. Morgan said so.");
        assert_eq!(expand("The drum. The mrsa. A dr."), "The drum. The mrsa. A Doctor.");
        assert_eq!(expand("Costs $1.50 in Mar."), "Costs $1.50 in Mar.");
        assert_eq!(expand("Smith et al. found it."), "Smith et al found it.");
    }

    #[test]
    fn writes_out_am_and_pm() {
        assert_eq!(expand("We met at 5 p.m. and left."), "We met at 5 PM and left.");
        assert_eq!(expand("We met at 9 A.M. Then we left."), "We met at 9 AM. Then we left.");
        assert_eq!(expand("It starts at 7 a.m."), "It starts at 7 AM.");
        assert_eq!(expand("a.map stays"), "a.map stays");
    }

    #[test]
    fn knows_which_words_do_not_end_a_sentence() {
        assert!(is_abbreviation("Dr"));
        assert!(is_abbreviation("al"));
        assert!(!is_abbreviation("Smith"));
    }
}
