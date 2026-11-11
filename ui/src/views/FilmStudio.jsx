import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Undo2} from 'lucide-react';
import {api, media, uploadLayer} from '../lib/api.js';
import {usePlayerKeys} from '../lib/hooks.js';
import {useToast} from '../lib/toast.js';
import {Inspector} from '../components/Inspector.jsx';
import {Player} from '../components/Player.jsx';
import {Scenes} from '../components/Scenes.jsx';
import {FilmEditor, newScene, sceneKinds} from '../components/SceneForm.jsx';
import {FilmNarration} from '../narration/Sentences.jsx';
import {LayerList} from '../layers/LayerList.jsx';
import {LayerStage} from '../layers/LayerStage.jsx';
import {applySceneLayers, sceneLayerView} from '../layers/film.js';
import {Button, Section} from '../components/ui.jsx';

// The film with the open form's draft in it: a scene's (index ≥ 0) or the settings' (index -1, keys kept in order).
function withDraft(film, index, draft) {
  if (draft == null) return film;
  if (index >= 0) return {...film, scenes: film.scenes.map((scene, at) => at === index ? draft : scene)};
  const keys = [...new Set([...Object.keys(film), ...Object.keys(draft)])];
  return Object.fromEntries(keys.flatMap(key => key === 'scenes' ? [[key, film.scenes]] : key in draft ? [[key, draft[key]]] : []));
}

// A film: the player (the exported video, or the film built live from film.json with its narration and music),
// the scene strip under it, and the open scene's fields on the right. Every save writes film.json (checked
// against the schema, undone with Ctrl+Z) and the live film is built again; an agent's edits show up the same way.
export function FilmStudio({project, refresh, onChange}) {
  const toast = useToast();
  const player = useRef(null);
  const [time, setTime] = useState(0);
  const [shown, setShown] = useState(project.final && project.state !== 'rendering' ? 'final' : 'live');
  const [preview, setPreview] = useState(null);
  const [problem, setProblem] = useState(null);
  const [film, setFilm] = useState(null);
  const [schema, setSchema] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState(null);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState(null);
  const [version, setVersion] = useState(0);
  // The open scene's overlay layer being worked on (its box shows over the player), the Inspector's tab, auto-key.
  const [chosenLayer, setChosenLayer] = useState(null);
  const [tab, setTab] = useState('edit');
  const [autoKey, setAutoKey] = useState(false);
  const final = project.final;
  const showing = final ? shown : 'live';

  useEffect(() => {
    api('film-schema').then(setSchema).catch(failure => toast(failure.message));
    api('projects').then(list => setRecordings(list.filter(item => item.recording))).catch(() => {});
  }, []);
  // film.json, and the live film built from it, again whenever it changes (here or by an agent).
  useEffect(() => {
    let current = true;
    api('film', {id: project.id}).then(next => current && setFilm(next.film)).catch(failure => current && toast(failure.message));
    return () => { current = false; };
  }, [project.id, project.edited]);
  // Its sentences: spoken yet, and what the words check heard (again after speaking or checking).
  useEffect(() => {
    let current = true;
    api('film-lines', {id: project.id}).then(next => current && setLines(next)).catch(() => {});
    return () => { current = false; };
  }, [project.id, project.edited, version]);
  useEffect(() => {
    if (showing !== 'live') return;
    let current = true;
    api('project-preview', {id: project.id}).then(next => { if (current) { setPreview({...next, src: next.src + '?v=' + Date.now()}); setProblem(null); } })
      .catch(failure => current && setProblem(failure.message));
    return () => { current = false; };
  }, [project.id, project.edited, showing, version]);
  // A new export shows itself.
  const exported = final?.output + final?.elapsedSeconds;
  const firstExport = useRef(exported);
  useEffect(() => { if (exported !== firstExport.current && project.state !== 'rendering') { firstExport.current = exported; setShown('final'); setChanged(false); } }, [exported, project.state]);

  const scenes = film?.scenes || [];
  const index = Math.min(selected, scenes.length - 1);
  const settings = useMemo(() => film && Object.fromEntries(Object.entries(film).filter(([key]) => key !== 'scenes')), [film]);
  const value = draft ?? (index >= 0 ? scenes[index] : settings);
  // Where each scene sits: the live film's, or the export's while it matches the film.
  const timing = preview ? preview.scenes : final?.scenes?.length === scenes.length ? final.scenes : null;
  const kinds = useMemo(() => schema ? sceneKinds(schema) : [], [schema]);
  const names = useMemo(() => Object.fromEntries(recordings.map(item => [item.id, item.name])), [recordings]);

  // Saves the whole film and opens `open` (a scene, or -1). The strip shows the change at once; a refused save
  // puts it back and says why (in the form, and in a toast when `loud`, for saves made from elsewhere).
  const save = async (next, open = index, loud = false) => {
    if (saving) return false;
    const before = {film, selected};
    setSaving(true); setErrors(null); setFilm(next); setSelected(open);
    try {
      await api('film-save', {id: project.id, film: next});
      setDraft(null); setChanged(true); setShown('live'); setPreview(old => old && {...old, scenes: null});
      return true;
    } catch (failure) { setFilm(before.film); setSelected(before.selected); setErrors(failure.message); if (loud) toast(failure.message); return false; }
    finally { setSaving(false); refresh(); }
  };
  const current = () => withDraft(film, index, draft);

  // The open scene's layers, in the live film's seconds (ui/src/layers/film.js), once the film says where it sits.
  // While the live film is built again after a save, the scene keeps where it last sat (a layer doesn't move it).
  const placed = useRef({});
  if (index >= 0 && timing?.[index]) placed.current[index] = timing[index];
  const part = index >= 0 ? timing?.[index] || placed.current[index] : null;
  const layers = part && value ? sceneLayerView(value, part) : [];
  function chooseLayer(id) {
    setChosenLayer(id);
    if (id) { setTab('layers'); setShown('live'); }
  }
  useEffect(() => { setChosenLayer(null); if (index < 0) setTab(old => old === 'layers' ? 'edit' : old); }, [index]);
  useEffect(() => { if (chosenLayer && part && !layers.some(layer => layer.id === chosenLayer)) setChosenLayer(null); }, [film, draft, part]);
  // Layer changes go into the scene and the whole film is saved (one undo step), like the form's own saves.
  const layerEdit = async changes => {
    const whole = current();
    const {scene, renamed, added} = applySceneLayers(whole.scenes[index], changes, part);
    if (!await save({...whole, scenes: whole.scenes.map((item, at) => at === index ? scene : item)}, index, true)) throw new Error('Not saved');
    if (added) chooseLayer(added);
    else if (renamed[chosenLayer]) setChosenLayer(renamed[chosenLayer]);
  };
  // A picture or video is copied into the project first, then added like any layer.
  const layerUpload = async (file, fields) => {
    let stored;
    try { stored = (await uploadLayer(project.id, file, {type: fields.type, keep: 1})).file; }
    catch (failure) { toast(failure.message); throw failure; }
    await layerEdit([{add: {...fields, file: stored}}]);
  };
  const removeLayer = id => { setChosenLayer(null); layerEdit([{remove: id}]).catch(() => {}); };
  const open = async at => {
    if (draft && !await save(current(), at)) return;
    setSelected(at); setErrors(null);
    const part = timing?.[at];
    // A little way in, past the transition from the scene before.
    if (part) player.current?.seek(part.start + Math.min(1, part.seconds / 4));
  };
  const move = (from, to) => {
    const next = [...current().scenes];
    next.splice(to, 0, ...next.splice(from, 1));
    save({...current(), scenes: next}, to);
  };
  const remove = () => {
    const next = current().scenes.filter((_, at) => at !== index);
    save({...current(), scenes: next}, Math.min(index, next.length - 1));
  };
  const add = kind => {
    const next = [...current().scenes];
    next.splice(index + 1, 0, newScene(schema, kind, recordings[0]?.id));
    save({...current(), scenes: next}, index + 1);
  };
  const undo = async () => {
    try { await api('project-undo', {id: project.id}); setDraft(null); setErrors(null); setChanged(true); setShown('live'); }
    catch (failure) { toast(failure.message); }
    finally { refresh(); }
  };
  const render = async () => {
    if (busy) return;
    setBusy(true); toast('');
    try { await api('render', {id: project.id}); } catch (failure) { toast(failure.message); }
    finally { setBusy(false); refresh(); onChange(); }
  };
  const rendering = busy || project.state === 'rendering';

  usePlayerKeys(player, undo);
  // Ctrl+S saves the open form, from anywhere (also while typing in it).
  const saveLatest = useRef(null);
  saveLatest.current = () => draft && save(current());
  useEffect(() => {
    const keys = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveLatest.current(); } };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, []);

  const source = showing === 'final' ? {src: media(project.id, 'final') + '&v=' + final.elapsedSeconds, video: true, width: final.width, height: final.height}
    : preview ? {src: preview.src, video: false, width: preview.width, height: preview.height} : {src: null, width: 16, height: 9};
  const fps = (showing === 'final' ? final.fps : preview?.fps) || 30;
  const ratio = preview ? preview.width / preview.height : 16 / 9;
  const layerStage = chosenLayer && showing === 'live' && preview && layers.length > 0 &&
    <LayerStage layers={layers} chosen={chosenLayer} time={time} ratio={ratio} fps={fps} autoKey={autoKey} onChoose={chooseLayer}
      onSave={changes => layerEdit(changes)} onRemove={removeLayer} onDone={() => setChosenLayer(null)}/>;

  return <div className="studio">
    <div className="stage-column">
      <Player ref={player} {...source} fps={fps} onTime={setTime} note={problem && !preview ? 'The live film can’t be built yet.' : undefined} overlay={layerStage}>
        <Button icon={Undo2} variant="ghost" size="small" tip="Undo the last save (Ctrl+Z)" disabled={rendering || saving} onClick={undo}/>
        <div className="segmented" role="tablist" aria-label="What plays">
          <button type="button" role="tab" aria-selected={showing === 'final'} disabled={!final} data-tip="The exported video file" onClick={() => setShown('final')}>Exported</button>
          <button type="button" role="tab" aria-selected={showing === 'live'} data-tip="The film as film.json is now, with narration and music" onClick={() => setShown('live')}>Live</button>
        </div>
      </Player>
      {problem && <div className="banner problem" role="alert">{problem}</div>}
      {rendering && <div className="banner">Rendering the film… the live preview plays meanwhile.</div>}
      {!rendering && !final && <div className="banner">Not exported yet. This is the live preview.</div>}
      {showing === 'live' && preview?.narration && preview.narration.spoken < preview.narration.total &&
        <div className="banner">{preview.narration.spoken} of {preview.narration.total} sentences spoken. The rest play once you render.</div>}
      {film && <Scenes scenes={scenes} timing={timing} selected={index} time={time} names={names} kinds={kinds} onSelect={open} onMove={move} onAdd={add}/>}
    </div>
    <Inspector project={project} render={render} rendering={rendering} changed={changed} tab={tab} onTab={setTab}
      layers={film && value && index >= 0 && (!part ? <Section title="Layers"><p className="hint">Layers go on the live film.</p>
        <Button size="small" onClick={() => setShown('live')}>{showing === 'live' ? 'Building the live film…' : 'Show live'}</Button></Section> : <LayerList layers={layers} chosen={chosenLayer} time={time} fps={fps} ratio={ratio} first={part.start} last={part.start + part.seconds}
        scene={part} autoKey={autoKey} onAutoKey={setAutoKey} onChoose={chooseLayer} onSeek={seconds => player.current?.seek(seconds)} onEdit={layerEdit} onUpload={layerUpload}/>)}
      narration={film && <FilmNarration project={project} film={current()} lines={lines} timing={timing} onSave={next => save(next)}
        onSeek={seconds => player.current?.seek(seconds)} onChanged={() => setVersion(old => old + 1)}/>}>
      {film && schema && value && <FilmEditor schema={schema} film={film} index={index} value={value} dirty={draft != null} saving={saving} errors={errors}
        recordings={recordings} onChange={setDraft} onSave={() => save(current())} onRevert={() => { setDraft(null); setErrors(null); }} onRemove={remove}/>}
    </Inspector>
  </div>;
}
