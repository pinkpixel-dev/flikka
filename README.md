# 🎬 Flikka

The screen recorder your AI agent edits, built natively for Linux.

You record, or your AI coding agent records itself. Then you tell it what you want in plain words ("cut the pauses", "zoom in when I click the signup button", "narrate this with captions") and the agent edits and renders the video for you.

## What is Flikka?

Flikka gives AI agents (and humans) a CLI-first video creation workflow. Instead of dragging clips on a timeline in a GUI app, every edit in Flikka is code and structured JSON.

- **Agents record themselves**: An agent can launch a real browser with your existing logins, click buttons, type naturally like a human, and record its own walkthroughs in the background.
- **Terminal recordings**: Record terminal sessions with automatic secret blurring (for API keys or passwords) and typing sounds.
- **Auto-edits**: When a recording stops, Flikka automatically trims out dead air and calculates smooth zooms onto clicks from recorded mouse telemetry.
- **Launch videos and films**: Turn clips into multi-scene demo videos with title cards, kinetic captions, voiceover narration, and background music.
- **Hardware accelerated**: Optimized for modern Linux desktops (Arch / CachyOS, Wayland, PipeWire) with CUDA support for speech recognition and neural voice synthesis.

## Quick Start

### Prerequisites
- Linux (tested on Arch Linux / CachyOS with Wayland and PipeWire)
- Node.js 22 or newer
- FFmpeg
- Python 3.12+ and `uv`
- Chromium or Google Chrome

### Installation

```bash
git clone https://github.com/your-username/flikka.git
cd flikka
npm install
```

Link the `flikka` command to your local bin, install the desktop entry, and register agent skills:

```bash
node flikka app install
```

Then check that your system has everything Flikka uses (screen recorder, clipboard tools, a browser and so on). It prints the exact install command for whatever's missing:

```bash
flikka doctor
```

## How to Use It

Flikka uses five core words:

```bash
flikka record    # make a video: browser, terminal, or screen
flikka project   # list, edit, preview, and render projects
flikka shot      # framed screenshots
flikka voice     # voice samples and narration
flikka app       # local preview panel
```

### 1. Let an agent record a browser session
```bash
flikka record browser https://example.com --name signup-flow
flikka record look
flikka record click 3
flikka record type 1 "hello@example.com"
flikka record stop
```

When it stops, Flikka prints a project ID (like `3f9a1c2e`).

### 2. Edit the video with simple flags
```bash
flikka project edit 3f9a1c2e --cut-idle --auto-zoom --cursor off --preset vertical
flikka project render 3f9a1c2e
```

The rendered video is saved to `~/Documents/flikka/`.

### 3. Build a multi-scene launch film
Create a `film.json` file describing your scenes and voiceover lines, then render:

```bash
flikka project new launch-demo
flikka project render launch-demo
```

## License

Apache 2.0. See [LICENSE](LICENSE) for details.
