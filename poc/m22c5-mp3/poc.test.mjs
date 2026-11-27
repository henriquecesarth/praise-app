// Generates its own artifacts (synthetic stems -> MP3 -> decode) and inspects the bytes directly.
// Requires ffmpeg on PATH for the reference decoder; the Chrome part is skipped when Chrome is absent.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { inspectMp3, mp3SizeBounds } from './src/mpeg.mjs';
import { STEM_IDS, SAMPLE_RATE } from './src/synth.mjs';

const SECONDS = 8;
const FRAMES = SECONDS * SAMPLE_RATE;
const dir = new URL('./', import.meta.url);
const out = (name) => new URL(`./out/${name}`, import.meta.url);
const env = { ...process.env, POC_SECONDS: String(SECONDS) };
const run = (script) => spawnSync(process.execPath, [script], { cwd: dir, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 280_000 });

let node;
let browser = null;

before(() => {
  rmSync(out(''), { recursive: true, force: true });
  const n = run('run-node.mjs');
  assert.equal(n.status, 0, n.stderr || n.stdout);
  node = JSON.parse(readFileSync(out('node-report.json'), 'utf8'));
  if (process.env.SKIP_BROWSER !== '1' && (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') || process.env.CHROME_PATH)) {
    const b = run('run-browser.mjs');
    assert.equal(b.status, 0, b.stderr || b.stdout);
    browser = JSON.parse(readFileSync(out('browser-report.json'), 'utf8'));
  }
});

describe('generated artifacts, inspected directly', () => {
  test('six lamejs and six ffmpeg MP3 files are valid CBR 256 kbps stereo 44.1 kHz streams', () => {
    for (const id of STEM_IDS) {
      for (const [file, expectInfo] of [[`${id}.lamejs.mp3`, false], [`${id}.ffmpeg.mp3`, true]]) {
        const bytes = readFileSync(out(file));
        const info = inspectMp3(bytes);
        assert.deepEqual(info.bitrates, [256], file);
        assert.deepEqual(info.sampleRates, [44100], file);
        assert.ok(info.channelModes.every((mode) => mode !== 3), `${file} must be stereo`);
        assert.equal(info.trailingBytes, 0, `${file} trailing garbage`);
        assert.equal(info.id3Bytes, 0, `${file} must not carry ID3`);
        assert.equal(info.infoFrame, expectInfo, `${file} Info frame`);
        const bounds = mp3SizeBounds(44100, info.frames);
        const expected = expectInfo ? bytes.length : bytes.length + 836; // lamejs writes no Info frame
        assert.ok(expected >= bounds.min && expected <= bounds.max, `${file} size ${bytes.length} vs bounds`);
      }
    }
  });

  test('size is about 18% of the PCM16 WAV measured from real files', () => {
    for (const id of STEM_IDS) {
      const wav = statSync(out(`${id}.wav`)).size;
      assert.equal(wav, 44 + FRAMES * 4);
      const ratio = statSync(out(`${id}.ffmpeg.mp3`)).size / wav;
      assert.ok(ratio > 0.17 && ratio < 0.19, `${id} ratio ${ratio}`);
    }
  });

  test('ffmpeg decode: Info-tagged MP3 is gapless; untagged lamejs output is late by the encoder delay', () => {
    for (const run of node.runs) {
      assert.equal(run.ffmpegLame.align.initialLagFrames, 0);
      assert.equal(run.ffmpegLame.align.frameDelta, 0);
      // Encoder delay is measured, never hardcoded: positive, within the contract bound, equal across stems.
      assert.ok(run.lamejs.align.initialLagFrames > 0 && run.lamejs.align.initialLagFrames <= 4608);
      assert.equal(run.lamejs.align.initialLagFrames, node.runs[0].lamejs.align.initialLagFrames);
      assert.equal(run.lamejs.align.driftFrames, 0);
    }
  });

  test('all six stems share identical timing and have zero drift', () => {
    const combos = new Set(node.runs.map((r) => JSON.stringify([r.lamejs.align.initialLagFrames, r.lamejs.align.frameDelta, r.ffmpegLame.align.frameDelta])));
    assert.equal(combos.size, 1);
    for (const r of node.runs) {
      assert.equal(r.lamejs.align.lagSpreadFrames, 0);
      assert.equal(r.ffmpegLame.align.lagSpreadFrames, 0);
    }
  });
});

describe('Chrome decodeAudioData on generated mediabunny/LAME output', { skip: process.env.SKIP_BROWSER === '1' }, () => {
  test('byte-derived alignment descriptor matches what Chrome decodes', (t) => {
    if (!browser) return t.skip('Chrome not found');
    const bytes = readFileSync(out('vocals.mediabunny.mp3'));
    const info = inspectMp3(bytes);
    assert.equal(info.infoFrame, true);
    assert.deepEqual(info.bitrates, [256]);
    assert.equal(info.trailingBytes, 0);
    assert.equal(info.id3Bytes, 0);

    const row = browser.rows[0];
    const delay = row.mediabunnyNoXing.align.initialLagFrames; // measured priming, not hardcoded
    const padding = info.frames * 1152 - delay - FRAMES; // contract invariant
    assert.ok(delay >= 0 && padding >= 0);
    assert.equal(delay + FRAMES + padding, info.frames * 1152);
    assert.equal(padding, row.mediabunnyXing.align.frameDelta, 'Chrome leaves exactly the end padding after trimming the start');
    assert.equal(row.mediabunnyXing.align.initialLagFrames, 0);
    const bounds = mp3SizeBounds(44100, info.frames);
    assert.ok(bytes.length >= bounds.min && bytes.length <= bounds.max);
  });

  test('stems stay mutually aligned and the encoder is deterministic', (t) => {
    if (!browser) return t.skip('Chrome not found');
    for (const key of ['mediabunnyXing', 'mediabunnyNoXing', 'lamejsFile', 'ffmpegLameFile']) {
      const combos = new Set(browser.rows.map((r) => JSON.stringify([r[key].align.initialLagFrames, r[key].align.frameDelta])));
      assert.equal(combos.size, 1, key);
      assert.ok(browser.rows.every((r) => r[key].align.driftFrames === 0 && r[key].align.lagSpreadFrames === 0), key);
    }
    assert.equal(browser.deterministic.sameInputSameBytes, true);
  });
});
