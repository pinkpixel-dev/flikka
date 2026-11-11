import React, {useEffect, useRef, useState} from 'react';
import {Undo2} from 'lucide-react';
import {api, media, uploadLayer} from '../lib/api.js';
import {usePlayerKeys} from '../lib/hooks.js';
import {useToast} from '../lib/toast.js';
import {AimBar, AimStage, aimFrame} from '../components/Aim.jsx';
import {Inspector} from '../components/Inspector.jsx';
import {LayerList} from '../layers/LayerList.jsx';
import {LayerStage} from '../layers/LayerStage.jsx';
import {Narration} from '../narration/Lines.jsx';
import {Player} from '../components/Player.jsx';
import {Timeline} from '../components/Timeline.jsx';
import {Button} from '../components/ui.jsx';

// A finished recording or film: the big player (the exported video, or the edit drawn live from the project at
// 30 fps so a change shows at once), the timeline under it, the edits on the right.
export function Studio({project, refresh, onChange}) {
  const toast = useToast();
  const player = useRef(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(project.final && project.state !== 'rendering' ? 'final' : 'live');
  const [preview, setPreview] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  // A zoom being aimed on the recording: the zoom, and where and how close it looks for now.
  const [aim, setAim] = useState(null);
  const [aiming, setAiming] = useState(false);
  // The overlay layer being worked on (its box shows over the player), and the Inspector's tab.
  const [chosenLayer, setChosenLayer] = useState(null);
  const [tab, setTab] = useState('edit');
  // Auto-key: edits to a layer's box, opacity and turn write keyframes at the playhead (render/keyframes.js).
  const [autoKey, setAutoKey] = useState(false);
  // The layers there were before one was added: the new one gets chosen once the timeline shows it.
  const adding = useRef(null);
  // The project file's stamp the timeline was read at (or the panel's own last edit left): edits send it back, and
  // one made against an older project is refused (lib/ui.mjs fresh()), so the timeline is read again.
  const stamp = useRef();
  const editable = Boolean(project.recording);
  const showing = !project.final || !editable ? (project.final ? 'final' : editable ? 'live' : 'none') : shown;

  // A layer that's gone (removed, cut whole, undone) lets go; a layer just added is chosen.
  useEffect(() => {
    const layers = timeline?.layers || [];
    if (adding.current) {
      const added = layers.find(layer => !adding.current.has(layer.id));
      if (added) { adding.current = null; chooseLayer(added.id); return; }
    }
    if (chosenLayer && !layers.some(layer => layer.id === chosenLayer)) setChosenLayer(null);
  }, [timeline]);

  // The live composition and the timeline, written again whenever the project changes (here or by an agent).
  useEffect(() => {
    if (!editable) return;
    let current = true;
    api('project-timeline', {id: project.id}).then(next => { if (current) { stamp.current = next.edited; setTimeline(next); } }).catch(failure => current && toast('Timeline: ' + failure.message));
    return () => { current = false; };
  }, [project.id, project.edited, version]);
  useEffect(() => {
    if (!editable || showing !== 'live') return;
    let current = true;
    api('project-preview', {id: project.id}).then(next => current && setPreview({...next, src: next.src + '?v=' + Date.now()}))
      .catch(failure => current && toast('Live preview: ' + failure.message));
    return () => { current = false; };
  }, [project.id, project.edited, showing, version]);
  // A new export shows itself.
  const exported = project.final?.output + project.final?.elapsedSeconds;
  const firstExport = useRef(exported);
  useEffect(() => { if (exported !== firstExport.current && project.state !== 'rendering') { firstExport.current = exported; setShown('final'); setChanged(false); } }, [exported, project.state]);

  const edit = async (action, body) => {
    try { await api(action, {id: project.id, ...body}); setChanged(true); setShown('live'); }
    catch (failure) { toast(failure.message); }
    finally { refresh(); }
  };
  // Timeline and narration edits: the edit, then the timeline and preview again. Refused as stale, the timeline is
  // read again too.
  const guarded = async (action, body) => {
    try { const result = await api(action, {id: project.id, edited: stamp.current, ...body}); stamp.current = result.edited; setChanged(true); setShown('live'); }
    catch (failure) { toast(failure.message); throw failure; }
    finally { setVersion(old => old + 1); refresh(); }
  };
  // From the narration list and lane: true when it saved.
  const narrationEdit = changes => guarded('project-narration', {changes}).then(() => true, () => false);
  // From the timeline: it fails loudly, so the timeline can drop what it drew while saving.
  const timelineEdit = body => guarded('project-timeline-edit', body);
  // Layer edits from the timeline, the player and the Layers tab (they fail loudly, like the timeline's).
  // adding: remember the layers there are, so the new one is chosen when it shows up.
  const layerEdit = (changes, add) => {
    adding.current = add ? new Set((timeline?.layers || []).map(layer => layer.id)) : null;
    return guarded('project-layers', {changes}).catch(failure => { adding.current = null; throw failure; });
  };
  const layerUpload = async (file, fields) => {
    adding.current = new Set((timeline?.layers || []).map(layer => layer.id));
    try { const result = await uploadLayer(project.id, file, {...fields, edited: stamp.current}); stamp.current = result.edited; setChanged(true); setShown('live'); }
    catch (failure) { adding.current = null; toast(failure.message); throw failure; }
    finally { setVersion(old => old + 1); refresh(); }
  };
  // Choosing a layer shows the live edit (its box sits on that) and its settings.
  function chooseLayer(id) {
    setChosenLayer(id);
    if (id) { setTab('layers'); setShown('live'); setAim(null); }
  }
  const removeLayer = id => { setChosenLayer(null); layerEdit([{remove: id}]).catch(() => {}); };
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
  const seek = seconds => player.current?.seek(seconds);
  // The finished video's shape (the timeline's size, "1080×1080", until the live preview says).
  const [sizeWidth, sizeHeight] = (timeline?.size || '16×9').split('×').map(Number);
  const ratio = preview ? preview.width / preview.height : sizeWidth / sizeHeight || 16 / 9;
  const layerStage = !aim && chosenLayer && showing === 'live' && preview && timeline?.layers?.length > 0 &&
    <LayerStage layers={timeline.layers} chosen={chosenLayer} time={time} ratio={ratio} fps={fps} autoKey={autoKey} onChoose={chooseLayer}
      onSave={changes => layerEdit(changes)} onRemove={removeLayer} onDone={() => setChosenLayer(null)}/>;
  // New layers go in the recording part of the video, not on the intro or outro cards.
  const first = timeline?.intro?.to || 0, last = timeline?.outro?.from ?? timeline?.duration ?? 0;

  return <div className="studio">
    <div className="stage-column">
      <Player ref={player} {...source} fps={fps} onTime={setTime} onPlaying={setPlaying} note={showing === 'none' ? 'This project has no recording to edit.' : undefined}
        overlay={layerStage || aim && timeline && <AimStage src={media(project.id, 'raw')} timeline={timeline} aim={aim} onChange={change => setAim(old => ({...old, ...change}))} onSave={saveAim} onCancel={() => setAim(null)}/>}>
        {aim && <AimBar aim={aim} saving={aiming} onChange={change => setAim(old => ({...old, ...change}))} onSave={saveAim} onCancel={() => setAim(null)}/>}
        {editable && !aim && <Button icon={Undo2} variant="ghost" size="small" tip="Undo the last edit (Ctrl+Z)" disabled={rendering} onClick={undo}/>}
        {editable && !aim && <div className="segmented" role="tablist" aria-label="What plays">
          <button type="button" role="tab" aria-selected={showing === 'final'} disabled={!final} data-tip="The exported video file" onClick={() => setShown('final')}>Exported</button>
          <button type="button" role="tab" aria-selected={showing === 'live'} data-tip="The edit as it is now, drawn live (30 fps)" onClick={() => setShown('live')}>Live</button>
        </div>}
      </Player>
      {rendering && <div className="banner">Rendering the video… the live preview plays meanwhile.</div>}
      {!rendering && editable && !final && <div className="banner">Not exported yet. This is the live preview.</div>}
      {showing === 'live' && preview?.narration && preview.narration.spoken < preview.narration.total &&
        <div className="banner">{preview.narration.spoken} of {preview.narration.total} narration lines spoken. The rest play once you render.</div>}
      {stale && <div className="banner">The timeline shows the edit as it is now. Render to update the exported video.</div>}
      {editable && timeline && <Timeline project={project.id} timeline={timeline} time={time} playing={playing} fps={fps} stale={stale} onEdit={timelineEdit} onNarration={narrationEdit} onAim={startAim} onSeek={seek}
        chosenLayer={chosenLayer} onChooseLayer={chooseLayer} onLayers={layerEdit}/>}
    </div>
    <Inspector project={project} edit={edit} render={render} rendering={rendering} changed={changed} tab={tab} onTab={setTab}
      layers={editable && timeline && <LayerList layers={timeline.layers || []} chosen={chosenLayer} time={time} fps={fps} first={first} last={last} autoKey={autoKey} onAutoKey={setAutoKey}
        ratio={ratio} onChoose={chooseLayer} onSeek={seek} onEdit={layerEdit} onUpload={layerUpload}/>}
      narration={editable && <Narration project={project} timeline={timeline} time={time} onSeek={seconds => player.current?.seek(seconds)}
        onEdit={narrationEdit} onSpoken={() => { setVersion(old => old + 1); refresh(); }}/>}/>
  </div>;
}
