// Record clip's save step: the video (no sound track of its own) + the engine's sound
// as a WAV must come out as one MP4 with sound. Needs ffmpeg on PATH (skipped without).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { exportMp4, exportArgs } = require('../src/main/services/video-export');

// the arguments, without running anything
{
  const a = exportArgs('v.webm', 'o.mp4', 's.wav');
  assert.deepStrictEqual(a.common.slice(4, 12), ['-i', 'v.webm', '-i', 's.wav', '-map', '0:v:0', '-map', '1:a:0']);
  const b = exportArgs('v.webm', 'o.mp4', null);
  assert.ok(b.common.includes('0:a:0?'), 'a capture without sound still exports');
  console.log('ok   export arguments');
}

const has = spawnSync('ffmpeg', ['-version']).status === 0;
if (!has) {
  console.log('skip ffmpeg not found: the real export is not checked');
  process.exit(0);
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-video-'));
  const webm = path.join(tmp, 'capture.webm');
  const wav = path.join(tmp, 'sound.wav');
  const out = path.join(tmp, 'out.mp4');
  // a video-only WebM, like the recorder makes with the native engine
  assert.strictEqual(spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-c:v', 'libvpx', webm]).status, 0);
  // the engine's sound: 2 s of 440 Hz, 16-bit stereo, built the way take-video.js builds it
  const { wavBytes } = await import('../src/renderer/js/codec.js');
  const rate = 48000;
  const q = new Int16Array(rate * 2 * 2);
  for (let i = 0; i < rate * 2; i++) q[2 * i] = q[2 * i + 1] = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000);
  const bytes = wavBytes ? wavBytes({ rate, parts: [q], frames: rate * 2 }) : null;
  assert.ok(bytes, 'wavBytes loads');
  fs.writeFileSync(wav, bytes);
  await exportMp4('ffmpeg', webm, out, wav);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).stdout.toString();
  assert.ok(/video/.test(probe) && /audio/.test(probe), 'MP4 has video and sound: ' + probe);
  // and the sound is really there (not silence)
  const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-']).stdout;
  let e = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) e += (pcm.readInt16LE(i) / 32768) ** 2;
  const rms = Math.sqrt(e / (pcm.length / 2));
  assert.ok(rms > 0.1, 'sound in the MP4 (rms ' + rms.toFixed(3) + ')');
  console.log(`ok   video + engine sound make one MP4 with sound (rms ${rms.toFixed(3)})`);
  // without the WAV and without a sound track it still exports (video only)
  await exportMp4('ffmpeg', webm, out, null);
  console.log('ok   a capture without sound still exports');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
