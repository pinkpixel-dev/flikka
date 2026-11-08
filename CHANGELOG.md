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
- The live preview of a recording plays its narration now, with the narration's captions. It uses the lines that have already been spoken, and if some haven't been yet, a note under the player says how many are ready. Fades and the dip under the narrator are only in the render.
- `flikka project live <id>` opens the film in the panel instead of its own page. Edits an agent makes to film.json show up there too.
- Renders wait their turn. Hit Render on a few projects and they go one at a time, listed in the sidebar with the step each one is on and how far along it is. Take a waiting one out of line with its ×. Finished and failed ones stay listed until you clear them, and a failed render says why on its project page too.
- Films report their render progress now, frame by frame, like recordings do.
- Press `?` (or Shortcuts at the bottom of the sidebar) for a sheet of every keyboard shortcut in the panel.
- Zoom into the timeline. Use the − and + buttons, `+` and `-` with the timeline focused, or Ctrl+wheel, which zooms around the pointer. `0` fits the whole video again. Zoomed all the way in, about 2 seconds fill the timeline, and the ruler shows tenths once its marks are under a second apart.
- A strip under the timeline shows the whole video, with a box around the part in view. Drag the box to scroll, drag its edges to zoom, or click the strip to jump there. With the box focused, the arrow keys scroll it (Shift for a whole view), and so do Home and End. While zoomed in, the mouse wheel scrolls sideways.
- While the video plays, the timeline follows the playhead. Scroll it yourself and it stays where you put it until you press play again.

### 📁 Folders and settings
- `flikka app doctor` checks for `flikka-voice` and the Chatterbox model. Both download on first use, so neither fails the check, and the model shows as linked from Narra when your Narra copy is there. On a system older than glibc 2.38 it says the helper can't run there.
- The default voice in Settings is a menu of Kokoro's 54 voices, grouped by language with Kokoro's own grades.
- `flikka voice list` shows Kokoro's voices with their language, gender and grade.
- `flikka app doctor` lists `espeak-ng` as optional (needed by the Spanish, French, Hindi, Italian and Portuguese voices) and gives its install command separately, so it never fails the check.
- Your own voices are switched off for now. Kokoro can't clone a voice, so a recorded sample was never actually used, and films quietly fell back to the default voice. `flikka voice add` and the Voices page come back once there's a model that can clone.
- Finished videos now go to `~/Videos/flikka` and screenshots to `~/Pictures/flikka`, instead of `~/Documents/flikka`. Both follow the desktop's own Videos and Pictures folders, so a renamed or translated one (like `~/Vidéos`) works too.
- A Settings page in the panel, and `flikka app config` in the CLI, cover everything that used to need an environment variable: the videos, screenshots, projects, voices and styles folders, the default voice, the transcription model, which browser records demos (and its sign-ins, profile and port), your own screenshot command, and the panel's port. Both save to `~/.config/flikka/config.json`, so the panel, the CLI and agents all agree, and the panel picks up a change right away. Each setting shows whether it's the default, changed in Settings, or set by an environment variable, and a value that can't work is refused with the reason.
- New environment variables for one-off overrides: `FLIKKA_VIDEOS` (`FLIKKA_DIR` still works) and `FLIKKA_SCREENSHOTS`. Every environment variable wins over the settings file.
- Films without a `voice` use the default voice from Settings (or `FLIKKA_DEFAULT_VOICE`) instead of always `af_heart`.
- Picking a browser by name for demos (like `brave`) now says so when it isn't installed, instead of falling back to another one.
- The terminal's state files moved from the videos folder into `~/.flikka`.

### 🗣️ Your own voice
- Narrate in your own voice. `flikka voice add "My voice" --consent` records about 15 seconds from your mic (or takes `--from` a voice note or video), cleans it, checks the words, and keeps the best 10 seconds. Chatterbox Nano speaks it, on your own machine.
- Your voices work anywhere a Kokoro voice does: films, narration over recordings (`--narrator "My voice"` or `--line n2,voice=My voice`), `flikka voice say`, and the default voice in Settings.
- `--consent` is required to add a voice, confirming it's yours or that you have permission to use it. The panel asks the same thing with a switch before it records.
- `flikka voice import narra` copies the voices you made in Narra, and the model is linked from Narra's copy when it's there, so nothing downloads twice.
- The Voices page is back in the panel: listen to each voice's sample, try a line in it, record or upload a new one, and delete one (it goes to the Trash).
- Lines in your voice are made again when you re-record that voice.
- Your voices speak English only and need glibc 2.38 or newer. Their helper, `flikka-voice`, downloads by itself the first time one speaks (about 15 MB, checked against the tested file), and the AUR package installs it into `/usr/lib/flikka`.

### 🎙️ Narration for recordings
- Recordings can have a Kokoro voice talking over them now, with captions. Add a line with `flikka project edit <id> --say "0:02,Open the settings."`, or `--say "next,…"` to start right after the line before.
- Each line is pinned to a moment of the recording, so cutting, speeding up or freezing parts later moves the line along with what it talks about. A line whose moment gets cut starts where the video picks up again.
- `--line id,…` changes one line: when it starts, when it should finish by (`until`), its voice and speed, trims and fades, gain, and mute. `--reword` changes its text, `--unsay` removes it, `--narrator` sets the voice for every line, and `--pronounce "word=sounds like"` fixes how a word is said without touching the captions.
- The recording's own sound dips while a line plays (`--duck off` to keep it level), and music ducks under both.
- `flikka project timeline` and the render result list every line with where it lands, and flag lines that run past their `until`, overlap the line before, or run past the end.
- A Narration tab in the panel lists a recording's lines. Edit a line's words, voice and speed, play it, speak it (or speak it again), mute it or remove it, and click its time to jump there. Ctrl+Enter splits a line at the cursor and Ctrl+Backspace at the start merges it into the line above. Type a new line at the bottom and it lands at the playhead. A line that needs a look, like one that's too long for its moment, says so under its text.
- `flikka project speak <id>` speaks the lines that aren't spoken yet without rendering, or one line with `--line n2` (add `--again` to speak it anew). The panel speaks lines through the same command, one job at a time.
- Say a word differently, in one spot or everywhere. In the Narration tab, put the cursor on a word and press Ctrl+K (or the speech button) to spell it the way it sounds, like `nair-ated`, or give exact phonemes, like `ʤˈɪf`. Preview speaks the line that way in its own voice before you apply it. Turn on "Everywhere in this project" to save it as a pronunciation for every line, and the ones you've saved are listed at the top of the tab, each with a button to take it off. Phonemes are for Kokoro voices. Your own voices read text, so they use the sounds-like spelling.
- In one spot, the change is written into the line as a say-as mark, `[read](red)` or `[GIF](/ʤˈɪf/)`, the same syntax Narra and Misaki use. `--say-as n2,"read=red"` (or `"read=/ɹˈɛd/"`) adds one from the CLI, and `--pronounce "GIF=/ʤˈɪf/"` takes exact phonemes now too. Captions and the film check always show the plain word.
- Check a recording's narration for words a listener may mishear. Press Check in the Narration tab, or run `flikka project check <id>` (`--line n2` for one). Whisper listens to each spoken line's own clip, so music and your mic can't cause false alarms, and every line is heard in one run. No render needed. Flagged words show under the line, and clicking one opens Say as right on it. What Whisper heard is kept with the clip, so only new or changed lines are heard again. The check uses Whisper's `base` model unless you picked one in Settings, since `tiny` mishears too much to trust.
- The film check's misheard-word note now mentions say-as marks too.
- Fit a line that runs past its moment. Press Fit on the line in the Narration tab, or run `flikka project fit <id>` (add `--line n2` for one). It reads the line just fast enough to fit, up to 1.3×, speaks it again and checks, with one more nudge if it's still a little long. The new speeds save as one edit, so Ctrl+Z undoes them.
- A line that still runs over gets a word budget, `shortenTo`, in `flikka project timeline` and the render result. Shorten in the panel copies a prompt for your agent with the line, how long it runs over and that budget. Flikka doesn't call a model itself.
- `--split n2,"words"` (or a character position) cuts a line in two, and `--merge n3` joins a line onto the one before it. Both halves keep the voice, speed, gain and mute. The second half follows the first and keeps the `until`.
- Narration lines have their own row on the panel's timeline now, each one drawn with its waveform. Drag a line to move it, or drag its edges to trim the start or end. Edges snap to the playhead, cuts, zooms and other lines. Click a line to choose it, then Alt+← → nudges it a frame (add Shift for a tenth of a second). A moved line takes its `until` along, so it keeps the same room. Lines that aren't spoken yet show as dashed outlines, sized from their word count.
- Moving a line with `--line id,at=…` keeps the lines in time order now, and the lines that follow it (`at: null`) move with it.
- If your agent changes a project while you're editing it in the panel, a timeline or narration edit made against the older version gets refused instead of landing in the wrong spot. The panel says so, loads the newer timeline, and you can try again.

### 🎞️ Narration for films
- A film's sentences get their own tools. Films have a Narration tab in the panel now, next to Edit. It lists every scene's sentences, and each one can have its own voice and speed. You can play it, speak it again, edit its words, say a word differently with Ctrl+K, and see the words Check flags, all without a render. Changes save to film.json like any other film edit, so Ctrl+Z undoes them.
- `say` in film.json can be a list now, so one sentence can have its own voice or speed: `["First, open it.", {"text": "Then save.", "voice": "bf_emma", "speed": 1.1}]`. A plain string works the same as before, and the panel only switches a scene to the list form when a sentence needs it, then back again when it doesn't.
- `flikka project speak <id>` works on films, speaking the sentences that aren't spoken yet (`--scene 2 --sentence 1 --again` for one). `flikka project check <id> --lines` checks the spoken sentences for misheard words without a render.
- A film's live preview shows right away instead of speaking every new sentence first. Sentences that aren't spoken yet get their captions and a length guessed from their words, and a note under the player says how many are ready. Speak them from the Narration tab, or render, and they play.

### 🖱️ Screen recordings
- Recording a whole display on Wayland no longer bakes the mouse pointer into the video. Flikka logs where it is and draws it at render time, like it does for browser demos, so the cursor overlay switch (or `--cursor on|off`) can show or hide it after recording. `--no-cursor` now just starts it hidden.
- The pointer comes from `flikka-cursor`, a small new helper in the same download as `flikka-voice`. It's fetched in the background the first time you record a display, and your desktop asks you to pick the screen once.
- Windows, regions, and desktops whose screencast portal can't report the pointer separately keep it in the video, like before.
- A paused and resumed recording handles the pointer the same way in every part.
- `flikka app doctor` lists `flikka-cursor` on Wayland. It's optional, since screen recordings work without it.

### ✂️ Editing
- `flikka project edit --unzoom <time>` removes the zoom showing at that moment (works with `--output-time`).
- `flikka project edit --padding <px>`, `--radius <px>` and `--shadow on|off` set the frame around the recording. Padding goes up to a third of the video's short side and corners up to 200 px, and the error says the limit when you go past it.
- `--zooms clicks` and `--zooms typing` (and `--auto-zoom clicks|typing`) zoom on only one kind of moment.
- `flikka project timeline` lists typing bursts, with where they were typed, so agents can zoom on them too.
- `flikka project undo <id>` works for films as well, stepping back through saves made in the panel (up to 50, kept in the project's `history/`).

### 🤖 Agent skills
- `flikka app install` puts the agent skill in `~/.gemini/config/skills/flikka` for Antigravity too, next to Claude Code, Codex and the shared `~/.agents` folder.
- `flikka app install` skips agents that aren't installed, so it no longer creates an empty `~/.claude`, `~/.codex` or `~/.gemini/config` on a machine without them. The shared `~/.agents` folder always gets the skill.
- `flikka app skills` installs just the skill, for every agent installed here or the ones you name with `--agent claude,codex,antigravity,agents` (named ones get it even if they aren't installed), and `--remove` takes it out again. It leaves the command link and the desktop entry alone.

### 🐛 Fixes
- A say-as mark with a period in it, like `[St.](saint)`, no longer ends the sentence there.
- `flikka project speak` works on a film that has never been rendered. It used to fail because the film's `.flikka-cache` folder didn't exist yet.
- Japanese and Chinese captions on recordings (the mic's or the narration's) use Noto Sans JP or SC too, instead of falling back to Arial.
- Japanese and Chinese captions break between words instead of in the middle of one, keep Japanese verb endings with their word, and never start a line with closing punctuation or a small kana.
- Japanese and Chinese titles and captions use Noto Sans JP or SC, now shipped with Flikka, so they render the same on every machine instead of as empty boxes where no such font is installed.
- `flikka voice setup japanese` is tested: after its one-time download, Japanese voices speak.
- Narration in other languages reads properly. Sentences end at `。！？` and the Hindi `।` too, Japanese and Chinese captions break by characters instead of running on as one line, and "too fast to read" uses limits that fit those languages.
- The film check listens in the narration's language. It tells Whisper the language, uses the `small` model outside English (unless you picked one), keeps accented letters together, and skips the misheard-words check for Japanese and Chinese with a note saying so, instead of flagging lines that sound fine.
- Kokoro now reads every voice in its own language. Before, every voice used American English rules, so British voices pronounced words the American way and other languages came out garbled. Narration for non-American voices is made again once.
- Mandarin voices work (their extra package downloads by itself), and Japanese voices say how to get their one-time dictionary: `flikka voice setup japanese`.
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
