// Spike: how Flikka would drive flikka-voice. Starts the helper once, sends every line as a job, and
// resolves each job from the JSON events it prints. Usage: node drive.mjs <bin> <model dir> <voices dir> <out dir> [--cpu]
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import path from 'node:path';

const [bin, model, voices, out, ...rest] = process.argv.slice(2);

export function startVoice(bin, {model, voices, cpu = false}) {
  const child = spawn(bin, ['speak', '--model', model, '--voices', voices, ...(cpu ? ['--cpu'] : [])], {stdio: ['pipe', 'pipe', 'inherit']});
  const waiting = new Map();
  let ready;
  const loaded = new Promise((resolve, reject) => { ready = {resolve, reject}; });
  createInterface({input: child.stdout}).on('line', text => {
    const event = JSON.parse(text);
    if (event.event === 'loaded') return ready.resolve(event);
    const job = waiting.get(event.id);
    if (!job) return ready.reject(new Error(event.error));
    waiting.delete(event.id);
    if (event.event === 'done') job.resolve(event); else job.reject(new Error(event.error));
  });
  child.on('exit', code => {
    const error = new Error(`flikka-voice exited with ${code}`);
    ready.reject(error);
    for (const job of waiting.values()) job.reject(error);
  });
  return {
    loaded,
    speak: job => new Promise((resolve, reject) => { waiting.set(job.id, {resolve, reject}); child.stdin.write(JSON.stringify(job) + '\n'); }),
    close: () => child.stdin.end(),
  };
}

const voice = startVoice(bin, {model, voices, cpu: rest.includes('--cpu')});
console.log('loaded', await voice.loaded);
const lines = ['Flikka sends every line as a job.', 'The helper answers each one as it finishes.', 'One model load covers all of them.'];
const started = performance.now();
const results = await Promise.all(lines.map((text, index) => voice.speak({id: `n${index + 1}`, text, voice: 'v1a0cb4505b3', out: path.join(out, `drive-${index + 1}.wav`)})));
for (const result of results) console.log(result.id, `${result.seconds.toFixed(2)} s of audio in ${result.elapsed.toFixed(2)} s`);
console.log(`all ${lines.length} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
voice.close();
