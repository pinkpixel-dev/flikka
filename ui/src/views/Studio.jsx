import React, {useEffect, useRef, useState} from 'react';
import {api, media} from '../lib/api.js';
import {useToast} from '../lib/toast.js';
import {Inspector} from '../components/Inspector.jsx';
import {Player} from '../components/Player.jsx';
import {Timeline} from '../components/Timeline.jsx';

// A finished recording or film: the big player (the exported video, or the edit drawn live from the project at
// 30 fps so a change shows at once), the timeline under it, the edits on the right.
export function Studio({project, refresh, onChange}) {
  const toast = useToast();
  const player = useRef(null);
  const [time, setTime] = useState(0);
  const [shown, setShown] = useState(project.final && project.state !== 'rendering' ? 'final' : 'live');
  const [preview, setPreview] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = Boolean(project.recording);
  const showing = !project.final || !editable ? (project.final ? 'final' : editable ? 'live' : 'none') : shown;

  // The live composition and the timeline, written again whenever the project changes (here or by an agent).
  useEffect(() => {
    if (!editable) return;
    let current = true;
    api('project-timeline', {id: project.id}).then(next => current && setTimeline(next)).catch(failure => current && toast('Timeline: ' + failure.message));
    return () => { current = false; };
  }, [project.id, project.edited]);
  useEffect(() => {
    if (!editable || showing !== 'live') return;
    let current = true;
    api('project-preview', {id: project.id}).then(next => current && setPreview({...next, src: next.src + '?v=' + Date.now()}))
      .catch(failure => current && toast('Live preview: ' + failure.message));
    return () => { current = false; };
  }, [project.id, project.edited, showing]);
  // A new export shows itself.
  const exported = project.final?.output + project.final?.elapsedSeconds;
  const firstExport = useRef(exported);
  useEffect(() => { if (exported !== firstExport.current && project.state !== 'rendering') { firstExport.current = exported; setShown('final'); setChanged(false); } }, [exported, project.state]);

  const edit = async (action, body) => {
    try { await api(action, {id: project.id, ...body}); setChanged(true); setShown('live'); }
    catch (failure) { toast(failure.message); }
    finally { refresh(); }
  };
  const render = async () => {
    if (busy) return;
    setBusy(true); setChanged(false); toast('');
    try { await api('render', {id: project.id}); } catch (failure) { toast(failure.message); }
    finally { setBusy(false); refresh(); onChange(); }
  };
  const rendering = busy || project.state === 'rendering';

  // Space or K plays and pauses, ← → step a frame (Shift: a second), Home and End, M mutes. Not while typing;
  // the focused timeline handles its own arrows.
  useEffect(() => {
    const keys = event => {
      if (event.target.closest('input, select, textarea, [contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
      const controls = player.current;
      if (!controls) return;
      const actions = {' ': () => controls.toggle(), k: () => controls.toggle(), m: () => controls.mute(), Home: () => controls.seek(0), End: () => controls.seek(controls.duration),
        ArrowLeft: () => event.shiftKey ? controls.seek(controls.time - 1) : controls.step(-1), ArrowRight: () => event.shiftKey ? controls.seek(controls.time + 1) : controls.step(1)};
      const action = actions[event.key];
      if (!action || (event.key === ' ' && event.target.closest('button, a, summary'))) return;
      event.preventDefault(); action();
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, []);

  const final = project.final;
  const source = showing === 'final' ? {src: media(project.id, 'final') + '&v=' + final.elapsedSeconds, video: true, width: final.width, height: final.height}
    : showing === 'live' && preview ? {src: preview.src, video: false, width: preview.width, height: preview.height} : {src: null, width: 16, height: 9};
  const fps = showing === 'live' ? 30 : timeline?.fps || project.fps || 30;
  const stale = showing === 'final' && timeline && Math.abs(final.duration - timeline.duration) > 0.05;

  return <div className="studio">
    <div className="stage-column">
      <Player ref={player} {...source} fps={fps} onTime={setTime} note={showing === 'none' ? 'Render the film to watch it here.' : undefined}>
        {editable && <div className="segmented" role="tablist" aria-label="What plays">
          <button type="button" role="tab" aria-selected={showing === 'final'} disabled={!final} data-tip="The exported video file" onClick={() => setShown('final')}>Exported</button>
          <button type="button" role="tab" aria-selected={showing === 'live'} data-tip="The edit as it is now, drawn live (30 fps)" onClick={() => setShown('live')}>Live</button>
        </div>}
      </Player>
      {rendering && <div className="banner">Rendering the video… the live preview plays meanwhile.</div>}
      {!rendering && editable && !final && <div className="banner">Not exported yet. This is the live preview.</div>}
      {stale && <div className="banner">The timeline shows the edit as it is now. Render to update the exported video.</div>}
      {editable && timeline && <Timeline timeline={timeline} time={time} fps={fps} stale={stale} onSeek={seconds => player.current?.seek(seconds)}/>}
    </div>
    <Inspector project={project} edit={edit} render={render} rendering={rendering} changed={changed}/>
  </div>;
}
