# Changelog

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
