// CUDA for your own voices on NVIDIA cards: Microsoft's CUDA plugin for ONNX Runtime, which flikka-voice loads at run
// time (--cuda), about 1.5 times faster than WebGPU on a 4090. It's off until someone
// installs it (flikka voice cuda install, or Settings), since it's a 183 MB download that also needs CUDA 13 and
// cuDNN 9 on the system. The voice-gpu setting picks auto (CUDA when it's ready, else WebGPU), webgpu or cpu.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {flikkaHome, run, setting, trace} from './common.mjs';

const pluginFile = 'libonnxruntime_providers_cuda.so';
export const cudaPlugin = path.join(flikkaHome, 'cuda', pluginFile);
// plugin-ep-cuda/v0.1.0 from microsoft/onnxruntime, the CUDA 13 build for Linux x64, and the plugin inside it, so
// an installed copy can be checked.
const archive = {url: 'https://github.com/microsoft/onnxruntime/releases/download/plugin-ep-cuda/v0.1.0/cuda_ep_cuda13_0.1.0_linux-x64.tar.gz',
  size: 182876357, sha256: '5fa5cc5b19843809707818302771e4d16b740df069ca63908b28245e5f6b8398'};
const plugin = {size: 245022440, sha256: '22cc6427ad14c2f2f4f6a5d01d1dc72a68ac56783951587012d00d85209a3a9a'};
// What the plugin loads from the system, with a name to show.
const libraries = [['libcudart.so.13', 'CUDA 13 runtime'], ['libcublas.so.13', 'cuBLAS 13'], ['libcublasLt.so.13', 'cuBLASLt 13'], ['libcudnn.so.9', 'cuDNN 9']];

const nvidiaDriver = () => process.arch === 'x64' && fsSync.existsSync('/proc/driver/nvidia/version');
const sized = async file => (await fs.stat(file).catch(() => null))?.size === plugin.size;

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of fsSync.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// The libraries the plugin can't find, by name: not in the loader's cache (ldconfig) or LD_LIBRARY_PATH.
async function missingLibraries() {
  const cache = await run('ldconfig', ['-p']).catch(() => run('/sbin/ldconfig', ['-p'])).catch(() => '');
  const extra = (process.env.LD_LIBRARY_PATH || '').split(':').filter(Boolean);
  return libraries.filter(([file]) => !cache.includes(`${file} `) && !extra.some(folder => fsSync.existsSync(path.join(folder, file)))).map(([, name]) => name);
}

// For flikka voice cuda, Settings and the doctor. available: an NVIDIA driver is loaded.
export async function cudaStatus() {
  const available = nvidiaDriver();
  const installed = await sized(cudaPlugin);
  return {available, installed, missing: available ? await missingLibraries() : [],
    gpu: setting('voice-gpu'), plugin: cudaPlugin, using: await cudaArgs().then(args => args.length > 0)};
}

// Puts the plugin in ~/.flikka/cuda: downloaded, checked, and only the plugin unpacked.
export async function installCuda({progress = () => {}} = {}) {
  if (!nvidiaDriver()) throw new Error('CUDA needs an NVIDIA card with its driver loaded, and none was found');
  if (await sized(cudaPlugin) && await sha256(cudaPlugin) === plugin.sha256) return {plugin: cudaPlugin, from: 'installed'};
  await fs.mkdir(path.dirname(cudaPlugin), {recursive: true});
  const temporary = `${cudaPlugin}.tmp`;
  await fs.rm(temporary, {force: true});
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-cuda-'));
  try {
    const file = path.join(work, 'cuda.tar.gz');
    progress(`Downloading the CUDA plugin (${Math.round(archive.size / 1e6)} MB)`);
    trace('cuda', `downloading ${archive.url}`);
    await run('curl', ['-fsSL', '--retry', '2', '-o', file, archive.url], {timeout: 30 * 60 * 1000});
    if ((await fs.stat(file)).size !== archive.size || await sha256(file) !== archive.sha256) throw new Error('The CUDA plugin download doesn\'t match its checksum, so it wasn\'t installed. Try again');
    progress('Unpacking');
    const entry = (await run('tar', ['-tzf', file])).split('\n').find(name => path.basename(name) === pluginFile);
    if (!entry) throw new Error(`The CUDA download didn't contain ${pluginFile}`);
    await run('tar', ['-xzf', file, '-C', work, entry]);
    if (await sha256(path.join(work, entry)) !== plugin.sha256) throw new Error(`${pluginFile} in the download isn't the one Flikka was tested with`);
    await fs.copyFile(path.join(work, entry), temporary);
    await fs.rename(temporary, cudaPlugin);
    return {plugin: cudaPlugin, from: 'download'};
  } finally { await fs.rm(work, {recursive: true, force: true}); }
}

export async function removeCuda() {
  await fs.rm(path.dirname(cudaPlugin), {recursive: true, force: true});
}

// flikka-voice's arguments for the voice-gpu setting. auto passes the plugin only when it can work (installed,
// driver loaded, libraries there); flikka-voice still falls back to WebGPU if CUDA fails anyway.
export async function cudaArgs() {
  const gpu = setting('voice-gpu');
  if (gpu === 'cpu') return ['--cpu'];
  if (gpu !== 'auto' || !nvidiaDriver() || !await sized(cudaPlugin)) return [];
  return (await missingLibraries()).length ? [] : ['--cuda', cudaPlugin];
}
