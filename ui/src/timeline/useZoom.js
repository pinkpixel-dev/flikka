import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';

// Zoom and sideways scroll for the timeline (Narra's useTimelineZoom, in seconds). The track is `zoom` times as
// wide as the viewport and everything on it is placed in percent, so dragging and seeking need no changes.
// Zooming keeps the moment under the pointer (or the playhead, or the middle) where it was. While the video plays,
// the view follows the playhead until you scroll it yourself; pressing play follows again.
const fewestSeconds = 2; // zoomed all the way in, at least this much shows
const mostZoom = 200;
const stepBy = 1.5;
const followAt = 0.1; // while following, the playhead lands this far into the view

export function useZoom(duration, time, playing) {
  const viewport = useRef(null);
  const [wanted, setWanted] = useState(1);
  const maxZoom = Math.max(1, Math.min(mostZoom, duration / fewestSeconds));
  const zoom = Math.min(wanted, maxZoom);
  const anchor = useRef(null);
  const follow = useRef(true);
  // Set just before scrolling from code, so the scroll event isn't taken as yours.
  const ownScroll = useRef(false);
  // The part in view, as fractions of the whole: where it starts and how wide it is.
  const [view, setView] = useState({start: 0, width: 1});

  const measure = useCallback(() => {
    const box = viewport.current;
    if (!box || !box.scrollWidth) return;
    const next = {start: box.scrollLeft / box.scrollWidth, width: Math.min(1, box.clientWidth / box.scrollWidth)};
    setView(old => Math.abs(old.start - next.start) < 1e-4 && Math.abs(old.width - next.width) < 1e-4 ? old : next);
  }, []);

  const scrollTo = useCallback(left => {
    const box = viewport.current;
    if (!box) return;
    const target = Math.max(0, Math.min(left, box.scrollWidth - box.clientWidth));
    if (Math.abs(target - box.scrollLeft) < 1) return;
    ownScroll.current = true;
    box.scrollLeft = target;
  }, []);

  // Zoom, keeping `at` seconds at `x` pixels from the viewport's left edge.
  const zoomTo = useCallback((next, at, x) => {
    const box = viewport.current;
    if (!box) return;
    const width = box.clientWidth * zoom;
    if (at === undefined || x === undefined) {
      const playheadX = (time / duration) * width - box.scrollLeft;
      if (playheadX >= 0 && playheadX <= box.clientWidth) { at = time; x = playheadX; }
      else { x = box.clientWidth / 2; at = ((box.scrollLeft + x) / width) * duration; }
    }
    anchor.current = {fraction: at / duration, x};
    setWanted(Math.max(1, Math.min(maxZoom, next)));
  }, [zoom, maxZoom, time, duration]);

  // Once the wider track has drawn, scroll so the anchor is back where it was.
  useLayoutEffect(() => {
    const box = viewport.current, held = anchor.current;
    if (!box || !held) return;
    anchor.current = null;
    scrollTo(held.fraction * box.clientWidth * zoom - held.x);
    measure();
  }, [zoom, scrollTo, measure]);

  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    // A scroll the code didn't make means you're looking somewhere else, so stop following.
    const scrolled = () => { if (ownScroll.current) ownScroll.current = false; else follow.current = false; measure(); };
    box.addEventListener('scroll', scrolled);
    return () => { observer.disconnect(); box.removeEventListener('scroll', scrolled); };
  }, [measure]);

  // Ctrl+wheel zooms around the pointer. Zoomed in, a plain up-and-down wheel scrolls sideways (there's nothing
  // to scroll up and down). Both need a listener that isn't passive, to stop the page zooming or scrolling.
  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const wheel = event => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const x = event.clientX - box.getBoundingClientRect().left;
        zoomTo(zoom * Math.exp(-event.deltaY * 0.0015), ((box.scrollLeft + x) / (box.clientWidth * zoom)) * duration, x);
      } else if (zoom > 1 && !event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        box.scrollLeft += event.deltaY;
      }
    };
    box.addEventListener('wheel', wheel, {passive: false});
    return () => box.removeEventListener('wheel', wheel);
  }, [zoom, duration, zoomTo]);

  useEffect(() => { if (playing) follow.current = true; }, [playing]);
  useEffect(() => {
    const box = viewport.current;
    if (!box || !playing || !follow.current || zoom <= 1) return;
    const x = (time / duration) * box.clientWidth * zoom;
    if (x < box.scrollLeft || x > box.scrollLeft + box.clientWidth - 24) scrollTo(x - box.clientWidth * followAt);
  }, [time, playing, zoom, duration, scrollTo]);

  // For the overview: scroll so the view starts at `start` (a fraction of the whole)…
  const scrollToFraction = start => {
    const box = viewport.current;
    if (!box) return;
    follow.current = false;
    scrollTo(start * box.scrollWidth);
  };
  // …or zoom and scroll so exactly this part shows.
  const showRange = (start, width) => {
    const box = viewport.current;
    if (!box) return;
    follow.current = false;
    const next = Math.max(1, Math.min(maxZoom, 1 / width));
    if (Math.abs(next - zoom) < 1e-3) { scrollTo(start * box.scrollWidth); return; }
    anchor.current = {fraction: start, x: 0};
    setWanted(next);
  };

  return {viewport, zoom, maxZoom, view, zoomIn: () => zoomTo(zoom * stepBy), zoomOut: () => zoomTo(zoom / stepBy), fit: () => zoomTo(1), scrollToFraction, showRange};
}
