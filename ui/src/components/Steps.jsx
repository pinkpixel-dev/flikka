import React, {useEffect, useState} from 'react';
import {Check, ChevronRight, X} from 'lucide-react';

const phases = [['record', 'Finishing the recording'], ['render', 'Rendering the video']];
const seconds = (from, to) => (((to || Date.now()) - from) / 1000).toFixed(1) + ' s';

// How it was made: each step with its time. Open while it's working, folded once ready (opening it again
// sticks until the state changes).
export function Steps({project}) {
  const [open, setOpen] = useState(project.state !== 'ready');
  useEffect(() => setOpen(project.state !== 'ready'), [project.id, project.state]);
  const list = project.steps;
  // Projects from before steps were logged have none to show.
  if (!list.length && project.state === 'ready') return null;
  const total = list.length ? (list.reduce((sum, step) => sum + ((step.ended || Date.now()) - step.started), 0) / 1000).toFixed(1) + ' s' : '';
  return <section className="section steps">
    <button type="button" className="disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
      <ChevronRight size={15} aria-hidden/><h3>How it was made</h3><span className="muted">{list.length ? `${list.length} steps · ${total}` : ''}</span>
    </button>
    {open && phases.map(([phase, title]) => {
      const steps = list.filter(step => step.phase === phase);
      return <div className="phase" key={phase}>
        <h4><span>{title}</span><span className="muted">{steps.length ? seconds(steps[0].started, Math.max(...steps.map(step => step.ended || Date.now()))) : 'waiting'}</span></h4>
        {steps.map((step, index) => <div key={index} className={`step ${step.error ? 'failed' : step.ended ? 'done' : 'running'}`}>
          <span className="icon" aria-hidden>{step.error ? <X size={11}/> : step.ended ? <Check size={11}/> : null}</span>
          <div><b>{step.name}</b>{(step.error || step.detail) && <small>{step.error || step.detail}</small>}</div>
          <time>{seconds(step.started, step.ended)}</time>
        </div>)}
      </div>;
    })}
  </section>;
}
