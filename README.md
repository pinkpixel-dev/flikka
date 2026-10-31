<p align="center">
  <img src="assets/flikka.png" alt="Flikka" width="250" height="250">
</p>

<h1 align="center">Flikka</h1>

<p align="center">The screen recorder your AI agent edits, built for Linux.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@pinkpixel/flikka"><img src="https://img.shields.io/npm/v/@pinkpixel/flikka?color=f92571&label=npm" alt="npm version"></a>
  <a href="https://aur.archlinux.org/packages/flikka"><img src="https://img.shields.io/aur/version/flikka?color=3390ff&label=AUR" alt="AUR version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-81b313" alt="Apache 2.0"></a>
</p>

Flikka records your screen, a window, a browser tab or a terminal, then lets you (or your AI coding agent) edit the result with plain commands instead of a timeline. Idle time gets cut and clicks get zoomed automatically, so a fresh recording already renders into a decent video. From there you can speed parts up, change the background, add narration in a neural voice, or build a whole launch film with title cards, charts and captions.

Every command prints JSON, which is what makes it work so well with agents. An agent can open a browser, click around a real site like a person would, record itself doing it, and hand you a finished MP4.

## What it does

- **Records the desktop** (a display, one window, or a region you drag out) with `gpu-screen-recorder`, so it's fast and light even at 60 fps.
- **Records a browser** that's a copy of your own, logins included. The mouse glides and text gets typed at human speed, so the video doesn't look like a bot made it.
- **Records a terminal** running your real shell, with a `--blur` option that hides API keys and other secrets.
- **Edits automatically**: cuts idle stretches, zooms in on clicks, and draws a smooth cursor with a click ripple.
- **Narrates** with Kokoro neural voices, and transcribes speech with Whisper for captions.
- **Builds films**: a `film.json` lists scenes (recordings, titles, images, stats, charts, line graphs, slides, before/after comparisons, your own React components) and the narrator's lines. Flikka times everything to the voice, adds captions and music, and checks the result for problems like frozen frames or music drowning out the voice.
- **Takes framed screenshots** with a nice backdrop, copied straight to your clipboard.
- **Has a local review panel** where you can watch projects, flip switches like click sounds or zoom, and re-render.

## Requirements

- Linux on x86_64 (developed on Arch and CachyOS, Wayland, PipeWire)
- Node.js 22 or newer
- `gpu-screen-recorder` for screen, window and region recording
- A Chromium-family browser (Chrome, Chromium, Brave, Edge or Vivaldi) for browser recordings

Flikka downloads a few things by itself the first time it needs them: ffmpeg and `uv` if you don't have them, the DeepFilterNet noise remover, and a headless Chrome for rendering (about 100 MB, into `~/.cache/hyperframes`). The first narration also sets up a Python environment with Kokoro, Whisper and PyTorch through `uv`, which is a few GB, so give that one a minute. Narration and transcription use your NVIDIA GPU through CUDA when it's there.

You don't have to figure out what's missing by hand, though. Once Flikka is installed, `flikka doctor` checks everything and prints the exact install command for your distro.

## Installation

### Arch Linux (AUR)

```bash
paru -S flikka
```

Or `yay -S flikka`. This pulls in ffmpeg, `uv`, `gpu-screen-recorder` and the rest as normal dependencies, and installs the app launcher system-wide.

### npm

```bash
npm install -g @pinkpixel/flikka
```

### From source

```bash
git clone https://github.com/pinkpixel-dev/flikka.git
cd flikka
npm install
node flikka app install
```

From a clone, `app install` also links the `flikka` command into `~/.local/bin`.

### After installing

Set up the desktop launcher (npm and source installs) and the agent skill:

```bash
flikka app install
```

Then check your system:

```bash
flikka doctor
```

It lists every tool Flikka uses, what each one is for, and whether it's there. Anything Flikka downloads by itself shows as "downloads on first use", and anything you need to install comes with a ready-to-paste `pacman`, `apt` or `dnf` command.

## Quick start

### Record a browser session

```bash
flikka record browser https://example.com --name signup-flow
flikka record look
flikka record click 3
flikka record type 1 "hello@example.com"
flikka record stop
```

`look` lists the page's buttons, links and fields with numbers, and `click` and `type` take those numbers (or visible text, or a CSS selector). `stop` prints the new project's id, something like `3f9a1c2e`.

### Record the screen, a window or a region

```bash
flikka record screen
flikka record window
flikka record region
flikka record stop
```

On Wayland, `window` lets you pick a window through your desktop's own picker, and `region` without coordinates lets you drag out an area with `slurp`. `flikka record sources` lists displays, microphones and cameras. Add `--mic default`, `--system-audio` or `--camera default` to record those too.

### Record a terminal

```bash
flikka record terminal --blur 'sk-[A-Za-z0-9]+'
flikka record run "npm test"
flikka record stop
```

### Render it

```bash
flikka project render 3f9a1c2e
```

The finished video lands in `~/Documents/flikka/`. Videos are square (1080×1080) by default, which looks good almost everywhere.

### Open the panel

```bash
flikka app panel
```

Or launch Flikka from your app menu. The panel shows every project, a live preview of the edit, and switches for the microphone, system audio, camera bubble, click sounds, zooms and the cursor overlay.

## Editing a recording

Edits are flags on `flikka project edit`, and you can combine several in one call:

```bash
flikka project edit 3f9a1c2e --cut-silence --speed 1.5 --background sunset --preset vertical
flikka project render 3f9a1c2e
```

Some useful ones:

| Flag | What it does |
|---|---|
| `--cut-idle`, `--cut-silence` | Cut still stretches, or pauses in speech |
| `--cut start,end` | Cut a range (in the recording's own seconds) |
| `--trim start,end` | Keep only that range |
| `--speed 1.5` or `--speed 2,start,end` | Speed up the whole video or one part |
| `--ramp 0.5` | Ease between speeds over half a second instead of jumping (`--ramp off` to jump) |
| `--freeze at,seconds` | Hold one moment as a still, in silence, so the viewer can read it |
| `--auto-zoom`, `--zooms on\|off` | Zoom in on clicks, and on the field you're typing in |
| `--zoom start,end,x,y[,scale]` | Zoom in on a spot yourself (x and y from 0 to 1) |
| `--crop x,y,w,h` | Show only part of the recording (fractions, or pixels of the recording). `--crop off` undoes it |
| `--spotlight start,end,x,y,w,h` | Dim everything except one area for a while |
| `--callout start,end,x,y,"text"` | A label pointing at a spot. `--step` does the same with a number, counted in time order |
| `--arrow start,end,x,y,x2,y2`, `--box start,end,x,y,w,h` | Draw an arrow, or a highlight box around something |
| `--redact start,end,x,y,w,h[,solid]` | Blur an area after recording, or cover it with `solid`. `all` instead of start,end covers the whole video |
| `--keystrokes on` | Show shortcuts (Ctrl+S, Enter and so on) in a corner as they're pressed |
| `--intro "text"`, `--outro "4,text"` | A title card before or after the recording (2.5 s unless you give the seconds) |
| `--transition fade` | A transition at every cut instead of a hard jump: `fade`, `wipe`, `slide` or `zoom`. The video's length doesn't change |
| `--music on` or `--music song.mp3` | Background music, ducked under the voice. `--music-volume` from 0.1 to 4 |
| `--cursor on\|off`, `--clicks on\|off` | The drawn cursor and the click sound |
| `--preset vertical\|portrait\|square\|landscape` | Output shape. Tall videos follow the cursor |
| `--background aurora\|sunset\|ocean\|meadow\|graphite\|midnight` | The backdrop behind the window |
| `--camera round=on,size=0.22,position=bottom-right` | The webcam bubble |

`flikka project help` lists them all.

### Editing by the time in the video

Times like "cut the part at 1:20" usually mean the finished video, which has already been cut and sped up. Flikka can show you that timeline and take edits in it directly:

```bash
flikka project timeline 3f9a1c2e
flikka project frames 3f9a1c2e --at 1:18,1:20,1:22
flikka project edit 3f9a1c2e --output-time --cut 1:20,1:25 --dry-run
flikka project edit 3f9a1c2e --output-time --cut 1:20,1:25
flikka project undo 3f9a1c2e
```

`--trim`, `--freeze` and `--speed` all take `--output-time` too. `timeline` lists the kept parts, freezes, speed ramps, cuts, zooms, clicks and spoken words in video time. `frames` shows those moments, stamped with both the video time and the recording time. `--dry-run` tells you how the length would change without saving anything, and `undo` steps back through earlier edits (Flikka keeps up to 50).

## Sharing it

Once a video is rendered, Flikka can make other files from it without rendering again:

```bash
flikka project export 3f9a1c2e --format gif --from 0:03 --to 0:09
flikka project export 3f9a1c2e --format webm
flikka project poster 3f9a1c2e
```

`export` makes a GIF (800 px wide and 15 fps unless you pass `--width` and `--fps`) or a WebM, and works for films too. `poster` saves a still for a thumbnail, a little past the intro unless you give `--at`.

A recording can also come out in other shapes, or with no backdrop at all, without changing the project:

```bash
flikka project render 3f9a1c2e --presets square,vertical,landscape
flikka project render 3f9a1c2e --transparent
```

`--transparent` makes a WebM with an alpha channel (or `--transparent mov` for ProRes 4444, for video editors), with only the window, cursor and overlays, so you can layer it over something else.

To add chapters, use `--chapter` with a moment and a title. Labelled `record mark` markers count too:

```bash
flikka project edit 3f9a1c2e --output-time --chapter "0:30,Sign in"
```

Chapters go into the video file, and also into a `.chapters.txt` list next to it that you can paste into a YouTube description.

## Making a film

A film is a project made of scenes, narrated by a voice. Start one, optionally with recordings you already have:

```bash
flikka project new launch --with signup-flow
```

That creates a `film.json` to fill in. Here's a small one:

```json
{
  "voice": {"name": "af_heart"},
  "scenes": [
    {"type": "title", "title": "Meet [Flikka]", "subtitle": "Screen recording for AI agents", "say": "Meet Flikka."},
    {"type": "recording", "recording": "signup-flow", "say": "Here's the signup flow, recorded by an agent."},
    {"type": "stats", "title": "Faster renders", "stats": [{"value": "60 fps", "label": "Capture"}], "say": "It records at sixty frames a second."}
  ]
}
```

In titles, `[words in brackets]` use the accent color and `*words in stars*` are muted. Each scene lasts as long as its narration needs. Add `"transition": "slide"` (or `wipe`, `zoom`, `fade`) to change how scenes come in.

```bash
flikka project schema       # every film.json field, described
flikka project styles       # built-in looks (add your own in ~/.flikka/styles)
flikka project preview launch
flikka project live launch
flikka project render launch
```

`preview` gives you one picture per scene plus a layout check, which is quick. `live` plays the film in your browser and reloads every time you save `film.json`. `render` makes the video and then checks it for frozen frames, music too loud under the voice, captions too fast to read, and words a listener might mishear. Every issue comes with a timestamp and a frame to look at.

## Voices

```bash
flikka voice list
flikka voice say af_heart "Testing one two three" --out test.wav
```

A film picks its narrator with `"voice": {"name": "..."}`. The default is `af_heart`, one of Kokoro's built-in voices.

## Screenshots

```bash
flikka shot
```

Pick an area or a window and Flikka frames it on a backdrop, saves it to `~/Documents/flikka/shots`, and copies it to your clipboard. `--background`, `--plain` and `--from file.png` change how it's made.

## Using it with AI agents

`flikka app install` puts a Flikka skill where agents look for them:

- `~/.claude/skills/flikka` for Claude Code
- `~/.codex/skills/flikka` for Codex
- `~/.agents/skills/flikka` for Gemini CLI and other agents that read the shared `.agents` folder

After that, you can just ask your agent to "record yourself signing up on example.com" or "make a launch video from project 3f9a1c2e". The built-in help (`flikka help`, `flikka record help`, and so on) is written for agents too, with rules like "look before you click" and "never type passwords".

## Where things live

| What | Where |
|---|---|
| Projects | `~/.flikka/projects/<id>/` |
| Finished videos | `~/Documents/flikka/` |
| Screenshots | `~/Documents/flikka/shots/` |
| Your voices and styles | `~/.flikka/voices/`, `~/.flikka/styles/` |
| Downloaded tools | `~/.flikka/bin/` |
| Anything Flikka can rebuild | `~/.cache/flikka/` |
| Activity log | `~/.flikka/trace.log` |

`FLIKKA_DIR` changes where finished videos go, and `FLIKKA_PROJECTS` moves the projects folder.

## Updating and uninstalling

Update the same way you installed:

```bash
paru -Syu flikka
npm install -g @pinkpixel/flikka@latest
```

From a git clone, `flikka app update` pulls and reinstalls for you. After any update, run `flikka app install` once more to refresh the agent skills.

To remove the launcher and skills (your projects and videos stay):

```bash
flikka app uninstall
```

## Troubleshooting

- Run `flikka doctor` first. Most problems are a missing tool.
- Every Flikka process writes what it's doing, with timings, to `~/.flikka/trace.log`. Watching it while something runs usually shows where it's stuck:

  ```bash
  tail -f ~/.flikka/trace.log
  ```

- A covered window stops updating in window recordings, so keep it visible. Browser recordings don't have this problem.
- To hide a password or API key after recording, use `--redact ...,solid`. Strong blur is usually fine for names and emails, but blurred text can sometimes be partly recovered.

## How it's built

Flikka is Node.js all the way down, with a little Python for the voice models. Videos are rendered with [HyperFrames](https://github.com/heygen-com/hyperframes): each edit becomes a small web page drawn by React, and HyperFrames captures it frame by frame in a headless Chrome. Flikka mixes the sound itself with ffmpeg.

## License

Apache 2.0. See [LICENSE](LICENSE).

---

Made with 💖 by [Pink Pixel](https://pinkpixel.dev) · [GitHub](https://github.com/pinkpixel-dev) · [Buy me a coffee](https://www.buymeacoffee.com/pinkpixel) · [Ko-fi](https://ko-fi.com/sizzlebop)
