import React from 'react';
import {X} from 'lucide-react';
import {clock} from '../lib/format.js';
import {Button, Progress} from './ui.jsx';

const finished = item => ['done', 'failed', 'cancelled'].includes(item.state);

function status(item) {
  if (item.state === 'queued') return item.ahead ? `Waiting · ${item.ahead} ahead` : 'Up next';
  if (item.state === 'done') return `Done in ${clock((item.ended - item.started) / 1000)}`;
  if (item.state === 'failed') return 'Failed';
  if (item.state === 'cancelled') return 'Cancelled';
  return null;
}

// The panel's render queue, in the sidebar while it has anything: what's rendering (with its step and how far),
// what waits, and what finished since (until cleared). Renders from an agent or the CLI aren't queued here.
export function Renders({items, onCancel, onClear}) {
  if (!items?.length) return null;
  return <section className="renders" aria-label="Renders">
    <div className="list-title renders-title"><span>Renders</span>
      {items.some(finished) && <button type="button" className="text-button" data-tip="Clear finished renders from this list" onClick={onClear}>Clear</button>}</div>
    <ul>
      {items.map(item => <li key={item.id + item.added} className={`render-item ${item.state}`}>
        <a href={'#project/' + item.id} data-tip={item.state === 'failed' ? item.error : `Open ${item.name}`}>
          <b>{item.name}</b>
          {item.state === 'rendering' ? <Progress compact render={item.render || {step: 'Starting', progress: null}}/> : <small>{status(item)}</small>}
        </a>
        {item.state === 'queued' && <Button size="small" variant="ghost" icon={X} tip="Take it out of the queue" onClick={() => onCancel(item.id)}/>}
      </li>)}
    </ul>
  </section>;
}
