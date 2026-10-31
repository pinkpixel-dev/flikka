import React from 'react';
import {Camera, Clapperboard, Image, Mic} from 'lucide-react';
import {thumb} from '../lib/api.js';
import {clock, states, when} from '../lib/format.js';

// New recording, screenshots and voices, then every project, newest first.
export function Sidebar({projects, current, view, counts}) {
  return <aside className="sidebar">
    <div className="brand"><span className="brand-mark" aria-hidden/>flikka</div>
    <a className={`button record new ${view === 'new' ? 'on' : ''}`} href="#new" data-tip="Set up a new screen recording" aria-current={view === 'new' ? 'page' : undefined}>
      <Camera size={17} strokeWidth={1.8} aria-hidden/>New recording</a>
    <nav className="nav" aria-label="Library">
      <a href="#shots" className={view === 'shots' ? 'on' : ''} aria-current={view === 'shots' ? 'page' : undefined}><Image size={16} strokeWidth={1.8} aria-hidden/>Screenshots<span>{counts.shots || ''}</span></a>
      <a href="#voices" className={view === 'voices' ? 'on' : ''} aria-current={view === 'voices' ? 'page' : undefined}><Mic size={16} strokeWidth={1.8} aria-hidden/>Voices<span>{counts.voices || ''}</span></a>
    </nav>
    <div className="list-title">Projects</div>
    <div className="list">
      {projects?.length === 0 && <div className="empty">No recordings yet.</div>}
      {projects?.map(item => <a key={item.id} href={'#project/' + item.id} className={`item ${current === item.id ? 'on' : ''}`} aria-current={current === item.id ? 'page' : undefined}>
        <span className="thumb" style={item.duration || item.final ? {backgroundImage: `url("${thumb(item.id)}")`} : undefined}>
          {!item.duration && !item.final && (item.film ? <Clapperboard size={16} aria-hidden/> : <span className="dot"/>)}</span>
        <span className="item-text">
          <b>{item.name}</b>
          <small>{when(item.created)}{item.final ? ' · ' + clock(item.final.duration) : item.duration ? ' · ' + clock(item.duration) : ''}</small>
          <span className={`chip ${item.state}`}><span className="dot"/>{states[item.state] || item.state}</span>
        </span>
      </a>)}
    </div>
  </aside>;
}
