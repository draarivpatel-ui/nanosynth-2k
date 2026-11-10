'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../src/nanosynth.js');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'shrink.html'), 'utf8');
const URI = fs.readFileSync(path.join(ROOT, 'DATA_URI.txt'), 'utf8')
  .split('\n').find((l) => l.startsWith(N.URI_PREFIX));

/* ---------------------------------------------------------------
   Utilities and math primitives
   --------------------------------------------------------------- */

test('VERSION is a semver-like string', () => {
  assert.match(N.VERSION, /^\d+\.\d+\.\d+$/);
});

test('TAU equals two pi', () => {
  assert.ok(Math.abs(N.TAU - 2 * Math.PI) < 1e-12);
});

test('SPEED_OF_SOUND is 343 m/s', () => {
  assert.equal(N.SPEED_OF_SOUND, 343);
});

test('clamp bounds values from both sides', () => {
  assert.equal(N.clamp(5, 0, 10), 5);
  assert.equal(N.clamp(-3, 0, 10), 0);
  assert.equal(N.clamp(42, 0, 10), 10);
});

test('clamp coerces non finite input to the low bound', () => {
  assert.equal(N.clamp(NaN, 2, 9), 2);
  assert.equal(N.clamp(-Infinity, 2, 9), 2);
  assert.equal(N.clamp(Infinity, 2, 9), 2);
  assert.equal(N.clamp('7', 0, 10), 7);
});

test('lerp is linear at the endpoints and midpoint', () => {
  assert.equal(N.lerp(10, 20, 0), 10);
  assert.equal(N.lerp(10, 20, 1), 20);
  assert.equal(N.lerp(10, 20, 0.5), 15);
});

test('roundTo trims to six decimals and removes negative zero', () => {
  assert.equal(N.roundTo(1 / 3), 0.333333);
  assert.ok(!Object.is(N.roundTo(-0.0000001), -0));
});

test('rng is deterministic for the same seed', () => {
  const a = N.rng(123), b = N.rng(123);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('rng differs for different seeds', () => {
  assert.notEqual(N.rng(1)(), N.rng(2)());
});

test('rng output stays in the unit interval', () => {
  const r = N.rng(99);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});

/* ---------------------------------------------------------------
   Wave interference optics
   --------------------------------------------------------------- */

test('distance matches the Pythagorean result', () => {
  assert.equal(N.distance(0, 0, 3, 4), 5);
  assert.equal(N.distance(1, 1, 1, 1), 0);
});

test('waveNumber is 2 pi over the wavelength', () => {
  assert.ok(Math.abs(N.waveNumber(4) - Math.PI / 2) < 1e-12);
});

test('wavelength and frequency convert both ways', () => {
  const w = N.frequencyToWavelength(343, 343);
  assert.equal(w, 1);
  assert.equal(N.wavelengthToFrequency(w, 343), 343);
  assert.ok(Math.abs(N.frequencyToWavelength(100) - 3.43) < 1e-12);
});

test('a single source has zero displacement at its own origin at t=0', () => {
  const s = [{ x: 10, y: 10, amplitude: 1, phase: 0 }];
  assert.ok(Math.abs(N.waveDisplacement(s[0], 10, 10, N.waveNumber(2), 0, 1, 0)) < 1e-12);
});

test('sourcePhase grows with distance', () => {
  const s = { x: 0, y: 0, amplitude: 1, phase: 0 };
  const k = N.waveNumber(10);
  assert.ok(N.sourcePhase(s, 10, 0, k, 0, 0) > N.sourcePhase(s, 1, 0, k, 0, 0));
});

test('two in-phase sources double amplitude on the midline', () => {
  const src = [
    { x: 0, y: 0, amplitude: 1, phase: 0 },
    { x: 20, y: 0, amplitude: 1, phase: 0 }
  ];
  const v = N.superpose(src, 10, 0, 8, 0, 0, 0);
  const one = N.waveDisplacement(src[0], 10, 0, N.waveNumber(8), 0, 0, 0);
  assert.ok(Math.abs(v - 2 * one) < 1e-9);
});

test('antiphase sources cancel exactly on the symmetry axis', () => {
  const src = [
    { x: 0, y: 0, amplitude: 1, phase: 0 },
    { x: 20, y: 0, amplitude: 1, phase: Math.PI }
  ];
  assert.ok(N.intensityAt(src, 10, 0, 8, 0) < 1e-18);
  assert.ok(Math.abs(N.superpose(src, 10, 0, 8, 0, 0, 0)) < 1e-9);
});

test('phasorAt returns the vector sum of unit phasors', () => {
  const src = [{ x: 0, y: 0, amplitude: 1, phase: 0 }];
  const p = N.phasorAt(src, 0, 0, 8, 0);
  assert.ok(Math.abs(p.re - 1) < 1e-12);
  assert.ok(Math.abs(p.im) < 1e-12);
});

test('intensityAt is the squared phasor magnitude', () => {
  const src = [
    { x: 0, y: 0, amplitude: 1, phase: 0 },
    { x: 10, y: 0, amplitude: 1, phase: Math.PI / 2 }
  ];
  const p = N.phasorAt(src, 3, 4, 7, 0.01);
  assert.ok(Math.abs(N.intensityAt(src, 3, 4, 7, 0.01) - (p.re * p.re + p.im * p.im)) < 1e-9);
});

test('intensityAt is never negative', () => {
  const src = [
    { x: 2, y: 3, amplitude: 1, phase: 1 },
    { x: 18, y: 9, amplitude: 0.7, phase: -2 }
  ];
  for (let x = 0; x < 20; x += 3) {
    for (let y = 0; y < 20; y += 3) {
      assert.ok(N.intensityAt(src, x, y, 5, 0.02) >= 0);
    }
  }
});

test('intensityField reports dimensions, max, min and mean', () => {
  const src = [
    { x: 4, y: 8, amplitude: 1, phase: 0 },
    { x: 24, y: 8, amplitude: 1, phase: 0 }
  ];
  const f = N.intensityField(src, 32, 16, 6, 2, 0.01);
  assert.equal(f.width, 32);
  assert.equal(f.height, 16);
  assert.equal(f.cols, 16);
  assert.equal(f.rows, 8);
  assert.equal(f.data.length, 128);
  assert.ok(f.max >= f.mean && f.mean >= f.min);
  assert.ok(f.max > 0);
});

test('intensityField is deterministic across calls', () => {
  const src = [{ x: 5, y: 5, amplitude: 1, phase: 0 }];
  const a = N.intensityField(src, 20, 20, 4, 2, 0);
  const b = N.intensityField(src, 20, 20, 4, 2, 0);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
});

test('pathDifference is zero on the perpendicular bisector', () => {
  const src = [
    { x: 0, y: 0 },
    { x: 20, y: 0 }
  ];
  assert.ok(Math.abs(N.pathDifference(src, 10, 50)) < 1e-9);
});

test('pathDifference is a scalar for two sources and an array for three', () => {
  const two = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
  const three = two.concat([{ x: 10, y: 20 }]);
  assert.equal(typeof N.pathDifference(two, 3, 4), 'number');
  assert.equal(N.pathDifference(three, 3, 4).length, 2);
});

test('fringeSpacing follows wavelength times distance over separation', () => {
  assert.equal(N.fringeSpacing(2, 4, 100), 50);
  assert.equal(N.fringeSpacing(4, 4, 100), 100);
});

test('isConstructive accepts integer path differences', () => {
  assert.equal(N.isConstructive(0, 4), true);
  assert.equal(N.isConstructive(8, 4), true);
  assert.equal(N.isConstructive(-12, 4), true);
  assert.equal(N.isConstructive(6, 4), false);
});

test('isDestructive accepts half integer path differences', () => {
  assert.equal(N.isDestructive(2, 4), true);
  assert.equal(N.isDestructive(6, 4), true);
  assert.equal(N.isDestructive(4, 4), false);
});

test('colorForIntensity stays inside 8 bit channels', () => {
  for (let i = 0; i <= 10; i++) {
    const c = N.colorForIntensity(i, 10);
    assert.equal(c.length, 3);
    c.forEach((v) => assert.ok(Number.isInteger(v) && v >= 0 && v <= 255));
  }
});

test('colorForIntensity is monotonic in brightness', () => {
  const a = N.colorForIntensity(1, 10), b = N.colorForIntensity(9, 10);
  assert.ok(b[0] >= a[0] && b[1] >= a[1] && b[2] >= a[2]);
});

/* ---------------------------------------------------------------
   Pitch, Karplus-Strong and FM synthesis
   --------------------------------------------------------------- */

test('noteToFrequency gives A4 = 440 Hz', () => {
  assert.equal(N.noteToFrequency(69), 440);
});

test('noteToFrequency drops an octave for midi minus 12', () => {
  assert.ok(Math.abs(N.noteToFrequency(57) - 220) < 1e-9);
});

test('frequencyToNote inverts noteToFrequency', () => {
  for (const m of [36, 57, 69, 81, 93]) {
    assert.ok(Math.abs(N.frequencyToNote(N.noteToFrequency(m)) - m) < 1e-9);
  }
});

test('midiToName names the standard notes', () => {
  assert.equal(N.midiToName(60), 'C4');
  assert.equal(N.midiToName(69), 'A4');
  assert.equal(N.midiToName(61), 'C#4');
});

test('karplusStrong returns the expected sample count', () => {
  const b = N.karplusStrong({ duration: 0.25, sampleRate: 8000 });
  assert.equal(b.length, 2000);
});

test('karplusStrong is bit for bit deterministic for the same seed', () => {
  const o = { frequency: 220, duration: 0.1, sampleRate: 22050, seed: 42 };
  assert.deepEqual(Array.from(N.karplusStrong(o)), Array.from(N.karplusStrong(o)));
});

test('karplusStrong changes with the seed', () => {
  const a = N.karplusStrong({ duration: 0.05, sampleRate: 8000, seed: 1 });
  const b = N.karplusStrong({ duration: 0.05, sampleRate: 8000, seed: 2 });
  assert.notDeepEqual(Array.from(a), Array.from(b));
});

test('karplusStrong stays bounded in the unit range', () => {
  const b = N.karplusStrong({ duration: 0.2, sampleRate: 22050, seed: 7 });
  assert.ok(N.peak(b) <= 1.0000001);
  assert.ok(N.rms(b) > 0);
});

test('lower damping decays karplusStrong faster', () => {
  const o = { duration: 0.5, sampleRate: 8000, seed: 5 };
  const tail = (d) => {
    const b = N.karplusStrong(Object.assign({}, o, { damping: d }));
    return N.rms(b.slice(Math.floor(b.length * 0.8)));
  };
  assert.ok(tail(0.99) < tail(0.9999));
});

test('karplusStrong autocorrelation peaks near the expected period', () => {
  const sr = 44100, f = 220;
  const b = N.karplusStrong({ frequency: f, sampleRate: sr, duration: 0.2, seed: 9 });
  const expected = Math.round(sr / f);
  let best = -1, bestLag = -1;
  for (let lag = expected - 5; lag <= expected + 5; lag++) {
    const v = N.autocorrelation(b, lag);
    if (v > best) { best = v; bestLag = lag; }
  }
  assert.ok(Math.abs(bestLag - expected) <= 2, 'lag ' + bestLag + ' vs ' + expected);
  assert.ok(best > 0.5);
});

test('fmSample is finite and bounded by amplitude', () => {
  for (let t = 0; t < 1; t += 0.01) {
    const v = N.fmSample(t, 220, 440, 3, 0.7);
    assert.ok(Number.isFinite(v) && Math.abs(v) <= 0.7000001);
  }
});

test('fmSample with zero index is a pure carrier sine', () => {
  const t = 0.003;
  assert.ok(Math.abs(N.fmSample(t, 220, 440, 0, 1) - Math.sin(N.TAU * 220 * t)) < 1e-12);
});

test('fmBuffer returns the expected sample count and is deterministic', () => {
  const o = { frequency: 330, sampleRate: 16000, duration: 0.1 };
  const a = N.fmBuffer(o), b = N.fmBuffer(o);
  assert.equal(a.length, 1600);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('fmBuffer peak respects the amplitude cap', () => {
  const b = N.fmBuffer({ amplitude: 0.5, duration: 0.1, sampleRate: 16000 });
  assert.ok(N.peak(b) <= 0.5000001);
});

test('rms and peak of a constant buffer agree', () => {
  const b = new Float64Array(100).fill(0.5);
  assert.equal(N.rms(b), 0.5);
  assert.equal(N.peak(b), 0.5);
});

test('rms and peak of an empty buffer are zero', () => {
  assert.equal(N.rms(new Float64Array(0)), 0);
  assert.equal(N.peak(new Float64Array(0)), 0);
});

test('autocorrelation at lag zero is one', () => {
  const b = N.karplusStrong({ duration: 0.05, sampleRate: 8000 });
  assert.ok(Math.abs(N.autocorrelation(b, 0) - 1) < 1e-9);
});

test('autocorrelation returns zero for out of range lags', () => {
  const b = new Float64Array(10).fill(1);
  assert.equal(N.autocorrelation(b, -1), 0);
  assert.equal(N.autocorrelation(b, 10), 0);
});

test('encodeWav writes a valid 16 bit mono RIFF header', () => {
  const w = N.encodeWav(new Float64Array([0, 0.5, -0.5, 1]), 22050);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...w.slice(8, 12)), 'WAVE');
  const dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
  assert.equal(dv.getUint16(20, true), 1);
  assert.equal(dv.getUint16(22, true), 1);
  assert.equal(dv.getUint32(24, true), 22050);
  assert.equal(dv.getUint16(34, true), 16);
  assert.equal(dv.getUint32(40, true), 8);
  assert.equal(w.length, 44 + 8);
});

test('encodeWav clamps samples outside the unit range', () => {
  const w = N.encodeWav(new Float64Array([5, -5]), 8000);
  const dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
  assert.equal(dv.getInt16(44, true), 32767);
  assert.equal(dv.getInt16(46, true), -32768);
});

/* ---------------------------------------------------------------
   Deterministic state serialization
   --------------------------------------------------------------- */

test('createState defaults to audio off and two sources', () => {
  const s = N.createState();
  assert.equal(s.audioOn, false);
  assert.equal(s.sources.length, 2);
  assert.equal(s.version, N.VERSION);
});

test('createState clamps out of range values', () => {
  const s = N.createState({
    sources: [{ x: 9, y: -4, amplitude: 50, phase: 99 }],
    optics: { wavelength: 0, spreading: 8, time: -3 },
    synth: { frequency: 1, damping: 5, modRatio: -1, duration: 99 },
    view: { width: 1, height: 99999, step: 0 }
  });
  assert.equal(s.sources[0].x, 1);
  assert.equal(s.sources[0].y, 0);
  assert.equal(s.sources[0].amplitude, 2);
  assert.equal(s.optics.wavelength, 4);
  assert.equal(s.optics.spreading, 0.5);
  assert.equal(s.synth.frequency, 20);
  assert.equal(s.synth.damping, 1);
  assert.equal(s.synth.modRatio, 0.1);
  assert.equal(s.synth.duration, 10);
  assert.equal(s.view.width, 64);
  assert.equal(s.view.height, 2000);
  assert.equal(s.view.step, 1);
});

test('createState normalizes the mode and palette', () => {
  assert.equal(N.createState({ synth: { mode: 'bogus' } }).synth.mode, 'ks');
  assert.equal(N.createState({ synth: { mode: 'fm' } }).synth.mode, 'fm');
  assert.equal(N.createState({ view: { palette: 'ember' } }).view.palette, 'ember');
  assert.equal(N.createState({ view: { palette: 'nope' } }).view.palette, 'ice');
});

test('createState forces audioOn to a boolean', () => {
  assert.equal(N.createState({ audioOn: 'yes' }).audioOn, true);
  assert.equal(N.createState({ audioOn: 0 }).audioOn, false);
});

test('serializeState sorts keys so insertion order cannot matter', () => {
  const a = { b: 1, a: 2 };
  const b = { a: 2, b: 1 };
  assert.equal(N.serializeState(a), N.serializeState(b));
  assert.equal(N.serializeState(a), '{"a":2,"b":1}');
});

test('canonicalize rounds floating point noise', () => {
  assert.equal(N.serializeState({ x: 0.1 + 0.2 }), N.serializeState({ x: 0.3 }));
});

test('canonicalize replaces non finite numbers with zero', () => {
  assert.equal(N.serializeState({ a: Infinity, b: NaN }), '{"a":0,"b":0}');
});

test('cloneState is equal but not the same object', () => {
  const s = N.createState();
  const c = N.cloneState(s);
  assert.deepEqual(c, s);
  assert.notEqual(c, s);
  assert.notEqual(c.sources, s.sources);
});

test('stateHash is stable for equal states', () => {
  const s = N.createState();
  const t = N.createState();
  assert.equal(N.stateHash(s), N.stateHash(t));
  assert.match(N.stateHash(s), /^[0-9a-f]{8}$/);
});

test('stateHash changes when a source moves', () => {
  const a = N.createState();
  const b = N.createState();
  b.sources[1].x = 0.9;
  assert.notEqual(N.stateHash(a), N.stateHash(b));
});

test('fnv1a is deterministic and hex encoded', () => {
  assert.equal(N.fnv1a('hello'), N.fnv1a('hello'));
  assert.notEqual(N.fnv1a('hello'), N.fnv1a('world'));
  assert.match(N.fnv1a('hello'), /^[0-9a-f]{8}$/);
});

test('deserializeState round trips through serializeState', () => {
  const s = N.createState({ synth: { frequency: 523.25, mode: 'fm' } });
  const t = N.deserializeState(N.serializeState(s));
  assert.deepEqual(t, s);
  assert.equal(N.stateHash(t), N.stateHash(s));
});

test('deserializeState canonicalizes messy input', () => {
  const t = N.deserializeState('{"b":2,"a":1,"synth":{"frequency":-5}}');
  assert.equal(t.synth.frequency, 20);
  assert.equal(t.version, N.VERSION);
});

test('deserializeState rejects non object JSON', () => {
  assert.throws(() => N.deserializeState('[1,2]'), /must be a JSON object/);
  assert.throws(() => N.deserializeState('null'), /must be a JSON object/);
  assert.throws(() => N.deserializeState('not json'), SyntaxError);
});

/* ---------------------------------------------------------------
   Byte budget and the standalone artifact
   --------------------------------------------------------------- */

test('shrink.html is strictly below 2950 bytes', () => {
  assert.ok(Buffer.byteLength(HTML) < 2950, 'shrink.html is ' + Buffer.byteLength(HTML) + ' bytes');
});

test('DATA_URI.txt contains a copyable data uri line', () => {
  assert.ok(URI, 'no data uri line');
  assert.ok(URI.startsWith('data:text/html,'));
});

test('Buffer.byteLength(dataUri) is strictly below 3072', () => {
  assert.ok(Buffer.byteLength(URI) < 3072, 'data uri is ' + Buffer.byteLength(URI) + ' bytes');
});

test('the data uri decodes back to shrink.html exactly', () => {
  assert.equal(N.decodeDataUri(URI), HTML);
});

test('the data uri line matches encodeDataUri of the file', () => {
  assert.equal(URI, N.encodeDataUri(HTML));
});

test('encodeDataUri escapes percent, hash, quote and newlines', () => {
  const u = N.encodeDataUri('a%b#c"d\ne');
  assert.ok(!u.includes('#'));
  assert.ok(!u.includes('"'));
  assert.ok(!u.includes('\n'));
  assert.ok(u.includes('%25'));
  assert.equal(N.decodeDataUri(u), 'a%b#c"d\ne');
});

test('decodeDataUri rejects a foreign prefix', () => {
  assert.throws(() => N.decodeDataUri('https://example.com'), /not a NanoSynth data uri/);
});

test('shrink.html has no em dash or en dash', () => {
  const em = String.fromCharCode(0x2014), en = String.fromCharCode(0x2013);
  assert.ok(!HTML.includes(em), 'em dash found');
  assert.ok(!HTML.includes(en), 'en dash found');
});

test('shrink.html contains no AI assistant branding', () => {
  assert.ok(!/(claude|chatgpt|openai|anthropic|copilot|gemini)/i.test(HTML));
});

test('shrink.html starts muted with a zero audio flag and no autoplay', () => {
  assert.match(HTML, /var\s+[^;]*A=0/);
  assert.ok(!/autoplay/i.test(HTML));
  assert.match(HTML, /Audio: OFF/);
  assert.match(HTML, /A=!A/);
  assert.match(HTML, /new AudioContext\(\)/);
});

test('AudioContext creation in shrink.html is gated behind the audio flag', () => {
  const gate = HTML.indexOf('A=!A');
  const make = HTML.indexOf('new AudioContext()');
  assert.ok(gate >= 0 && make > gate);
});

test('shrink.html implements both synthesis voices', () => {
  assert.match(HTML, /Karplus-Strong/);
  assert.match(HTML, /FM/);
  assert.match(HTML, /createBuffer/);
  assert.match(HTML, /getChannelData/);
});

test('shrink.html implements the two source interference field', () => {
  assert.match(HTML, /Math\.hypot/);
  assert.match(HTML, /Math\.cos/);
  assert.match(HTML, /Math\.sin/);
  assert.match(HTML, /putImageData/);
});

test('shrink.html script parses as valid JavaScript', () => {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'no inline script');
  assert.doesNotThrow(() => new (require('node:vm').Script)(m[1]));
});

test('the modular workbench references the shared core and app controller', () => {
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(idx, /src\/nanosynth\.js/);
  assert.match(idx, /app\.js/);
  assert.match(idx, /shrink\.html/);
});

test('the workbench also starts with audio off', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /var audioOn = false/);
  assert.match(app, /setAudio\(!audioOn\)/);
  assert.match(app, /function play\(\)[\s\S]*?if \(!audioOn\)/);
  assert.ok(/function setAudio\(on\)[\s\S]*?new \(window\.AudioContext/.test(app));
});

test('every source file is free of em dashes and en dashes', () => {
  const em = String.fromCharCode(0x2014), en = String.fromCharCode(0x2013);
  for (const f of ['app.js', 'src/nanosynth.js', 'index.html', 'test/nanosynth.test.js',
                   'README.md', 'shrink.html']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!s.includes(em) && !s.includes(en), f + ' contains a dash');
  }
});
