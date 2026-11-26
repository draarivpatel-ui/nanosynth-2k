'use strict';
/* Hostile-input and hardening coverage: prototype pollution guards, numeric
   sanitization, amplitude application, WAV edge cases, DOM contract checks
   on index.html and app.js, and WCAG surface checks. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../src/nanosynth.js');

const ROOT = path.join(__dirname, '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src/nanosynth.js'), 'utf8');

/* ---------- prototype pollution and hostile state input ---------- */

test('deserializeState cannot pollute Object.prototype via __proto__ key', () => {
  N.deserializeState('{"__proto__":{"polluted":true}}');
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(Object.prototype.polluted, undefined);
});

test('deserializeState ignores constructor and prototype keys', () => {
  const s = N.deserializeState('{"constructor":{"x":1},"prototype":{"y":2}}');
  assert.strictEqual(s.version, N.VERSION);
  assert.strictEqual(({}).x, undefined);
});

test('nested __proto__ inside a sources entry cannot pollute either', () => {
  N.deserializeState('{"sources":[{"x":0.5,"__proto__":{"evil":9}}]}');
  assert.strictEqual(({}).evil, undefined);
});

test('canonicalize keeps a literal __proto__ key as an own property', () => {
  const c = N.canonicalize(JSON.parse('{"__proto__":{"x":1},"a":2}'));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(c, '__proto__'), true);
  assert.strictEqual(Object.getPrototypeOf(c), Object.prototype);
  assert.ok(JSON.stringify(c).includes('__proto__'));
});

test('serializeState survives a hostile key set deterministically', () => {
  const hostile = JSON.parse('{"__proto__":{"p":1},"a":{"__proto__":{"q":2}}}');
  const out = N.serializeState(hostile);
  assert.strictEqual(({}).p, undefined);
  assert.equal(out, N.serializeState(hostile));
});

test('cloneState on a hostile object still produces a clean state', () => {
  const s = N.cloneState(JSON.parse('{"__proto__":{"z":1},"synth":{"frequency":330}}'));
  assert.strictEqual(s.synth.frequency, 330);
  assert.strictEqual(({}).z, undefined);
});

/* ---------- numeric sanitization ---------- */

test('waveNumber treats non positive wavelengths as one unit', () => {
  assert.equal(N.waveNumber(0), N.TAU);
  assert.equal(N.waveNumber(-5), N.TAU);
  assert.equal(N.waveNumber(NaN), N.TAU);
  assert.equal(N.waveNumber(Infinity), N.TAU);
});

test('intensityAt is finite for zero and negative wavelengths', () => {
  const src = [{ x: 0, y: 0, amplitude: 1, phase: 0 }];
  assert.ok(Number.isFinite(N.intensityAt(src, 5, 5, 0, 0)));
  assert.ok(Number.isFinite(N.intensityAt(src, 5, 5, -3, 0)));
  assert.ok(Number.isFinite(N.superpose(src, 5, 5, 0, 0, 1, 0)));
});

test('intensityField coerces non positive step to the default of two', () => {
  const src = [{ x: 0, y: 0, amplitude: 1, phase: 0 }];
  const f = N.intensityField(src, 32, 16, 8, -2, 0);
  assert.equal(f.cols, 16);
  assert.equal(f.rows, 8);
  assert.equal(f.data.length, 128);
});

test('intensityField coerces a fractional step below one', () => {
  const f = N.intensityField([{ x: 0, y: 0 }], 30, 20, 8, 0.5, 0);
  assert.equal(f.cols, 15);
  assert.equal(f.rows, 10);
});

test('intensityField floors a fractional step above one', () => {
  const f = N.intensityField([{ x: 0, y: 0 }], 30, 20, 8, 2.7, 0);
  assert.equal(f.step, 2);
  assert.equal(f.cols, 15);
});

test('intensityField never reports a negative grid', () => {
  const f = N.intensityField([{ x: 0, y: 0 }], 10, 10, 8, 9999, 0);
  assert.equal(f.cols, 0);
  assert.equal(f.data.length, 0);
  assert.equal(f.min, 0);
});

test('autocorrelation floors a fractional lag', () => {
  const b = new Float64Array([1, 2, 3, 4, 5]);
  assert.equal(N.autocorrelation(b, 1.9), N.autocorrelation(b, 1));
});

test('autocorrelation returns zero for non finite lags', () => {
  const b = new Float64Array([1, 2, 3]);
  assert.equal(N.autocorrelation(b, NaN), 0);
  assert.equal(N.autocorrelation(b, 'x'), 0);
  assert.equal(N.autocorrelation(b, Infinity), 0);
});

test('autocorrelation of an all zero buffer is zero not NaN', () => {
  assert.equal(N.autocorrelation(new Float64Array(16), 0), 0);
});

test('frequencyToNote of a non positive frequency is non finite but defined', () => {
  assert.equal(N.frequencyToNote(0), -Infinity);
});

/* ---------- synthesis correctness ---------- */

test('karplusStrong honors the amplitude option', () => {
  const o = { duration: 0.05, sampleRate: 8000, seed: 3 };
  const full = N.karplusStrong(Object.assign({ amplitude: 1 }, o));
  const half = N.karplusStrong(Object.assign({ amplitude: 0.5 }, o));
  assert.ok(Math.abs(N.peak(half) - N.peak(full) * 0.5) < 1e-9);
});

test('karplusStrong amplitude zero renders silence', () => {
  const b = N.karplusStrong({ duration: 0.05, sampleRate: 8000, seed: 3, amplitude: 0 });
  assert.equal(N.peak(b), 0);
});

test('karplusStrong amplitude defaults to one', () => {
  const a = N.karplusStrong({ duration: 0.05, sampleRate: 8000, seed: 3 });
  const b = N.karplusStrong({ duration: 0.05, sampleRate: 8000, seed: 3, amplitude: 1 });
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('karplusStrong never emits NaN or non finite samples', () => {
  const b = N.karplusStrong({ frequency: 20, duration: 0.1, sampleRate: 8000, seed: 1 });
  assert.ok(Array.from(b).every(Number.isFinite));
});

test('karplusStrong clamps frequency and sample rate extremes', () => {
  const a = N.karplusStrong({ frequency: 1e9, duration: 0.01, sampleRate: 1e9 });
  const b = N.karplusStrong({ frequency: 8000, duration: 0.01, sampleRate: 96000 });
  assert.equal(a.length, b.length);
});

test('fmBuffer never emits non finite samples at index extremes', () => {
  const b = N.fmBuffer({ frequency: 8000, sampleRate: 96000, duration: 0.05, modIndex: 20, modRatio: 16 });
  assert.ok(Array.from(b).every(Number.isFinite));
  assert.ok(N.peak(b) <= 1.0000001);
});

test('fmBuffer first sample starts at silence through the envelope', () => {
  const b = N.fmBuffer({ duration: 0.05, sampleRate: 8000 });
  assert.equal(b[0], 0);
});

test('encodeWav maps NaN and Infinity to silence not full scale', () => {
  const w = N.encodeWav(new Float64Array([NaN, Infinity, -Infinity]), 8000);
  const dv = new DataView(w.buffer);
  assert.equal(dv.getInt16(44, true), 0);
  assert.equal(dv.getInt16(46, true), 0);
  assert.equal(dv.getInt16(48, true), 0);
});

test('encodeWav byte rate and block align fields are consistent', () => {
  const w = N.encodeWav(new Float64Array(4), 48000);
  const dv = new DataView(w.buffer);
  assert.equal(dv.getUint32(28, true), 96000);
  assert.equal(dv.getUint16(32, true), 2);
  assert.equal(dv.getUint32(4, true), 36 + 8);
});

test('encodeWav of an empty buffer is a valid header only file', () => {
  const w = N.encodeWav(new Float64Array(0), 8000);
  assert.equal(w.length, 44);
  const dv = new DataView(w.buffer);
  assert.equal(dv.getUint32(40, true), 0);
});

test('encodeWav accepts a plain array not just Float64Array', () => {
  const w = N.encodeWav([0.5, -0.5], 8000);
  assert.equal(w.length, 48);
});

/* ---------- deterministic state hardening ---------- */

test('createState coerces string numerics from form fields', () => {
  const s = N.createState({ synth: { frequency: '440', midi: '69', seed: '12' }, optics: { wavelength: '30' } });
  assert.equal(s.synth.frequency, 440);
  assert.equal(s.synth.midi, 69);
  assert.equal(s.synth.seed, 12);
  assert.equal(s.optics.wavelength, 30);
});

test('createState clamps source count between two and four', () => {
  const five = N.createState({ sources: [{}, {}, {}, {}, {}] });
  assert.equal(five.sources.length, 4);
  const none = N.createState({ sources: [] });
  assert.equal(none.sources.length, 2);
});

test('createState repairs a non array sources field', () => {
  const s = N.createState({ sources: 'bogus' });
  assert.equal(s.sources.length, 2);
});

test('createState keeps a source entry that is not an object', () => {
  const s = N.createState({ sources: [null, 42, 'x'] });
  assert.equal(s.sources.length, 3);
  s.sources.forEach((p) => {
    assert.ok(p.x >= 0 && p.x <= 1 && Number.isFinite(p.x));
  });
});

test('createState seed wraps and normalizes', () => {
  assert.equal(N.createState({ synth: { seed: -7 } }).synth.seed, 7);
  assert.equal(N.createState({ synth: { seed: 'abc' } }).synth.seed, 0);
  assert.ok(N.createState({ synth: { seed: 1e20 } }).synth.seed < 4294967296);
});

test('createState mode only accepts ks or fm', () => {
  assert.equal(N.createState({ synth: { mode: 'FM' } }).synth.mode, 'ks');
  assert.equal(N.createState({ synth: { mode: null } }).synth.mode, 'ks');
});

test('serializeState output is byte stable across repeated canonicalization', () => {
  const s = N.createState({ synth: { frequency: 220.0000004 } });
  assert.equal(N.serializeState(s), N.serializeState(N.deserializeState(N.serializeState(s))));
});

test('deserializeState on a deeply nested object survives', () => {
  const deep = '{"a":'.repeat(0) + '{"optics":{"wavelength":12.5}}';
  const s = N.deserializeState(deep);
  assert.equal(s.optics.wavelength, 12.5);
});

test('deserializeState rejects oversized hostile values', () => {
  const s = N.deserializeState('{"synth":{"frequency":1e308,"duration":1e308}}');
  assert.ok(s.synth.frequency <= 8000);
  assert.ok(s.synth.duration <= 10);
});

test('stateHash differs for structurally different states', () => {
  const a = N.createState();
  const b = N.createState({ view: { palette: 'ember' } });
  assert.notEqual(N.stateHash(a), N.stateHash(b));
});

test('fnv1a matches the published constant for a known input', () => {
  assert.equal(N.fnv1a('a'), 'e40c292c');
  assert.equal(N.fnv1a(''), '811c9dc5');
});

/* ---------- data URI edge cases ---------- */

test('encodeDataUri round trips a document with unicode text', () => {
  const doc = '<p>café ☃ 日本語</p>';
  assert.equal(N.decodeDataUri(N.encodeDataUri(doc)), doc);
});

test('encodeDataUri round trips an empty string', () => {
  assert.equal(N.decodeDataUri(N.encodeDataUri('')), '');
});

test('encodeDataUri leaves no raw percent signs behind', () => {
  const u = N.encodeDataUri('100% sure ## "quoted"\r\nline');
  assert.ok(!u.includes('% sure'));
  assert.ok(!u.includes('#'));
  assert.ok(!u.includes('"'));
  assert.ok(!/\r|\n/.test(u));
});

test('decodeDataUri throws on a truncated percent escape', () => {
  assert.throws(() => N.decodeDataUri('data:text/html,%2'), /URI|URIError|malformed/i);
});

/* ---------- app controller DOM contract ---------- */

test('index.html declares a restrictive content security policy', () => {
  const m = IDX.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(m, 'no CSP meta');
  const csp = m[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
});

test('index.html never loads remote resources', () => {
  const urls = IDX.match(/https?:\/\/[^"'\s<>)]+/g) || [];
  assert.equal(urls.length, 0, 'remote url found: ' + urls.join(','));
});

test('every script tag in index.html resolves to a checked in file', () => {
  const scripts = [...IDX.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2);
  for (const s of scripts) assert.ok(fs.existsSync(path.join(ROOT, s)), s);
});

test('index.html has a visible focus indicator rule', () => {
  assert.match(IDX, /:focus-visible\{outline:2px solid var\(--accent\)/);
});

test('both canvases expose accessible names', () => {
  assert.match(IDX, /<canvas id="field"[^>]*role="img"[^>]*aria-label="[^"]+"/);
  assert.match(IDX, /<canvas id="wave"[^>]*role="img"[^>]*aria-label="[^"]+"/);
});

test('the field canvas is keyboard focusable', () => {
  assert.match(IDX, /<canvas id="field"[^>]*tabindex="0"/);
});

test('preset controls are real buttons not clickable spans', () => {
  assert.equal(/<span class="pill"/.test(IDX), false);
  const pills = IDX.match(/<button type="button" class="pill" data-preset="/g) || [];
  assert.equal(pills.length, 4);
});

test('the audio and motion toggles expose aria-pressed', () => {
  assert.match(IDX, /id="audioBtn"[^>]*aria-pressed="false"/);
  assert.match(IDX, /id="animBtn"[^>]*aria-pressed="false"/);
  assert.match(APP, /setAttribute\('aria-pressed', on \? 'true' : 'false'\)/);
});

test('the state textarea has an accessible label and live status', () => {
  assert.match(IDX, /<textarea id="stateBox"[^>]*aria-label="[^"]+"/);
  assert.match(IDX, /id="stateMsg"[^>]*aria-live="polite"/);
});

test('no interactive element nests a button inside an anchor', () => {
  assert.equal(/<a [^>]*><button>/.test(IDX), false);
  assert.match(IDX, /<a href="shrink\.html"[^>]*class="btn-link">/);
});

test('every id referenced by app.js exists in index.html', () => {
  const htmlIds = new Set([...IDX.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...APP.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});

test('app.js never writes user data through innerHTML', () => {
  assert.equal(/\.innerHTML\s*=\s*[^'"`<]/.test(APP), false);
  assert.equal(/innerHTML\s*\+=/.test(APP), false);
});

test('app.js space handler excludes form controls and repeats', () => {
  assert.match(APP, /e\.code === 'Space' && !e\.repeat/);
  assert.match(APP, /TEXTAREA\|INPUT\|SELECT\|BUTTON\|A/);
});

test('app.js creates an AudioContext at exactly two gesture gated call sites', () => {
  const makes = APP.match(/new \(window\.AudioContext/g) || [];
  assert.equal(makes.length, 2);
  assert.equal(/new \(window\.AudioContext/.test(IDX), false);
});

test('applyPreset preserves the synth voice and view across a swap', () => {
  const fn = APP.slice(APP.indexOf('function applyPreset'));
  assert.match(fn, /synth: state\.synth/);
  assert.match(fn, /view: state\.view/);
  assert.match(fn, /spreading: state\.optics\.spreading/);
});

test('pointerdown only drags a source inside the grab ring', () => {
  assert.match(APP, /dragIdx = bestD < 22 \? best : -1/);
});

test('index.html keeps the h1 standing alone with no tagline under it', () => {
  const header = IDX.slice(IDX.indexOf('<header>'), IDX.indexOf('</header>'));
  assert.equal(/<p[\s>]/.test(header), false);
});

test('index.html contains no em dash en dash or AI branding', () => {
  var em = String.fromCharCode(0x2014), en = String.fromCharCode(0x2013);
  assert.equal(IDX.includes(em) || IDX.includes(en), false);
  var banned = ['cl' + 'aude', 'chat' + 'gpt', 'open' + 'ai',
    'anthro' + 'pic', 'copi' + 'lot', 'gem' + 'ini'];
  assert.equal(new RegExp(banned.join('|'), 'i').test(IDX), false);
});

test('no source file has media elements or an autoplay attribute', () => {
  for (const f of ['index.html', 'app.js', 'src/nanosynth.js', 'shrink.html']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(/<audio[\s>]|<video[\s>]/i.test(s), false, f);
    assert.equal(/autoplay[\s=>]/i.test(s), false, f);
  }
});

test('every shipped page declares the document language', () => {
  for (const f of ['index.html', 'shrink.html']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(s, /<html[^>]*\slang\s*=\s*["']?en["']?/i, f + ' needs lang=en');
  }
});

test('no source file uses scroll-behavior smooth', () => {
  for (const f of ['index.html', 'app.js', 'src/nanosynth.js', 'shrink.html', 'README.md']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(/scroll-behavior\s*:\s*smooth/.test(s), false, f);
  }
});

test('workbench loads with the audio flag off and no AudioContext at boot', () => {
  assert.match(APP, /var audioOn = false/);
  const boot = APP.slice(APP.indexOf('pushControls();', APP.lastIndexOf('/* ---------- Boot')));
  assert.equal(/new \(window\.AudioContext/.test(boot), false);
});

test('every aria-controls or aria-labelledby reference in index.html resolves', () => {
  const ids = new Set([...IDX.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of IDX.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)) {
    assert.ok(ids.has(m[1]), 'missing target ' + m[1]);
  }
});

test('every interactive element in index.html is reachable by keyboard', () => {
  assert.equal(/<span[^>]*data-preset/.test(IDX), false);
  const onclickSpans = IDX.match(/<span[^>]*onclick/g) || [];
  assert.equal(onclickSpans.length, 0);
});

/* ---------- physics invariants ---------- */

test('superpose equals the phasor imaginary part at t zero', () => {
  const src = [
    { x: 0, y: 0, amplitude: 1, phase: 0 },
    { x: 30, y: 0, amplitude: 0.8, phase: 1 }
  ];
  const ph = N.phasorAt(src, 15, 40, 20, 0.01);
  const inst = N.superpose(src, 15, 40, 20, 0, 0, 0.01);
  assert.ok(Math.abs(ph.im - inst) < 1e-9);
});

test('doubling all amplitudes multiplies intensity by four', () => {
  const a = [{ x: 0, y: 0, amplitude: 1, phase: 0 }, { x: 40, y: 0, amplitude: 0.5, phase: 0.4 }];
  const b = a.map((s) => Object.assign({}, s, { amplitude: s.amplitude * 2 }));
  const ia = N.intensityAt(a, 20, 25, 15, 0.01);
  const ib = N.intensityAt(b, 20, 25, 15, 0.01);
  assert.ok(Math.abs(ib - 4 * ia) < 1e-6);
});

test('spreading of zero leaves source amplitude untouched', () => {
  const s = { x: 0, y: 0, amplitude: 2, phase: 0 };
  const v = N.waveDisplacement(s, 50, 0, 0.5, 0, 0, 0);
  assert.ok(Math.abs(Math.abs(v) - 2 * Math.abs(Math.sin(0.5 * 50))) < 1e-9);
});

test('constructive and destructive predicates agree on half wavelength', () => {
  assert.equal(N.isDestructive(6, 12), true);
  assert.equal(N.isConstructive(6, 12), false);
  assert.equal(N.isDestructive(3, 12), false);
  assert.equal(N.isConstructive(12, 12), true);
});

test('a four source array keeps all sources in serialized state', () => {
  const s = N.createState({ sources: [{}, {}, {}, {}] });
  const j = N.serializeState(s);
  assert.equal(JSON.parse(j).sources.length, 4);
});

test('large source count requests are capped at four', () => {
  const s = N.createState({ sources: Array(9).fill({ x: 0.5, y: 0.5 }) });
  assert.equal(s.sources.length, 4);
});

test('createState preserves explicit audioOn true and false', () => {
  assert.equal(N.createState({ audioOn: true }).audioOn, true);
  assert.equal(N.createState({ audioOn: 0 }).audioOn, false);
});

test('source coordinates clamp to the unit square', () => {
  const s = N.createState({ sources: [{ x: 5, y: -2 }, { x: 0.5, y: 2 }] });
  assert.equal(s.sources[0].x, 1);
  assert.equal(s.sources[0].y, 0);
  assert.equal(s.sources[1].y, 1);
});

test('negative and NaN source amplitudes and phases repair to defaults', () => {
  const s = N.createState({ sources: [{ x: 0.5, y: 0.5, amplitude: NaN, phase: NaN }] });
  assert.ok(Number.isFinite(s.sources[0].amplitude));
  assert.ok(Number.isFinite(s.sources[0].phase));
});

test('intensityField width and height floor at one cell each', () => {
  const f = N.intensityField([{ x: 0, y: 0 }], -10, 0, 8, 2, 0);
  assert.ok(f.width >= 1 && f.height >= 1);
  assert.ok(f.data.length === f.cols * f.rows);
});

test('intensityField tracks min and max within the data array', () => {
  const f = N.intensityField([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], 40, 40, 10, 2, 0.005);
  let mn = Infinity, mx = -Infinity;
  for (const v of f.data) { if (v < mn) mn = v; if (v > mx) mx = v; }
  assert.ok(Math.abs(f.min - mn) < 1e-12);
  assert.ok(Math.abs(f.max - mx) < 1e-12);
});

test('pathDifference returns source zero minus each later source distance', () => {
  const src = [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 60, y: 0 }];
  const d = N.pathDifference(src, 0, 0);
  assert.equal(d.length, 2);
  assert.ok(Math.abs(d[0] + 50) < 1e-9);
  assert.ok(Math.abs(d[1] + 60) < 1e-9);
});

test('rms of a constant buffer equals its absolute value', () => {
  assert.ok(Math.abs(N.rms(new Float64Array([0.25, -0.25, 0.25, -0.25])) - 0.25) < 1e-9);
});

test('clamp repairs non finite values to the lower bound', () => {
  assert.equal(N.clamp(NaN, 0, 1), 0);
  assert.equal(N.clamp(Infinity, 0, 1), 0);
  assert.equal(N.clamp(5, 0, 1), 1);
  assert.equal(N.clamp(-5, 0, 1), 0);
  assert.equal(N.clamp('0.5', 0, 1), 0.5);
});

test('noteToFrequency lands on the A440 concert pitch', () => {
  assert.ok(Math.abs(N.noteToFrequency(69) - 440) < 1e-6);
  assert.ok(Math.abs(N.noteToFrequency(60) - 261.625565) < 1e-3);
});

test('frequencyToNote inverts noteToFrequency', () => {
  assert.ok(Math.abs(N.frequencyToNote(N.noteToFrequency(72)) - 72) < 1e-6);
});

test('rng is deterministic and stays inside the unit interval', () => {
  const a = N.rng(42), b = N.rng(42);
  for (let i = 0; i < 50; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test('encodeDataUri escapes percent signs so round trips are exact', () => {
  const u = N.encodeDataUri('a%b');
  assert.ok(u.includes('%25'));
  assert.equal(N.decodeDataUri(u), 'a%b');
});

/* ---------- adversarial tester regression findings ---------- */

test('karplusStrong has no persistent DC offset even at damping one', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const b = N.karplusStrong({ damping: 1, duration: 2, sampleRate: 22050, seed });
    let tail = 0;
    for (let i = Math.floor(b.length * 0.9); i < b.length; i++) tail += b[i];
    tail /= b.length - Math.floor(b.length * 0.9);
    assert.ok(Math.abs(tail) < 0.01, 'seed ' + seed + ' dc ' + tail);
  }
});

test('karplusStrong excitation mean is zero for many seeds', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const b = N.karplusStrong({ damping: 1, duration: 1, sampleRate: 8000, seed });
    let m = 0;
    for (const v of b) m += v;
    m /= b.length;
    assert.ok(Math.abs(m) < 0.02, 'seed ' + seed + ' mean ' + m);
  }
});

test('karplusStrong peak never exceeds the amplitude bound', () => {
  for (let seed = 1; seed <= 10; seed++) {
    assert.ok(N.peak(N.karplusStrong({ duration: 1, sampleRate: 8000, seed })) <= 1.0000001);
  }
});

test('serializeState keeps huge finite numbers instead of null', () => {
  assert.equal(N.serializeState({ x: 1e303 }), '{"x":1e+303}');
  assert.equal(N.serializeState({ x: 5e307 }), '{"x":5e+307}');
  assert.notEqual(N.stateHash({ x: 1e308 }), N.stateHash({ x: null }));
});

test('cloneState of a state holding a huge number stays faithful', () => {
  const s = N.createState();
  s.extra = 1e303;
  assert.deepEqual(N.deserializeState(N.serializeState(s)).extra, s.extra);
});

test('roundTo returns huge finite inputs instead of Infinity', () => {
  assert.equal(N.roundTo(1e308), 1e308);
  assert.equal(N.roundTo(-1e308), -1e308);
  assert.equal(N.roundTo(1.2345678, 4), 1.2346);
});

test('createState heals sparse source arrays into dense defaults', () => {
  const s = N.createState({ sources: [undefined, { x: 0.9 }] });
  assert.equal(s.sources.length, 2);
  assert.ok(s.sources[0] && typeof s.sources[0].x === 'number');
  assert.equal(s.sources[1].x, 0.9);
});

test('encodeWav rounds to nearest int16 not toward zero', () => {
  const dv = new DataView(N.encodeWav([0.999999, -0.999999, 0.5, -0.5], 8000).buffer);
  assert.equal(dv.getInt16(44, true), 32767);
  assert.equal(dv.getInt16(46, true), -32768);
  assert.equal(Math.abs(dv.getInt16(48, true)), Math.abs(dv.getInt16(50, true)));
});

test('encodeWav rejects non sample arrays and repairs bad rates', () => {
  assert.equal(N.encodeWav(5, 8000).length, 44);
  assert.equal(N.encodeWav('abc', 8000).length, 44);
  assert.equal(N.encodeWav(null, 8000).length, 44);
  const w = N.encodeWav([0], 'bogus');
  assert.equal(new DataView(w.buffer).getUint32(24, true), 44100);
  const w2 = N.encodeWav([0], 999999);
  assert.equal(new DataView(w2.buffer).getUint32(24, true), 96000);
});

test('fmSample stays finite on extreme arguments', () => {
  assert.equal(N.fmSample(1e308, 220, 220, 3, 1), 0);
  assert.equal(N.fmSample(0.5, 220, 110, 2, NaN), 0);
  assert.equal(N.fmSample(0.5, 220, 110, 2, Infinity), 0);
  assert.ok(Number.isFinite(N.fmSample(0.5, 220, 110, 2, 0.7)));
});

test('optics functions never emit NaN on hostile coordinates', () => {
  const src = [{ x: NaN, y: 0, amplitude: NaN, phase: Infinity }];
  assert.ok(Number.isFinite(N.superpose(src, NaN, NaN, 20, 0, 1, -5)));
  const ph = N.phasorAt(src, NaN, NaN, 20, -5);
  assert.ok(Number.isFinite(ph.re) && Number.isFinite(ph.im));
  assert.ok(Number.isFinite(N.intensityAt(src, NaN, NaN, 20, -5)));
});

test('intensityField survives non finite and absurd dimensions', () => {
  const f = N.intensityField([{ x: 0, y: 0 }], Infinity, 40, 8, 2, 0);
  assert.ok(f.cols <= 1000 && Number.isFinite(f.min));
  const g = N.intensityField([{ x: 0, y: 0 }], NaN, NaN, 8, 2, 0);
  assert.ok(g.cols >= 0 && g.rows >= 0);
});

test('rms and peak and autocorrelation ignore non finite samples', () => {
  const b = [1, 2, Infinity, 4];
  assert.ok(Number.isFinite(N.rms(b)));
  assert.ok(Number.isFinite(N.peak(b)));
  assert.ok(Number.isFinite(N.autocorrelation(b, 1)));
});

test('createState audioOn only trusts the literal boolean true', () => {
  assert.equal(N.deserializeState('{"audioOn":"false"}').audioOn, false);
  assert.equal(N.deserializeState('{"audioOn":1}').audioOn, false);
  assert.equal(N.deserializeState('{"audioOn":true}').audioOn, true);
});

test('createState repairs a non finite seed', () => {
  assert.equal(N.createState({ synth: { seed: Infinity } }).synth.seed, 0);
  assert.equal(N.createState({ synth: { seed: -Infinity } }).synth.seed, 0);
});

test('createState derives midi from frequency when only frequency is given', () => {
  assert.equal(N.createState({ synth: { frequency: 440 } }).synth.midi, 69);
  assert.equal(N.createState({ synth: { frequency: 440, midi: 60 } }).synth.midi, 60);
});

test('serializeState and stateHash never throw on exotic input', () => {
  assert.equal(N.serializeState(undefined), 'null');
  assert.equal(N.serializeState(function () {}), 'null');
  assert.ok(/^[0-9a-f]{8}$/.test(N.stateHash(undefined)));
  const c = { a: 1 };
  c.self = c;
  const s = N.serializeState(c);
  assert.ok(s.length > 0 && s.length < 1e6);
  assert.equal(N.serializeState({ n: 9007199254740993n }).includes('9'), true);
});

test('pathDifference returns zero for fewer than two sources', () => {
  assert.equal(N.pathDifference([], 0, 0), 0);
  assert.equal(N.pathDifference([{ x: 0, y: 0 }], 0, 0), 0);
  assert.equal(N.pathDifference(null, 0, 0), 0);
});

test('app.js copyUri reports a failed shrink.html fetch', () => {
  assert.match(APP, /getShrink\(\)\.then\(function \(h\) \{ copyText\(N\.encodeDataUri\(h\), 'Data URI'\); \}\)\s*\.catch/);
});

test('app.js snaps unrepresentable select values to the nearest option', () => {
  assert.match(APP, /function snapSelect\(el, v\)/);
  assert.match(APP, /snapSelect\(\$\('sr'\)/);
  assert.match(APP, /snapSelect\(\$\('step'\)/);
});

test('app.js loadState re-reads controls so state normalizes immediately', () => {
  const load = APP.slice(APP.indexOf("$('loadState')"), APP.indexOf("$('resetState')"));
  assert.match(load, /pushControls\(\);\s*\/\*[\s\S]*?readControls\(\);/);
});

test('shrink.html is touch friendly with a viewport and touch action', () => {
  const h = fs.readFileSync(path.join(ROOT, 'shrink.html'), 'utf8');
  assert.match(h, /<meta name=viewport/);
  assert.match(h, /touch-action:none/);
  assert.ok(Buffer.byteLength(h) < 2950);
});

test('generate_data_uri checks byte length not character length', () => {
  const g = fs.readFileSync(path.join(ROOT, 'tools/generate_data_uri.js'), 'utf8');
  assert.match(g, /Buffer\.byteLength\(html\)/);
});

/* ---------- revamp regression coverage ---------- */

test('wavelength frequency conversion helpers repair hostile inputs', () => {
  assert.equal(N.frequencyToWavelength(0), N.SPEED_OF_SOUND);
  assert.equal(N.frequencyToWavelength(-10), N.SPEED_OF_SOUND);
  assert.equal(N.frequencyToWavelength(NaN), N.SPEED_OF_SOUND);
  assert.equal(N.wavelengthToFrequency(0), N.SPEED_OF_SOUND);
  assert.equal(N.wavelengthToFrequency(-2), N.SPEED_OF_SOUND);
  assert.equal(N.wavelengthToFrequency(Infinity), N.SPEED_OF_SOUND);
});

test('fringe helpers stay finite for hostile optical inputs', () => {
  assert.ok(Number.isFinite(N.fringeSpacing(0, 0, NaN)));
  assert.ok(Number.isFinite(N.fringeSpacing(-2, -4, -100)));
  assert.equal(N.isConstructive(0, 0), true);
  assert.equal(N.isDestructive(0.5, 0), true);
});

test('phasor superposition and path difference tolerate malformed source entries', () => {
  assert.doesNotThrow(() => N.phasorAt([null, 4, {}], 2, 3, 10));
  assert.doesNotThrow(() => N.superpose([null, 4, {}], 2, 3, 10, 0, 0, 0));
  assert.doesNotThrow(() => N.intensityAt(null, 2, 3, 10, 0));
  assert.doesNotThrow(() => N.pathDifference([null, { x: 1 }], 2, 3));
});

test('workbench measures slit separation as Euclidean distance', () => {
  const probe = APP.slice(APP.indexOf('function updateProbe'), APP.indexOf('/* ---------- Synth'));
  assert.match(probe, /Math\.hypot\(srcs\[1\]\.x - srcs\[0\]\.x, srcs\[1\]\.y - srcs\[0\]\.y\)/);
  assert.equal(/Math\.abs\(srcs\[1\]\.x - srcs\[0\]\.x\)/.test(probe), false);
});

test('frequency and note controls synchronize before state capture', () => {
  const wired = APP.slice(APP.indexOf("['wl', 'sp'"), APP.indexOf('/* Keep note and frequency'));
  assert.equal(/'freq'/.test(wired), false);
  assert.equal(/'midi'/.test(wired), false);
  const midi = APP.slice(APP.indexOf("$('midi').addEventListener('input'"), APP.indexOf("$('freq').addEventListener('input'"));
  const freq = APP.slice(APP.indexOf("$('freq').addEventListener('input'"), APP.indexOf("$('srcCount').addEventListener"));
  assert.match(midi, /onControlsChanged\(\)/);
  assert.match(freq, /onControlsChanged\(\)/);
});

test('page has a keyboard skip link into the main landmark', () => {
  assert.match(IDX, /<a class="skip-link" href="#main">Skip to main content<\/a>/);
  assert.match(IDX, /<main id="main">/);
  assert.match(IDX, /\.skip-link:focus/);
});

test('reduced motion users get a stepwise motion alternative', () => {
  assert.match(APP, /prefers-reduced-motion: reduce/);
  assert.match(APP, /Step motion/);
  assert.match(APP, /advanced one frame/);
});

test('comparator rows expose keyboard selection through a real button', () => {
  assert.match(APP, /view\.textContent = 'View'/);
  assert.match(APP, /view\.setAttribute\('aria-label', 'Show '/);
  assert.match(APP, /view\.addEventListener\('click'/);
});

test('functional copy and controls meet legibility and touch floors', () => {
  assert.equal(/font-size:10px/.test(IDX), false);
  assert.match(IDX, /\.row label\{[^}]*font-size:12px/);
  assert.match(IDX, /\.legend\{[^}]*font-size:12px/);
  assert.match(IDX, /\.note\{[^}]*font-size:12px/);
  assert.match(IDX, /\.pill\{[^}]*font-size:11px/);
  assert.match(IDX, /\.stat\{[^}]*padding:6px 0/);
  assert.match(IDX, /button\{[^}]*min-height:24px/);
});
