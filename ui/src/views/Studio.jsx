import React, {useEffect, useRef, useState} from 'react';
import {Undo2} from 'lucide-react';
import {api, media} from '../lib/api.js';
import {usePlayerKeys} from '../lib/hooks.js';
import {useToast} from '../lib/toast.js';
import {AimBar, AimStage, aimFrame} from '../components/Aim.jsx';
import {Inspector} from '../components/Inspector.jsx';
import {Player} from '../components/Player.jsx';
import {Timeline} from '../components/Timeline.jsx';
import {Button} from '../components/ui.jsx';

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
  const [version, setVersion] = useState(0);
  // A zoom being aimed on the recording: the zoom, and where and how close it looks for now.
  const [aim, setAim] = useState(null);
  const [aiming, setAiming] = useState(false);
  const editable = Boolean(project.recording);
  const showing = !project.final || !editable ? (project.final ? 'final' : editable ? 'live' : 'none') : shown;

  // The live composition and the timeline, written again whenever the project changes (here or by an agent).
  useEffect(() => {
    if (!editable) return;
    let current = true;
    api('project-timeline', {id: project.id}).then(next => current && setTimeline(next)).catch(failure => current && toast('Timeline: ' + failure.message));
    return () => { current = false; };
  }, [project.id, project.edited, version]);
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
  // From the timeline: the edit, then the timeline and preview again. It fails loudly, so the timeline can drop
  // what it drew while saving.
  const timelineEdit = async body => {
    try { await api('project-timeline-edit', {id: project.id, ...body}); setChanged(true); setShown('live'); setVersion(old => old + 1); }
    catch (failure) { toast(failure.message); throw failure; }
    finally { refresh(); }
  };
  // Back one saved edit (any edit: a switch, the timeline, or an agent's).
  const undo = async () => {
    try { await api('project-undo', {id: project.id}); setChanged(true); setShown('live'); setVersion(old => old + 1); }
    catch (failure) { toast(failure.message); }
    finally { refresh(); }
  };
  const startAim = zoom => { player.current?.step(0); setAim({zoom, x: zoom.x, y: zoom.y, scale: zoom.scale}); };
  const saveAim = async () => {
    if (!aim || aiming) return;
    const {zoom, scale} = aim, {x, y} = aimFrame(aim, timeline?.crop);
    setAiming(true);
    try { await timelineEdit({unzoom: (zoom.from + zoom.to) / 2, zoom: {from: zoom.from, to: zoom.to, x: +x.toFixed(4), y: +y.toFixed(4), scale}}); setAim(null); } catch {}
    finally { setAiming(false); }
  };
  const render = async () => {
    if (busy) return;
    setBusy(true); toast('');
    try { await api('render', {id: project.id}); } catch (failure) { toast(failure.message); }
    finally { setBusy(false); refresh(); onChange(); }
  };
  const rendering = busy || project.state === 'rendering';

  usePlayerKeys(player, editable ? undo : null);

  const final = project.final;
  const source = showing === 'final' ? {src: media(project.id, 'final') + '&v=' + final.elapsedSeconds, video: true, width: final.width, height: final.height}
    : showing === 'live' && preview ? {src: preview.src, video: false, width: preview.width, height: preview.height} : {src: null, width: 16, height: 9};
  const fps = showing === 'live' ? 30 : timeline?.fps || project.fps || 30;
  const stale = showing === 'final' && timeline && Math.abs(final.duration - timeline.duration) > 0.05;

  return <div className="studio">
    <div className="stage-column">
      <Player ref={player} {...source} fps={fps} onTime={setTime} note={showing === 'none' ? 'This project has no recording to edit.' : undefined}
        overlay={aim && timeline && <AimStage src={media(project.id, 'raw')} timeline={timeline} aim={aim} onChange={change => setAim(old => ({...old, ...change}))} onSave={saveAim} onCancel={() => setAim(null)}/>}>
        {aim && <AimBar aim={aim} saving={aiming} onChange={change => setAim(old => ({...old, ...change}))} onSave={saveAim} onCancel={() => setAim(null)}/>}
        {editable && !aim && <Button icon={Undo2} variant="ghost" size="small" tip="Undo the last edit (Ctrl+Z)" disabled={rendering} onClick={undo}/>}
        {editable && !aim && <div className="segmented" role="tablist" aria-label="What plays">
          <button type="button" role="tab" aria-selected={showing === 'final'} disabled={!final} data-tip="The exported video file" onClick={() => setShown('final')}>Exported</button>
          <button type="button" role="tab" aria-selected={showing === 'live'} data-tip="The edit as it is now, drawn live (30 fps)" onClick={() => setShown('live')}>Live</button>
        </div>}
      </Player>
      {rendering && <div className="banner">Rendering the video… the live preview plays meanwhile.</div>}
      {!rendering && editable && !final && <div className="banner">Not exported yet. This is the live preview.</div>}
      {stale && <div className="banner">The timeline shows the edit as it is now. Render to update the exported video.</div>}
      {editable && timeline && <Timeline timeline={timeline} time={time} fps={fps} stale={stale} onEdit={timelineEdit} onAim={startAim} onSeek={seconds => player.current?.seek(seconds)}/>}
    </div>
    <Inspector project={project} edit={edit} render={render} rendering={rendering} changed={changed}/>
  </div>;
}
