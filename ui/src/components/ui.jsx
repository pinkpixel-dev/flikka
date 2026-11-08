import React, {useEffect, useRef, useState} from 'react';

// A button with an optional icon (a lucide component) and tooltip. `variant`: primary, record, danger, ghost.
export function Button({icon: Icon, children, variant, size, tip, className = '', ...rest}) {
  return <button type="button" className={['button', variant, size, !children && 'icon-only', className].filter(Boolean).join(' ')} data-tip={tip} aria-label={!children ? tip : undefined} {...rest}>
    {Icon && <Icon size={size === 'small' ? 15 : 17} strokeWidth={1.8} aria-hidden/>}{children}
  </button>;
}

// On/off, as a real button with role=switch so Space and Enter work and screen readers say its state.
export function Switch({checked, onChange, label, tip, disabled}) {
  return <button type="button" role="switch" aria-checked={checked} className="switch-row" data-tip={tip} disabled={disabled} onClick={() => onChange(!checked)}>
    <span>{label}</span><span className="switch" aria-hidden/>
  </button>;
}

// Anything that throws away: the first click arms it for 3 s, the second does it.
export function ConfirmButton({onConfirm, children, armed: armedText = 'Sure? Click again', ...rest}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Button {...rest} variant={armed ? 'danger' : rest.variant} onClick={() => {
    if (armed) { setArmed(false); clearTimeout(timer.current); onConfirm(); return; }
    setArmed(true); timer.current = setTimeout(() => setArmed(false), 3000);
  }}>{armed ? armedText : children}</Button>;
}

// A slider that follows the drag and saves once: when it's let go, when focus leaves it, or half a second after the
// last arrow key (so a run of key presses is one edit and one undo step). Its value shows beside it.
export function Range({label, tip, value, min, max, step = 1, unit = '', onCommit, disabled}) {
  const [moving, setMoving] = useState(null);
  const pending = useRef(null);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = () => {
    clearTimeout(timer.current);
    if (pending.current == null) return;
    const next = pending.current;
    pending.current = null;
    if (next === value) { setMoving(null); return; }
    Promise.resolve(onCommit(next)).finally(() => { if (pending.current == null) setMoving(null); });
  };
  const shown = moving ?? value;
  return <label className="line slider-line" data-tip={tip}><span>{label}</span>
    <span className="range-input">
      <input type="range" min={min} max={max} step={step} value={shown} disabled={disabled} aria-valuetext={shown + unit}
        onChange={event => { pending.current = Number(event.target.value); setMoving(pending.current); }}
        onPointerUp={commit} onBlur={commit} onKeyUp={() => { clearTimeout(timer.current); if (pending.current != null) timer.current = setTimeout(commit, 500); }}/>
      <output>{shown}{unit}</output>
    </span></label>;
}

export function Section({title, children, aside, hidden}) {
  if (hidden) return null;
  return <section className="section">
    {title && <header><h3>{title}</h3>{aside}</header>}
    {children}
  </section>;
}

export function Meter({level}) {
  return <div className="meter" aria-hidden><div style={{transform: `scaleX(${level})`}}/></div>;
}

// How far a render is: the step it's on and a bar (moving stripes while the step can't say how far).
// `render`: {step, progress} with progress 0…1 or null.
export function Progress({render, compact}) {
  const known = render.progress != null, percent = known ? Math.round(render.progress * 100) : null;
  return <div className={`progress ${compact ? 'compact' : ''}`}>
    <div className="progress-text"><span>{render.step}</span>{known && <span>{percent}%</span>}</div>
    <div className={`progress-bar ${known ? '' : 'unknown'}`} role="progressbar" aria-label={render.step} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      <div style={known ? {transform: `scaleX(${render.progress})`} : undefined}/></div>
  </div>;
}

// One tooltip for the page: it follows whatever element with data-tip is under the mouse or has keyboard focus,
// placed above it (below when there's no room), and never clipped by a scrolling panel.
export function Tooltips() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    let timer, target = null;
    const show = (element, delay) => {
      clearTimeout(timer);
      target = element;
      if (!element) { setTip(null); return; }
      timer = setTimeout(() => {
        const box = element.getBoundingClientRect();
        if (!element.isConnected || !element.dataset.tip) return;
        setTip({text: element.dataset.tip, x: box.left + box.width / 2, y: box.top, below: box.top < 48, bottom: box.bottom});
      }, delay);
    };
    const over = event => { const element = event.target.closest?.('[data-tip]'); if (element !== target) show(element, 450); };
    const focus = event => { const element = event.target.closest?.('[data-tip]'); if (element?.matches(':focus-visible')) show(element, 150); };
    const hide = () => show(null);
    addEventListener('pointerover', over); addEventListener('focusin', focus); addEventListener('focusout', hide);
    addEventListener('pointerdown', hide, true); addEventListener('scroll', hide, true); addEventListener('keydown', hide);
    return () => {
      clearTimeout(timer);
      removeEventListener('pointerover', over); removeEventListener('focusin', focus); removeEventListener('focusout', hide);
      removeEventListener('pointerdown', hide, true); removeEventListener('scroll', hide, true); removeEventListener('keydown', hide);
    };
  }, []);
  if (!tip) return null;
  const left = Math.min(innerWidth - 12, Math.max(12, tip.x));
  return <div className={`tooltip ${tip.below ? 'below' : ''}`} role="tooltip" style={{left, top: tip.below ? tip.bottom + 8 : tip.y - 8}}>{tip.text}</div>;
}
