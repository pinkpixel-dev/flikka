//! Stand-in for Narra's CUDA plugin support, which the spike leaves out: Chatterbox runs on
//! WebGPU or the CPU here. The engine only calls these when a CUDA plugin was set, which never
//! happens in the spike.
use std::path::Path;

use ort::session::builder::SessionBuilder;

pub fn builder(_plugin: &Path) -> Result<SessionBuilder, String> {
    Err("CUDA isn't part of the spike".into())
}

pub fn note_webgpu() {}
