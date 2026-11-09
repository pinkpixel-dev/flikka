//! flikka-voice: a Chatterbox Nano engine as a headless helper Flikka runs as a child process.
//!
//!   flikka-voice voices --voices <dir>
//!       prints the saved voices as one JSON array
//!   flikka-voice speak --model <dir> --voices <dir> [--cpu] [--cuda <libonnxruntime_providers_cuda.so>]
//!       reads one job per line on stdin: {"id": "n1", "text": "...", "voice": "<voice id>", "speed": 1.0, "out": "/path.wav"}
//!       writes one JSON line per event on stdout: {"event": "loaded", ...}, then {"event": "done", ...} or
//!       {"event": "error", ...} per job. Exits when stdin closes.
//!
//! engines/ holds the speech model, voices/ the saved voices, audio/ WAV reading and writing, and
//! pronunciations/ the sounds-like dictionary.

mod audio;
mod cuda;
mod engines;
mod pronunciations;
mod voices;

use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::Instant;

use serde::Deserialize;
use serde_json::{json, Value};

use engines::chatterbox::ChatterboxEngine;
use engines::traits::{SynthesisRequest, TtsEngine};

#[derive(Deserialize)]
struct Job {
    id: String,
    text: String,
    voice: Option<String>,
    speed: Option<f32>,
    out: PathBuf,
}

fn flag(args: &[String], name: &str) -> Option<PathBuf> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(PathBuf::from)
}

fn say(value: Value) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let fail = |message: &str| -> ! {
        say(json!({"event": "error", "error": message}));
        std::process::exit(1);
    };
    let voices_dir = flag(&args, "--voices").unwrap_or_else(|| fail("--voices <dir> is required"));
    match args.first().map(String::as_str) {
        Some("voices") => {
            let list: Vec<Value> = voices::list(&voices_dir)
                .into_iter()
                .map(|v| json!({"id": v.id, "name": v.meta.name, "source": v.meta.source}))
                .collect();
            say(Value::Array(list));
        }
        Some("speak") => {
            let model = flag(&args, "--model").unwrap_or_else(|| fail("--model <dir> is required"));
            let mut engine = ChatterboxEngine::new(model, voices_dir);
            engine.set_gpu(!args.iter().any(|a| a == "--cpu"));
            // Tried before WebGPU; when it fails, `loaded` says why in `fallback` and WebGPU takes over.
            engine.set_cuda(flag(&args, "--cuda"));
            let started = Instant::now();
            if let Err(error) = engine.load() {
                fail(&error.to_string());
            }
            let acceleration = engine.acceleration();
            say(json!({
                "event": "loaded",
                "seconds": started.elapsed().as_secs_f64(),
                "provider": acceleration.as_ref().and_then(|a| a.provider).unwrap_or("cpu"),
                "fallback": acceleration.and_then(|a| a.fallback),
            }));
            for line in io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let job: Job = match serde_json::from_str(&line) {
                    Ok(job) => job,
                    Err(error) => {
                        say(json!({"event": "error", "error": format!("not a job: {error}")}));
                        continue;
                    }
                };
                let started = Instant::now();
                let request = SynthesisRequest { text: job.text, voice_id: job.voice, speed: job.speed, phonemes: None };
                let result = engine
                    .synthesize(request)
                    .map_err(|e| e.to_string())
                    .and_then(|r| {
                        let bytes = audio::wav::encode_pcm16(&r.samples, r.sample_rate).map_err(|e| e.to_string())?;
                        audio::wav::save(&job.out, &bytes)?;
                        Ok(r.samples.len() as f64 / r.sample_rate as f64)
                    });
                match result {
                    Ok(seconds) => say(json!({"event": "done", "id": job.id, "out": job.out, "seconds": seconds, "elapsed": started.elapsed().as_secs_f64()})),
                    Err(error) => say(json!({"event": "error", "id": job.id, "error": error})),
                }
            }
        }
        _ => fail("usage: flikka-voice voices --voices <dir> | speak --model <dir> --voices <dir> [--cpu] [--cuda <plugin>]"),
    }
}
