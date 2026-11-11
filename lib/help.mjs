// Everything `flikka help` prints. Three levels: the overview (every action, one line each), a command's page
// (flikka record help: the rules and the big picture) and an action's page (flikka record click help: usage, options
// and examples). The overview is built from the action pages, so a new action shows up there once it has one.
import fs from 'node:fs';
import path from 'node:path';
import {root} from './common.mjs';

const groups = {
  record: 'make a video: a screen, a window, the flikka browser or a terminal, and act in it',
  project: 'what you made: list, edit, narrate, render. A recording, or a film of many scenes',
  shot: 'framed screenshots',
  voice: "voices for narration: Kokoro's, and your own",
  app: 'the panel, setup, settings and the doctor',
};

// Each action: usage (after `flikka <group>`), summary (the overview line), and optionally about (a few lines),
// options ([flag, what it does]), examples and see (other actions in the same group).
const capture = [
  ['--name <name>', 'the project name (letters, numbers, spaces, - and _)'],
  ['--mic <name|default>', 'record a microphone (flikka record sources lists them)'],
  ['--system-audio', 'record what the computer plays (the flikka browser: only its own sound)'],
  ['--camera <name|default>', 'record a webcam too, shown in a corner (not for the browser)'],
  ['--fps 24|30|60', 'frames per second (60)'],
  ['--countdown <s>', 'wait this long before recording starts (up to 30)'],
  ['--no-zoom', 'no automatic zooms on clicks'],
  ['--no-cursor', 'hide the pointer (where it can be logged, it can still be shown later)'],
  ['--native-cursor', "keep the system's own pointer in the video"],
  ['--max-width <px>', 'scale the video down to this width (320–7680)'],
];

const actions = {
  record: {
    screen: {usage: 'screen [index] [options]', summary: 'a whole display',
      about: `Records one display. The index comes from flikka record sources (0 is the first). On Wayland, full-screen
recordings log the pointer separately when they can, so it can be shown or hidden after recording.`,
      options: capture, examples: ['flikka record screen', 'flikka record screen 1 --mic default --name setup'], see: ['sources', 'stop']},
    window: {usage: 'window [id] [options]', summary: 'one window (keep it visible: a covered window stops updating)',
      about: `Records one window. On Wayland the system asks which one, so the id is only used on X11. It asks twice when
the pointer can be logged (the recording, then the pointer): pick the same window both times.`,
      options: capture, examples: ['flikka record window --name settings'], see: ['sources', 'stop']},
    region: {usage: 'region [x,y,w,h] [options]', summary: 'part of a display',
      about: 'Records part of a display, in points. Leave the area out to drag one with the mouse (needs slurp).',
      options: capture, examples: ['flikka record region 0,0,1280,720', 'flikka record region'], see: ['screen', 'stop']},
    browser: {usage: 'browser [url] [options]', summary: 'the flikka browser, the best way for an agent to record itself',
      about: `A copy of your browser with your logins, recorded inside the page, so it records fine while covered.
Drive it with look, click, type and the other actions below.`,
      options: [...capture.filter(([flag]) => flag !== '--camera <name|default>'),
        ['--hide <text>', 'hide the row holding this text (repeatable)'],
        ['--blur <regex>', 'blur text matching this pattern, like API keys (repeatable)'],
        ['--run <js> --for <s>', 'one step: run a trigger in the page, record for s seconds, stop']],
      examples: ['flikka record browser https://example.com --name signup', 'flikka record browser --blur "sk-[A-Za-z0-9]+"'], see: ['look', 'click', 'stop']},
    terminal: {usage: 'terminal [options]', summary: 'your own shell in the flikka browser',
      about: 'Opens a terminal (or records the open one) and records it. Drive it with run and send.',
      options: [...capture.filter(([flag]) => !['--camera <name|default>', '--no-zoom', '--no-cursor', '--native-cursor'].includes(flag)),
        ['--blur <regex>', 'blur matching text, like API keys (repeatable)'],
        ['--color <word=#hex[,#hex]>', 'paint a word (a brand name) in one color or a gradient (repeatable)'],
        ['--cwd <dir>', 'where the shell starts (your home folder)'],
        ['--title <text>', 'the window title (-zsh)'],
        ['--font-size <px>', 'the text size']],
      examples: ['flikka record terminal --cwd ~/code/app --name install', 'flikka record run "npm test"', 'flikka record stop'], see: ['run', 'send', 'stop']},
    sources: {usage: 'sources', summary: 'the displays, windows, microphones and cameras you can record',
      examples: ['flikka record sources'], see: ['screen', 'window']},
    stop: {usage: 'stop [id]', summary: 'stop and save; prints the project id',
      about: 'Stops the recording (the newest one unless an id is given). It gets cut and zoomed as it saves.',
      examples: ['flikka record stop'], see: ['pause', 'status']},
    pause: {usage: 'pause [id]', summary: 'pause the recording', see: ['resume', 'stop']},
    resume: {usage: 'resume [id]', summary: 'carry on after a pause', see: ['pause', 'stop']},
    status: {usage: 'status [id]', summary: "whether it's recording, paused or saved", see: ['stop']},
    mark: {usage: 'mark <label> [--at x,y] [--id id]', summary: 'a moment to zoom on',
      about: 'Marks this moment in the recording, to zoom on later. Clicks in the flikka browser mark themselves.',
      options: [['--at x,y', 'where to zoom, from 0 to 1 across the video'], ['--id <id>', 'a recording other than the newest']],
      examples: ['flikka record mark "the save button" --at 0.8,0.1']},
    open: {usage: 'open <url> [--refresh-login] | open terminal [options]', summary: 'a new tab in the flikka browser, or the terminal',
      about: 'Opens a tab, starting the flikka browser if needed. Works without recording, to set a page up first.',
      options: [['--refresh-login', 'copy your logins from your own browser again'], ['terminal', 'open the terminal instead (takes the options of record terminal)']],
      examples: ['flikka record open https://example.com', 'flikka record open terminal --cwd ~/code/app'], see: ['look', 'close']},
    look: {usage: 'look', summary: "the page's buttons, links and fields, numbered, and its text",
      about: 'Numbers expire when the page changes, so look again after anything that loads.',
      examples: ['flikka record look'], see: ['click', 'type']},
    click: {usage: 'click <target>', summary: 'click something; the mouse glides there like a person',
      about: 'target is a number from look, visible text, or a CSS selector.',
      examples: ['flikka record click 4', 'flikka record click "Sign in"'], see: ['look', 'hover']},
    type: {usage: 'type [<target>] "text"', summary: 'click a field, replace what it holds, type key by key',
      about: '\\n is a new line in a text area. For long text, paste reads more like a person.',
      examples: ['flikka record type 3 "hello@example.com"', 'flikka record type "Search" "clapperboard"'], see: ['paste', 'key']},
    paste: {usage: 'paste [<target>] "text"', summary: 'long text at once, like Ctrl+V',
      examples: ['flikka record paste 5 "A longer message\\nwith two lines"'], see: ['type']},
    key: {usage: 'key <key>', summary: 'press Enter, Tab, Escape, Backspace, Space or an arrow key',
      about: 'Keys: Enter Tab Escape Backspace Space ArrowUp ArrowDown ArrowLeft ArrowRight.',
      examples: ['flikka record key Enter']},
    wait: {usage: 'wait "text" [--gone] [--timeout s]', summary: 'until text (or a CSS selector) shows up, or goes',
      about: 'Use it after anything that loads, instead of sleep.',
      options: [['--gone', 'wait until it goes away instead'], ['--timeout <s>', 'give up after this long (15)']],
      examples: ['flikka record wait "Welcome back"', 'flikka record wait ".spinner" --gone --timeout 30']},
    scroll: {usage: 'scroll [px]', summary: 'scroll smoothly (600 px; negative goes up)', examples: ['flikka record scroll', 'flikka record scroll -300']},
    hover: {usage: 'hover <target>', summary: 'move the mouse over something', examples: ['flikka record hover "Pricing"'], see: ['click']},
    drag: {usage: 'drag <from> <to>', summary: 'drag from one target to another', examples: ['flikka record drag 3 7']},
    select: {usage: 'select <target> <option>', summary: 'pick an option in a dropdown, by its text or value',
      examples: ['flikka record select 6 "Monthly"']},
    upload: {usage: 'upload <file> [<target>]', summary: 'put a file in an upload field, without the file dialog',
      examples: ['flikka record upload ./photo.png "Upload"']},
    go: {usage: 'go <url>', summary: 'load another address in this tab', examples: ['flikka record go https://example.com/pricing']},
    back: {usage: 'back', summary: 'the page before', see: ['forward']},
    forward: {usage: 'forward', summary: 'the page after', see: ['back']},
    tabs: {usage: 'tabs', summary: "the flikka browser's open tabs", see: ['switch']},
    switch: {usage: 'switch <tab>', summary: 'bring a tab to the front (an id from tabs, or part of its address)', see: ['tabs']},
    shot: {usage: 'shot [file.png]', summary: 'a screenshot of the page (browser.png)',
      examples: ['flikka record shot page.png', 'flikka shot --from page.png --no-copy'], see: ['mask']},
    mask: {usage: 'mask --hide <text> --blur <regex>', summary: 'hide or blur things on the page, before a shot',
      options: [['--hide <text>', 'hide the row holding this text (repeatable)'], ['--blur <regex>', 'blur text matching this pattern (repeatable)']],
      examples: ['flikka record mask --blur "sk-[A-Za-z0-9]+"'], see: ['shot']},
    eval: {usage: 'eval <js>', summary: "run JavaScript in the page and print its value (not for acting: viewers can tell)",
      examples: ['flikka record eval "document.title"']},
    run: {usage: 'run "<command>" [--timeout s]', summary: 'type a command in the terminal, wait, return its output and exit code',
      options: [['--timeout <s>', 'stop it with Ctrl-C after this long (120)']],
      examples: ['flikka record run "ls -la"', 'flikka record run "npm install" --timeout 300'], see: ['send', 'terminal']},
    send: {usage: 'send "text"', summary: "type into what's running now, without waiting (\\n is Enter)",
      examples: ['flikka record send "y\\n"'], see: ['run']},
    close: {usage: 'close terminal', summary: 'close the terminal', see: ['open']},
  },
  project: {
    list: {usage: 'list', summary: 'every project, newest first'},
    show: {usage: 'show <id>', summary: 'its kind, files and finished video'},
    render: {usage: 'render <id> [options]', summary: 'the finished video, checked',
      about: 'Saves it to the videos folder as <name>-<id>.mp4 (flikka app config shows where) and checks it.',
      options: [['--out <file>', "write somewhere else, so the user's video isn't replaced (for test renders)"],
        ['--presets square,vertical,landscape', 'a recording: each shape as its own file'],
        ['--transparent [webm|mov]', 'a recording: no backdrop, with an alpha channel'],
        ['--no-check', "a film: skip the check after rendering"]],
      examples: ['flikka project render 3f9a1c2e', 'flikka project render launch --out /tmp/test.mp4'], see: ['preview', 'check']},
    preview: {usage: 'preview <id> [--frame n] [--out file]', summary: 'a recording: one frame. A film: a picture per scene and a layout check',
      options: [['--frame <n>', 'which frame of a recording, counted at the video fps (0)'], ['--out <file>', 'where to save the picture']],
      examples: ['flikka project preview 3f9a1c2e --frame 120'], see: ['frames', 'render']},
    frames: {usage: 'frames <id> [options]', summary: 'labelled frames of the edit in one picture',
      about: "A recording's narration captions show for the lines already spoken (narration in the result counts them).",
      options: [['--from <s> --to <s>', 'only this stretch'], ['--at <s,s,…>', 'these moments'], ['--every <s>', 'one frame this often'],
        ['--scene <n>', 'a film: only this scene'], ['--out <file>', 'where to save the picture']],
      examples: ['flikka project frames 3f9a1c2e --every 2', 'flikka project frames launch --scene 3']},
    timeline: {usage: 'timeline <id>', summary: 'a recording: what happens in the finished video, in its seconds',
      about: 'Parts, cuts, zooms, clicks, speech and narration lines. Read it before an edit with --output-time.', see: ['edit']},
    edit: {usage: 'edit <id> [options]', summary: 'a recording: cuts, zooms, speed, looks, annotations, narration',
      about: `Takes several options in one call. Times are seconds or m:ss, in the recording's own seconds unless
--output-time. Try a big edit with --dry-run first; flikka project undo takes it back.

Cuts and timing:
  --cut-idle (still picture, nobody talks)  --cut-silence (pauses in speech)  --cut start,end  --reset
  --trim start,end (keep only that)  --freeze at,seconds (hold that moment: a still, no sound)
  --speed 1.5 (whole video, 0.5–4) | --speed 2,start,end (one part)  --ramp 0.5|off (ease between speeds)
Zooms and pointer:
  --auto-zoom [clicks|typing]  --zooms on|off|clicks|typing  --zoom start,end,x,y[,scale]  --unzoom at
  --clicks on|off  --cursor on|off  --keys on|off (typing sounds)  --keystrokes on|off (shortcuts in a corner)
Sound and camera:
  --mic|--system-audio|--webcam on|off  --music on|off|<file>  --music-volume 0.1–4
  --camera round=on,size=0.22,position=bottom-right
Look:
  --preset vertical|portrait|square|landscape  --crop x,y,w,h|off  --background aurora|sunset|ocean|meadow|graphite|midnight|<css>
  --padding 64  --radius 20  --shadow on|off  --transition fade|wipe|slide|zoom|off
  --intro "text" | "seconds,text" | off  --outro (the same, at the end)
Annotations (x,y,w,h from 0 to 1, or pixels of the recording):
  --spotlight start,end,x,y,w,h|off  --callout start,end,x,y,"text"  --step start,end,x,y,"text"
  --arrow start,end,x,y,x2,y2  --box start,end,x,y,w,h  --annotations off
  --redact start,end,x,y,w,h[,solid] | all,x,y,w,h[,solid] | off (solid covers it: use solid for secrets)
  --chapter at,"label"  --chapters off
Layers (on the finished video: x,y,w,h are shares of the video; times stick to recording moments):
  --layer text|image|video|solid,start,end,x,y,w,h[,text|file|color] | type,all,x,y,w,h[,…]   → ids l1, l2, …
  --layer-set id,opacity=,rotation=,x=,size=,color=,align=,fit=,order=front|back,…,text=… (text last;
               new x, y, rotation, w or h take that value's keyframes along)
  --keyframe id,at,opacity=0,x=0.1,…[,ease=ease-out|cubic-bezier(0.2,0,0,1)] (at: seconds after it appears)
  --unkeyframe id,at|all  --unlayer id  --layers off
Narration (a voice over the recording, captioned; each line sticks to its moment when you cut later):
  --say at,"text" | next,"text"   → ids n1, n2, … (timeline lists them)
  --line id,until=m:ss,at=,voice=,speed=0.7–1.5,trim-start=,trim-end=,fade-in=,fade-out=,gain=-30–12,mute=on|off
  --split id,12|id,"words"  --merge id  --reword id,"new text"  --unsay id|all
  --narrator <voice>[,speed]|default  --duck on|off  --pronounce "Memlake=Mem-lake" | "GIF=/ʤˈɪf/" | "word=" | off
  --say-as n2,"read=red" | n2,"read=/ɹˈɛd/"
Other:
  --transcript <file.json>  --output-time (times are in the finished video, as timeline shows)  --dry-run`,
      examples: ['flikka project edit 3f9a1c2e --cut-idle --auto-zoom --preset vertical',
        'flikka project edit 3f9a1c2e --output-time --cut 1:20,1:25',
        'flikka project edit 3f9a1c2e --say 0:04,"First, open the settings." --narrator af_heart'],
      see: ['timeline', 'undo', 'speak', 'render']},
    undo: {usage: 'undo <id>', summary: 'back to before the last saved edit (repeat to go further back)'},
    speak: {usage: 'speak <id> [--line n2 | --scene 2 [--sentence 1]] [--again]', summary: 'speak narration not spoken yet, without rendering',
      options: [['--line <id>', 'a recording: one line'], ['--scene <n> --sentence <m>', 'a film: one scene, or one sentence (from 1)'],
        ['--again', 'speak the one you named again, even if it was spoken']],
      examples: ['flikka project speak 3f9a1c2e', 'flikka project speak launch --scene 2 --sentence 1 --again'], see: ['check', 'fit']},
    fit: {usage: 'fit <id> [--line n2]', summary: 'a recording: speed up lines that run past their until (up to 1.3×)',
      about: "Lines that still don't fit need fewer words: --reword them in about shortenTo words (flikka project timeline).",
      examples: ['flikka project fit 3f9a1c2e', 'flikka project fit 3f9a1c2e --line n2'], see: ['speak', 'edit']},
    check: {usage: 'check <id> [--line n2 | --lines [--scene 2 [--sentence 1]]]', summary: 'would a listener hear the right words',
      about: `A recording: transcribes each narration line's clip (Whisper) and lists misheard words.
A film: the check of the last render again, or with --lines each spoken sentence, without rendering.`,
      examples: ['flikka project check 3f9a1c2e', 'flikka project check launch --lines --scene 2'], see: ['speak', 'render']},
    captions: {usage: 'captions <id>', summary: 'a recording: a transcript with word times (only when someone talks)'},
    export: {usage: 'export <id> --format gif|webm [options]', summary: 'a GIF or WebM of the finished video',
      options: [['--width <px>', 'scale it to this width'], ['--fps <n>', 'frames per second'], ['--from <s> --to <s>', 'only this stretch'], ['--out <file>', 'where to save it']],
      examples: ['flikka project export 3f9a1c2e --format gif --width 800 --from 0:05 --to 0:12']},
    poster: {usage: 'poster <id> [--at s] [--out file.jpg|png]', summary: 'a still of the finished video, for a thumbnail',
      examples: ['flikka project poster 3f9a1c2e --at 0:03']},
    rename: {usage: 'rename <id> <name>', summary: 'give it a new name'},
    remove: {usage: 'remove <id>', summary: 'move it to the Trash (only when the user asks)'},
    new: {usage: 'new <name> [--with <id>,<id>]', summary: 'a new film; --with starts it with those recordings as scenes',
      examples: ['flikka project new launch --with wiki,3f9a1c2e'], see: ['schema', 'live', 'preview']},
    schema: {usage: 'schema [--path]', summary: 'every film.json field, described (--path: just where the file is)',
      about: 'Read it before writing a film. Unknown fields are errors with a "did you mean".'},
    styles: {usage: 'styles', summary: 'looks for films (your own go in ~/.flikka/styles)'},
    live: {usage: 'live <id> [--no-open]', summary: 'a film in the panel: plays now, reloads on every save',
      options: [['--no-open', "serve it without opening the browser"]]},
  },
  shot: {
    take: {usage: '[--background b] [--plain] [--from file.png] [--out file.png] [--no-copy]', summary: 'pick an area or a window: framed, saved, copied',
      options: [['--background <name|css>', 'what it sits on (aurora)'], ['--plain', 'no frame, just the picture'],
        ['--from <file.png>', 'frame a picture you already have'], ['--out <file.png>', 'where to save it'], ['--no-copy', "don't put it on the clipboard"]],
      examples: ['flikka shot', 'flikka record shot page.png && flikka shot --from page.png --no-copy']},
    list: {usage: 'list', summary: 'your screenshots, newest first'},
    copy: {usage: 'copy <file>', summary: 'put one on the clipboard'},
    remove: {usage: 'remove <file>', summary: 'move one to the Trash (only when the user asks)'},
  },
  voice: {
    list: {usage: 'list', summary: "every voice: Kokoro's (name, language, gender, grade), then yours (own: true)"},
    say: {usage: 'say <name> "text" [--speed 1.1] [--out file.wav]', summary: 'hear a voice',
      about: 'Say-as marks work here too, to hear one before writing it into a line: [GIF](/ʤˈɪf/) or [read](red).',
      options: [['--speed <n>', 'from 0.5 to 2 (1 by default), like a line\'s speed'], ['--out <file>', 'where the WAV goes (voice-<name>.wav here by default)']],
      examples: ['flikka voice say af_heart "Hello there"', 'flikka voice say bf_emma "Open the [GIF](/ʤˈɪf/) folder" --speed 1.1',
        'flikka voice say me "Testing my voice" --out me.wav']},
    add: {usage: 'add <name> --consent [--from file] [--seconds 15] [--mic default]', summary: 'your own voice, from the mic or a file',
      about: `Records you reading a short text (or reads a file), cleans it, checks the words and keeps 10 s.
--consent says it's your voice, or one you may use. Agents: only when the user asked.`,
      options: [['--consent', 'required: you may clone this voice'], ['--from <file>', 'use a recording instead of the mic'],
        ['--seconds <n>', 'how long to record (15)'], ['--mic <name>', 'which microphone (default)']],
      examples: ['flikka voice add me --consent', 'flikka voice add "Jo narrating" --consent --from jo.wav']},
    remove: {usage: 'remove <name>', summary: 'your voice, to the Trash'},
    setup: {usage: 'setup japanese', summary: 'the one-time dictionary download (about 500 MB) Japanese voices need'},
    cuda: {usage: 'cuda [install | remove]', summary: 'your own voices on CUDA (NVIDIA): status, install or remove',
      about: `install downloads Microsoft's CUDA plugin for ONNX Runtime (183 MB). It needs CUDA 13 and cuDNN 9, and is
about 1.5 times faster than WebGPU. Agents: install only when the user asks.`},
  },
  app: {
    install: {usage: 'install', summary: 'set up flikka: the command, a desktop entry, agent skills'},
    skills: {usage: 'skills [--agent claude,codex,antigravity,agents] [--remove]', summary: 'just the agent skill (default: the agents installed here)'},
    update: {usage: 'update', summary: 'a git install: pull the latest code and refresh'},
    doctor: {usage: 'doctor', summary: "check what flikka needs here, with the command to install what's missing"},
    uninstall: {usage: 'uninstall', summary: 'remove the desktop entry and links'},
    panel: {usage: 'panel [--no-open] [--project <id> | --shots]', summary: 'the panel: projects, screenshots, voices, settings',
      options: [['--no-open', "serve it without opening the browser"], ['--project <id>', 'open on this project'], ['--shots', 'open on the screenshots']]},
    config: {usage: 'config [set <setting> <value> | unset <setting>]', summary: 'every setting, its value and where it came from',
      about: `Settings:
  folders:  videos, screenshots, projects, voices, styles (a full path)
  voice:    voice (your own or a Kokoro voice), voice-gpu (auto, webgpu, cpu),
            whisper-model (tiny, base, small, medium, large-v3)
  browser:  browser (auto, google-chrome, chromium, brave, edge, vivaldi or a path), browser-source,
            browser-profile, browser-port
  other:    screenshot-command (with %o for the PNG), panel-port
Saved in ~/.config/flikka/config.json. An environment variable wins over it for one run or a script:
FLIKKA_VIDEOS, FLIKKA_SCREENSHOTS, FLIKKA_PROJECTS, FLIKKA_VOICES, FLIKKA_STYLES, FLIKKA_DEFAULT_VOICE, FLIKKA_VOICE_GPU,
FLIKKA_WHISPER_MODEL, FLIKKA_BROWSER_APP, FLIKKA_BROWSER_SOURCE, FLIKKA_BROWSER_PROFILE, FLIKKA_BROWSER_PORT,
FLIKKA_SCREENSHOT_CMD, FLIKKA_UI_PORT.`,
      examples: ['flikka app config', 'flikka app config set videos ~/Videos/demos', 'flikka app config unset videos']},
  },
};

// Each command's own page: how its parts fit together, and the rules agents follow.
const pages = {
  record: `flikka record - make a video. Each recording becomes a project: stop prints its id.

{actions}
The browser actions work without recording too, to set a page up first. The mouse glides and text is typed like
a person, so the video looks real. Options to start a recording: flikka record screen help.

Rules:
  - An agent records itself in the flikka browser (record browser), never the user's own browser. It starts with the
    user's logins. When a site still asks to log in, ask the user to do it in the flikka browser's window (never
    type a password yourself): the flikka browser keeps it. open --refresh-login copies their logins again.
  - Look before you act: look, then click or type by number. After an action that loads something, wait "text",
    not sleep. Numbers expire when the page changes: look again.
  - Look like a person: viewers spot an agent at once (text that appears without typing, a jumping mouse, a page
    that snaps). Act only with click/type/paste/scroll/select/drag, never with eval. Short text: type; long: paste.
    Give the viewer a beat (sleep 1) after each result.
  - Keep secrets out: --hide/--blur when starting, mask before a shot. Terminal: --blur, and pass keys through the
    environment, never type them.
  - Screen and window recordings show the real screen: anything on it ends up in the video.

Example:
  flikka record browser https://en.wikipedia.org --name wiki
  flikka record look; flikka record type 3 "Clapperboard"; flikka record key Enter; flikka record wait "Clapperboard"
  flikka record stop                        → {"id": "3f9a1c2e", …}: flikka project render 3f9a1c2e
`,
  project: `flikka project - what you made. A project is a video: one recording, or a film of many scenes
(recordings, titles, pictures, numbers) narrated in a voice. Give a project by id or by name (newest wins).

{actions}
A recording is cut and zoomed when it stops; change it with edit. A film is its film.json: the schema describes
every field.

Edit options, for flikka project edit <id> [options]:
{edit}

Rules:
  - Times the user says ("at 1:20") are in the rendered video: read flikka project timeline, then edit with
    --output-time so they need no converting. Try a big edit with --dry-run first; flikka project undo takes it back.
  - Test renders take --out <file>, so the user's finished video isn't replaced.
  - Videos are square by default (1080×1080): big on social platforms, phone, and desktop.
  - Films: the schema is the reference (unknown fields are errors with a "did you mean"). In text, *muted words*
    render grey and [accent words] in the accent color. Write "say" as plain spoken sentences, numbers spelled as
    they are read, and only real numbers. "voice": {"name": "af_heart"} speaks in a Kokoro neural voice, or the user's own by its name (flikka voice list).
    A sentence can have its own voice or speed: "say": ["First, open it.", {"text": "Then save.", "voice": "bf_emma", "speed": 1.1}].
  - Loop: preview (~20 s), then render. Always read the check at the end of a render: each issue has a time, a
    scene and a frame to look at. Fix and render again until it is empty.

Example:
  flikka project new launch --with wiki      → {"id": "7c1e09aa", "film": "…/film.json"}: write the scenes, then
  flikka project preview launch; flikka project render launch
`,
  shot: `flikka shot - framed screenshots, saved to the screenshots folder (flikka app config shows where).

{actions}
Options for flikka shot:
{take}
An agent's own: flikka record shot page.png, then flikka shot --from page.png --no-copy. Remove only when the user asks.
`,
  voice: `flikka voice - voices for narration: Kokoro's (CUDA, or CPU), and your own (Chatterbox, English only).

{actions}
A film speaks in one with "voice": {"name": "<name>"}, a recording with --narrator <name>; without one, the voice
from flikka app config. Your voices go by their name (quote names with spaces). The first letter of a Kokoro voice
is the language it reads in: a American English, b British, e Spanish, f French, h Hindi, i Italian,
p Brazilian Portuguese, j Japanese, z Mandarin. English voices are by far the best.
Your own voices need glibc 2.38 or newer. The first time one speaks, Flikka downloads its helper (flikka-voice,
15 MB, unless the AUR package installed it) and a 550 MB model.
Agents: never add a voice unless the user asked.
`,
  app: `flikka app - the review panel, setup and settings.

{actions}
{config}`,
};

const version = () => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { return ''; } };
const pad = (text, width) => text.length >= width ? `${text}  ` : text.padEnd(width);
const usageOf = (group, name) => `flikka ${group} ${actions[group][name].usage}`;

function overview() {
  const lines = [`🎬 flikka ${version()} - record your screen, then let an agent edit it. Every command prints JSON.`, ''];
  for (const [group, about] of Object.entries(groups)) {
    lines.push(`flikka ${group}: ${about}`);
    for (const [name, entry] of Object.entries(actions[group])) {
      lines.push(`  ${pad(group === 'shot' && name === 'take' ? '(no action)' : name, 12)}${entry.summary}`);
    }
    lines.push('');
  }
  lines.push(`More:
  flikka <command> help            a command's rules and examples (flikka record help)
  flikka <command> <action> help   one action in full: usage, options, examples (flikka project edit help)
  flikka version                   the version

How it fits: \`record … stop\` makes a project and prints its id. Recordings are cut (idle time) and zoomed (on
clicks) when they stop, so \`flikka project render <id>\` already gives a good video. A film is a project too: its
film.json lists scenes (recordings, titles, pictures, numbers) with narration. Projects live in
~/.flikka/projects/<id>/, finished videos in ~/Videos/flikka/<name>-<id>.mp4 (flikka app config shows where, if
the user moved them). The user watches it all in the panel and names projects by id ("edit project 3f9a1c2e: …").

Before saying done: look at 2–3 frames of the result; when someone talked, check the sound
(ffmpeg -i <video> -vn -af volumedetect -f null - → mean_volume well above -60 dB). Report the video's path.
Every flikka process logs what it does, with times, to ~/.flikka/trace.log.
`);
  return lines.join('\n');
}

function actionPage(group, name) {
  const entry = actions[group][name];
  const lines = [usageOf(group, name), '', `${entry.summary[0].toUpperCase()}${entry.summary.slice(1)}.`];
  if (entry.about) lines.push('', entry.about);
  if (entry.options) {
    const width = Math.min(32, Math.max(...entry.options.map(([flag]) => flag.length)) + 3);
    lines.push('', 'Options:', ...entry.options.map(([flag, what]) => `  ${pad(flag, width)}${what}`));
  }
  if (entry.examples) lines.push('', 'Examples:', ...entry.examples.map(example => `  ${example}`));
  lines.push('', `See also: ${[...(entry.see || []).map(other => `flikka ${group} ${other} help`), `flikka ${group} help`].join(', ')}`);
  return `${lines.join('\n')}\n`;
}

export const isGroup = group => Object.hasOwn(pages, group);
export const actionNames = group => Object.keys(actions[group] || {});
export const hasAction = (group, name) => isGroup(group) && Object.hasOwn(actions[group], name);

function groupPage(group) {
  const list = Object.keys(actions[group]).map(name => [usageOf(group, name), actions[group][name].summary]);
  const width = Math.min(58, Math.max(...list.map(([usage]) => usage.length)) + 3);
  const lines = list.map(([usage, summary]) => usage.length + 2 + summary.length > 116 ? `  ${usage}\n  ${' '.repeat(width)}${summary}` : `  ${pad(usage, width)}${summary}`);
  return pages[group].replace('{actions}', `${lines.join('\n')}\n`).replace('{edit}', actions.project.edit.about)
    .replace('{take}', actions.shot.take.options.map(([flag, what]) => `  ${pad(flag, 26)}${what}`).join('\n') + '\n')
    .replace('{config}', `${actions.app.config.about}\n`);
}

// flikka help, flikka help <command>, flikka help <command> <action>.
export function helpText(group, name) {
  if (!group) return overview();
  if (!isGroup(group)) throw new Error(`No help for ${group}. Commands: ${Object.keys(pages).join(', ')}`);
  if (!name) return groupPage(group);
  if (!hasAction(group, name)) throw new Error(`No help for flikka ${group} ${name}. Actions: ${Object.keys(actions[group]).join(', ')}`);
  return actionPage(group, name);
}
