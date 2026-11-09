//! Optional CUDA for NVIDIA cards, through Microsoft's CUDA plugin for ONNX Runtime.
//!
//! flikka-voice is the WebGPU build, and the plugin loads into it at run time, so CUDA is a download Flikka makes
//! when asked (`flikka voice cuda install`) instead of a second build. The plugin uses the CUDA 13 and cuDNN 9
//! libraries installed on the system. On a 4090, Chatterbox ran about 1.5 times faster on CUDA than on WebGPU.
use std::path::Path;
use std::sync::Mutex;

use ort::environment::Environment;
use ort::session::builder::SessionBuilder;
use ort::session::Session;

const EP_NAME: &str = "CUDAExecutionProvider";

/// A plugin stays registered for the life of the process, so it is only registered once.
static REGISTERED: Mutex<bool> = Mutex::new(false);

/// A session builder on the first CUDA device, registering `plugin` first if needed. TF32 is off: with it on,
/// Kokoro's audio drifted far from the CPU's in earlier tests, so it's kept off for Chatterbox too.
pub fn builder(plugin: &Path) -> Result<SessionBuilder, String> {
    let env = Environment::current().map_err(|e| e.to_string())?;
    {
        let mut registered = REGISTERED.lock().unwrap_or_else(|p| p.into_inner());
        if !*registered {
            env.register_ep_library(EP_NAME, plugin).map_err(|e| e.to_string())?;
            *registered = true;
        }
    }
    let device = env.devices().find(|d| d.ep().is_ok_and(|e| e == EP_NAME)).ok_or("no CUDA device was found")?;
    let options = vec![(format!("{EP_NAME}.use_tf32"), "0".to_string())];
    Session::builder().map_err(|e| e.to_string())?.with_devices([device], Some(&options)).map_err(|e| e.to_string())
}

/// CUDA ran slower in a process that had already used WebGPU, which a long-running app would have to track.
/// flikka-voice is a fresh process for each run, so there's nothing to track.
pub fn note_webgpu() {}
