//! The contract between Narra and each speech model.
//!
//! Narra owns the workflow (projects, segments, caching, export). An engine only loads its
//! model, reports what it can do, and turns text into audio.

use std::path::{Path, PathBuf};

use serde::Serialize;
use thiserror::Error;

use crate::pronunciations::Pronunciation;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineCapabilities {
    pub built_in_voices: bool,
    pub voice_cloning: bool,
    pub multilingual: bool,
    pub speed_control: bool,
    pub expression_control: bool,
    pub streaming: bool,
    /// Accepts phonemes directly, so exact pronunciation overrides are possible.
    pub phoneme_input: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    /// Factual metadata from the model publisher, such as "American English".
    pub accent: Option<String>,
    pub gender: Option<String>,
}

/// A tag the model acts out when it appears in the text, such as `[laugh]`.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextTag {
    pub tag: &'static str,
    /// "sound" for something the voice does, "style" for how it says the words.
    pub kind: &'static str,
}

/// Where an engine runs, for engines that can use the GPU.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Acceleration {
    /// The user wants the GPU used.
    pub enabled: bool,
    /// `gpu` or `cpu` once the model is loaded. `None` before that.
    pub active: Option<&'static str>,
    /// `cuda` or `webgpu` when the model runs on the GPU.
    pub provider: Option<&'static str>,
    /// Why the GPU could not be used, when the engine fell back to the CPU.
    pub fallback: Option<String>,
}

/// Engines ignore fields their capabilities do not cover.
#[derive(Debug, Clone)]
pub struct SynthesisRequest {
    pub text: String,
    pub voice_id: Option<String>,
    pub speed: Option<f32>,
    /// Engine phonemes to speak instead of `text`. Only for engines with `phoneme_input`.
    pub phonemes: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SynthesisResult {
    /// Mono samples in the range -1.0 to 1.0.
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

/// What a sounds-like spelling turns into for one engine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Respelling {
    pub phonemes: String,
    /// Words the engine does not know. It spells them out letter by letter.
    pub unknown_words: Vec<String>,
}

#[derive(Debug, Error)]
pub enum TtsError {
    #[error("model files are missing: {}", .0.join(", "))]
    MissingFiles(Vec<String>),
    #[error("unknown voice \"{0}\"")]
    UnknownVoice(String),
    #[error("there are no voices yet. Make one in Settings first")]
    NoVoices,
    #[error("there is no speakable text")]
    EmptyText,
    #[error("failed to load the model: {0}")]
    Load(String),
    #[error("speech generation failed: {0}")]
    Inference(String),
}

pub trait TtsEngine: Send {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    /// The mode the UI shows for this engine, such as "Standard" or "Lightweight".
    fn tier(&self) -> &'static str;
    /// The voice used when a request names none.
    fn default_voice(&self) -> &'static str;
    fn capabilities(&self) -> EngineCapabilities;

    /// The folder this engine's downloaded model files live in.
    fn model_dir(&self) -> &Path;
    /// Every file the engine needs, relative to `model_dir`.
    fn required_files(&self) -> Vec<String>;
    /// Required model files that are not on disk yet. Empty means the engine can load.
    fn missing_files(&self) -> Vec<String>;
    fn voices(&self) -> Vec<VoiceInfo>;

    fn is_loaded(&self) -> bool;
    fn load(&mut self) -> Result<(), TtsError>;
    fn unload(&mut self);

    /// Takes `&mut self` because ONNX Runtime sessions need exclusive access to run.
    fn synthesize(&mut self, request: SynthesisRequest) -> Result<SynthesisResult, TtsError>;

    /// A stable id for the exact audio `request` would produce, used to name cached clips.
    /// It must change whenever the output would change, including pronunciation edits.
    fn cache_key(&mut self, request: &SynthesisRequest) -> Result<String, TtsError>;

    /// Replaces the pronunciation dictionary. Applies to the next synthesis.
    fn set_pronunciations(&mut self, entries: Vec<Pronunciation>) -> Result<(), TtsError>;
    /// The dictionary set last, so a project run can put it back after using its own.
    fn pronunciations(&self) -> &[Pronunciation];
    /// Shows how the engine would say a sounds-like spelling. May load the model.
    fn respell(&mut self, sounds_like: &str) -> Result<Respelling, TtsError>;

    /// Tags the engine understands in its text. Empty for engines without any.
    fn tags(&self) -> &'static [TextTag] {
        &[]
    }

    /// Where the engine runs. `None` for engines that only run on the CPU.
    fn acceleration(&self) -> Option<Acceleration> {
        None
    }
    /// Turns GPU use on or off. Takes effect the next time the model loads.
    fn set_gpu(&mut self, _enabled: bool) {}
    /// The CUDA plugin to try before WebGPU when the GPU is on, or `None` to use WebGPU. Takes
    /// effect the next time the model loads.
    fn set_cuda(&mut self, _plugin: Option<PathBuf>) {}
}
