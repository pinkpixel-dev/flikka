// Click sounds: tiny tones made in the page, no sound files. A press is a short tap, a switch rises when it
// turns on and falls when it turns off.
let context;
const layer = (when, type, from, to, length, volume) => {
  const oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.type = type; oscillator.frequency.setValueAtTime(from, when); oscillator.frequency.exponentialRampToValueAtTime(to, when + length);
  gain.gain.setValueAtTime(volume, when); gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
  oscillator.connect(gain).connect(context.destination); oscillator.start(when); oscillator.stop(when + length + 0.02);
};
const kinds = {
  press: now => { layer(now, 'triangle', 520, 420, 0.04, 0.16); layer(now, 'sine', 1250, 900, 0.02, 0.05); },
  on: now => { layer(now, 'sine', 520, 520, 0.06, 0.08); layer(now + 0.035, 'sine', 780, 780, 0.07, 0.08); },
  off: now => { layer(now, 'sine', 780, 780, 0.06, 0.08); layer(now + 0.035, 'sine', 520, 520, 0.07, 0.08); },
};
export function sound(kind) {
  try { context ||= new AudioContext(); if (context.state === 'suspended') context.resume(); kinds[kind](context.currentTime + 0.005); } catch {}
}

export function listenForPresses() {
  addEventListener('pointerdown', event => {
    const target = event.target.closest?.('button, a, select, summary, input[type=checkbox], [role=switch]');
    if (!target || target.disabled) return;
    const on = target.type === 'checkbox' ? target.checked : target.getAttribute('role') === 'switch' ? target.getAttribute('aria-checked') === 'true' : null;
    sound(on === null ? 'press' : on ? 'off' : 'on');
  }, true);
}
