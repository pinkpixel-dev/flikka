// Talking to lib/ui.mjs: POST /<action> with the page's token, and addresses for pictures, videos and voices
// (which can't send a header, so the token goes in the address).
export const token = window.FLIKKA_PANEL?.token || '';

export async function api(action, body = {}) {
  const response = await fetch('/' + action, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, body: JSON.stringify(body)});
  // A tab left open from an earlier panel has an old key: load the page again for the current one.
  if (response.status === 403) { location.reload(); throw Error('Reconnecting to the panel…'); }
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}

export const media = (id, kind) => `/media?token=${token}&id=${id}&kind=${kind}`;
export const thumb = id => `/thumb?token=${token}&id=${id}`;
export const shotURL = name => `/shot?token=${token}&name=${encodeURIComponent(name)}`;
// A narration line's spoken clip, fresh each time (speaking a line again keeps its address).
// `film`: {scene, sentence} for a film's sentence (both count from 1) instead of a recording's line.
export const narrationClipURL = (id, line, film) => `/narration-clip?token=${token}&id=${id}&${film ? `scene=${film.scene}&sentence=${film.sentence}` : `line=${line}`}&v=${Date.now()}`;
export const triedLineURL = id => `/narration-try?token=${token}&id=${id}&v=${Date.now()}`;
export const voiceURL = (name, version, kind) => `/voice?token=${token}&name=${name}${kind ? '&kind=' + kind : ''}&v=${version}`;

// A new voice: the body is the audio itself.
export async function uploadVoice(name, blob, consent) {
  const response = await fetch('/voice-add?name=' + encodeURIComponent(name) + (consent ? '&consent=1' : ''), {method: 'POST', headers: {Authorization: 'Bearer ' + token}, body: blob});
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
