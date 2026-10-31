// Times as people read them: 1:05 for lengths, 1:05.40 for a playhead, "Today 14:02" for when.
export const clock = seconds => { seconds = Math.max(0, Math.round(seconds || 0)); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); };

export const timecode = seconds => {
  seconds = Math.max(0, seconds || 0);
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0') + '.' + String(Math.floor((seconds - whole) * 100)).padStart(2, '0');
};

export const when = time => {
  const date = new Date(time), today = new Date();
  const day = date.toDateString() === today.toDateString() ? 'Today' : date.toDateString() === new Date(today - 864e5).toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  return day + ' ' + date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
};

export const states = {recording: 'Recording', paused: 'Paused', finalizing: 'Finishing', rendering: 'Rendering', ready: 'Ready', saved: 'Not rendered', error: 'Failed', starting: 'Starting', unknown: 'Unknown'};
export const recordingStates = ['starting', 'recording', 'paused'];
