import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {monitor} from './monitor.js';

// The address after #: "new", "project/<id>", "shots", "voices".
export function useHash() {
  const read = () => location.hash.slice(1) || 'new';
  const [hash, setHash] = useState(read);
  useEffect(() => { const update = () => setHash(read()); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update); }, []);
  return hash;
}

// Run `task` now and every `ms`, with the latest version of it (no restarts on every render).
export function usePoll(task, ms, keys = []) {
  const latest = useRef(task);
  latest.current = task;
  useEffect(() => {
    let alive = true;
    const run = () => alive && Promise.resolve(latest.current()).catch(() => {});
    run();
    const timer = setInterval(run, ms);
    return () => { alive = false; clearInterval(timer); };
  }, [ms, ...keys]);
}

// The mic level, 0…1, every animation frame while something shows it.
export function useMicLevel() {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let frame;
    const tick = () => { setLevel(monitor.level()); frame = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);
  return level;
}

export const useMonitor = () => useSyncExternalStore(monitor.subscribe, () => monitor.stream);

// A short "Copied" (or any word) on a button, then back.
export function useFlash() {
  const [flash, setFlash] = useState(null);
  const timer = useRef();
  return [flash, word => { setFlash(word); clearTimeout(timer.current); timer.current = setTimeout(() => setFlash(null), 1800); }];
}

// The player's keys: Space or K plays and pauses, ← → step a frame (Shift: a second), Home and End, M mutes,
// Ctrl+Z calls `undo` (when there is one). Not while typing; the focused timeline handles its own arrows.
export function usePlayerKeys(player, undo) {
  const latest = useRef(undo);
  latest.current = undo;
  useEffect(() => {
    const keys = event => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !event.target.closest('input, textarea, [contenteditable]')) {
        event.preventDefault(); latest.current?.(); return;
      }
      if (event.target.closest('input, select, textarea, [contenteditable]') || event.metaKey || event.ctrlKey || event.altKey) return;
      const controls = player.current;
      if (!controls) return;
      const actions = {' ': () => controls.toggle(), k: () => controls.toggle(), m: () => controls.mute(), Home: () => controls.seek(0), End: () => controls.seek(controls.duration),
        ArrowLeft: () => event.shiftKey ? controls.seek(controls.time - 1) : controls.step(-1), ArrowRight: () => event.shiftKey ? controls.seek(controls.time + 1) : controls.step(1)};
      const action = actions[event.key];
      if (!action || (event.key === ' ' && event.target.closest('button, a, summary'))) return;
      event.preventDefault(); action();
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, []);
}
