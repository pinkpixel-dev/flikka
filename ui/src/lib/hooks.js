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
