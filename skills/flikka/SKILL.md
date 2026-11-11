---
name: flikka
description: The Linux CLI for screen recording, autonomous browser demos, video editing, voice narration, and video generation. Use when the user asks to "record yourself doing X", "make a demo or launch video", "record the screen", "edit recording", "add voice narration", "render a video", or references a Flikka project ID.
---

# Flikka

Flikka gives coding agents and developers a CLI to record screens, browsers and terminals, script realistic browser actions, auto-edit zooms and cuts, narrate in neural or cloned voices, and render videos natively on Linux.

Every command prints structured JSON to stdout. A failure prints `{"error": "…"}` and exits with 1.

## Start with the help

The built-in help is the full reference, and it's written for agents. Read it when you need an option this skill doesn't cover.

```bash
flikka help                      # every command and action, one line each
flikka record help               # a command's actions with their usage, plus its rules and an example
flikka project edit help         # one action in full: usage, options, examples (--help and -h work too)
flikka help voice add            # the same page, asked the other way round
```

## Commands at a Glance

**Record** (`flikka record …`)

| Command | Purpose |
|---|---|
| `browser [url]` | The flikka browser: a copy of the user's browser with their logins, recorded inside the page, so it records fine while covered. The best way for an agent to record itself |
| `terminal` | The user's own shell in the flikka browser, driven with `run` and `send` |
| `screen [index]`, `window [id]`, `region [x,y,w,h]` | A whole display, one window (the Wayland portal asks which), or part of a display (drag one with slurp if no area is given) |
| `sources` | Displays, windows, microphones and cameras |
| `stop`, `pause`, `resume`, `status` | Control the running recording. `stop` saves it and prints the project id |
| `mark <label> [--at x,y]` | A moment to zoom on (browser clicks mark themselves) |
| `open <url>`, `look`, `click`, `type`, `paste`, `key`, `wait`, `scroll`, `hover`, `drag`, `select`, `upload`, `go`, `back`, `forward`, `tabs`, `switch`, `shot`, `mask`, `eval` | Act in the flikka browser, with or without recording |
| `open terminal`, `run "<command>"`, `send "text"`, `close terminal` | Act in the terminal |

**Project** (`flikka project …`)

| Command | Purpose |
|---|---|
| `list`, `show <id>`, `rename <id> <name>`, `remove <id>` | Every project, one project's files, a new name, or the Trash (remove only when the user asks) |
| `edit <id> [options]` | A recording: cuts, zooms, speed, framing, annotations, narration, music |
| `timeline <id>` | What happens in the finished video, in its own seconds: kept parts, cuts, zooms, clicks, speech, narration lines |
| `frames <id> --at 3,1:20` | Labelled frames of the edit in one picture, each stamped with video time and recording time |
| `preview <id> [--frame n]` | A recording: one frame. A film: a picture per scene and a layout check |
| `render <id> [--out file]` | The finished video, checked. It goes to the videos folder as `<name>-<id>.mp4` |
| `undo <id>` | Back to before the last saved edit (for films: the last save) |
| `speak`, `fit`, `check` | Narration without a render: speak lines, fit them to their time, check for misheard words |
| `captions <id>` | A transcript with word times, when someone talks in a recording |
| `export`, `poster` | A GIF or WebM, or a still, from the finished video |
| `new <name> [--with ids]`, `schema`, `styles`, `live <id>` | Films: create one, read every film.json field, list the looks, open it in the panel |

**Other**

| Command | Purpose |
|---|---|
| `flikka shot` | A framed screenshot of an area or window, saved and copied (`list`, `copy`, `remove`) |
| `flikka voice list \| say \| add \| remove \| setup \| cuda` | Kokoro's voices and the user's own (see Voices below) |
| `flikka app panel` | The review panel: projects, screenshots, voices, settings |
| `flikka app config [set <key> <value> \| unset <key>]` | Every setting, its value and where it came from |
| `flikka app doctor` | Checks the system tools flikka needs and prints the command that installs anything missing (`flikka doctor` works too) |
| `flikka app skills`, `install`, `update`, `uninstall` | Agent skills, desktop entry and links |

## Autonomous Browser Recording Workflow

When asked to record a demo of a website or web app, follow this loop:

### 1. Start the recording session

```bash
flikka record browser https://example.com --name demo
```

This starts a background worker and returns a project ID (for example, `1b2bf8de`). The flikka browser starts with the user's logins. When a site still asks to log in, ask the user to log in in the flikka browser's window. Never type a password yourself. The flikka browser keeps the login, and `flikka record open <url> --refresh-login` copies the user's logins again.

To keep secrets out of the video, add `--hide <text>` (hides the row holding it) and `--blur <regex>` when starting. Both repeat. Before a screenshot, `flikka record mask --hide … --blur …` does the same on the current page.

### 2. Inspect and interact like a person

Viewers can immediately tell when an agent snaps or evaluates directly into the DOM. Use Flikka's humanized actions:

```bash
# 1. Inspect elements and their numeric targets
flikka record look

# 2. Click elements by target number, text, or CSS selector
flikka record click 1

# 3. Type into fields with natural typing rhythm (short text), or paste long text at once
flikka record type 11 "Arch Linux"
flikka record paste 12 "A longer message\nwith two lines"
flikka record key Enter

# 4. Wait for elements instead of using arbitrary sleep
flikka record wait "Search results"
flikka record wait ".spinner" --gone --timeout 30

# 5. Smooth scroll down the page
flikka record scroll 300
```

Also available: `hover <target>`, `drag <from> <to>`, `select <target> <option>` (a dropdown), `upload <file> [<target>]` (sets the file without a file dialog), `go <url>`, `back`, `forward`, `tabs` and `switch <tab>`, and `shot page.png`. Numbers from `look` expire when the page changes, so look again after anything that loads. Give the viewer a beat (`sleep 1`) after each result. `eval` exists for reading the page, never for acting in a recording.

For a one-step capture: `flikka record browser <url> --run "<js trigger>" --for 8` runs the trigger, records 8 seconds, stops, and returns the saved recording.

### 3. Stop and finalize

```bash
flikka record stop
```

Stopping writes `recording.mp4`, generates `recording.project.json`, trims idle pauses, and calculates camera zooms on click targets.

### 4. Preview and render

```bash
# Preview a single frame
flikka project preview <id>

# Render the final MP4 into the videos folder
flikka project render <id>
```

## Terminal Recording Workflow

To show a CLI or an install, record the user's own shell inside the flikka browser:

```bash
flikka record terminal --cwd ~/code/app --name install --blur "sk-[A-Za-z0-9]+"
flikka record run "npm install"                  # typed key by key; waits, returns output and exit code
flikka record run "npm test" --timeout 300       # Ctrl-C after 300 s (120 by default)
flikka record send "y\n"                         # answer a prompt without waiting
flikka record stop
flikka record close terminal
```

`--color 'word=#5bb0ff,#22d3c5'` paints a word (a brand name) in one color or a gradient, and `--title` and `--font-size` set the window. Terminal recordings keep their pauses (they're reading time) and have typing sounds on. Pass API keys through the environment, never type them, and blur anything that might print one.

## Desktop Screen Recording Workflow

Flikka records the physical Linux desktop display using `gpu-screen-recorder` with hardware NVENC acceleration and PipeWire audio.

```bash
# 1. List available displays, mics, and webcams
flikka record sources

# 2. Record full display for a fixed duration
flikka record screen --for 10 --name desktop-flow

# 3. Record an individual window via Wayland portal (keep it visible: a covered window stops updating)
flikka record window --name window-demo

# 4. Record an interactive region (drag crosshairs with slurp, or pass x,y,w,h)
flikka record region --name region-demo
flikka record region 100,100,800,600 --name fixed-box

# 5. Stop the recording (pause and resume make new parts of the same recording)
flikka record stop

# 6. Render the project
flikka project render <id>
```

Options that work with every recording: `--mic <name|default>`, `--system-audio`, `--camera <name|default>` (not for the browser), `--fps 24|30|60`, `--countdown <s>`, `--no-zoom`, `--max-width <px>` and `--native-cursor`.

`--no-cursor` starts with the mouse cursor hidden. A whole display or a window on Wayland logs the pointer instead of baking it in (when `flikka-cursor` is installed and the portal supports it; windows need 0.2.0 or newer), so `flikka project edit <id> --cursor on|off` can show or hide it later; check `cursorBaked` in the project. A window recording asks the user to pick the window twice (the recording, then the pointer): tell them to pick the same one. A region recorded with `--no-cursor` has no pointer at all. Screen and window recordings show the real screen, so anything on it ends up in the video.

## Multi-Scene Films with Voice Narration

Flikka can assemble multiple scenes (recordings, titles, pictures, numbers) into a single produced film with synchronized neural TTS narration and background music.

```bash
# 1. Create a new film project (--with starts it with those recordings as scenes)
flikka project new product-launch --with 1b2bf8de

# 2. Read the schema, then edit film.json in the project folder
flikka project schema
# "scenes": [
#   {"type": "title", "title": "Introducing Flikka", "say": "Meet Flikka for Linux."},
#   {"type": "recording", "source": "demo.mp4", "say": "Record yourself effortlessly."}
# ]

# 3. Preview frames (or open it in the panel for the user: flikka project live product-launch)
flikka project preview product-launch

# 4. Render and check
flikka project render product-launch
```

The schema is the reference: unknown fields are errors with a "did you mean". `flikka project styles` lists the looks (the user's own live in `~/.flikka/styles`). In text, `*muted words*` render grey and `[accent words]` in the accent color. Write `say` as plain spoken sentences, numbers spelled the way they're read. Loop on preview (about 20 s), then render, and always read the check at the end of a render: each issue has a time, a scene and a frame to look at. Fix and render again until it's empty. `flikka project frames <id> --scene 3` shows one scene's frames.

Available Kokoro neural voices include `af_heart`, `af_bella`, `af_nicole`, `am_michael`, `bf_emma`, and `bm_george`. List all 54 with `flikka voice list`. The first letter is the language the voice reads in (`a` American, `b` British, `e` Spanish, `f` French, `h` Hindi, `i` Italian, `p` Brazilian Portuguese, `j` Japanese, `z` Mandarin), so write the narration in that language. English voices are much better than the rest. Japanese needs `flikka voice setup japanese` once. The user's own voices show in `flikka voice list` with `"own": true` and are used by their name, like `"voice": {"name": "My voice"}` or `--narrator "My voice"`. They speak English only, and the first line takes about 15 s longer while the model loads. Captions and the check follow the voice's language; for Japanese and Chinese the check can't compare words, so its `checkNotes` ask you to listen to the narration instead.

A scene's `say` can also be a list, to give one sentence its own voice or speed: `"say": ["First, open the settings.", {"text": "Then save it.", "voice": "bf_emma", "speed": 1.1}]`. Plain strings in the list read in the film's voice. Say-as marks like `[Flikka](Flick-uh)` and `/phonemes/` in `voice.pronounce` work in films too. Without rendering, `flikka project speak <id>` speaks the sentences not spoken yet (`--scene 2 --sentence 1 --again` speaks one anew), and `flikka project check <id> --lines` lists words a listener may mishear in the spoken sentences, scene by scene. A plain `flikka project check <id>` still checks the last render.

## Editing by What the Viewer Sees

Times a user mentions ("cut the part at 1:20") are in the finished video, not the raw recording. Don't convert them by hand:

```bash
flikka project timeline <id>                                     # parts, cuts, zooms, clicks and speech in video time
flikka project frames <id> --at 1:18,1:20,1:22                   # look at the moments before changing them
flikka project edit <id> --output-time --cut 1:20,1:25 --dry-run # what would change: durations before and after
flikka project edit <id> --output-time --cut 1:20,1:25           # do it
flikka project undo <id>                                         # changed your mind
```

The same works for `--trim start,end` (keep only that), `--freeze at,seconds` (hold a moment as a silent still) and `--speed 2,start,end`. Add `--ramp 0.5` to ease between speeds instead of jumping. `--cut-idle` and `--cut-silence` take out still moments and pauses in speech, and `--reset` puts every cut back. For framing: `--crop x,y,w,h` shows only part of the recording, `--zoom start,end,x,y[,scale]` zooms in on a spot (`--unzoom at` removes the one showing at that moment, and `--zooms clicks|typing` keeps the automatic zooms to one kind of moment), and `--spotlight start,end,x,y,w,h` dims everything else for a while. Positions are 0 to 1 of the whole recording (a crop also takes pixels), and the times take `--output-time` like the rest. Look at `flikka project frames` first to pick the spot.

To explain what's happening on screen: `--step start,end,x,y,"text"` (numbered automatically in time order), `--callout start,end,x,y,"text"`, `--arrow start,end,x,y,x2,y2` and `--box start,end,x,y,w,h`. Quote text that has spaces. `--keystrokes on` shows shortcuts as they're pressed (recordings only log shortcuts and named keys, never typed text). To hide something after recording, use `--redact start,end,x,y,w,h,solid`, or `all,x,y,w,h,solid` for the whole video. Always use `solid` for passwords, keys and tokens, since blurred text can sometimes be recovered.

For free-placed overlays, add layers: `--layer text,2,8,0.05,0.85,0.9,0.1,Hello there` (also `image` or `video` with a file, which Flikka copies into the project, and `solid` with a CSS color; `all` instead of start,end covers the whole recording). Boxes are shares of the finished video, so they don't move with zooms, and start and end stick to recording moments like narration. Each gets an id (`l1`, `l2`, …). Change one with `--layer-set l1,opacity=0.8,size=0.04,align=left,order=front`, animate it with `--keyframe l1,0,opacity=0` then `--keyframe l1,0.5,opacity=1,ease=ease-out` (`ease=` alone resets a keyframe's easing) (at is seconds after it appears; x, y, w, h, opacity and rotation animate), (setting x, y, w, h or rotation on an animated layer moves its keyframes along with it), and remove things with `--unkeyframe l1,0`, `--unlayer l1` or `--layers off`. Films take the same layers as a scene's `"layers"` list in film.json (start and end in seconds from the scene's start, see `flikka project schema`). Video layers are muted and loop.

For a finished feel: `--intro "text"` and `--outro "seconds,text"` add title cards, `--transition fade|wipe|slide|zoom` adds a transition at every cut (films take `"transition"` in film.json), and `--music on` (or `--music <file>`) adds a bed that ducks under the voice (`--music-volume` from 0.1 to 4). An intro shifts every video time by its length, so re-read `flikka project timeline` after adding one.

To change how the video frames the recording: `--preset square|landscape|portrait|vertical` sets the shape (videos are square, 1080×1080, by default), `--background aurora|sunset|ocean|meadow|graphite|midnight` (or any CSS background) sets the wallpaper, `--padding 64` and `--radius 20` set the margin and corner rounding in video pixels, `--shadow on|off` toggles the shadow under the recording, and `--camera round=on,size=0.22,position=bottom-right` places the webcam bubble. `--mic`, `--system-audio`, `--webcam`, `--clicks` and `--keys` (typing sounds) each take `on|off`.

## Narrating a Recording

A recording can have a Kokoro voice (or one of the user's own) talking over it, with captions. Each line is pinned to a moment of the recording, so when you cut or speed things up later, the line moves along with what it talks about.

```bash
flikka project edit <id> --output-time --say "0:02,First, open the settings." --say "next,Then switch on sync."
flikka project edit <id> --output-time --line "n2,until=0:09"   # it should finish by then
flikka project render <id>                                       # report.narration: where every line landed
flikka project edit <id> --reword "n2,Then turn on sync."        # too long? say less
```

`--say next,"text"` starts a line right after the one before it. `flikka project timeline` lists every line with its id, and `--line id,key=value` changes one: `at`, `until`, `voice`, `speed`, `trim-start`, `trim-end`, `fade-in`, `fade-out`, `gain` (dB) and `mute`. Moving a line with `at` keeps the lines in time order, and lines that follow it (`at: null`) move with it. `--unsay n2` removes a line (`--unsay all` removes every one). `--narrator bf_emma` picks the voice for every line that doesn't choose its own, and `--pronounce "Memlake=Mem-lake"` fixes how a word is said without changing the captions. `--split n2,"then save"` cuts a line in two before those words (or at a character position), and `--merge n3` joins a line onto the one before it. To change how one word is said in one place, `--say-as n2,"read=red"` (sounds like) or `--say-as n2,"GIF=/ʤˈɪf/"` (exact Misaki phonemes, Kokoro voices only) writes a say-as mark like `[GIF](/ʤˈɪf/)` into the line, and `--say-as n2,"GIF="` takes it off. You can also write marks straight into `--say` and `--reword` text. `--pronounce` takes `/phonemes/` too, for every line. Captions always show the plain word. `flikka project speak <id>` speaks the lines that aren't spoken yet without rendering (`--line n2 --again` speaks one anew), so `flikka project timeline` can show where they end before you render.

Read `narration` in the render result before finishing. A line with `overrun` is longer than its `until` allows: run `flikka project fit <id>` to speed it up just enough (up to 1.3×), and if it's still over, rewrite it in about `shortenTo` words with `--reword`, then `flikka project speak` and check the timeline again. The user may also paste you a Shorten prompt from the panel asking exactly that. `flikka project check <id>` listens to each spoken line with Whisper (no render needed) and lists `misheard` words per line, and the timeline marks checked lines the same way. Fix one with `--say-as`, speak the line again, and check again. When you're not sure a respelling will sound right, hear it first with `flikka voice say <the line's voice> "Open the [GIF](/ʤˈɪf/) folder" --speed <its speed>` (`timeline` shows each line's voice and speed). A name Whisper merely spells differently (Flikka heard as "Flicka") can be fine: listen before changing it. Also: `overlaps` means it starts before the line before it ends, `runsPast` means it goes past the end of the recording, and `snapped` means its moment was cut, so it starts where the video picks up again. The recording's own sound dips while a line plays (`--duck off` to stop that), and narration captions replace the mic's captions.

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

## Screenshots

```bash
flikka shot                                          # the user picks an area or a window: framed, saved, copied
flikka record shot page.png                          # an agent's own, from the flikka browser
flikka shot --from page.png --no-copy                # frame it like the others
flikka shot list
```

`--background <name|css>` picks the backdrop and `--plain` skips the frame. Screenshots go to the screenshots folder (`flikka app config` shows where). Remove one only when the user asks.

## Voices

```bash
flikka voice list                                    # Kokoro's (with grades, A is best), then the user's own
flikka voice say af_heart "Hello there" --out hi.wav # hear one (--speed 1.1, say-as marks work too)
flikka voice cuda                                    # whether the user's own voices run on CUDA
```

The user's own voices come from `flikka voice add <name> --consent [--from file]`, which records them reading a short text (or reads a file) and keeps 10 clean seconds. `--consent` confirms it's their voice or one they may use. Never add or remove one of the user's voices unless they asked, and never run `flikka voice cuda install` (a 183 MB download that needs CUDA 13 and cuDNN 9) unless they asked. The first time one of their voices speaks, Flikka downloads its helper (about 15 MB) and a 550 MB model, and it needs glibc 2.38 or newer.

## The Panel and Settings

The user watches everything in the panel (`flikka app panel`) and names projects by id ("edit project 3f9a1c2e: …"). Films open there live with `flikka project live <id>`. The panel and an agent can edit the same project; the panel refuses an edit made against an older file and reloads, so there's no need to coordinate.

Projects live in `~/.flikka/projects/<id>/`, finished videos in the videos folder (`~/Videos/flikka` unless the user moved it). `flikka app config` shows every folder and setting; change one with `flikka app config set <key> <value>` only when the user asks. Environment variables win over the settings file for one run: `FLIKKA_VIDEOS`, `FLIKKA_PROJECTS`, `FLIKKA_VOICES`, `FLIKKA_DEFAULT_VOICE` and the rest (`flikka app config help` lists them). Every flikka process logs what it does, with times, to `~/.flikka/trace.log`, which is the first place to look when something is slow or fails.

## Agent Guidelines

- Look before acting: Run `flikka record look` first to obtain accurate numeric targets for clicks and typing.
- Avoid raw DOM evaluations for recorded interactions: Use `click`, `type`, `paste` and `scroll` so the mouse cursor moves smoothly across frames.
- Record yourself in the flikka browser (`record browser`), never the user's own browser, and never type a password: ask the user to log in.
- Guard secrets: Use `--hide <text>` and `--blur <regex>` when launching recordings to keep API keys and tokens out of video frames, and `--redact …,solid` after the fact.
- Edit in video time: read `flikka project timeline` and use `--output-time` instead of converting times by hand. Try big edits with `--dry-run` first.
- Test renders take `--out <file>`, so the user's finished video isn't replaced.
- Verify before finishing: look at 2 or 3 frames of the result (`flikka project frames`, which shows narration captions only for lines already spoken: its `narration` counts them, so run `flikka project speak` first), and when someone talked, check the sound (`ffmpeg -i <video> -vn -af volumedetect -f null -`, with `mean_volume` well above -60 dB). Then report the video's path.
