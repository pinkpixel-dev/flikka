import React, {useEffect, useState} from 'react';
import {narrationClipURL} from '../lib/api.js';

// A narration line's waveform on the timeline (from Narra's waveform.ts and Waveform.tsx). The browser decodes the
// clip, so any format Kokoro or flikka-voice writes works, and its peaks are kept per clip for the page's life.
const peakWindow = 0.01; // one peak per 10 ms
const peaks = new Map();
let decoder;

// The loudest sample in each window, 0 to 1, the loudest channel counting.
function peaksOf(audio) {
  const size = Math.max(1, Math.round(audio.sampleRate * peakWindow));
  const channels = Array.from({length: audio.numberOfChannels}, (_, index) => audio.getChannelData(index));
  const list = [];
  for (let first = 0; first < audio.length; first += size) {
    let peak = 0;
    const last = Math.min(audio.length, first + size);
    for (const samples of channels) for (let index = first; index < last; index++) peak = Math.max(peak, Math.abs(samples[index]));
    list.push(Math.min(1, peak));
  }
  return list;
}

// A line's clip changes with its words, voice and speed (and its length, when spoken again), so that's the key.
function useClipPeaks(project, line) {
  const key = line.to === null ? null : [project, line.id, line.text, line.voice, line.speed, (line.to - line.from + (line.trimStart || 0) + (line.trimEnd || 0)).toFixed(2)].join('|');
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!key || peaks.has(key)) return;
    let current = true;
    peaks.set(key, null);
    decoder ||= new OfflineAudioContext(1, 1, 48000);
    fetch(narrationClipURL(project, line.id)).then(response => response.ok ? response.arrayBuffer() : Promise.reject())
      .then(bytes => decoder.decodeAudioData(bytes)).then(audio => { peaks.set(key, peaksOf(audio)); if (current) setLoaded(old => old + 1); })
      .catch(() => peaks.delete(key));
    return () => { current = false; };
  }, [key]);
  return key ? peaks.get(key) : null;
}

// Shrinks peaks to at most `columns`, keeping the loudest in each group.
function fitPeaks(list, columns) {
  if (list.length <= columns) return list;
  return Array.from({length: columns}, (_, index) => {
    const from = Math.floor((index * list.length) / columns), to = Math.max(from + 1, Math.floor(((index + 1) * list.length) / columns));
    let peak = 0;
    for (let at = from; at < to; at++) peak = Math.max(peak, list[at]);
    return peak;
  });
}

// The kept part (between the trims, as they are right now) as a filled envelope around a center line.
export function Wave({project, line, trimStart = 0, trimEnd = 0, columns = 200}) {
  const all = useClipPeaks(project, line);
  if (!all?.length) return null;
  const kept = fitPeaks(all.slice(Math.floor(trimStart / peakWindow), Math.max(Math.floor(trimStart / peakWindow) + 1, all.length - Math.ceil(trimEnd / peakWindow))), columns);
  // Silence still shows as a thin line.
  const height = peak => Math.max(peak, 0.03);
  const top = kept.map((peak, index) => `${index + 0.5},${(1 - height(peak)).toFixed(3)}`);
  const bottom = kept.map((peak, index) => `${index + 0.5},${(1 + height(peak)).toFixed(3)}`).reverse();
  return <svg className="wave" viewBox={`0 0 ${kept.length} 2`} preserveAspectRatio="none" aria-hidden>
    <polygon points={[...top, ...bottom].join(' ')} fill="currentColor"/>
  </svg>;
}
