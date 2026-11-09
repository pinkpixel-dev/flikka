//! The global pronunciation dictionary, stored as `<app data>/pronunciations.json`.
//!
//! Entries are engine-agnostic: `sounds_like` is plain respelling text. `phonemes` is an
//! optional exact override in the Kokoro/Misaki phoneme set. Each engine decides how to apply
//! them (see `TtsEngine::set_pronunciations`).

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const FILE_NAME: &str = "pronunciations.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pronunciation {
    pub word: String,
    pub sounds_like: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonemes: Option<String>,
}

/// The dictionary a fresh install starts with: empty.
pub fn defaults() -> Vec<Pronunciation> {
    Vec::new()
}

/// Trims every field, drops empty phoneme overrides, and rejects entries that cannot work.
pub fn validate(entries: Vec<Pronunciation>) -> Result<Vec<Pronunciation>, String> {
    let mut seen = HashSet::new();
    let mut clean = Vec::with_capacity(entries.len());
    for entry in entries {
        let word = entry.word.trim().to_string();
        let sounds_like = entry.sounds_like.trim().to_string();
        let phonemes = entry
            .phonemes
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty());

        if word.is_empty() {
            return Err("every entry needs a word".into());
        }
        if !word.chars().all(|c| c.is_alphanumeric() || matches!(c, '\'' | '-' | '’')) {
            return Err(format!(
                "\"{word}\" must be a single word, without spaces or punctuation"
            ));
        }
        if sounds_like.is_empty() && phonemes.is_none() {
            return Err(format!("\"{word}\" needs a sounds-like spelling or phonemes"));
        }
        if !seen.insert(word.to_lowercase()) {
            return Err(format!("\"{word}\" is in the list twice"));
        }
        clean.push(Pronunciation {
            word,
            sounds_like,
            phonemes,
        });
    }
    Ok(clean)
}

/// The global dictionary with a project's entries on top. A project entry replaces a global one for
/// the same word, ignoring case.
pub fn layered(global: &[Pronunciation], project: &[Pronunciation]) -> Vec<Pronunciation> {
    let overridden: HashSet<String> = project.iter().map(|p| p.word.to_lowercase()).collect();
    global
        .iter()
        .filter(|g| !overridden.contains(&g.word.to_lowercase()))
        .chain(project)
        .cloned()
        .collect()
}

/// Reads the dictionary. A missing file means a fresh install, so it gets the defaults.
pub fn load(path: &Path) -> Result<Vec<Pronunciation>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("could not read {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(defaults()),
        Err(e) => Err(format!("could not read {}: {e}", path.display())),
    }
}

/// Writes through a temporary file, so a crash mid-write cannot leave a half-written dictionary.
pub fn save(path: &Path, entries: &[Pronunciation]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("could not save {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_entries_replace_global_ones_for_the_same_word() {
        let entry = |word: &str, sounds_like: &str| Pronunciation { word: word.into(), sounds_like: sounds_like.into(), phonemes: None };
        let global = [entry("Memlake", "vox see"), entry("Nguyen", "win")];
        let project = [entry("memlake", "vox ee"), entry("Aoife", "ee fa")];
        let words: Vec<(String, String)> = layered(&global, &project).into_iter().map(|p| (p.word, p.sounds_like)).collect();
        assert_eq!(
            words,
            [("Nguyen".into(), "win".into()), ("memlake".into(), "vox ee".into()), ("Aoife".into(), "ee fa".into())]
        );
        assert_eq!(layered(&global, &[]).len(), 2);
    }

    fn entry(word: &str, sounds_like: &str, phonemes: Option<&str>) -> Pronunciation {
        Pronunciation {
            word: word.into(),
            sounds_like: sounds_like.into(),
            phonemes: phonemes.map(Into::into),
        }
    }

    #[test]
    fn validate_trims_and_drops_blank_phonemes() {
        let clean = validate(vec![entry("  Memlake ", " vox see ", Some("  "))]).unwrap();
        assert_eq!(clean, vec![entry("Memlake", "vox see", None)]);
    }

    #[test]
    fn validate_rejects_bad_entries() {
        assert!(validate(vec![entry("", "x", None)]).is_err());
        assert!(validate(vec![entry("two words", "x", None)]).is_err());
        assert!(validate(vec![entry("Memlake", "", None)]).is_err());
        assert!(validate(vec![entry("Memlake", "a", None), entry("memlake", "b", None)]).is_err());
    }

    #[test]
    fn validate_allows_apostrophes_hyphens_and_phoneme_only_entries() {
        assert!(validate(vec![entry("O'Neil", "oh neel", None)]).is_ok());
        assert!(validate(vec![entry("Jean-Luc", "zhawn luke", None)]).is_ok());
        assert!(validate(vec![entry("Memlake", "", Some("vˈɑksi"))]).is_ok());
    }

    #[test]
    fn save_then_load_round_trips_and_missing_file_gives_defaults() {
        let dir = std::env::temp_dir().join(format!("flikka-pron-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        let _ = std::fs::remove_file(&path);

        assert_eq!(load(&path).unwrap(), defaults());

        let entries = vec![entry("Siobhan", "shiv awn", Some("ʃɪvˈɔn"))];
        save(&path, &entries).unwrap();
        assert_eq!(load(&path).unwrap(), entries);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
