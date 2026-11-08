import React, {useState} from 'react';
import {Clipboard, Copy, FolderOpen, Play, X} from 'lucide-react';
import {api} from '../lib/api.js';
import {clock} from '../lib/format.js';
import {useFlash} from '../lib/hooks.js';
import {useToast} from '../lib/toast.js';
import {Button, Progress, Section, Switch} from './ui.jsx';
import {Steps} from './Steps.jsx';
import {Frame} from './Frame.jsx';

// Mic, system audio, camera, click sounds, zooms and cursor: each in or out of the video.
const switchNames = {mic: ['Microphone', 'Your voice'], system: ['System audio', 'Sound from apps'], webcam: ['Camera bubble', 'You in a bubble in the corner'],
  clicks: ['Click sounds', 'A soft tick on each click'], cursor: ['Cursor overlay', 'Smooth pointer and click ring']};
const zoomModes = [['all', 'Clicks and typing'], ['clicks', 'Clicks'], ['typing', 'Typing'], ['off', 'Off']];
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const corners = [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-right', 'Top right'], ['top-left', 'Top left']];

// The right column of a project: export, edits that write to the project (the live preview follows), and the
// agent prompt, details and steps. `edit(action, body)` saves one edit and refreshes. `children` (a film's scene
// editor) go under Export.
export function Inspector({project, edit, render, rendering, changed, children}) {
  const toast = useToast();
  const [copied, flash] = useFlash();
  const [size, setSize] = useState(null);
  const final = project.final;
  const facts = [['Recorded', project.duration && clock(project.duration)], ['Video', final && clock(final.duration)],
    ['Cut', project.kept != null && project.duration ? (project.duration - project.kept).toFixed(1) + ' s' : null], ['Zooms', project.zooms],
    ['Source', project.size && `${project.size} · ${project.fps} fps`], ['Output', final && `${final.width}×${final.height}`]].filter(([, value]) => value != null && value !== '');
  const copy = (what, text) => navigator.clipboard.writeText(text).then(() => flash(what));
  // Renders wait their turn (one at a time): a waiting one can be taken out of the queue.
  const queued = project.render?.state === 'queued';
  const cancel = () => api('render-cancel', {id: project.id}).catch(failure => toast(failure.message));

  return <aside className="inspector" aria-label="Edit">
    <Section title="Export">
      {final && <div className="file">
        <span className="file-name" data-tip={final.output}>{final.output.split('/').pop()}</span>
        <div className="button-row">
          <Button size="small" icon={Clipboard} tip="Copy the video file, to paste into a chat or a folder"
            onClick={() => api('copy-video', {id: project.id}).then(() => flash('file')).catch(failure => toast(failure.message))}>{copied === 'file' ? 'Copied' : 'Copy file'}</Button>
          <Button size="small" icon={FolderOpen} tip="Open the folder with the video" onClick={() => api('reveal', {id: project.id, kind: 'final'}).catch(failure => toast(failure.message))}>Show</Button>
        </div>
      </div>}
      {queued ? <>
        <p className="hint">Waiting for {project.render.ahead === 1 ? 'one render' : project.render.ahead + ' renders'} to finish first.</p>
        <Button className="wide" icon={X} tip="Take this render out of the queue" onClick={cancel}>Cancel render</Button>
      </> : <Button className="wide" variant={changed || !final ? 'primary' : undefined} icon={Play} disabled={rendering || (!project.recording && !project.film)} onClick={render}
        tip="Export the video with every edit. Renders wait their turn, one at a time.">{rendering ? 'Rendering…' : changed ? 'Render with changes' : final ? 'Render again' : 'Render'}</Button>}
      {project.render?.state === 'rendering' && <Progress render={project.render}/>}
      {project.render?.state === 'failed' && !rendering && <p className="form-error" role="alert">The last render failed: {project.render.error}</p>}
    </Section>

    {children}

    {project.switches && Object.keys(project.switches).length > 0 && <Section title="In the video">
      {Object.entries(project.switches).map(([kind, on]) => kind === 'zooms'
        ? <label key={kind} className="line" data-tip="Picking again replaces the zooms with automatic ones (Ctrl+Z undoes)"><span>Auto zoom</span>
          <select value={on} onChange={event => edit('project-switch', {kind, on: event.target.value !== 'off', mode: event.target.value})}>
            {zoomModes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        : <Switch key={kind} label={switchNames[kind][0]} tip={switchNames[kind][1]} checked={on} onChange={value => edit('project-switch', {kind, on: value})}/>)}
    </Section>}

    {project.look && <Frame look={project.look} edit={edit}/>}

    {project.speed && <Section title="Speed">
      <select aria-label="Playback speed" data-tip="How fast the whole video plays (Ctrl+Z undoes)" value={String(project.speed.whole)} onChange={event => edit('project-speed', {speed: Number(event.target.value)})}>
        {[...new Set([...speeds, project.speed.whole])].sort((a, b) => a - b).map(speed => <option key={speed} value={speed}>{speed === 1 ? '1× as recorded' : speed + '×'}</option>)}
      </select>
      {project.speed.parts && <p className="hint">Some parts have their own speed. Picking here resets them.</p>}
    </Section>}

    {project.camera && <Section title="Camera">
      <Switch label="Round" tip="A circle, or a rounded rectangle" checked={project.camera.round} onChange={round => edit('project-camera', {camera: {round}})}/>
      <label className="line" data-tip="How big the bubble is"><span>Size</span><input type="range" min="0.1" max="0.45" step="0.01" value={size ?? project.camera.size ?? 0.2}
        onChange={event => setSize(Number(event.target.value))} onPointerUp={() => size != null && edit('project-camera', {camera: {size}}).then(() => setSize(null))}
        onKeyUp={() => size != null && edit('project-camera', {camera: {size}}).then(() => setSize(null))}/></label>
      <label className="line" data-tip="Which corner the bubble sits in"><span>Corner</span><select value={project.camera.position || 'bottom-right'} onChange={event => edit('project-camera', {camera: {position: event.target.value}})}>
        {corners.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </Section>}

    <Section title="Your agent">
      <div className="prompt"><code>{project.prompt}…</code>
        <Button size="small" icon={Copy} tip="Copy, paste into your agent, then say what to change" onClick={() => copy('prompt', project.prompt)}>{copied === 'prompt' ? 'Copied' : 'Copy'}</Button></div>
    </Section>

    {facts.length > 0 && <Section title="Details">
      <dl className="facts">{facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    </Section>}

    <Steps project={project}/>
  </aside>;
}
