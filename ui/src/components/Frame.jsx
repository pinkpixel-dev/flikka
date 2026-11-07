import React from 'react';
import {Range, Section, Switch} from './ui.jsx';

const shapes = [['square', 'Square', '1:1, fits a feed and a screen'], ['landscape', 'Landscape', '16:9, for YouTube'],
  ['portrait', 'Portrait', '4:5, fills a phone feed'], ['vertical', 'Vertical', '9:16, for Shorts, Reels and TikTok']];

// How the video frames the recording: its shape, the wallpaper behind it, and the margin, corners and shadow.
// `look` comes from the panel's project summary; every change is one saved edit (Ctrl+Z undoes it).
export function Frame({look, edit}) {
  const set = change => edit('project-look', change);
  return <Section title="Frame">
    <div className="shapes" role="group" aria-label="Shape">
      {shapes.map(([name, label, tip]) => {
        const [width, height] = {square: [1, 1], landscape: [16, 9], portrait: [4, 5], vertical: [9, 16]}[name];
        return <button key={name} type="button" aria-pressed={look.shape === name} data-tip={tip} onClick={() => look.shape !== name && set({shape: name})}>
          <span className="shape-icon" aria-hidden><span style={{aspectRatio: `${width} / ${height}`}}/></span>{label}</button>;
      })}
    </div>
    {!look.shape && <p className="hint">Custom size, {look.width}×{look.height}</p>}

    <div className="swatches" role="group" aria-label="Background">
      {Object.entries(look.backgrounds).map(([name, css]) =>
        <button key={name} type="button" aria-pressed={look.background === name} aria-label={name} data-tip={name[0].toUpperCase() + name.slice(1)}
          style={{background: css}} onClick={() => look.background !== name && set({background: name})}/>)}
      {look.background === 'custom' && <button type="button" aria-pressed aria-label="Custom" data-tip="Custom background, set from the CLI" style={{background: look.css}}/>}
    </div>

    <Range label="Padding" tip="Space between the recording and the edge of the video" value={look.padding} min={0} max={look.most} step={4} unit=" px" onCommit={padding => set({padding})}/>
    <Range label="Corners" tip="How round the recording's corners are" value={look.radius} min={0} max={Math.max(60, look.radius)} unit=" px" onCommit={radius => set({radius})}/>
    <Switch label="Shadow" tip="A soft shadow under the recording" checked={look.shadow} onChange={shadow => set({shadow})}/>
  </Section>;
}
