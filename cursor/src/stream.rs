//! The PipeWire side: connects to the portal's stream without mapping its frames, asks for cursor metadata on every
//! buffer, and writes a line whenever the pointer moves.

use std::cell::RefCell;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::os::fd::OwnedFd;
use std::path::Path;
use std::rc::Rc;
use std::time::{SystemTime, UNIX_EPOCH};

use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use serde_json::json;
use spa::buffer::meta::{MetaCursor, MetaHeader};
use spa::param::format::{FormatProperties, MediaSubtype, MediaType};
use spa::param::video::{VideoFormat, VideoInfoRaw};
use spa::param::ParamType;
use spa::pod::serialize::PodSerializer;
use spa::pod::{ChoiceValue, Object, Pod, Property, PropertyFlags, Value};
use spa::utils::{Choice, ChoiceEnum, ChoiceFlags, Fraction, Id, Rectangle, SpaTypes};

use crate::emit;

struct State {
    width: u32,
    height: u32,
    out: BufWriter<File>,
    last: Option<(i32, i32, bool)>,
    /// The compositor sends a still pointer's position again (COSMIC does), so a buffer without one means it left.
    repeats: bool,
    moves: u64,
    /// Total and count of how old buffers were when they arrived, for the lag reported at the end.
    lag: (f64, u32),
    ready: bool,
    error: Option<String>,
}

fn monotonic_ns() -> i64 {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
    now.tv_sec * 1_000_000_000 + now.tv_nsec
}

/// Wall-clock seconds when the compositor captured the buffer: its header's pts (monotonic nanoseconds) moved onto the
/// wall clock. Buffers reach us tens of milliseconds after that, so the time they arrive would put the pointer behind
/// the video. Falls back to now when there's no usable pts.
fn captured_at(pts: Option<i64>) -> (f64, Option<f64>) {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or_default();
    let age = pts.map(|pts| monotonic_ns() - pts).filter(|age| (0..1_000_000_000).contains(age)).map(|age| age as f64 / 1e9);
    (now - age.unwrap_or(0.0), age)
}

impl State {
    fn moved(&mut self, x: i32, y: i32, t: f64) {
        let (w, h) = (self.width.max(1) as i32, self.height.max(1) as i32);
        let visible = (0..w).contains(&x) && (0..h).contains(&y);
        if self.last == Some((x, y, visible)) {
            self.repeats = true;
        } else {
            self.write(x, y, t, visible);
        }
    }

    fn write(&mut self, x: i32, y: i32, t: f64, visible: bool) {
        let (w, h) = (self.width.max(1) as i32, self.height.max(1) as i32);
        self.last = Some((x, y, visible));
        let round = |value: f64| (value * 100_000.0).round() / 100_000.0;
        let line = json!({"type": "move", "x": round(x as f64 / w as f64), "y": round(y as f64 / h as f64),
            "t": (t * 1000.0).round() / 1000.0, "visible": visible});
        // Written through at once, so a recorder that gets killed still leaves what was logged.
        if writeln!(self.out, "{line}").and_then(|_| self.out.flush()).is_err() {
            self.error.get_or_insert_with(|| "Couldn't write the pointer log".into());
        }
        self.moves += 1;
    }

    /// The pointer went off the stream without a position outside it: hidden at its last place, once. A compositor
    /// that repeats a still pointer's position only sends no data when the pointer is gone. One that hasn't been seen
    /// doing that might send none for a still pointer too, so then it's only taken as gone near the edge.
    fn left(&mut self, t: f64) {
        let Some((x, y, true)) = self.last else { return };
        let (w, h) = (self.width.max(1) as i32, self.height.max(1) as i32);
        let margin = 16.max(w.min(h) * 3 / 100);
        if self.repeats || x < margin || y < margin || x >= w - margin || y >= h - margin {
            self.write(x, y, t, false);
        }
    }
}

fn pod(object: Object) -> Vec<u8> {
    PodSerializer::serialize(std::io::Cursor::new(Vec::new()), &Value::Object(object)).expect("pod").0.into_inner()
}

/// Any raw video the portal offers: the frames are never looked at, so the format doesn't matter.
fn formats() -> Vec<u8> {
    pod(pw::spa::pod::object!(
        SpaTypes::ObjectParamFormat,
        ParamType::EnumFormat,
        pw::spa::pod::property!(FormatProperties::MediaType, Id, MediaType::Video),
        pw::spa::pod::property!(FormatProperties::MediaSubtype, Id, MediaSubtype::Raw),
        pw::spa::pod::property!(
            FormatProperties::VideoFormat, Choice, Enum, Id,
            VideoFormat::BGRx, VideoFormat::BGRx, VideoFormat::RGBx, VideoFormat::BGRA, VideoFormat::RGBA,
            VideoFormat::xRGB, VideoFormat::xBGR, VideoFormat::ARGB, VideoFormat::ABGR
        ),
        pw::spa::pod::property!(
            FormatProperties::VideoSize, Choice, Range, Rectangle,
            Rectangle { width: 1920, height: 1080 }, Rectangle { width: 1, height: 1 }, Rectangle { width: 16384, height: 16384 }
        ),
        pw::spa::pod::property!(
            FormatProperties::VideoFramerate, Choice, Range, Fraction,
            Fraction { num: 60, denom: 1 }, Fraction { num: 0, denom: 1 }, Fraction { num: 1000, denom: 1 }
        ),
    ))
}

fn meta(kind: u32, size: Value) -> Vec<u8> {
    pod(Object {
        type_: SpaTypes::ObjectParamMeta.as_raw(),
        id: ParamType::Meta.as_raw(),
        properties: vec![
            Property { key: spa::sys::SPA_PARAM_META_type, flags: PropertyFlags::empty(), value: Value::Id(Id(kind)) },
            Property { key: spa::sys::SPA_PARAM_META_size, flags: PropertyFlags::empty(), value: size },
        ],
    })
}

/// Cursor metadata on every buffer, with room for the pointer's picture (it's sent, but not used), and the header,
/// for when the buffer was captured.
fn metas() -> [Vec<u8>; 2] {
    let size = |side: i32| (std::mem::size_of::<spa::sys::spa_meta_cursor>() + std::mem::size_of::<spa::sys::spa_meta_bitmap>()) as i32 + side * side * 4;
    let range = ChoiceEnum::Range { default: size(64), min: size(1), max: size(1024) };
    [
        meta(spa::sys::SPA_META_Cursor, Value::Choice(ChoiceValue::Int(Choice(ChoiceFlags::empty(), range)))),
        meta(spa::sys::SPA_META_Header, Value::Int(std::mem::size_of::<spa::sys::spa_meta_header>() as i32)),
    ]
}

/// What a finished run logged: how many lines, and how late buffers arrived on average (None without timestamps).
pub struct Logged {
    pub moves: u64,
    pub lag_ms: Option<f64>,
}

/// Reads pointer positions until `quit` says stop or the stream fails.
pub fn run(node: u32, fd: OwnedFd, out: &Path, size: Option<(i32, i32)>, source: &'static str, quit: pw::channel::Receiver<()>) -> Result<Logged, String> {
    let file = File::create(out).map_err(|e| format!("Couldn't create {}: {e}", out.display()))?;
    let (width, height) = size.map(|(w, h)| (w.max(0) as u32, h.max(0) as u32)).unwrap_or((0, 0));
    let state = Rc::new(RefCell::new(State { width, height, out: BufWriter::new(file), last: None, repeats: false, moves: 0, lag: (0.0, 0), ready: false, error: None }));

    let mainloop = pw::main_loop::MainLoopRc::new(None).map_err(|e| e.to_string())?;
    let context = pw::context::ContextBox::new(mainloop.loop_(), None).map_err(|e| e.to_string())?;
    let core = context.connect_fd(fd, None).map_err(|e| format!("Couldn't reach PipeWire: {e}"))?;
    let stream = pw::stream::StreamBox::new(
        &core,
        "flikka-cursor",
        properties! { *pw::keys::MEDIA_TYPE => "Video", *pw::keys::MEDIA_CATEGORY => "Capture", *pw::keys::MEDIA_ROLE => "Screen" },
    )
    .map_err(|e| e.to_string())?;

    let stopper = mainloop.clone();
    let _quit = quit.attach(mainloop.loop_(), move |_| stopper.quit());
    let metas = metas();
    let (on_state, on_param, on_buffer) = (state.clone(), state.clone(), state.clone());
    let failed = mainloop.clone();
    let _listener = stream
        .add_local_listener_with_user_data(())
        .state_changed(move |_, _, _, new| {
            let mut state = on_state.borrow_mut();
            match new {
                pw::stream::StreamState::Error(message) => {
                    state.error = Some(format!("The screencast stream failed: {message}"));
                    failed.quit();
                }
                pw::stream::StreamState::Streaming if !state.ready => {
                    state.ready = true;
                    emit(json!({"event": "ready", "width": state.width, "height": state.height, "source": source}));
                }
                _ => {}
            }
        })
        .param_changed(move |stream, _, id, param| {
            let Some(param) = param else { return };
            if id != ParamType::Format.as_raw() {
                return;
            }
            let mut info = VideoInfoRaw::default();
            if info.parse(param).is_ok() && info.size().width > 0 {
                let mut state = on_param.borrow_mut();
                (state.width, state.height) = (info.size().width, info.size().height);
            }
            // Asked for once the format is set, the way the portal expects it.
            let mut params = metas.each_ref().map(|bytes| Pod::from_bytes(bytes).expect("meta pod"));
            if let Err(e) = stream.update_params(&mut params) {
                on_param.borrow_mut().error.get_or_insert_with(|| format!("PipeWire refused the cursor metadata: {e}"));
            }
        })
        .process(move |stream, _| {
            let Some(buffer) = stream.dequeue_buffer() else { return };
            let Some(cursor) = buffer.find_meta::<MetaCursor>() else { return };
            let pts = buffer.find_meta::<MetaHeader>().map(|header| header.pts()).filter(|pts| *pts > 0);
            let (t, age) = captured_at(pts);
            let mut state = on_buffer.borrow_mut();
            // An id of 0 means this buffer brings no new pointer data. Right after a position at the edge, it means
            // the pointer left: a window stream sends only those while the pointer is somewhere else on the screen.
            if !cursor.is_valid() {
                state.left(t);
                return;
            }
            if let Some(age) = age {
                state.lag = (state.lag.0 + age, state.lag.1 + 1);
            }
            let position = cursor.position();
            state.moved(position.x, position.y, t);
        })
        .register()
        .map_err(|e| e.to_string())?;

    let format = formats();
    let mut params = [Pod::from_bytes(&format).expect("format pod")];
    // No MAP_BUFFERS: the frames stay where they are, only the metadata is read.
    stream
        .connect(spa::utils::Direction::Input, Some(node), pw::stream::StreamFlags::AUTOCONNECT, &mut params)
        .map_err(|e| format!("Couldn't connect to the screencast stream: {e}"))?;
    mainloop.run();
    let _ = stream.disconnect();

    let mut state = state.borrow_mut();
    let _ = state.out.flush();
    match state.error.take() {
        Some(message) => Err(message),
        None => Ok(Logged { moves: state.moves, lag_ms: (state.lag.1 > 0).then(|| (state.lag.0 / state.lag.1 as f64 * 10_000.0).round() / 10.0) }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(name: &str) -> (State, std::path::PathBuf) {
        let file = std::env::temp_dir().join(format!("flikka-cursor-{name}-{}.jsonl", std::process::id()));
        let out = BufWriter::new(File::create(&file).unwrap());
        (State { width: 1000, height: 500, out, last: None, repeats: false, moves: 0, lag: (0.0, 0), ready: false, error: None }, file)
    }

    fn lines(file: &Path) -> Vec<serde_json::Value> {
        std::fs::read_to_string(file).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect()
    }

    #[test]
    fn no_data_after_an_edge_hides_the_pointer_once_and_a_position_brings_it_back() {
        let (mut state, file) = state("edge");
        state.moved(500, 250, 1.0);
        state.moved(995, 250, 1.1);
        state.left(1.2);
        state.left(1.3);
        state.moved(990, 260, 2.0);
        let logged = lines(&file);
        assert_eq!(logged.iter().map(|line| line["visible"].as_bool().unwrap()).collect::<Vec<_>>(), [true, true, false, true]);
        assert_eq!((logged[2]["x"].as_f64().unwrap(), logged[2]["t"].as_f64().unwrap()), (0.995, 1.2));
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn once_still_positions_repeat_no_data_anywhere_means_the_pointer_left() {
        let (mut state, file) = state("repeats");
        state.moved(500, 250, 1.0);
        state.moved(500, 250, 1.1);
        state.moved(700, 250, 1.2);
        state.left(1.3);
        let logged = lines(&file);
        assert_eq!(logged.len(), 3);
        assert_eq!((logged[2]["x"].as_f64().unwrap(), logged[2]["visible"].as_bool().unwrap()), (0.7, false));
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn no_data_in_the_middle_means_the_pointer_is_still_there() {
        let (mut state, file) = state("middle");
        state.moved(500, 250, 1.0);
        state.left(1.2);
        assert_eq!(lines(&file).len(), 1);
        let _ = std::fs::remove_file(file);
    }
}
