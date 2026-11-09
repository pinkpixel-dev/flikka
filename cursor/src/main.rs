//! flikka-cursor: logs where the pointer is while Flikka records the screen on Wayland, so the recording itself can be
//! made without it and Flikka draws it (or not) when it renders.
//!
//!   flikka-cursor --out <file.jsonl> [--token <file>] [--window]
//!
//! Opens its own screencast session in the portal's metadata cursor mode: the stream's frames are never read, only the
//! pointer position each PipeWire buffer carries. Writes one line per change to --out:
//!   {"type":"move","x":0.41,"y":0.73,"t":1762600000.123,"visible":true}
//! x and y are 0 to 1 across the stream, t is wall-clock seconds (Unix time), and visible is false while the pointer is
//! off the stream (this monitor, or with --window the chosen window). --token keeps the portal's restore token, so only the first run shows the picker.
//!
//! Events on stdout, one JSON line each: {"event":"ready","width":…,"height":…} once positions flow,
//! {"event":"error","code":…,"message":…} on failure (code "no-metadata" when the portal can't do it, "cancelled"
//! when the picker was closed), and {"event":"stopped","moves":…,"lag_ms":…} after SIGINT or SIGTERM (lag_ms: how late buffers arrived on
//! average, already taken out of t).

mod stream;

use std::path::PathBuf;
use std::process::exit;

use ashpd::desktop::screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType};
use ashpd::desktop::PersistMode;
use serde_json::{json, Value};
use tokio::signal::unix::{signal, SignalKind};

pub fn emit(value: Value) {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

fn fail(code: &str, message: impl std::fmt::Display) -> ! {
    emit(json!({"event": "error", "code": code, "message": message.to_string()}));
    exit(1);
}

fn flag(args: &[String], name: &str) -> Option<PathBuf> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(PathBuf::from)
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--version") {
        println!("flikka-cursor {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let Some(out) = flag(&args, "--out") else {
        eprintln!("usage: flikka-cursor --out <file.jsonl> [--token <file>] [--window]");
        exit(2);
    };
    let source = if args.iter().any(|a| a == "--window") { SourceType::WINDOW } else { SourceType::MONITOR };
    let token_file = flag(&args, "--token");
    let token = token_file
        .as_ref()
        .and_then(|file| std::fs::read_to_string(file).ok())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());

    let portal = Screencast::new().await.unwrap_or_else(|e| fail("portal", format!("No screencast portal: {e}")));
    let modes = portal.available_cursor_modes().await.unwrap_or_else(|e| fail("no-metadata", e));
    if !modes.contains(CursorMode::METADATA) {
        fail("no-metadata", "This desktop's screencast portal can't report the pointer separately");
    }
    let session = portal.create_session(Default::default()).await.unwrap_or_else(|e| fail("portal", e));
    let options = SelectSourcesOptions::default()
        .set_cursor_mode(CursorMode::METADATA)
        .set_sources(source)
        .set_multiple(false)
        .set_persist_mode(PersistMode::ExplicitlyRevoked)
        .set_restore_token(token.as_deref());
    portal
        .select_sources(&session, options)
        .await
        .and_then(|request| request.response())
        .unwrap_or_else(|e| fail("portal", e));
    let streams = match portal.start(&session, None, Default::default()).await.and_then(|request| request.response()) {
        Ok(streams) => streams,
        Err(ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled)) => fail("cancelled", "The screen picker was closed"),
        Err(e) => fail("portal", e),
    };
    if let (Some(file), Some(token)) = (&token_file, streams.restore_token()) {
        if let Some(folder) = file.parent() {
            let _ = std::fs::create_dir_all(folder);
        }
        if let Err(e) = std::fs::write(file, token) {
            eprintln!("flikka-cursor couldn't keep the restore token: {e}");
        }
    }
    let Some(chosen) = streams.streams().first() else { fail("portal", "The portal started no stream") };
    let (node, size) = (chosen.pipe_wire_node_id(), chosen.size());
    let fd = portal.open_pipe_wire_remote(&session, Default::default()).await.unwrap_or_else(|e| fail("portal", e));

    // PipeWire runs its own loop, so it gets a thread; this one keeps the portal session (its D-Bus connection) alive
    // and waits for the signal to stop.
    let (quit, quit_rx) = pipewire::channel::channel::<()>();
    let mut reader = tokio::task::spawn_blocking(move || stream::run(node, fd, &out, size, quit_rx));
    let (mut interrupt, mut terminate) = (signal(SignalKind::interrupt()).unwrap(), signal(SignalKind::terminate()).unwrap());
    let result = tokio::select! {
        _ = interrupt.recv() => { let _ = quit.send(()); (&mut reader).await }
        _ = terminate.recv() => { let _ = quit.send(()); (&mut reader).await }
        done = &mut reader => done,
    };
    let _ = session.close().await;
    match result {
        Ok(Ok(logged)) => emit(json!({"event": "stopped", "moves": logged.moves, "lag_ms": logged.lag_ms})),
        Ok(Err(message)) => fail("stream", message),
        Err(e) => fail("stream", e),
    }
}
