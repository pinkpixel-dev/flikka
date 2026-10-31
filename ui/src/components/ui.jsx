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
