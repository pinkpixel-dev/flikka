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
| `flikka project render <id>` | Renders the final 60 fps MP4 video through HyperFrames |
| `flikka project new <name>` | Scaffolds a multi-scene film with voice narration |
| `flikka voice say <name> "text"` | Synthesizes speech using Kokoro neural voices on CUDA/CPU |
| `flikka shot` | Captures framed screenshots with desktop wallpaper backgrounds |

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

## Agent Guidelines

- Look before acting: Run `flikka record look` first to obtain accurate numeric targets for clicks and typing.
- Avoid raw DOM evaluations for recorded interactions: Use `click`, `type`, and `scroll` so the mouse cursor moves smoothly across frames.
- Guard secrets: Use `--hide <text>` and `--blur <regex>` when launching recordings to keep API keys and tokens out of video frames.
- Verify before finishing: Always inspect the final video with `ffprobe` to confirm video resolution, framerate, and audio track validity.
