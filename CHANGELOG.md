# Changelog

## 0.4.0 - Unreleased

### 🎬 Panel
- The panel is now a dark, full-window app built in React. Projects stay in the sidebar, and a project's page puts the video front and center with its edits on the right.
- One player handles both the exported video and the live preview, and it stays on the same moment when you switch between them or an edit reloads the preview.
- Step through frame by frame with the buttons or the arrow keys. Space plays and pauses, Shift plus an arrow jumps a second, and M mutes.
- A timeline under the player shows the kept clips, cuts, zooms, spotlights, overlays, clicks, markers and spoken lines. Click or drag on it to scrub.
- Every button, menu and field has a tooltip, on hover and on keyboard focus.
- Edit right on the timeline: drag across the clips to cut a part, drag on the Camera row to add a zoom, drag a zoom to move it or its edges to resize it, and click one to change its scale or remove it. Edges snap to the playhead, clip edges and whole frames.
- Undo button and Ctrl+Z for the last edit.
- Pick which moments get a zoom: click a click or a typing burst on the timeline (or press Z near one) and choose Zoom here.
- Aim a zoom on the recording itself: choose a zoom, press the crosshair (or A), then click or drag the frame to where it should look and pick how close it gets.
- The zoom switch is now an Auto zoom picker: clicks and typing, just clicks, just typing, or off.
- Zooms work from the keyboard too: with the timeline focused, `[` and `]` jump to the previous or next zoom and choose it, and Enter chooses the one under the playhead. Then A aims it, Delete removes it and Esc lets go.
- A Frame section in the edit column: pick the video's shape (square, landscape, portrait or vertical), the wallpaper behind the recording, the padding around it, how round its corners are, and whether it has a shadow. The live preview updates after each change, and Ctrl+Z undoes it. A run of arrow-key presses on a slider saves as one edit.
- Films have a home in the panel now. The live film plays with its narration and music, and a strip under the player shows every scene, as wide as it is long. Click a scene to open it and jump there, drag it (or press Alt+← →) to move it, and add a new one from the Add menu. The open scene's fields sit on the right, drawn from the film schema, with each field's description as its tooltip. Ctrl+S saves, Ctrl+Z undoes, and a save that doesn't fit the schema is refused with the reason.
- `flikka project live <id>` opens the film in the panel instead of its own page. Edits an agent makes to film.json show up there too.
- Renders wait their turn. Hit Render on a few projects and they go one at a time, listed in the sidebar with the step each one is on and how far along it is. Take a waiting one out of line with its ×. Finished and failed ones stay listed until you clear them, and a failed render says why on its project page too.
- Films report their render progress now, frame by frame, like recordings do.
- Press `?` (or Shortcuts at the bottom of the sidebar) for a sheet of every keyboard shortcut in the panel.

### 📁 Folders and settings
- Finished videos now go to `~/Videos/flikka` and screenshots to `~/Pictures/flikka`, instead of `~/Documents/flikka`. Both follow the desktop's own Videos and Pictures folders, so a renamed or translated one (like `~/Vidéos`) works too.
- A Settings page in the panel, and `flikka app config` in the CLI, let you move the videos, screenshots, projects, voices and styles folders. Both save to `~/.config/flikka/config.json`, so the panel, the CLI and agents all agree, and the panel picks up a change right away. Each folder shows whether it's the default, changed in Settings, or set by an environment variable.
- New environment variables for one-off overrides: `FLIKKA_VIDEOS` (`FLIKKA_DIR` still works), `FLIKKA_SCREENSHOTS`, `FLIKKA_PROJECTS`, `FLIKKA_VOICES` and `FLIKKA_STYLES`. They win over the settings file.
- The terminal's state files moved from the videos folder into `~/.flikka`.

### ✂️ Editing
- `flikka project edit --unzoom <time>` removes the zoom showing at that moment (works with `--output-time`).
- `flikka project edit --padding <px>`, `--radius <px>` and `--shadow on|off` set the frame around the recording. Padding goes up to a third of the video's short side and corners up to 200 px, and the error says the limit when you go past it.
- `--zooms clicks` and `--zooms typing` (and `--auto-zoom clicks|typing`) zoom on only one kind of moment.
- `flikka project timeline` lists typing bursts, with where they were typed, so agents can zoom on them too.
- `flikka project undo <id>` works for films as well, stepping back through saves made in the panel (up to 50, kept in the project's `history/`).

### 🐛 Fixes
- The live preview no longer fails with `EEXIST` when an edit and a reload (or two quick edits) rebuild it at the same moment. Preview builds for a project now wait their turn.
- Recording a window that never changes no longer leaves a broken project stuck in "finalizing" with its session still running. On Wayland a completely still window sends no frames at all, so Stop now says that plainly, marks the recording as failed and closes the session.

### 🧹 Maintenance
- Added `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` and `lucide-react` for the panel's fonts and icons, bundled locally.

## 0.3.0 - October 31, 2026

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

### 🏷️ Annotations
- `--callout` and `--step` add labels that point at a spot. Steps are numbered automatically in time order.
- `--arrow` and `--box` draw an arrow or a highlight box. Annotations sit on the recording, so they move with zooms and crops.
- `--redact` blurs an area after recording, or covers it with `solid`. `all` covers the whole video.
- `--keystrokes on` shows shortcuts in a corner as they're pressed. Browser and terminal recordings now log shortcut combos and named keys only, never typed characters.
- `flikka project timeline` lists annotations, redactions and keystrokes in video time.
- A clearer error when text with spaces wasn't quoted.

### ✨ Polish
- `--intro` and `--outro` add title cards from the CLI. The card text fades in and out.
- `--transition fade|wipe|slide|zoom` adds a transition at every cut. The outgoing moment, zoom and cursor included, leaves on top of the next part, without changing the video's length.
- Films take `"transition": "fade" | "wipe" | "slide" | "zoom"` for how each scene comes in. `fade` stays the default.
- `--music on|<file>` adds background music to recordings, ducked about 10 dB under the sound like in films, with `--music-volume`. The panel's live preview plays it too.

### 📤 Output
- `flikka project export <id> --format gif|webm` converts the finished video (a recording's or a film's) with `--width`, `--fps`, `--from` and `--to`. GIFs use one palette per clip with light dithering, so screen text stays crisp.
- `flikka project poster <id>` saves a still of the finished video for a thumbnail.
- `flikka project render <id> --presets square,vertical,landscape` renders each shape as its own file.
- `flikka project render <id> --transparent [webm|mov]` renders without a backdrop, with an alpha channel (VP9 WebM, or ProRes 4444 MOV for editors).
- `--chapter at,"label"` adds chapters, and labelled `record mark` markers count too. They're embedded in the video and written to a `.chapters.txt` list for YouTube.
- Variants never replace the project's main video.

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
