//! Cloned voices for engines that speak in a reference voice (Chatterbox), stored as
//! `<dir>/<id>/voice.json` and `<dir>/<id>/reference.wav`. They live outside the model folder, so
//! reinstalling a model never touches them.


use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::audio::wav;

pub const SAMPLE_RATE: u32 = 24_000;
/// Longer references are cut to this. The spike tested clips up to 10 s.
pub const MAX_REFERENCE_SECONDS: usize = 10;
/// Quiet references are turned up until their peak reaches this, about -1 dBFS.
const TARGET_PEAK: f32 = 0.89;
/// The most a reference is turned up (+40 dB). A laptop mic measured about -35 dBFS at its peak.
const MAX_GAIN: f32 = 100.0;
const META: &str = "voice.json";
const REFERENCE: &str = "reference.wav";
/// The reference as it was before Clean up replaced it, kept the first time.
const ORIGINAL: &str = "reference-original.wav";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceMeta {
    pub name: String,
    /// Where the reference came from, such as "Kokoro · Heart".
    pub source: String,
    /// Unix time in milliseconds.
    pub created_ms: u64,
    /// When the user confirmed the voice is theirs or used with permission. Voices made from a
    /// built-in synthetic voice have none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consent_ms: Option<u64>,
    /// The background noise was cleaned out of the reference (`clean.rs`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub cleaned: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredVoice {
    pub id: String,
    #[serde(flatten)]
    pub meta: VoiceMeta,
}

/// Every voice in `dir`, oldest first. Folders without a readable `voice.json` are skipped.
pub fn list(dir: &Path) -> Vec<StoredVoice> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut voices: Vec<StoredVoice> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let id = e.file_name().to_str()?.to_string();
            let text = std::fs::read_to_string(e.path().join(META)).ok()?;
            let meta = serde_json::from_str(&text).ok()?;
            e.path().join(REFERENCE).is_file().then_some(StoredVoice { id, meta })
        })
        .collect();
    voices.sort_by(|a, b| a.meta.created_ms.cmp(&b.meta.created_ms).then_with(|| a.id.cmp(&b.id)));
    voices
}

pub fn reference_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(id).join(REFERENCE)
}

/// Ids are folder names, so only ones shaped like v19a4f2c0b1e are accepted.
fn valid_id(id: &str) -> bool {
    id.starts_with('v') && id.len() > 1 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

pub fn exists(dir: &Path, id: &str) -> bool {
    valid_id(id) && reference_path(dir, id).is_file()
}

/// Turns a quiet clip up so its loudest sample reaches `TARGET_PEAK`. A loud clip is left alone,
/// and the gain stops at `MAX_GAIN`, so near-silence is not blown up into noise.
fn normalize(samples: &[f32]) -> Vec<f32> {
    let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs()));
    let gain = if peak > 0.0 { (TARGET_PEAK / peak).clamp(1.0, MAX_GAIN) } else { 1.0 };
    samples.iter().map(|s| s * gain).collect()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn clean_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("give the voice a name".into());
    }
    Ok(name)
}

/// Saves a new voice from 24 kHz mono samples, cut to `MAX_REFERENCE_SECONDS`. `consent` records
/// that the user confirmed they may use the voice. Returns its id.
pub fn create(dir: &Path, name: &str, source: &str, samples: &[f32], consent: bool) -> Result<String, String> {
    let name = clean_name(name)?;
    if samples.is_empty() {
        return Err("the reference clip is empty".into());
    }
    let created_ms = now_ms();
    let mut n = created_ms;
    let (id, folder) = loop {
        let id = format!("v{n:x}");
        let folder = dir.join(&id);
        if !folder.exists() {
            break (id, folder);
        }
        n += 1;
    };
    std::fs::create_dir_all(&folder).map_err(|e| format!("could not create {}: {e}", folder.display()))?;
    let kept = normalize(&samples[..samples.len().min(MAX_REFERENCE_SECONDS * SAMPLE_RATE as usize)]);
    let write = || -> Result<(), String> {
        let bytes = wav::encode_pcm16(&kept, SAMPLE_RATE).map_err(|e| format!("could not encode the clip: {e}"))?;
        std::fs::write(folder.join(REFERENCE), bytes).map_err(|e| format!("could not save the clip: {e}"))?;
        let meta = VoiceMeta {
            name: name.to_string(),
            source: source.to_string(),
            created_ms,
            consent_ms: consent.then_some(created_ms),
            cleaned: false,
        };
        let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        std::fs::write(folder.join(META), json).map_err(|e| format!("could not save the voice: {e}"))
    };
    // A half-written voice would be skipped by `list` anyway, but clean it up.
    write().inspect_err(|_| {
        let _ = std::fs::remove_dir_all(&folder);
    })?;
    Ok(id)
}

/// Changes a voice's name. Its id and clip stay the same, so saved projects keep working.
pub fn rename(dir: &Path, id: &str, name: &str) -> Result<(), String> {
    let name = clean_name(name)?;
    if !exists(dir, id) {
        return Err(format!("there is no voice \"{id}\""));
    }
    let path = dir.join(id).join(META);
    let text = std::fs::read_to_string(&path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let mut meta: VoiceMeta = serde_json::from_str(&text).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    meta.name = name.to_string();
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("could not save the voice: {e}"))
}

/// Marks a voice's reference as cleaned.
pub fn mark_cleaned(dir: &Path, id: &str) -> Result<(), String> {
    if !exists(dir, id) {
        return Err(format!("there is no voice \"{id}\""));
    }
    let path = dir.join(id).join(META);
    let text = std::fs::read_to_string(&path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let mut meta: VoiceMeta = serde_json::from_str(&text).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    meta.cleaned = true;
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("could not save the voice: {e}"))
}

/// Replaces a voice's reference with cleaned `samples`, leveled like a new one, and marks it
/// cleaned. The first time, the old reference is kept beside it as `reference-original.wav`.
pub fn replace_reference(dir: &Path, id: &str, samples: &[f32]) -> Result<(), String> {
    if !exists(dir, id) {
        return Err(format!("there is no voice \"{id}\""));
    }
    if samples.is_empty() {
        return Err("the cleaned clip is empty".into());
    }
    let (reference, original) = (reference_path(dir, id), dir.join(id).join(ORIGINAL));
    if !original.exists() {
        std::fs::copy(&reference, &original).map_err(|e| format!("could not keep the original clip: {e}"))?;
    }
    let bytes = wav::encode_pcm16(&normalize(samples), SAMPLE_RATE).map_err(|e| format!("could not encode the clip: {e}"))?;
    wav::save(&reference, &bytes)?;
    mark_cleaned(dir, id)
}

/// Moves a voice to the system trash, so a mistake can be undone there.
pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    if !exists(dir, id) {
        return Err(format!("there is no voice \"{id}\""));
    }
    trash::delete(dir.join(id)).map_err(|e| format!("could not move the voice to the trash: {e}"))
}

/// A voice's reference clip as mono samples. They're saved at 24 kHz, so other rates are refused.
pub fn read_reference(dir: &Path, id: &str) -> Result<Vec<f32>, String> {
    if !valid_id(id) {
        return Err(format!("there is no voice \"{id}\""));
    }
    let path = reference_path(dir, id);
    let mut reader = hound::WavReader::open(&path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let spec = reader.spec();
    if spec.sample_rate != SAMPLE_RATE || spec.channels != 1 {
        return Err(format!("{} is not 24 kHz mono", path.display()));
    }
    let read = |e: hound::Error| format!("could not read {}: {e}", path.display());
    match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<_, _>>().map_err(read),
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader.samples::<i32>().map(|s| s.map(|s| s as f32 / scale)).collect::<Result<_, _>>().map_err(read)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("flikka-voices-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn replacing_a_reference_keeps_the_original_once() {
        let dir = temp_dir("replace");
        let tone: Vec<f32> = (0..24_000).map(|i| (i as f32 / 20.0).sin() * 0.5).collect();
        let id = create(&dir, "Mine", "Recorded", &tone, true).unwrap();
        assert!(!list(&dir)[0].meta.cleaned);
        let first = std::fs::read(reference_path(&dir, &id)).unwrap();

        replace_reference(&dir, &id, &vec![0.1; 24_000]).unwrap();
        replace_reference(&dir, &id, &vec![0.2; 24_000]).unwrap();
        assert!(list(&dir)[0].meta.cleaned);
        // The backup is the clip from before the first clean, not the second.
        assert_eq!(std::fs::read(dir.join(&id).join(ORIGINAL)).unwrap(), first);
        // Leveled like a new voice.
        assert!((read_reference(&dir, &id).unwrap()[100] - TARGET_PEAK).abs() < 1e-3);
        assert!(replace_reference(&dir, "vnope", &tone).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn creates_lists_and_reads_voices() {
        let dir = temp_dir("create");
        let tone: Vec<f32> = (0..24_000).map(|i| (i as f32 / 20.0).sin() * 0.5).collect();
        let a = create(&dir, " Heart ", "Kokoro · Heart", &tone, false).unwrap();
        let b = create(&dir, "Second", "Imported", &tone, true).unwrap();
        assert_ne!(a, b);

        let voices = list(&dir);
        assert_eq!(voices.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(), [a.as_str(), b.as_str()]);
        assert_eq!(voices[0].meta.name, "Heart");
        assert_eq!(voices[0].meta.source, "Kokoro · Heart");
        assert_eq!(voices[0].meta.consent_ms, None);
        assert_eq!(voices[1].meta.consent_ms, Some(voices[1].meta.created_ms));

        rename(&dir, &a, "  Narrator ").unwrap();
        assert_eq!(list(&dir)[0].meta.name, "Narrator");
        assert!(rename(&dir, &a, " ").is_err());
        assert!(rename(&dir, "vmissing", "x").is_err());

        let back = read_reference(&dir, &a).unwrap();
        assert_eq!(back.len(), tone.len());
        // The clip was turned up to the target peak on the way in.
        let gain = TARGET_PEAK / tone.iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((back[100] - tone[100] * gain).abs() < 1e-3);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn quiet_clips_are_turned_up_and_loud_ones_left_alone() {
        let peak = |s: &[f32]| s.iter().fold(0f32, |m, x| m.max(x.abs()));
        // A laptop mic's -35 dBFS peak comes up to the target.
        let quiet: Vec<f32> = (0..100).map(|i| (i as f32 / 5.0).sin() * 0.0178).collect();
        assert!((peak(&normalize(&quiet)) - TARGET_PEAK).abs() < 1e-3);
        let loud = vec![0.95, -0.5];
        assert_eq!(normalize(&loud), loud);
        // Near-silence only gets the maximum gain.
        assert!((peak(&normalize(&[0.0001, -0.0001])) - 0.01).abs() < 1e-6);
        assert_eq!(normalize(&[0.0, 0.0]), vec![0.0, 0.0]);
    }

    #[test]
    fn cuts_long_references_and_refuses_bad_input() {
        let dir = temp_dir("limits");
        let long = vec![0.1; (MAX_REFERENCE_SECONDS + 3) * SAMPLE_RATE as usize];
        let id = create(&dir, "Long", "test", &long, false).unwrap();
        assert_eq!(read_reference(&dir, &id).unwrap().len(), MAX_REFERENCE_SECONDS * SAMPLE_RATE as usize);
        assert!(create(&dir, "  ", "test", &long, false).is_err());
        assert!(create(&dir, "Empty", "test", &[], false).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn skips_broken_folders_and_rejects_odd_ids() {
        let dir = temp_dir("broken");
        std::fs::create_dir_all(dir.join("vnometa")).unwrap();
        std::fs::create_dir_all(dir.join("vnoref")).unwrap();
        std::fs::write(dir.join("vnoref").join(META), r#"{"name":"x","source":"y","createdMs":1}"#).unwrap();
        assert!(list(&dir).is_empty());
        assert!(!exists(&dir, "../etc"));
        assert!(read_reference(&dir, "../x").is_err());
        assert!(delete(&dir, "vnoref").is_err());
        assert!(list(&temp_dir("missing")).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
