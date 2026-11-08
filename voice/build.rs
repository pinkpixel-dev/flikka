fn main() {
    // ONNX Runtime's WebGPU build loads libwebgpu_dawn.so, which `ort` copies next to the binary.
    // Look for it there, so the binary and the library can travel together in one folder.
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
}
