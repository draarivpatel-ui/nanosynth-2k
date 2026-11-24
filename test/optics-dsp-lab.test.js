'use strict';
/* Optics fringe and harmonic spectrum lab coverage: UTF-8 and SHA-256
   primitives, base64url, the strict #ns= bookmark codec, radix-2 FFT and
   pitch tracking, far-field profiles, the comparator, the single-digest
   audited exporters, tamper detection, in-page self-tests, and the DOM
   contract on index.html and app.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../src/nanosynth.js');
const L = require('../src/optics-dsp-lab.js');

const ROOT = path.join(__dirname, '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const LAB_SRC = fs.readFileSync(path.join(ROOT, 'src/optics-dsp-lab.js'), 'utf8');

const realSha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* ---------- module surface ---------- */

test('lab module exports the expected public api', () => {
  for (const k of ['LAB_VERSION', 'OPTICS_PRESETS', 'OPTICS_PRESET_NAMES', 'VOICE_NAMES',
    'utf8Bytes', 'utf8FromBytes', 'sha256', 'bytesToBase64Url', 'base64UrlToBytes',
    'nextPow2', 'fftSizeFor', 'fft', 'magnitudeDb', 'spectralCentroid', 'topPeaks',
    'detectPitch', 'normalizePreset', 'farFieldProfile', 'analyzeOptics',
    'analyzeVoice', 'voiceBuffer', 'compare', 'compareAll', 'stampedBrief',
    'briefDigest', 'exportJson', 'exportCsv', 'exportMarkdown', 'csvCell',
    'verifyBrief', 'tamperJson', 'normalizeBookmark', 'encodeBookmark',
    'decodeBookmark', 'detectPresetName', 'voiceToApp', 'voiceFromApp', 'selfTests']) {
    assert.ok(L[k] !== undefined, k);
  }
});

test('LAB_VERSION is a semver-like string', () => {
  assert.match(L.LAB_VERSION, /^\d+\.\d+\.\d+$/);
});

test('the four optics presets and two voices are declared', () => {
  assert.deepEqual(L.OPTICS_PRESET_NAMES,
    ['double-slit', 'antiphase', 'quad-array', 'three-slit']);
  assert.deepEqual(L.VOICE_NAMES, ['karplus-strong', 'fm-2op']);
});

/* ---------- UTF-8 ---------- */

test('utf8Bytes encodes ascii unchanged', () => {
  assert.deepEqual(L.utf8Bytes('abc123'), [97, 98, 99, 49, 50, 51]);
  assert.deepEqual(L.utf8Bytes(''), []);
});

test('utf8Bytes encodes a two byte codepoint', () => {
  assert.deepEqual(L.utf8Bytes('é'), [0xc3, 0xa9]);
  assert.deepEqual(L.utf8Bytes('ñ'), [0xc3, 0xb1]);
});

test('utf8Bytes encodes a three byte codepoint', () => {
  assert.deepEqual(L.utf8Bytes('€'), [0xe2, 0x82, 0xac]);
  assert.deepEqual(L.utf8Bytes('日'), [0xe6, 0x97, 0xa5]);
});

test('utf8Bytes encodes a surrogate pair as four bytes', () => {
  const b = L.utf8Bytes('𝄞');
  assert.equal(b.length, 4);
  assert.equal(b[0] & 0xf0, 0xf0);
});

test('utf8Bytes maps lone surrogates to the replacement char', () => {
  assert.deepEqual(L.utf8Bytes('\ud800'), [0xef, 0xbf, 0xbd]);
  assert.deepEqual(L.utf8Bytes('\udc00'), [0xef, 0xbf, 0xbd]);
  assert.deepEqual(L.utf8Bytes('\ud800x'), [0xef, 0xbf, 0xbd, 0x78]);
});

test('utf8Bytes matches TextEncoder byte for byte', () => {
  const enc = new TextEncoder();
  for (const s of ['hello world', 'café ☃ 日本語', '𝄞𝄢𝄪', '']) {
    assert.deepEqual(L.utf8Bytes(s), Array.from(enc.encode(s)));
  }
});

test('utf8FromBytes inverts utf8Bytes on valid text', () => {
  for (const s of ['plain ascii', 'café ☃ 日本語', '𝄞']) {
    assert.equal(L.utf8FromBytes(L.utf8Bytes(s)), s);
  }
});

test('utf8FromBytes rejects truncated and invalid sequences', () => {
  assert.equal(L.utf8FromBytes([0xc3]), null);
  assert.equal(L.utf8FromBytes([0x80]), null);
  assert.equal(L.utf8FromBytes([0xe2, 0x82]), null);
  assert.equal(L.utf8FromBytes([0xf0, 0x90, 0x84]), null);
  assert.equal(L.utf8FromBytes([0xc3, 0x28]), null);
});

/* ---------- SHA-256 ---------- */

test('sha256 matches the empty-string known answer', () => {
  assert.equal(L.sha256(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256 matches the abc known answer', () => {
  assert.equal(L.sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256 matches the 448-bit two-block known answer', () => {
  assert.equal(L.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('sha256 matches the one-million-a known answer', () => {
  assert.equal(L.sha256('a'.repeat(1000000)),
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('sha256 returns 64 lowercase hex characters', () => {
  assert.match(L.sha256('anything'), /^[0-9a-f]{64}$/);
});

test('sha256 parity with node crypto on varied inputs', () => {
  for (const s of ['x', 'hello world', 'café ☃ 日本語', 'a'.repeat(555),
    JSON.stringify({ a: 1, b: [2, 3] }), '𝄞𝄢', 'line1\nline2']) {
    assert.equal(L.sha256(s), realSha(s), 'mismatch on ' + JSON.stringify(s.slice(0, 30)));
  }
});

test('sha256 parity at every block boundary length', () => {
  for (const len of [1, 54, 55, 56, 57, 63, 64, 65, 118, 119, 120, 127, 128, 129]) {
    const s = 'z'.repeat(len);
    assert.equal(L.sha256(s), realSha(s), 'length ' + len);
  }
});

test('sha256 coerces non string input through String()', () => {
  assert.equal(L.sha256(123), realSha('123'));
  assert.equal(L.sha256(true), realSha('true'));
});

test('sha256 flips the digest on a single character change', () => {
  assert.notEqual(L.sha256('abcd'), L.sha256('abce'));
});

test('sha256 of the canonical state is stable across calls', () => {
  const c = N.serializeState(N.createState());
  assert.equal(L.sha256(c), L.sha256(c));
});

/* ---------- base64url ---------- */

test('bytesToBase64Url encodes the rfc test vectors', () => {
  assert.equal(L.bytesToBase64Url([77]), 'TQ');
  assert.equal(L.bytesToBase64Url([77, 97]), 'TWE');
  assert.equal(L.bytesToBase64Url([77, 97, 110]), 'TWFu');
});

test('base64url uses no plus slash or padding characters', () => {
  const out = L.bytesToBase64Url(L.utf8Bytes('surely a longer payload 12345'));
  assert.ok(!/[+/=]/.test(out));
});

test('base64UrlToBytes decodes the rfc test vectors', () => {
  assert.deepEqual(L.base64UrlToBytes('TQ'), [77]);
  assert.deepEqual(L.base64UrlToBytes('TWE'), [77, 97]);
  assert.deepEqual(L.base64UrlToBytes('TWFu'), [77, 97, 110]);
});

test('base64url round trips every byte value', () => {
  const all = [];
  for (let i = 0; i < 256; i++) all.push(i);
  assert.deepEqual(L.base64UrlToBytes(L.bytesToBase64Url(all)), all);
});

test('base64UrlToBytes rejects invalid characters', () => {
  assert.equal(L.base64UrlToBytes('***'), null);
  assert.equal(L.base64UrlToBytes('ab c'), null);
  assert.equal(L.base64UrlToBytes('ab=c'), null);
});

test('base64UrlToBytes rejects an impossible remainder of one', () => {
  assert.equal(L.base64UrlToBytes('A'), null);
  assert.equal(L.base64UrlToBytes('AAAAA'), null);
});

test('base64UrlToBytes accepts empty input', () => {
  assert.deepEqual(L.base64UrlToBytes(''), []);
});

/* ---------- strict #ns= bookmark codec ---------- */

test('encodeBookmark round trips all six fields', () => {
  const bm = { p: 'quad-array', m: 'fm', f: 440, w: 22, d: 0.5, i: 7 };
  assert.deepEqual(L.decodeBookmark(L.encodeBookmark(bm)), bm);
});

test('encodeBookmark round trips a partial field set', () => {
  assert.deepEqual(L.decodeBookmark(L.encodeBookmark({ p: 'antiphase' })), { p: 'antiphase' });
  assert.deepEqual(L.decodeBookmark(L.encodeBookmark({ f: 123.5 })), { f: 123.5 });
  assert.deepEqual(L.decodeBookmark(L.encodeBookmark({ m: 'ks' })), { m: 'ks' });
});

test('encodeBookmark produces a compact url-safe hash', () => {
  const code = L.encodeBookmark({ p: 'three-slit', m: 'fm', f: 330 });
  assert.match(code, /^#ns=[A-Za-z0-9_-]+$/);
});

test('encodeBookmark is deterministic', () => {
  const bm = { p: 'double-slit', m: 'ks', f: 220, w: 18, d: 0.996, i: 3 };
  assert.equal(L.encodeBookmark(bm), L.encodeBookmark(bm));
});

test('encodeBookmark returns null when nothing usable is given', () => {
  assert.equal(L.encodeBookmark({}), null);
  assert.equal(L.encodeBookmark(null), null);
  assert.equal(L.encodeBookmark('double-slit'), null);
  assert.equal(L.encodeBookmark({ p: 'bogus' }), null);
  assert.equal(L.encodeBookmark({ f: 'abc' }), null);
});

test('decodeBookmark accepts a bare ns= code without the hash', () => {
  const code = L.encodeBookmark({ f: 500 });
  assert.deepEqual(L.decodeBookmark(code.slice(1)), { f: 500 });
});

test('decodeBookmark trims surrounding whitespace', () => {
  const code = L.encodeBookmark({ f: 500 });
  assert.deepEqual(L.decodeBookmark('  ' + code + ' \n'), { f: 500 });
});

test('decodeBookmark returns null on non string input', () => {
  assert.equal(L.decodeBookmark(null), null);
  assert.equal(L.decodeBookmark(undefined), null);
  assert.equal(L.decodeBookmark(42), null);
  assert.equal(L.decodeBookmark({}), null);
});

test('decodeBookmark returns null on malformed hashes', () => {
  assert.equal(L.decodeBookmark(''), null);
  assert.equal(L.decodeBookmark('#'), null);
  assert.equal(L.decodeBookmark('#ns='), null);
  assert.equal(L.decodeBookmark('ns='), null);
  assert.equal(L.decodeBookmark('#other=abc'), null);
  assert.equal(L.decodeBookmark('not a hash'), null);
  assert.equal(L.decodeBookmark('#ns=%%%'), null);
  assert.equal(L.decodeBookmark('#ns=ab+c'), null);
});

test('decodeBookmark returns null on valid base64 that is not utf8', () => {
  assert.equal(L.decodeBookmark('#ns=' + L.bytesToBase64Url([0x80, 0x80])), null);
});

test('decodeBookmark returns null on non json payloads', () => {
  assert.equal(L.decodeBookmark('#ns=' + L.bytesToBase64Url(L.utf8Bytes('hello'))), null);
});

test('decodeBookmark returns null on json scalars arrays and empty objects', () => {
  for (const payload of ['5', 'true', 'null', '"str"', '[1,2]', '{}']) {
    const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes(payload));
    assert.equal(L.decodeBookmark(code), null, payload);
  }
});

test('decodeBookmark clamps out of range fields instead of trusting them', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes(
    '{"f":1e9,"w":999,"d":-2,"i":99}'));
  assert.deepEqual(L.decodeBookmark(code), { f: 8000, w: 200, d: 0, i: 20 });
});

test('decodeBookmark clamps negative frequency to the floor', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('{"f":-50}'));
  assert.deepEqual(L.decodeBookmark(code), { f: 20 });
});

test('decodeBookmark drops non finite field values', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('{"f":"zzz","p":"antiphase"}'));
  assert.deepEqual(L.decodeBookmark(code), { p: 'antiphase' });
});

test('decodeBookmark rejects an unknown preset or voice', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('{"p":"bogus","m":"xx"}'));
  assert.equal(L.decodeBookmark(code), null);
});

test('decodeBookmark ignores unknown extra keys', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('{"x":1,"f":300}'));
  assert.deepEqual(L.decodeBookmark(code), { f: 300 });
});

test('decodeBookmark blocks a literal __proto__ key', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('{"__proto__":{"x":1},"f":440}'));
  assert.equal(L.decodeBookmark(code), null);
  assert.strictEqual(({}).x, undefined);
});

test('decodeBookmark blocks constructor and prototype keys', () => {
  for (const payload of ['{"constructor":{"x":1},"f":1}', '{"prototype":{"x":1},"f":1}']) {
    const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes(payload));
    assert.equal(L.decodeBookmark(code), null, payload);
  }
});

test('decodeBookmark survives nested hostile keys inside allowed fields', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('{"f":440,"safe":{"__proto__":{"x":9}}}'));
  const bm = L.decodeBookmark(code);
  assert.equal(bm.f, 440);
  assert.strictEqual(({}).x, undefined);
});

test('decodeBookmark rejects an overlong hash', () => {
  const code = '#ns=' + 'A'.repeat(5000);
  assert.equal(L.decodeBookmark(code), null);
});

test('normalizeBookmark reads only through hasOwnProperty', () => {
  const obj = JSON.parse('{"p":"double-slit","f":330}');
  const out = L.normalizeBookmark(obj);
  assert.deepEqual(out, { p: 'double-slit', f: 330 });
});

test('normalizeBookmark rejects non object shapes', () => {
  assert.equal(L.normalizeBookmark(5), null);
  assert.equal(L.normalizeBookmark('s'), null);
  assert.equal(L.normalizeBookmark([1]), null);
  assert.equal(L.normalizeBookmark(null), null);
});

test('normalizeBookmark clamps negative zero frequency like any number', () => {
  assert.equal(L.normalizeBookmark({ f: -0 }).f, 20);
});

test('a bookmark never carries an audio field', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('{"audio":true,"audioOn":true,"f":220}'));
  const bm = L.decodeBookmark(code);
  assert.deepEqual(bm, { f: 220 });
  assert.ok(!('audio' in bm) && !('audioOn' in bm));
});

/* ---------- preset detection and voice maps ---------- */

test('detectPresetName maps two in-phase sources to double-slit', () => {
  assert.equal(L.detectPresetName([{ x: 0, y: -80 }, { x: 0, y: 80, phase: 0 }]), 'double-slit');
});

test('detectPresetName maps an antiphase pair', () => {
  assert.equal(L.detectPresetName([{ x: 0, y: -80 }, { x: 0, y: 80, phase: Math.PI }]), 'antiphase');
  assert.equal(L.detectPresetName([{ x: 0, y: -80 }, { x: 0, y: 80, phase: -3.0 }]), 'antiphase');
});

test('detectPresetName maps three and four source layouts', () => {
  assert.equal(L.detectPresetName([{}, {}, {}]), 'three-slit');
  assert.equal(L.detectPresetName([{}, {}, {}, {}]), 'quad-array');
});

test('detectPresetName returns null on unusable input', () => {
  assert.equal(L.detectPresetName(null), null);
  assert.equal(L.detectPresetName([]), null);
  assert.equal(L.detectPresetName([{}]), null);
  assert.equal(L.detectPresetName([{}, {}, {}, {}, {}]), null);
  assert.equal(L.detectPresetName('x'), null);
});

test('voiceToApp and voiceFromApp invert each other', () => {
  assert.equal(L.voiceToApp('karplus-strong'), 'ks');
  assert.equal(L.voiceToApp('fm-2op'), 'fm');
  assert.equal(L.voiceFromApp('ks'), 'karplus-strong');
  assert.equal(L.voiceFromApp('fm'), 'fm-2op');
});

test('voice maps fall back to safe defaults', () => {
  assert.equal(L.voiceToApp('bogus'), 'ks');
  assert.equal(L.voiceFromApp('bogus'), 'karplus-strong');
});

/* ---------- radix-2 FFT ---------- */

test('nextPow2 returns the next power of two', () => {
  assert.equal(L.nextPow2(1), 1);
  assert.equal(L.nextPow2(3), 4);
  assert.equal(L.nextPow2(1024), 1024);
  assert.equal(L.nextPow2(1025), 2048);
});

test('nextPow2 repairs hostile input', () => {
  assert.equal(L.nextPow2(0), 1);
  assert.equal(L.nextPow2(-7), 1);
  assert.equal(L.nextPow2(NaN), 1);
  assert.ok(Number.isFinite(L.nextPow2(Infinity)));
});

test('fftSizeFor rounds up and respects the cap', () => {
  assert.equal(L.fftSizeFor(100), 128);
  assert.equal(L.fftSizeFor(100000), 65536);
  assert.equal(L.fftSizeFor(100000, 12), 4096);
  assert.equal(L.fftSizeFor(0), 1);
});

test('fft rejects non power of two or mismatched input', () => {
  assert.equal(L.fft(new Float64Array(3), new Float64Array(3)), false);
  assert.equal(L.fft(new Float64Array(6), new Float64Array(6)), false);
  assert.equal(L.fft(new Float64Array(8), new Float64Array(4)), false);
  assert.equal(L.fft(null, null), false);
});

test('fft accepts power of two input', () => {
  assert.equal(L.fft(new Float64Array(2), new Float64Array(2)), true);
  assert.equal(L.fft(new Float64Array(1024), new Float64Array(1024)), true);
});

test('fft of an impulse is a flat spectrum', () => {
  const re = new Float64Array(64); re[0] = 1;
  const im = new Float64Array(64);
  L.fft(re, im);
  for (let k = 0; k < 64; k++) {
    assert.ok(Math.abs(Math.hypot(re[k], im[k]) - 1) < 1e-9, 'bin ' + k);
  }
});

test('fft of a constant buffer puts all energy in bin zero', () => {
  const re = new Float64Array(32).fill(1);
  const im = new Float64Array(32);
  L.fft(re, im);
  assert.ok(Math.abs(re[0] - 32) < 1e-9);
  for (let k = 1; k < 32; k++) assert.ok(Math.hypot(re[k], im[k]) < 1e-9);
});

test('fft of a bin-centered sine peaks at that bin', () => {
  const n = 512, k0 = 7;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin(2 * Math.PI * k0 * i / n);
  L.fft(re, im);
  let best = 0, bestBin = -1;
  for (let k = 0; k < n / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    if (m > best) { best = m; bestBin = k; }
  }
  assert.equal(bestBin, k0);
  assert.ok(Math.abs(best - n / 2) < 1e-6);
});

test('fft conserves energy (parseval)', () => {
  const n = 256;
  const re = new Float64Array(n), im = new Float64Array(n);
  let e1 = 0;
  for (let i = 0; i < n; i++) {
    re[i] = Math.sin(i * 1.7) * 0.5 + Math.cos(i * 0.3);
    e1 += re[i] * re[i];
  }
  L.fft(re, im);
  let e2 = 0;
  for (let i = 0; i < n; i++) e2 += re[i] * re[i] + im[i] * im[i];
  assert.ok(Math.abs(e2 - e1 * n) < e1 * n * 1e-9);
});

test('magnitudeDb normalizes a unit sine to about zero dB', () => {
  const n = 2048;
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin(2 * Math.PI * 40 * i / n);
  const s = L.magnitudeDb(buf, { sampleRate: n });
  assert.equal(s.size, n);
  let best = -180;
  for (const v of s.magsDb) if (v > best) best = v;
  assert.ok(Math.abs(best) < 0.5, 'peak ' + best + ' dB');
});

test('magnitudeDb floors a silent buffer at minus 180 dB', () => {
  const s = L.magnitudeDb(new Float64Array(256), { sampleRate: 22050 });
  assert.ok(Array.from(s.magsDb).every((v) => v === -180));
});

test('magnitudeDb reports size bin width and half spectrum', () => {
  const s = L.magnitudeDb(new Float64Array(1000), { sampleRate: 22050 });
  assert.equal(s.size, 1024);
  assert.ok(Math.abs(s.binHz - 22050 / 1024) < 1e-9);
  assert.equal(s.magsDb.length, 512);
  assert.equal(s.mags.length, 512);
});

test('magnitudeDb sanitizes non finite samples to silence', () => {
  const s = L.magnitudeDb(new Float64Array([NaN, Infinity, -Infinity, 0]), { sampleRate: 8000 });
  assert.ok(Array.from(s.magsDb).every((v) => v === -180));
});

test('magnitudeDb survives an empty buffer', () => {
  const s = L.magnitudeDb(new Float64Array(0), { sampleRate: 8000 });
  assert.equal(s.magsDb.length, 1);
});

test('spectralCentroid of a bin-centered sine lands on its bin', () => {
  const n = 4096, sr = 22050, k0 = 64;
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin(2 * Math.PI * k0 * i / n);
  const c = L.spectralCentroid(buf, sr, n);
  assert.ok(Math.abs(c - k0 * sr / n) < 0.5, c + ' vs ' + k0 * sr / n);
});

test('spectralCentroid of a sine stays inside the spectrum', () => {
  const n = 4096, sr = 22050, f = 500;
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin(2 * Math.PI * f * i / sr);
  const c = L.spectralCentroid(buf, sr, n);
  assert.ok(c > 0 && c < sr / 2 && Number.isFinite(c), c);
});

test('spectralCentroid of silence is zero', () => {
  assert.equal(L.spectralCentroid(new Float64Array(512), 22050, 512), 0);
});

test('topPeaks finds the sine frequency within a bin', () => {
  const n = 2048, sr = 22050, f = 700;
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin(2 * Math.PI * f * i / sr);
  const tp = L.topPeaks(buf, { sampleRate: sr, fftSize: n, count: 3 });
  assert.ok(tp.peaks.length >= 1);
  assert.ok(Math.abs(tp.peaks[0].freqHz - f) < tp.binHz * 1.5);
});

test('topPeaks orders peaks by descending magnitude', () => {
  const n = 2048, sr = 22050;
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin(2 * Math.PI * 100 * i / sr) +
    0.5 * Math.sin(2 * Math.PI * 300 * i / sr);
  const tp = L.topPeaks(buf, { sampleRate: sr, fftSize: n, count: 4 });
  for (let i = 1; i < tp.peaks.length; i++) {
    assert.ok(tp.peaks[i - 1].magnitude >= tp.peaks[i].magnitude);
  }
});

test('topPeaks on silence returns an empty list', () => {
  const tp = L.topPeaks(new Float64Array(512), { sampleRate: 22050 });
  assert.equal(tp.peaks.length, 0);
});

test('topPeaks honors the requested count', () => {
  const n = 4096;
  const buf = new Float64Array(n);
  for (let k = 1; k <= 8; k++) {
    for (let i = 0; i < n; i++) buf[i] += Math.sin(2 * Math.PI * k * 100 * i / n);
  }
  const tp = L.topPeaks(buf, { sampleRate: n, fftSize: n, count: 3 });
  assert.equal(tp.peaks.length, 3);
});

/* ---------- pitch detection ---------- */

test('detectPitch on a 220 Hz sine stays within a few cents', () => {
  const sr = 22050, n = sr;
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin(2 * Math.PI * 220 * i / sr);
  const p = L.detectPitch(buf, sr, 220);
  assert.ok(p.lag > 0);
  assert.ok(Math.abs(p.errorCents) < 5, p.errorCents + ' cents');
});

test('detectPitch on a 440 Hz sine at 44100 stays within a few cents', () => {
  const sr = 44100, n = sr;
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin(2 * Math.PI * 440 * i / sr);
  const p = L.detectPitch(buf, sr, 440);
  assert.ok(Math.abs(p.errorCents) < 5, p.errorCents + ' cents');
});

test('detectPitch on karplus-strong tracks the loop period', () => {
  const sr = 22050, f = 220;
  const b = N.karplusStrong({ frequency: f, sampleRate: sr, duration: 0.4, seed: 7 });
  const p = L.detectPitch(b, sr, f);
  assert.equal(p.lag, Math.round(sr / f));
  assert.ok(p.r > 0.3);
  assert.ok(Math.abs(p.errorCents) < 25);
});

test('detectPitch on fm-2op tracks the carrier period', () => {
  const sr = 22050, f = 220;
  const b = N.fmBuffer({ frequency: f, sampleRate: sr, duration: 0.4, modRatio: 2 });
  const p = L.detectPitch(b, sr, f);
  assert.ok(p.lag > 0);
  assert.ok(Math.abs(p.errorCents) < 10, p.errorCents + ' cents');
});

test('detectPitch reports no pitch on silence', () => {
  const p = L.detectPitch(new Float64Array(2000), 22050, 220);
  assert.equal(p.lag, -1);
  assert.equal(p.estimateHz, 0);
});

test('detectPitch reports no pitch on a too-short buffer', () => {
  const p = L.detectPitch(new Float64Array(4), 22050, 220);
  assert.equal(p.lag, -1);
});

test('detectPitch repairs hostile sample rate and target', () => {
  const b = N.karplusStrong({ duration: 0.1, sampleRate: 22050 });
  const p = L.detectPitch(b, 'bogus', NaN);
  assert.ok(Number.isFinite(p.estimateHz));
  const q = L.detectPitch(null, 22050, 220);
  assert.equal(q.lag, -1);
});

test('detectPitch estimate is finite for every seed tried', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const b = N.karplusStrong({ frequency: 180 + seed * 40, sampleRate: 22050, duration: 0.3, seed });
    const p = L.detectPitch(b, 22050, 180 + seed * 40);
    assert.ok(Number.isFinite(p.estimateHz), 'seed ' + seed);
  }
});

/* ---------- far-field profiles ---------- */

test('farFieldProfile returns null for an unknown preset name', () => {
  assert.equal(L.farFieldProfile('bogus'), null);
  assert.equal(L.farFieldProfile(''), null);
  assert.equal(L.farFieldProfile(null), null);
  assert.equal(L.farFieldProfile([]), null);
});

for (const name of L.OPTICS_PRESET_NAMES) {
  test('farFieldProfile ' + name + ' returns a finite profile', () => {
    const f = L.farFieldProfile(name);
    assert.equal(f.points, 401);
    assert.equal(f.profile.length, 401);
    assert.equal(f.xs.length, 401);
    assert.ok(Array.from(f.profile).every(Number.isFinite));
    assert.ok(f.max >= f.min);
    assert.ok(f.mean >= f.min && f.mean <= f.max);
    assert.ok(f.visibility >= 0 && f.visibility <= 1);
    assert.ok(f.theoreticalSpacing > 0);
    assert.equal(f.preset, name);
  });
}

test('farFieldProfile is deterministic across calls', () => {
  const a = L.farFieldProfile('double-slit');
  const b = L.farFieldProfile('double-slit');
  assert.deepEqual(Array.from(a.profile), Array.from(b.profile));
});

test('double-slit center is the global maximum', () => {
  const f = L.farFieldProfile('double-slit');
  assert.ok(Math.abs(f.centerIntensity - f.max) < 1e-9);
  assert.ok(f.visibility > 0.9);
});

test('antiphase profile has a central null', () => {
  const f = L.farFieldProfile('antiphase');
  assert.ok(f.centerIntensity < 1e-9);
  assert.ok(f.visibility > 0.9);
  assert.ok(f.minima.length >= 1);
});

test('double-slit measured spacing is close to the young prediction', () => {
  const f = L.farFieldProfile('double-slit');
  const ratio = f.measuredSpacing / f.theoreticalSpacing;
  assert.ok(ratio > 0.5 && ratio < 2, 'ratio ' + ratio);
});

test('young spacing of every preset matches the shared core formula', () => {
  for (const name of L.OPTICS_PRESET_NAMES) {
    const f = L.farFieldProfile(name);
    const p = L.OPTICS_PRESETS[name];
    assert.ok(Math.abs(f.theoreticalSpacing -
      N.fringeSpacing(p.wavelength, p.slitSeparation, p.screenDistance)) < 1e-9);
  }
});

test('farFieldProfile odd-ifies an even point count', () => {
  const f = L.farFieldProfile('double-slit', { points: 400 });
  assert.equal(f.points, 401);
});

test('farFieldProfile clamps point count and span', () => {
  const f = L.farFieldProfile('double-slit', { points: 1e9, span: 1e9 });
  assert.equal(f.points, 4097);
  assert.equal(f.span, 1e5);
});

test('farFieldProfile xs are symmetric about the detector center', () => {
  const f = L.farFieldProfile('three-slit');
  assert.ok(Math.abs(f.xs[0] + f.xs[f.points - 1]) < 1e-9);
  assert.ok(Math.abs(f.xs[(f.points - 1) / 2]) < 1e-9);
});

test('a spreading coefficient keeps the profile finite', () => {
  const f = L.farFieldProfile('double-slit', { spreading: 0.01 });
  assert.ok(Array.from(f.profile).every(Number.isFinite));
  assert.ok(f.visibility >= 0 && f.visibility <= 1);
});

test('normalizePreset sanitizes a custom preset object', () => {
  const p = L.normalizePreset({
    sources: [{ x: 0, y: -50 }, { x: 0, y: 50 }],
    wavelength: 25, slitSeparation: 100, screenDistance: 500
  });
  assert.equal(p.name, 'custom');
  assert.equal(p.wavelength, 25);
  assert.equal(p.slitSeparation, 100);
});

test('normalizePreset repairs hostile source fields', () => {
  const p = L.normalizePreset({
    sources: [{ x: NaN, y: Infinity, amplitude: -5, phase: 'x' }, {}],
    wavelength: -3
  });
  assert.ok(p);
  assert.ok(Number.isFinite(p.sources[0].x));
  assert.ok(Number.isFinite(p.sources[0].phase));
  assert.ok(p.wavelength > 0);
});

test('normalizePreset derives separation from source extent when absent', () => {
  const p = L.normalizePreset({ sources: [{ y: -40 }, { y: 60 }] });
  assert.equal(p.slitSeparation, 100);
});

test('normalizePreset returns null for a source-free preset', () => {
  assert.equal(L.normalizePreset({ sources: [] }), null);
  assert.equal(L.normalizePreset({}), null);
});

test('a single-source custom preset produces a smooth finite profile', () => {
  const f = L.farFieldProfile({ sources: [{ x: 0, y: 0 }], wavelength: 20 });
  assert.ok(f);
  assert.ok(Array.from(f.profile).every(Number.isFinite));
});

test('analyzeOptics returns metrics without sample arrays', () => {
  const a = L.analyzeOptics('double-slit');
  assert.equal(a.preset, 'double-slit');
  assert.ok(a.profile === undefined);
  assert.ok(a.xs === undefined);
  assert.ok(a.visibility > 0);
  assert.doesNotThrow(() => JSON.stringify(a));
});

test('analyzeOptics returns null for an unknown preset', () => {
  assert.equal(L.analyzeOptics('nope'), null);
});

/* ---------- voice analysis ---------- */

for (const voice of L.VOICE_NAMES) {
  test('analyzeVoice ' + voice + ' returns a complete metric set', () => {
    const a = L.analyzeVoice(voice, { frequency: 220, sampleRate: 22050, duration: 0.3 });
    assert.equal(a.voice, voice);
    assert.equal(a.wav.bytes, 44 + a.sampleCount * 2);
    assert.equal(a.wav.headerOk, true);
    assert.ok(a.rms > 0);
    assert.ok(a.peak <= 1.0000001);
    assert.ok(Number.isFinite(a.dc));
    assert.ok(a.pitch.lag > 0);
    assert.ok(Number.isFinite(a.pitch.errorCents));
    assert.ok(a.spectrum.centroidHz > 0);
    assert.ok(a.spectrum.peaks.length >= 1);
    assert.equal(a.spectrum.peaks.length <= 5, true);
  });
}

test('analyzeVoice returns null for an unknown voice', () => {
  assert.equal(L.analyzeVoice('bogus'), null);
  assert.equal(L.analyzeVoice('fm'), null);
  assert.equal(L.analyzeVoice(null), null);
});

test('analyzeVoice is deterministic for identical options', () => {
  const o = { frequency: 330, sampleRate: 22050, duration: 0.2, seed: 4 };
  const a = L.analyzeVoice('karplus-strong', o);
  const b = L.analyzeVoice('karplus-strong', o);
  assert.deepEqual(a, b);
});

test('analyzeVoice wav bytes scale with duration and sample rate', () => {
  const a = L.analyzeVoice('karplus-strong', { sampleRate: 8000, duration: 0.5 });
  assert.equal(a.wav.bytes, 44 + 2 * Math.round(8000 * 0.5));
});

test('analyzeVoice clamps a hostile frequency and sample rate', () => {
  const a = L.analyzeVoice('karplus-strong', { frequency: 0, sampleRate: 1e9, duration: 0.05 });
  assert.equal(a.params.frequency, 20);
  assert.equal(a.params.sampleRate, 96000);
  assert.ok(Number.isFinite(a.rms));
});

test('analyzeVoice zero amplitude yields silence metrics', () => {
  const a = L.analyzeVoice('fm-2op', { amplitude: 0, duration: 0.1 });
  assert.equal(a.peak, 0);
  assert.equal(a.rms, 0);
  assert.equal(a.pitch.lag, -1);
});

test('analyzeVoice echoes damping for karplus-strong and index for fm', () => {
  const ks = L.analyzeVoice('karplus-strong', { damping: 0.99, duration: 0.1 });
  const fm = L.analyzeVoice('fm-2op', { modIndex: 6, modRatio: 3, duration: 0.1 });
  assert.equal(ks.params.damping, 0.99);
  assert.equal(ks.params.modIndex, undefined);
  assert.equal(fm.params.modIndex, 6);
  assert.equal(fm.params.damping, undefined);
});

test('analyzeVoice normalizes a negative seed', () => {
  const a = L.analyzeVoice('karplus-strong', { seed: -5, duration: 0.05 });
  assert.equal(a.params.seed, 5);
});

test('voiceBuffer returns a finite buffer and shared params', () => {
  const made = L.voiceBuffer('fm-2op', { frequency: 330, duration: 0.1 });
  assert.ok(made.buf.length > 100);
  assert.ok(Array.from(made.buf).every(Number.isFinite));
  assert.equal(made.params.frequency, 330);
});

test('compare returns optics and audio results for a pair', () => {
  const c = L.compare('antiphase', 'fm-2op', { duration: 0.1 });
  assert.equal(c.preset, 'antiphase');
  assert.equal(c.voice, 'fm-2op');
  assert.ok(c.optics.visibility > 0);
  assert.ok(c.audio.wav.bytes > 44);
});

test('compare returns null on a bad pair', () => {
  assert.equal(L.compare('bogus', 'karplus-strong'), null);
  assert.equal(L.compare('double-slit', 'bogus'), null);
});

test('compareAll produces the full four by two matrix', () => {
  const rows = L.compareAll({ duration: 0.1 });
  assert.equal(rows.length, 8);
  const keys = rows.map((r) => r.preset + '/' + r.voice);
  assert.equal(new Set(keys).size, 8);
  for (const p of L.OPTICS_PRESET_NAMES) {
    for (const v of L.VOICE_NAMES) {
      assert.ok(keys.includes(p + '/' + v));
    }
  }
});

test('compareAll is deterministic', () => {
  const a = L.compareAll({ duration: 0.1 });
  const b = L.compareAll({ duration: 0.1 });
  assert.deepEqual(a, b);
});

/* ---------- single-digest audited brief ---------- */

test('briefDigest is a 64 hex sha256', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  assert.match(L.briefDigest(data), /^[0-9a-f]{64}$/);
});

test('stampedBrief caches one object per canonical state key', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  assert.strictEqual(L.stampedBrief(data), L.stampedBrief(data));
});

test('the digest stamped on page matches json csv and markdown', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  const d = L.briefDigest(data);
  assert.ok(L.exportJson(data).includes(d));
  assert.ok(L.exportCsv(data).includes('# sha256: ' + d));
  assert.ok(L.exportMarkdown(data).includes('SHA-256: `' + d + '`'));
});

test('structurally equal data gets the same digest regardless of key order', () => {
  const d1 = L.briefDigest({ a: 1, b: { x: 2, y: 3 } });
  const d2 = L.briefDigest({ b: { y: 3, x: 2 }, a: 1 });
  assert.equal(d1, d2);
});

test('different data gets a different digest', () => {
  const d1 = L.briefDigest({ v: 1 });
  const d2 = L.briefDigest({ v: 2 });
  assert.notEqual(d1, d2);
});

test('exportJson parses to schema digest and data', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  const obj = JSON.parse(L.exportJson(data));
  assert.equal(obj.schema, L.SCHEMA);
  assert.match(obj.sha256, /^[0-9a-f]{64}$/);
  assert.ok(obj.data.comparator.length === 8);
});

test('exportJson bytes are deterministic', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  assert.equal(L.exportJson(data), L.exportJson(data));
});

test('exportJson sorts keys inside nested objects', () => {
  const text = L.exportJson({ z: 1, a: 2 });
  assert.ok(text.indexOf('"a"') < text.indexOf('"z"'));
});

test('exportCsv has provenance header then a column header', () => {
  const csv = L.exportCsv({ comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } });
  const lines = csv.split('\n');
  assert.match(lines[0], /^# nanosynth-2k/);
  assert.match(lines[1], /^# schema: /);
  assert.match(lines[2], /^# sha256: [0-9a-f]{64}$/);
  assert.equal(lines[3], 'section,key,value');
});

test('exportCsv emits one row per comparator metric family', () => {
  const csv = L.exportCsv({ comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } });
  assert.ok(csv.includes('optics,double-slit/karplus-strong.visibility,'));
  assert.ok(csv.includes('pitch,three-slit/fm-2op.errorCents,'));
  assert.ok(csv.includes('wav,quad-array/fm-2op.bytes,'));
});

test('exportCsv bytes are deterministic', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  assert.equal(L.exportCsv(data), L.exportCsv(data));
});

test('exportMarkdown carries the comparator table and digest footer', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  const md = L.exportMarkdown(data);
  assert.ok(md.includes('| Preset | Voice |'));
  assert.ok(md.includes('| double-slit | karplus-strong |'));
  assert.ok(md.includes('| three-slit | fm-2op |'));
  assert.match(md, /SHA-256: `[0-9a-f]{64}`\n?$/);
});

test('csvCell escapes spreadsheet formula starts', () => {
  assert.equal(L.csvCell('=1+1'), "'=1+1");
  assert.equal(L.csvCell('+cmd'), "'+cmd");
  assert.equal(L.csvCell('-5'), "'-5");
  assert.equal(L.csvCell('@run'), "'@run");
});

test('csvCell quotes separators and whitespace edges', () => {
  assert.equal(L.csvCell('a,b'), '"a,b"');
  assert.equal(L.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(L.csvCell('a\nb'), '"a\nb"');
  assert.equal(L.csvCell(' pad '), '" pad "');
});

test('csvCell leaves ordinary values untouched', () => {
  assert.equal(L.csvCell('plain'), 'plain');
  assert.equal(L.csvCell(220.5), '220.5');
  assert.equal(L.csvCell(''), '');
  assert.equal(L.csvCell(null), '');
  assert.equal(L.csvCell(undefined), '');
});

test('csvCell escapes a tab or carriage return led formula', () => {
  assert.equal(L.csvCell('\t=x'), "'\t=x");
  assert.equal(L.csvCell('\r=cmd'), '"\'\r=cmd"');
});

/* ---------- verify and tamper ---------- */

test('verifyBrief accepts a genuine export', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  const v = L.verifyBrief(L.exportJson(data));
  assert.equal(v.ok, true);
  assert.equal(v.reason, 'match');
  assert.equal(v.expected, v.actual);
});

test('verifyBrief catches a flipped metric', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  const bad = L.tamperJson(L.exportJson(data));
  const v = L.verifyBrief(bad);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'mismatch');
  assert.notEqual(v.expected, v.actual);
});

test('verifyBrief reports not-json on unparseable text', () => {
  assert.equal(L.verifyBrief('not json at all').reason, 'not-json');
  assert.equal(L.verifyBrief('').reason, 'not-json');
  assert.equal(L.verifyBrief(undefined).reason, 'not-json');
});

test('verifyBrief reports not-object on scalars and arrays', () => {
  assert.equal(L.verifyBrief('5').reason, 'not-object');
  assert.equal(L.verifyBrief('[1,2]').reason, 'not-object');
  assert.equal(L.verifyBrief('null').reason, 'not-object');
});

test('verifyBrief reports bad-schema on a foreign payload', () => {
  assert.equal(L.verifyBrief('{"schema":"other","sha256":"' + 'a'.repeat(64) + '","data":{}}').reason,
    'bad-schema');
});

test('verifyBrief reports bad-digest on a malformed digest field', () => {
  const data = { params: { f: 1 } };
  const j = L.exportJson(data);
  const obj = JSON.parse(j);
  obj.sha256 = 'not hex';
  assert.equal(L.verifyBrief(JSON.stringify(obj)).reason, 'bad-digest');
});

test('verifyBrief rejects a hand-signed forgery', () => {
  const forged = JSON.stringify({
    schema: L.SCHEMA, sha256: 'f'.repeat(64),
    data: { params: { f: 220 } }
  });
  const v = L.verifyBrief(forged);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'mismatch');
});

test('tamperJson changes the payload but keeps it parseable', () => {
  const data = { comparator: L.compareAll({ duration: 0.1 }), params: { f: 220 } };
  const bad = L.tamperJson(L.exportJson(data));
  const obj = JSON.parse(bad);
  assert.equal(obj.schema, L.SCHEMA);
  const orig = JSON.parse(L.exportJson(data));
  assert.notEqual(obj.data.comparator[0].optics.visibility,
    orig.data.comparator[0].optics.visibility);
});

test('tamperJson falls back to params then a flag on sparse data', () => {
  const j1 = L.tamperJson(JSON.stringify({ schema: L.SCHEMA, sha256: 'x'.repeat(64), data: { params: { frequency: 220 } } }));
  assert.equal(JSON.parse(j1).data.params.frequency, 221);
  const j2 = L.tamperJson(JSON.stringify({ schema: L.SCHEMA, sha256: 'x'.repeat(64), data: {} }));
  assert.equal(JSON.parse(j2).data.tampered, true);
});

/* ---------- in-page self tests ---------- */

test('selfTests returns at least fourteen named checks', () => {
  const r = L.selfTests();
  assert.ok(r.length >= 14, r.length + ' checks');
  for (const t of r) {
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.pass, 'boolean');
  }
});

test('selfTests passes every check', () => {
  const r = L.selfTests();
  const failed = r.filter((t) => !t.pass);
  assert.deepEqual(failed.map((t) => t.name + ' ' + t.detail), []);
});

test('selfTests names are unique', () => {
  const r = L.selfTests();
  const names = r.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('selfTests is deterministic across runs', () => {
  const a = L.selfTests().map((t) => t.pass);
  const b = L.selfTests().map((t) => t.pass);
  assert.deepEqual(a, b);
});

/* ---------- DOM contract on index.html and app.js ---------- */

test('index.html loads the lab module after the core and before app.js', () => {
  const iCore = IDX.indexOf('src/nanosynth.js');
  const iLab = IDX.indexOf('src/optics-dsp-lab.js');
  const iApp = IDX.indexOf('app.js');
  assert.ok(iCore >= 0 && iLab > iCore && iApp > iLab);
});

test('index.html hosts every lab element id the app uses', () => {
  for (const id of ['labCard', 'labRows', 'labPreset', 'labSpan', 'labSpanVal',
    'labRefresh', 'labProfile', 'labProfileRead', 'labSpectrum', 'labSpecRead',
    'labJson', 'labCsv', 'labMd', 'labShare', 'labVerify', 'labTamper',
    'labDigest', 'labMsg', 'labSelfTest', 'labTests']) {
    assert.ok(IDX.includes('id="' + id + '"'), id);
  }
});

test('the lab card spans the full grid width on wide screens', () => {
  assert.match(IDX, /main \.wide\{grid-column:1\/-1\}/);
  assert.match(IDX, /<section class="wide">/);
});

test('the lab table declares eleven columns', () => {
  const table = IDX.slice(IDX.indexOf('<table class="lab"'), IDX.indexOf('<tbody'));
  assert.equal((table.match(/<th>/g) || []).length, 11);
});

test('both lab svgs are focusable charts with accessible names', () => {
  assert.match(IDX, /<svg id="labProfile" class="chart" viewBox="0 0 640 200" role="img"\s+aria-label="[^"]+"/);
  assert.match(IDX, /<svg id="labSpectrum" class="chart" viewBox="0 0 640 200" role="img"\s+aria-label="[^"]+"/);
});

test('the inline lab svgs carry no xmlns url attribute', () => {
  assert.equal(/<svg[^>]*xmlns/.test(IDX), false);
});

test('the lab card includes the export and verify buttons', () => {
  for (const label of ['Export JSON', 'Export CSV', 'Export Markdown',
    'Copy share link', 'Verify digest', 'Tamper demo', 'Run lab self-tests']) {
    assert.ok(IDX.includes(label), label);
  }
});

test('the lab message area announces results politely', () => {
  assert.match(IDX, /id="labMsg"[^>]*aria-live="polite"/);
});

test('app.js guards the whole lab behind the optional module', () => {
  assert.match(APP, /var LAB = window\.NanoSynthLab \|\| null/);
  assert.match(APP, /if \(LAB\) initLab\(\);\s*else if \(\$\('labCard'\)\) \$\('labCard'\)\.style\.display = 'none'/);
});

test('app.js restores the ns bookmark at boot before first render', () => {
  const boot = APP.slice(APP.lastIndexOf('/* ---------- Boot'));
  assert.ok(boot.indexOf('restoreFromHash()') < boot.indexOf('pushControls()'));
  assert.ok(boot.indexOf('restoreFromHash()') >= 0);
});

test('restoreFromHash can never enable audio', () => {
  const restore = APP.slice(APP.indexOf('function restoreFromHash'),
    APP.indexOf('function initLab'));
  assert.match(restore, /state\.audioOn = false/);
  assert.equal(/AudioContext|audioOn = true|audioOn: true/.test(restore), false);
});

test('the bookmark codec is the only hash reader in app.js', () => {
  assert.match(APP, /LAB\.decodeBookmark\(location\.hash\)/);
  assert.equal((APP.match(/location\.hash/g) || []).length, 2);
});

test('app.js hash changes re-render but still gate on the lab module', () => {
  assert.match(APP, /window\.addEventListener\('hashchange', function \(\) \{\s*restoreFromHash\(\);/);
});

test('app.js never puts lab text through innerHTML', () => {
  const lab = APP.slice(APP.indexOf('var LAB ='));
  assert.equal(/innerHTML/.test(lab), false);
});

test('app.js shares one digest across the display and exports', () => {
  assert.match(APP, /LAB\.briefDigest\(labData\(\)\)/);
  assert.match(APP, /LAB\.exportJson\(labData\(\)\)/);
  assert.match(APP, /LAB\.exportCsv\(labData\(\)\)/);
  assert.match(APP, /LAB\.exportMarkdown\(labData\(\)\)/);
});

test('app.js tamper demo verifies a mutated brief', () => {
  assert.match(APP, /LAB\.tamperJson\(LAB\.exportJson\(labData\(\)\)\)/);
});

test('the lab still creates zero audio contexts', () => {
  const makes = APP.match(/new \(window\.AudioContext/g) || [];
  assert.equal(makes.length, 2);
  const lab = APP.slice(APP.indexOf('var LAB ='));
  assert.equal(/AudioContext/.test(lab), false);
});

test('the lab section uses no data-preset attribute hooks', () => {
  const labHtml = IDX.slice(IDX.indexOf('id="labCard"'), IDX.indexOf('id="labTests"'));
  assert.equal(/data-preset/.test(labHtml), false);
});

/* ---------- source file hygiene ---------- */

test('new lab files are free of em dashes and en dashes', () => {
  const em = String.fromCharCode(0x2014), en = String.fromCharCode(0x2013);
  for (const f of ['src/optics-dsp-lab.js', 'test/optics-dsp-lab.test.js',
    'index.html', 'app.js']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!s.includes(em) && !s.includes(en), f);
  }
});

test('new lab files contain no AI assistant branding', () => {
  const banned = ['cl' + 'aude', 'chat' + 'gpt', 'open' + 'ai',
    'anthro' + 'pic', 'copi' + 'lot', 'gem' + 'ini'];
  for (const f of ['src/optics-dsp-lab.js', 'index.html', 'app.js']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(new RegExp(banned.join('|'), 'i').test(s), false, f);
  }
});

test('optics-dsp-lab.js parses as a standalone script', () => {
  assert.doesNotThrow(() => new (require('node:vm').Script)(LAB_SRC));
});

test('the lab module touches no audio or network surface', () => {
  assert.equal(/AudioContext|fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(LAB_SRC), false);
});

test('the lab module references only the shared core for math', () => {
  assert.match(LAB_SRC, /require\('\.\/nanosynth\.js'\)/);
  assert.match(LAB_SRC, /root\.NanoSynthLab = api/);
});

/* ---------- deeper edge coverage ---------- */

for (const name of L.OPTICS_PRESET_NAMES) {
  test('preset ' + name + ' declares sane physical parameters', () => {
    const p = L.OPTICS_PRESETS[name];
    assert.ok(p.sources.length >= 2);
    assert.ok(p.wavelength > 0 && p.slitSeparation > 0 && p.screenDistance > 0);
    for (const s of p.sources) {
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
      assert.ok(s.amplitude > 0 && Number.isFinite(s.phase));
    }
  });
}

test('antiphase minima sit on the detector centerline', () => {
  const f = L.farFieldProfile('antiphase');
  const central = f.minima.filter((m) => Math.abs(m.x) < 5);
  assert.ok(central.length >= 1);
  assert.ok(central[0].intensity < 1e-9);
});

test('three-slit minima are partial unlike the double-slit nulls', () => {
  const three = L.farFieldProfile('three-slit');
  const two = L.farFieldProfile('double-slit');
  assert.ok(three.maxima.length > 0);
  assert.ok(three.visibility > 0.5 && three.visibility < two.visibility);
  assert.ok(Number.isFinite(two.visibility));
});

test('quad array visibility stays bounded below one', () => {
  const f = L.farFieldProfile('quad-array');
  assert.ok(f.visibility <= 1);
  assert.ok(f.max > f.min);
});

test('normalizePreset clamps hostile amplitudes', () => {
  const p = L.normalizePreset({ sources: [{ amplitude: -5 }, { amplitude: 99 }] });
  assert.equal(p.sources[0].amplitude, 0);
  assert.equal(p.sources[1].amplitude, 4);
});

test('normalizePreset repairs a zero or negative slit separation', () => {
  const p = L.normalizePreset({ sources: [{ y: -30 }, { y: 30 }], slitSeparation: -8 });
  assert.ok(p.slitSeparation > 0);
});

test('farFieldProfile repairs hostile points and span', () => {
  const f = L.farFieldProfile('double-slit', { points: NaN, span: -4 });
  assert.equal(f.points, 401);
  assert.equal(f.span, 1);
});

test('a preset object with a missing wavelength gets the default', () => {
  const p = L.normalizePreset({ sources: [{ y: -10 }, { y: 10 }] });
  assert.equal(p.wavelength, 18);
});

test('magnitudeDb truncates a buffer longer than the fft size', () => {
  const s = L.magnitudeDb(new Float64Array(5000).fill(0.5), { fftSize: 1024, sampleRate: 8000 });
  assert.equal(s.size, 1024);
  assert.equal(s.magsDb.length, 512);
});

test('fftSizeFor enforces the power-of-two ceiling', () => {
  assert.equal(L.fftSizeFor(70000), 65536);
  assert.equal(L.fftSizeFor(300, 8), 256);
});

test('detectPitch on fm index zero still finds the carrier', () => {
  const b = N.fmBuffer({ frequency: 330, sampleRate: 22050, duration: 0.3, modIndex: 0 });
  const p = L.detectPitch(b, 22050, 330);
  assert.ok(Math.abs(p.errorCents) < 15, p.errorCents + ' cents');
});

test('detectPitch is deterministic for the same buffer', () => {
  const b = N.karplusStrong({ frequency: 220, sampleRate: 22050, duration: 0.3, seed: 3 });
  const a = L.detectPitch(b, 22050, 220);
  const c = L.detectPitch(b, 22050, 220);
  assert.deepEqual(a, c);
});

test('encodeBookmark is idempotent through a decode re-encode cycle', () => {
  const bm = { p: 'antiphase', m: 'fm', f: 440, w: 18, d: 0.5, i: 7 };
  const once = L.encodeBookmark(L.decodeBookmark(L.encodeBookmark(bm)));
  assert.equal(once, L.encodeBookmark(bm));
});

test('decodeBookmark rejects a doubled marker', () => {
  const inner = L.encodeBookmark({ f: 300 }).slice(4);
  assert.equal(L.decodeBookmark('#ns=ns=' + inner), null);
});

test('decodeBookmark tolerates whitespace inside the json payload', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('  { "f": 300 }  '));
  assert.deepEqual(L.decodeBookmark(code), { f: 300 });
});

test('decodeBookmark rejects a payload with trailing junk', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('{"f":300} garbage'));
  assert.equal(L.decodeBookmark(code), null);
});

test('a unicode preset name in the hash is dropped, not trusted', () => {
  const code = '#ns=' + L.bytesToBase64Url(L.utf8Bytes('{"p":"café","f":300}'));
  assert.deepEqual(L.decodeBookmark(code), { f: 300 });
});

test('analyzeVoice fm spectrum peaks near integer harmonic positions', () => {
  const a = L.analyzeVoice('fm-2op', { frequency: 220, sampleRate: 22050, duration: 0.3, modIndex: 2 });
  const near = a.spectrum.peaks.filter((pk) => {
    const h = pk.freqHz / 220;
    return Math.abs(h - Math.round(h)) < 0.08;
  });
  assert.ok(near.length >= 1, 'no harmonic peak found');
});

test('analyzeVoice karplus-strong centroid is above the fundamental', () => {
  const a = L.analyzeVoice('karplus-strong', { frequency: 220, sampleRate: 22050, duration: 0.3 });
  assert.ok(a.spectrum.centroidHz > 100, a.spectrum.centroidHz);
});

test('exportMarkdown lists every parameter line', () => {
  const md = L.exportMarkdown({ params: { frequency: 220, damping: 0.9 }, comparator: [] });
  assert.ok(md.includes('- `damping` = 0.9'));
  assert.ok(md.includes('- `frequency` = 220'));
});

test('verifyBrief ignores keys outside the signed data payload', () => {
  const obj = JSON.parse(L.exportJson({ params: { f: 1 } }));
  obj.extra = 'unsigned metadata';
  const v = L.verifyBrief(JSON.stringify(obj));
  assert.equal(v.ok, true);
});

test('a forged digest from a different payload always fails', () => {
  const good = JSON.parse(L.exportJson({ params: { f: 1 } }));
  const moved = { schema: L.SCHEMA, sha256: good.sha256, data: { params: { f: 2 } } };
  assert.equal(L.verifyBrief(JSON.stringify(moved)).ok, false);
});

test('sha256 parity on random ascii payloads', () => {
  const r = N.rng(99);
  for (let i = 0; i < 12; i++) {
    let s = '';
    for (let j = 0; j < 40; j++) s += String.fromCharCode(32 + Math.floor(r() * 95));
    assert.equal(L.sha256(s), realSha(s));
  }
});

test('labRows table body starts empty until the app fills it', () => {
  assert.match(IDX, /<tbody id="labRows"><\/tbody>/);
});

test('lab preset select offers exactly the four lab presets', () => {
  const sel = IDX.slice(IDX.indexOf('id="labPreset"'), IDX.indexOf('</select>', IDX.indexOf('id="labPreset"')));
  for (const v of ['double-slit', 'antiphase', 'quad-array', 'three-slit']) {
    assert.ok(sel.includes('value="' + v + '"'), v);
  }
});

test('app.js recomputes the lab on bench control changes', () => {
  assert.match(APP, /labInvalidate\(\);\s*labRenderAll\(\);/);
});

test('app.js applies lab presets through the bench preset table', () => {
  assert.match(APP, /var LAB_TO_BENCH = \{/);
  assert.match(APP, /'double-slit': 'young'/);
  assert.match(APP, /'three-slit': 'grating'/);
});

test('app.js share link builds the bookmark from live bench state', () => {
  const share = APP.slice(APP.indexOf("$('labShare')"));
  assert.match(share, /LAB\.detectPresetName\(state\.sources\)/);
  assert.match(share, /LAB\.encodeBookmark\(/);
});

/* ---------- revamp regression coverage ---------- */

test('utf8FromBytes rejects overlong encodings', () => {
  assert.equal(L.utf8FromBytes([0xc0, 0x80]), null);
  assert.equal(L.utf8FromBytes([0xe0, 0x80, 0x80]), null);
  assert.equal(L.utf8FromBytes([0xf0, 0x80, 0x80, 0x80]), null);
});

test('utf8FromBytes rejects encoded surrogates and out of range codepoints', () => {
  assert.equal(L.utf8FromBytes([0xed, 0xa0, 0x80]), null);
  assert.equal(L.utf8FromBytes([0xed, 0xbf, 0xbf]), null);
  assert.equal(L.utf8FromBytes([0xf4, 0x90, 0x80, 0x80]), null);
  assert.equal(L.utf8FromBytes([0xf5, 0x80, 0x80, 0x80]), null);
});

test('magnitudeDb normalizes the DC bin as a true amplitude', () => {
  const n = 256;
  const dc = new Float64Array(n).fill(0.5);
  const s = L.magnitudeDb(dc, { sampleRate: 1000, fftSize: n });
  assert.ok(Math.abs(s.magsDb[0] - 20 * Math.log10(0.5)) < 1e-9, String(s.magsDb[0]));
});
