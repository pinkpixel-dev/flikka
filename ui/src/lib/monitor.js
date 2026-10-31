// The browser's own view of the chosen camera and mic, so you see and hear what will be recorded. One for the
// whole page: the mic keeps running from the setup into the recording, so its meter stays on.
let stream = null, audio = null, analyser = null, buffer = null;
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener());

export const monitor = {
  get stream() { return stream; },
  get camera() { return stream?.getVideoTracks().length ? stream : null; },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  // 0…1, loudness right now.
  level() {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(buffer);
    return Math.min(1, Math.sqrt(buffer.reduce((total, value) => total + value * value, 0) / buffer.length) * 5);
  },
  // keepMic: the recorder takes the camera, the meter goes on.
  stop(keepMic = false) {
    if (stream) for (const track of stream.getTracks()) if (!(keepMic && track.kind === 'audio')) track.stop();
    if (!keepMic) { audio?.close(); audio = analyser = null; stream = null; }
    else if (stream) stream = new MediaStream(stream.getAudioTracks());
    notify();
  },
  // Devices are matched by name: the recorder's names come from the system, the browser's from its own list.
  async start({mic, camera}) {
    monitor.stop();
    if (!mic && !camera) return;
    const warm = await navigator.mediaDevices.getUserMedia({audio: Boolean(mic), video: Boolean(camera)});
    warm.getTracks().forEach(track => track.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const find = (kind, name) => name && devices.find(device => device.kind === kind && device.label.includes(name))?.deviceId;
    const micId = find('audioinput', mic), cameraId = find('videoinput', camera);
    stream = await navigator.mediaDevices.getUserMedia({audio: Boolean(mic) && {deviceId: micId ? {exact: micId} : undefined},
      video: Boolean(camera) && {deviceId: cameraId ? {exact: cameraId} : undefined, width: 1280, height: 720}});
    if (mic) {
      audio = new AudioContext();
      analyser = audio.createAnalyser(); analyser.fftSize = 1024; buffer = new Float32Array(analyser.fftSize);
      audio.createMediaStreamSource(stream).connect(analyser);
    }
    notify();
  },
};
