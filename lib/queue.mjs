// Renders asked for from the panel: one at a time, in the order asked for. `start(id)` runs one render and
// settles when it's done. Waiting renders can be taken out; finished ones stay listed (the newest 20) until
// cleared. It lives in the panel's process, so it's empty again when the panel restarts.
export function renderQueue(start) {
  const items = [];
  let running = null;
  const waiting = () => items.filter(item => item.state === 'queued');
  const finished = item => ['done', 'failed', 'cancelled'].includes(item.state);
  const prune = () => {
    const old = items.filter(finished).slice(0, -20);
    for (const item of old) items.splice(items.indexOf(item), 1);
  };
  const next = () => {
    if (running) return;
    const item = waiting()[0];
    if (!item) return;
    running = item;
    Object.assign(item, {state: 'rendering', started: Date.now()});
    Promise.resolve().then(() => start(item.id))
      .then(() => { item.state = 'done'; }, error => { item.state = 'failed'; item.error = error.message; })
      .finally(() => { item.ended = Date.now(); running = null; prune(); next(); });
  };
  // What one entry says: how many are ahead of a waiting one.
  const view = item => ({...item, ...(item.state === 'queued' && {ahead: waiting().indexOf(item) + (running ? 1 : 0)})});
  const active = id => items.find(item => item.id === id && (item.state === 'queued' || item.state === 'rendering'));

  return {
    // A project already waiting or rendering keeps its place.
    add(id) {
      const item = active(id) || {id, state: 'queued', added: Date.now()};
      if (!items.includes(item)) { items.push(item); next(); }
      return view(item);
    },
    cancel(id) {
      const item = items.find(entry => entry.id === id && entry.state === 'queued');
      if (!item) throw new Error('That render isn’t waiting (it may have started already)');
      Object.assign(item, {state: 'cancelled', ended: Date.now()});
      prune();
      return view(item);
    },
    clear() { for (const item of items.filter(finished)) items.splice(items.indexOf(item), 1); },
    list: () => items.map(view),
    // The newest entry for a project, or null.
    status(id) { const item = items.findLast(entry => entry.id === id); return item ? view(item) : null; },
  };
}
