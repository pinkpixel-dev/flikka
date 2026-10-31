// Agent tools on a real project file: output-time edits, dry runs, the timeline, and undo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {editProject, undoProject, timelineProject} from '../lib/project.mjs';

async function scratchProject() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'flikka-test-'));
  const file = path.join(folder, 'recording.project.json');
  await fs.writeFile(file, JSON.stringify({
    version: 1, source: 'recording.mp4', duration: 20, width: 1920, height: 1080, fps: 30, cursor: null, cursorBaked: true,
    clips: [{start: 0, end: 20}], markers: [], zooms: [{start: 4, end: 7, x: 0.5, y: 0.5, scale: 1.5}],
    style: {background: '#111', padding: 64, radius: 20, shadow: true, cursorSize: 32, clickColor: '#fff'},
    captions: {enabled: true}, audio: {normalize: true, clicks: true}, export: {width: 1080, height: 1080, fps: 30}, webcam: null,
  }));
  return {folder, file};
}

test('output-time edits, dry runs, timeline and undo work together', async () => {
  const {folder, file} = await scratchProject();
  try {
    await editProject(file, ['--cut', '5,8', '--speed', '2,12,16']);
    let timeline = await timelineProject(file);
    assert.equal(timeline.duration, 15);
    // A zoom cut short by the cut ends exactly where the kept part ends (it once came out as null).
    assert.deepEqual(timeline.zooms.map(zoom => [zoom.from, zoom.to]), [[4, 5]]);

    // Video 0:10–0:12 is source 14–16 (2x) plus 16–17: a dry run changes nothing on disk.
    const dry = await editProject(file, ['--output-time', '--cut', '0:10,0:12', '--dry-run']);
    assert.deepEqual([dry.before.duration, dry.after.duration], [15, 13]);
    assert.equal((await timelineProject(file)).duration, 15);

    await editProject(file, ['--output-time', '--cut', '0:10,0:12']);
    timeline = await timelineProject(file);
    assert.deepEqual(timeline.parts.map(part => part.source), [[0, 5], [8, 12], [12, 14], [17, 20]]);
    await assert.rejects(editProject(file, ['--output-time', '--cut', '0:40,0:45']), /not in the recording part/);

    assert.equal((await undoProject(file)).duration, 15);
    assert.equal((await undoProject(file)).duration, 20);
    await assert.rejects(undoProject(file), /Nothing to undo/);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});
