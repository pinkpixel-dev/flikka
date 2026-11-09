use std::io::Cursor;
use std::path::Path;

/// Encodes mono float samples as a 16-bit PCM WAV, which every webview can play.
pub fn encode_pcm16(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, hound::Error> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buffer = Cursor::new(Vec::with_capacity(44 + samples.len() * 2));
    let mut writer = hound::WavWriter::new(&mut buffer, spec)?;
    for &s in samples {
        writer.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16)?;
    }
    writer.finalize()?;
    Ok(buffer.into_inner())
}

/// Writes WAV bytes to a path the user picked. Only `.wav` paths and RIFF/WAVE data are
/// accepted, so the command cannot be used to write arbitrary files.
pub fn save(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let is_wav_path = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"));
    if !is_wav_path {
        return Err(format!("{} is not a .wav file", path.display()));
    }
    let is_wav_data = bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE";
    if !is_wav_data {
        return Err("the audio is not WAV data".into());
    }
    std::fs::write(path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("flikka-wav-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn saves_wav_bytes_to_a_wav_path() {
        let bytes = encode_pcm16(&[0.1, -0.1], 24_000).unwrap();
        let path = temp_path("clip.WAV");
        save(&path, &bytes).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn refuses_other_extensions_and_non_wav_data() {
        let bytes = encode_pcm16(&[0.0], 24_000).unwrap();
        assert!(save(&temp_path("clip.txt"), &bytes).is_err());
        assert!(save(&temp_path("clip"), &bytes).is_err());
        assert!(save(&temp_path("fake.wav"), b"#!/bin/sh\necho hi\n").is_err());
        assert!(!temp_path("fake.wav").exists());
    }

    #[test]
    fn round_trips_through_hound() {
        let samples = [0.0, 0.5, -0.5, 1.0, -1.0, 2.0];
        let bytes = encode_pcm16(&samples, 24_000).unwrap();

        let mut reader = hound::WavReader::new(Cursor::new(bytes)).unwrap();
        assert_eq!(reader.spec().sample_rate, 24_000);
        assert_eq!(reader.spec().channels, 1);
        let decoded: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();
        // Out-of-range input is clamped rather than wrapping around.
        assert_eq!(decoded, vec![0, 16384, -16384, i16::MAX, -i16::MAX, i16::MAX]);
    }
}
