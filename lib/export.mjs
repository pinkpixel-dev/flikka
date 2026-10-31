// flikka project export | poster: other files made from a finished video (a recording's or a film's), without
// rendering again. A GIF or a WebM for a README or a pull request, and a still to use as a thumbnail.
import fs from 'node:fs/promises';
import path from 'node:path';
import {run, probe} from './common.mjs';

// format: gif or webm. width: pixels (height follows). fps: frames per second (GIF: 15 by default). from, to: a part
// of the video, in its own seconds.
export async function exportVideo(input, {format, width, fps, from, to, output} = {}) {
  if (!['gif', 'webm'].includes(format)) throw new Error('--format takes gif or webm');
  const video = (await probe(input)).streams.find(stream => stream.codec_type === 'video');
  const duration = Number((await probe(input)).format.duration);
  const [start, end] = [from ?? 0, Math.min(to ?? duration, duration)];
  if (!(end > start)) throw new Error('--from must come before --to, inside the video');
  // A GIF of a whole 1080p video is huge: 800 px wide unless asked, never wider than the video.
  const size = Math.min(width || (format === 'gif' ? 800 : video.width), video.width);
  output = path.resolve(output || input.replace(/\.\w+$/, `${from !== undefined || to !== undefined ? `-${Math.round(start)}-${Math.round(end)}` : ''}.${format}`));
  if (output === path.resolve(input)) throw new Error('The export must not overwrite the video it comes from');
  const range = ['-ss', String(start), '-t', String(end - start)];
  const scale = `scale=${size - size % 2}:-2:flags=lanczos`;
  if (format === 'gif') {
    // One palette for the whole clip (stats_mode=diff favours what moves) and light dithering: screen text stays crisp.
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...range, '-i', input, '-filter_complex',
      `fps=${fps || 15},${scale},split[a][b];[a]palettegen=stats_mode=diff[palette];[b][palette]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', output]);
  } else {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...range, '-i', input, '-vf', `${fps ? `fps=${fps},` : ''}${scale}`,
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', '-b:a', '128k', output]);
  }
  const {size: bytes} = await fs.stat(output);
  return {output, format, width: size - size % 2, seconds: +(end - start).toFixed(2), megabytes: +(bytes / 1048576).toFixed(2)};
}

// A still of the video at `at` seconds (by default a little in: past the intro, or a fifth of the way through).
export async function posterFrame(input, {at, intro = 0, output} = {}) {
  const duration = Number((await probe(input)).format.duration);
  const time = Math.max(0, Math.min(duration - 0.05, at ?? (intro ? intro + 1.5 : duration * 0.2)));
  output = path.resolve(output || input.replace(/\.\w+$/, '.jpg'));
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(time), '-i', input, '-frames:v', '1', ...(output.endsWith('.jpg') ? ['-q:v', '2'] : []), output]);
  return {poster: output, at: +time.toFixed(2)};
}
