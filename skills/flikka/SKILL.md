---
name: flikka
description: The Linux CLI for screen recording, autonomous browser demos, video editing, voice narration, and video generation. Use when the user asks to "record yourself doing X", "make a demo or launch video", "record the screen", "edit recording", "add voice narration", "render a video", or references a Flikka project ID.
---

# Flikka

Flikka gives coding agents and developers a CLI to record screens, script realistic browser actions, auto-edit zooms and cuts, synthesize voice narration, and render videos natively on Linux.

Every command prints structured JSON to stdout.

## Core Capabilities

| Command | Purpose |
|---|---|
| `flikka record browser <url>` | Opens an isolated Chromium instance and records inside the page |
| `flikka record screen` | Records the Linux desktop display using hardware acceleration |
| `flikka record screen --no-cursor` | Records screen or window without the mouse cursor |
| `flikka record look` | Inspects interactive elements on the page with numeric references |
| `flikka record click <target>` | Glides the mouse and clicks an element |
| `flikka record type <target> "text"` | Types with human keystroke timing |
| `flikka record wait "text"` | Waits for text or a selector to appear on the page |
| `flikka record stop` | Finalizes recording, mixes audio, and outputs project files |
| `flikka project edit <id>` | Configures clips, auto-zooms, idle cuts, cursor overlay (--cursor on/off), background styling |
| `flikka project timeline <id>` | Lists what happens in the finished video, in its own seconds: kept parts, cuts, zooms, clicks, speech |
| `flikka project frames <id> --at 3,1:20` | Labelled frames of the edit in one picture, each stamped with video time and recording time |
| `flikka project undo <id>` | Puts the project back as it was before the last saved edit |
| `flikka project render <id>` | Renders the final 60 fps MP4 video through HyperFrames |
| `flikka project new <name>` | Scaffolds a multi-scene film with voice narration |
| `flikka voice say <name> "text"` | Synthesizes speech using Kokoro neural voices on CUDA/CPU |
| `flikka shot` | Captures framed screenshots with desktop wallpaper backgrounds |
| `flikka doctor` | Checks the system tools flikka needs and prints the command that installs anything missing |

## Autonomous Browser Recording Workflow

When asked to record a demo of a website or web app, follow this loop:

### 1. Start the recording session

```bash
flikka record browser https://example.com --name demo
```

This starts a background worker and returns a project ID (for example, `1b2bf8de`).

### 2. Inspect and interact like a person

Viewers can immediately tell when an agent snaps or evaluates directly into the DOM. Use Flikka's humanized actions:

```bash
# 1. Inspect elements and their numeric targets
flikka record look

# 2. Click elements by target number, text, or CSS selector
flikka record click 1

# 3. Type into fields with natural typing rhythm
flikka record type 11 "Arch Linux"
flikka record key Enter

# 4. Wait for elements instead of using arbitrary sleep
flikka record wait "Search results"

# 5. Smooth scroll down the page
flikka record scroll 300
```

### 3. Stop and finalize

```bash
flikka record stop
```

Stopping writes `recording.mp4`, generates `recording.project.json`, trims idle pauses, and calculates camera zooms on click targets.

### 4. Preview and render

```bash
# Preview a single frame
flikka project preview <id>

# Render the final 60 fps MP4 video
flikka project render <id> --out ~/Documents/flikka/demo.mp4
```

## Desktop Screen Recording Workflow

Flikka records the physical Linux desktop display using `gpu-screen-recorder` with hardware NVENC acceleration and PipeWire audio.

```bash
# 1. List available displays, mics, and webcams
flikka record sources

# 2. Record full display for a fixed duration
flikka record screen --for 10 --name desktop-flow

# 3. Record an individual window via Wayland portal
flikka record window --name window-demo

# 4. Record an interactive region (drag crosshairs with slurp, or pass x,y,w,h)
flikka record region --name region-demo
flikka record region 100,100,800,600 --name fixed-box

# 5. Stop the recording
flikka record stop

# 6. Render the project
flikka project render <id>
```

## Multi-Scene Films with Voice Narration

Flikka can assemble multiple scenes (screen captures, browser clips, titles, code snippets) into a single produced film with synchronized neural TTS narration and background music.

```bash
# 1. Create a new film project
flikka project new product-launch

# 2. Edit film.json in the project folder
# List scenes with voice narration:
# "scenes": [
#   {"type": "title", "title": "Introducing Flikka", "say": "Meet Flikka for Linux."},
#   {"type": "recording", "source": "demo.mp4", "say": "Record yourself effortlessly."}
# ]

# 3. Preview frames
flikka project preview product-launch

# 4. Render and check
flikka project render product-launch
```

Available Kokoro neural voices include `af_heart`, `af_bella`, `af_nicole`, `am_adam`, `am_michael`, `bf_emma`, and `bm_george`. List them with `flikka voice list`.

## Editing by What the Viewer Sees

Times a user mentions ("cut the part at 1:20") are in the finished video, not the raw recording. Don't convert them by hand:

```bash
flikka project timeline <id>                                     # parts, cuts, zooms, clicks and speech in video time
flikka project frames <id> --at 1:18,1:20,1:22                   # look at the moments before changing them
flikka project edit <id> --output-time --cut 1:20,1:25 --dry-run # what would change: durations before and after
flikka project edit <id> --output-time --cut 1:20,1:25           # do it
flikka project undo <id>                                         # changed your mind
```

The same works for `--trim start,end` (keep only that), `--freeze at,seconds` (hold a moment as a silent still) and `--speed 2,start,end`. Add `--ramp 0.5` to ease between speeds instead of jumping. For framing: `--crop x,y,w,h` shows only part of the recording, `--zoom start,end,x,y[,scale]` zooms in on a spot, and `--spotlight start,end,x,y,w,h` dims everything else for a while. Positions are 0 to 1 of the whole recording (a crop also takes pixels), and the times take `--output-time` like the rest. Look at `flikka project frames` first to pick the spot.

To explain what's happening on screen: `--step start,end,x,y,"text"` (numbered automatically in time order), `--callout start,end,x,y,"text"`, `--arrow start,end,x,y,x2,y2` and `--box start,end,x,y,w,h`. Quote text that has spaces. `--keystrokes on` shows shortcuts as they're pressed (recordings only log shortcuts and named keys, never typed text). To hide something after recording, use `--redact start,end,x,y,w,h,solid`, or `all,x,y,w,h,solid` for the whole video. Always use `solid` for passwords, keys and tokens, since blurred text can sometimes be recovered.

For a finished feel: `--intro "text"` and `--outro "seconds,text"` add title cards, `--transition fade|wipe|slide|zoom` adds a transition at every cut (films take `"transition"` in film.json), and `--music on` (or `--music <file>`) adds a bed that ducks under the voice. An intro shifts every video time by its length, so re-read `flikka project timeline` after adding one.

## Sharing Finished Videos

```bash
flikka project export <id> --format gif --from 0:03 --to 0:09   # for a README or pull request (800 px, 15 fps)
flikka project export <id> --format webm
flikka project poster <id> [--at 0:12]                           # a thumbnail
flikka project render <id> --presets square,vertical,landscape  # each shape as its own file
flikka project render <id> --transparent [mov]                  # no backdrop, alpha channel
flikka project edit <id> --output-time --chapter "0:30,Sign in" # chapters in the file and a list for YouTube
```

`export` and `poster` use the finished video, so render first. Variants (`--presets`, `--transparent`) never replace the project's main video. Keep GIFs short: a few seconds of the important part. Freezes and ramps apply to recording renders; a film plays its recordings at the scene's own speed.

`--output-time` reads the times as the video was before this edit. Every saved edit keeps the previous version in the project's `history/` folder, up to 50 deep.

## Agent Guidelines

- Look before acting: Run `flikka record look` first to obtain accurate numeric targets for clicks and typing.
- Avoid raw DOM evaluations for recorded interactions: Use `click`, `type`, and `scroll` so the mouse cursor moves smoothly across frames.
- Guard secrets: Use `--hide <text>` and `--blur <regex>` when launching recordings to keep API keys and tokens out of video frames.
- Edit in video time: read `flikka project timeline` and use `--output-time` instead of converting times by hand. Try big edits with `--dry-run` first.
- Verify before finishing: Always inspect the final video with `ffprobe` to confirm video resolution, framerate, and audio track validity.
