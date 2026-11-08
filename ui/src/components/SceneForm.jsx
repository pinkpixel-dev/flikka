import React, {useState} from 'react';
import {RotateCcw, Trash2} from 'lucide-react';
import {Button, Section} from './ui.jsx';

// The film editor's form, drawn from film.schema.json: one input per field of the selected scene (or of the
// film's settings), with the field's description as its tooltip.

export function resolve(schema, node) {
  while (node?.$ref) node = node.$ref.slice(2).split('/').reduce((value, key) => value[key], schema);
  return node || {};
}

// The kinds of scene, in the schema's order.
export const sceneKinds = schema => schema.$defs.scene.oneOf.map(option => option.$ref.split('/').pop());
// "accentText" → "Accent text".
export const title = key => key.replace(/[A-Z]/g, letter => ' ' + letter.toLowerCase()).replace(/^./, letter => letter.toUpperCase());

// A value that passes the schema for a new scene's required fields: "New", the smallest number, one of each list.
function placeholder(schema, declared, key, recording) {
  const spec = resolve(schema, declared);
  if (key === 'recording') return recording || 'name-of-recording';
  if (spec.enum) return spec.enum[0];
  const type = [].concat(spec.type || 'object')[0];
  if (type === 'string') return 'New';
  if (type === 'number' || type === 'integer') return spec.minimum ?? 1;
  if (type === 'boolean') return false;
  if (type === 'array') return Array.from({length: Math.max(1, spec.minItems || 1)}, () => placeholder(schema, spec.items, null, recording));
  return Object.fromEntries((spec.required || []).map(name => [name, placeholder(schema, spec.properties?.[name], name, recording)]));
}

// `recording`: the id a new recording scene starts with (the newest recording).
export function newScene(schema, kind, recording) {
  const definition = resolve(schema, schema.$defs[kind]);
  const scene = {type: kind};
  for (const key of definition.required || []) if (key !== 'type') scene[key] = placeholder(schema, definition.properties[key], key, recording);
  return scene;
}

const long = ['say', 'subtitle', 'note', 'text'];

// One input for one field; `value === undefined` means not set (the default). Text that is still being typed
// (lists, JSON) stays as typed until focus leaves.
function Field({schema, name, declared, value, required, onChange}) {
  const spec = {...resolve(schema, declared), ...(declared.description && {description: declared.description})};
  const [text, setText] = useState(null);
  const [bad, setBad] = useState(false);
  const type = spec.enum ? 'enum' : [].concat(spec.type || 'json')[0];
  const item = type === 'array' ? resolve(schema, spec.items) : null;
  const lines = item?.type === 'string';
  const shape = item?.properties && `A list of {${Object.keys(item.properties).map(key => key + (item.required?.includes(key) ? '*' : '')).join(', ')}}.`;
  const rich = declared.$ref === '#/$defs/rich' && declared.description;
  const tip = [spec.description, !lines && shape, rich && '*Muted words*, [accent words].'].filter(Boolean).join(' ') || undefined;
  const label = <span>{title(name)}{required && <span className="required" aria-hidden> *</span>}</span>;
  const common = {'data-tip': tip, 'aria-required': required || undefined};
  let input;
  if (type === 'enum') input = <select {...common} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? undefined : spec.enum.find(option => String(option) === event.target.value))}>
    {!required && <option value="">Default</option>}{spec.enum.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select>;
  // On, off, or left to the default (which isn't always off).
  else if (type === 'boolean') input = <select {...common} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}>
    {!required && <option value="">Default</option>}<option value="true">On</option><option value="false">Off</option></select>;
  else if (type === 'number' || type === 'integer') input = <input {...common} type="number" step={type === 'integer' ? 1 : 'any'} min={spec.minimum} max={spec.maximum} value={value ?? ''}
    onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))}/>;
  else if (type === 'string') input = long.includes(name)
    ? <textarea {...common} value={value ?? ''} onChange={event => onChange(event.target.value || undefined)}/>
    : <input {...common} type="text" list={name === 'recording' ? 'film-recordings' : undefined} value={value ?? ''} onChange={event => onChange(event.target.value || undefined)}/>;
  else if (lines) input = <textarea {...common} placeholder="One per line" value={text ?? (value || []).join('\n')} onBlur={() => setText(null)}
    onChange={event => { setText(event.target.value); onChange(event.target.value.trim() ? event.target.value.split('\n').filter(Boolean) : undefined); }}/>;
  else input = <textarea {...common} className={`code ${bad ? 'bad' : ''}`} aria-invalid={bad || undefined} spellCheck={false}
    value={text ?? (value === undefined ? '' : JSON.stringify(value, null, 2))} onBlur={() => !bad && setText(null)}
    onChange={event => { setText(event.target.value); try { onChange(event.target.value.trim() ? JSON.parse(event.target.value) : undefined); setBad(false); } catch { setBad(true); } }}/>;
  return <label className={`field ${value === undefined ? 'unset' : ''}`}>{label}{input}{bad && <small className="form-error">Not valid JSON yet</small>}</label>;
}

// The right column's editor: the selected scene, or the film's settings (index -1). Changes stay in `value`
// (the draft) until Save (or Ctrl+S); `errors` are the schema's answer to the last save.
export function FilmEditor({schema, film, index, value, dirty, saving, errors, recordings, onChange, onSave, onRevert, onRemove}) {
  const scene = index >= 0;
  const definition = scene ? resolve(schema, schema.$defs[value.type]) : schema;
  const keys = Object.keys(definition.properties || {}).filter(key => !['type', 'scenes', '$schema'].includes(key));
  const set = (key, next) => { const changed = {...value}; if (next === undefined) delete changed[key]; else changed[key] = next; onChange(changed); };
  return <Section title={scene ? `Scene ${index + 1} · ${title(value.type)}` : 'Film settings'} aside={<div className="button-row">
    <Button size="small" variant="ghost" icon={RotateCcw} tip="Drop the changes" disabled={!dirty || saving} onClick={onRevert}/>
    {scene && <Button size="small" variant="ghost" icon={Trash2} tip="Delete this scene (Ctrl+Z undoes)" disabled={film.scenes.length < 2 || saving} onClick={onRemove}/>}
    <Button size="small" variant={dirty ? 'primary' : undefined} tip="Save to film.json (Ctrl+S)" disabled={!dirty || saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</Button>
  </div>}>
    {errors && <p className="form-error" role="alert">{errors}</p>}
    <div className="fields">
      {keys.map(key => <Field key={`${index}-${key}`} schema={schema} name={key} declared={definition.properties[key]} value={value[key]}
        required={definition.required?.includes(key)} onChange={next => set(key, next)}/>)}
    </div>
    <datalist id="film-recordings">{recordings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist>
  </Section>;
}
