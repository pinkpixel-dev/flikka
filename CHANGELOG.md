# Changelog

## 0.3.0 - Unreleased

### 🤖 Agent tools
- `flikka project timeline <id>` lists what happens in the finished video, in its own seconds: kept parts, cuts, zooms, clicks and spoken words.
- `flikka project edit --output-time` takes times in the finished video (seconds or `m:ss`), so "cut 1:20 to 1:25" needs no converting.
- `flikka project edit --dry-run` shows what an edit would change, with the video length before and after, without saving.
- `flikka project undo <id>` steps back through earlier edits. Every saved edit keeps the previous version in `history/`, up to 50.
- `flikka project frames <id>` now works for recordings too, with each frame stamped with the video time and the recording time.
- `--cut` and `--speed` ranges accept `m:ss` as well as seconds.

### ✂️ Cutting and timing
- `--trim start,end` keeps only that part of a recording.
- `--freeze at,seconds` holds one moment as a still (the cursor stays where it was, the sound goes quiet), so viewers can read a result.
- `--ramp 0.2–2` eases between speeds in short steps instead of jumping, in the picture, the cursor and the sound alike. `--ramp off` goes back to hard jumps.
- `flikka project timeline` shows freezes and speed ramps.

### 🔍 Framing
- `--crop x,y,w,h` shows only part of a recording, given as fractions or as pixels of the recording. Zooms, the cursor, spotlights, vertical follow and film scenes all respect it.
- `--zoom start,end,x,y[,scale]` adds a zoom from the CLI and replaces any zoom it overlaps.
- `--spotlight start,end,x,y,w,h` dims everything except one area, fading in and out.
- `--auto-zoom` now zooms on typing too: three or more key presses in a row zoom in on the field being typed in, until a second after the last key. Browser and terminal recordings now log where typing goes, so this works on new recordings.
- `flikka project timeline` shows the crop and spotlights.

### 🧪 Tests
- First automated tests (`npm test`): the time mapping between the recording and the finished video, freezes and speed ramps, and edit, timeline and undo on a real project file.

## 0.2.1 - October 31, 2026

### 🎨 Branding
- New app icon (`assets/flikka.png`, 512×512). `flikka app install` and the AUR package install it to `hicolor/512x512/apps`.

### 📦 Packaging
- Flikka is on the AUR as `flikka`. The `PKGBUILD` lives in `packaging/aur/` and installs the npm package.
- The npm package now includes `assets/`.

### 📝 Docs
- README rewritten for npm and AUR installs, with a quick start, editing flags, films, voices, agent setup, file locations and troubleshooting.

## 0.2.0 - October 31, 2026

### 🎬 Rendering
- Videos and films render with HyperFrames (Apache 2.0) instead of Remotion, so there's no company license requirement. Renders are faster and dependencies are about 156 MB instead of 554 MB.
- The first render downloads a headless Chrome into `~/.cache/hyperframes` if none is there or in `~/.cache/puppeteer`.
- Custom film scenes import everything from `"flikka"`, which now includes `AbsoluteFill`, `Sequence`, `Img`, `Video`, `Audio`, `useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring` and `Easing`.

### 🛠️ Install and setup
- Published to npm as `@pinkpixel/flikka`.
- New `flikka doctor` checks the system tools Flikka uses and prints the `pacman`, `apt` or `dnf` command for anything missing.
- `flikka app install` installs the agent skill for Claude Code, Codex and `~/.agents/skills`: linked from a git clone, copied from a package.
- `flikka app update` pulls from git in a clone, and otherwise prints the npm or AUR update command.
- Flikka only writes to `~/.cache/flikka`, never its own install folder.

### 🖥️ Linux desktop
- Web panel on Linux: `xdg-open`/`gio` for links and folders, `wl-copy`/`xclip` for copying videos.
- Window recording through the Wayland portal, and region recording with `slurp`.
- Hide the cursor at capture time (`--no-cursor`) or toggle the cursor overlay afterwards (`--cursor on|off`).
- Built-in dark film style.

### 🐛 Fixes
- Auto-zoom no longer fails on clicks near the bottom edge of the page.
- The film live editor opens with `xdg-open` instead of the macOS `open` command.
- The local asset server ignores query strings, so cache-busted preview links load.
- Published installs work: the bundle cache no longer needs `package-lock.json`, and copied skills stay writable.
