/* NanoSynth-2K core. Deterministic wave optics, Karplus-Strong and FM
   synthesis, canonical state serialization and data URI helpers. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else if (root) {
    root.NanoSynth = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var TAU = Math.PI * 2;
  var SPEED_OF_SOUND = 343;
  var DEFAULT_SAMPLE_RATE = 44100;
  var PRECISION = 1e6;
  var URI_PREFIX = 'data:text/html,';

  function clamp(v, lo, hi) {
    v = Number(v);
    if (!isFinite(v)) v = lo;
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function roundTo(v, digits) {
    var f = Math.pow(10, digits === undefined ? 6 : digits);
    var r = Math.round(Number(v) * f) / f;
    /* Rounding a huge finite number can overflow to Infinity; keep the
       original value rather than emitting a non finite result. */
    if (!isFinite(r)) return v;
    return Object.is(r, -0) ? 0 : r;
  }

  /* Mulberry32. Small, fast, fully deterministic across engines. */
  function rng(seed) {
    var s = seed === undefined ? 1 : (seed >>> 0);
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 2D wave interference optics ---------- */

  function distance(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  /* Non positive or non finite wavelengths are meaningless; treat them as a
     one unit wavelength so every downstream phasor stays finite. */
  function waveNumber(wavelength) {
    var w = Number(wavelength);
    return TAU / ((w > 0 && isFinite(w)) ? w : 1);
  }

  function positiveOr(value, fallback) {
    var v = Number(value);
    return (v > 0 && isFinite(v)) ? v : fallback;
  }

  function frequencyToWavelength(freq, speed) {
    var sp = positiveOr(speed === undefined ? SPEED_OF_SOUND : speed, SPEED_OF_SOUND);
    return sp / positiveOr(freq, 1);
  }

  function wavelengthToFrequency(wavelength, speed) {
    var sp = positiveOr(speed === undefined ? SPEED_OF_SOUND : speed, SPEED_OF_SOUND);
    return sp / positiveOr(wavelength, 1);
  }

  /* Every public optics entry point repairs non finite inputs instead of
     propagating NaN into pixels or audio. */
  function num(v, d) {
    v = Number(v);
    return isFinite(v) ? v : d;
  }

  function sourcePhase(source, x, y, k, t, omega) {
    source = source && typeof source === 'object' ? source : {};
    var d = distance(num(source.x, 0), num(source.y, 0), num(x, 0), num(y, 0));
    return num(k, 0) * d - num(omega, 0) * num(t, 0) + num(source.phase, 0);
  }

  function waveDisplacement(source, x, y, k, t, omega, spreading) {
    source = source && typeof source === 'object' ? source : {};
    var d = distance(num(source.x, 0), num(source.y, 0), num(x, 0), num(y, 0));
    var s = Math.max(0, num(spreading, 0));
    var a = num(source.amplitude === undefined ? 1 : source.amplitude, 1) /
      Math.sqrt(1 + s * d);
    return a * Math.sin(num(k, 0) * d - num(omega, 0) * num(t, 0) + num(source.phase, 0));
  }

  function superpose(sources, x, y, wavelength, t, omega, spreading) {
    if (!Array.isArray(sources)) return 0;
    var k = waveNumber(wavelength);
    var sum = 0;
    for (var i = 0; i < sources.length; i++) {
      sum += waveDisplacement(sources[i], x, y, k, t, omega, spreading);
    }
    return sum;
  }

  /* Coherent phasor sum. Time independent for sources sharing one frequency. */
  function phasorAt(sources, x, y, wavelength, spreading) {
    if (!Array.isArray(sources)) return { re: 0, im: 0 };
    var k = waveNumber(wavelength);
    var s = Math.max(0, num(spreading, 0));
    var px = num(x, 0), py = num(y, 0);
    var re = 0;
    var im = 0;
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i] && typeof sources[i] === 'object' ? sources[i] : {};
      var d = distance(num(src.x, 0), num(src.y, 0), px, py);
      var a = num(src.amplitude === undefined ? 1 : src.amplitude, 1) /
        Math.sqrt(1 + s * d);
      var p = k * d + num(src.phase, 0);
      re += a * Math.cos(p);
      im += a * Math.sin(p);
    }
    return { re: re, im: im };
  }

  function intensityAt(sources, x, y, wavelength, spreading) {
    var p = phasorAt(sources, x, y, wavelength, spreading);
    return p.re * p.re + p.im * p.im;
  }

  function intensityField(sources, width, height, wavelength, step, spreading) {
    step = Math.floor(step);
    if (!(step >= 1)) step = 2;
    /* Cap each dimension so a hostile or corrupted request cannot ask for
       an unbounded typed array. */
    var w = Math.max(1, Math.min(Math.floor(Number(width)) || 1, 2000));
    var h = Math.max(1, Math.min(Math.floor(Number(height)) || 1, 2000));
    var cols = Math.floor(w / step);
    var rows = Math.floor(h / step);
    var data = new Float64Array(cols * rows);
    var max = 0;
    var min = Infinity;
    var sum = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var v = intensityAt(sources, c * step, r * step, wavelength, spreading);
        data[r * cols + c] = v;
        if (v > max) max = v;
        if (v < min) min = v;
        sum += v;
      }
    }
    var n = cols * rows;
    return {
      width: w, height: h, step: step, cols: cols, rows: rows,
      data: data, max: max, min: n ? min : 0, mean: n ? sum / n : 0
    };
  }

  /* Path difference against the first source. Two sources give a scalar. */
  function pathDifference(sources, x, y) {
    if (!Array.isArray(sources) || sources.length < 2) return 0;
    var a = sources[0] && typeof sources[0] === 'object' ? sources[0] : {};
    var d0 = distance(num(a.x, 0), num(a.y, 0), num(x, 0), num(y, 0));
    var diffs = [];
    for (var i = 1; i < sources.length; i++) {
      var b = sources[i] && typeof sources[i] === 'object' ? sources[i] : {};
      diffs.push(d0 - distance(num(b.x, 0), num(b.y, 0), num(x, 0), num(y, 0)));
    }
    return diffs.length === 1 ? diffs[0] : diffs;
  }

  /* Young double slit fringe spacing on a distant screen. */
  function fringeSpacing(wavelength, separation, screenDistance) {
    return positiveOr(wavelength, 1) * positiveOr(screenDistance, 1) /
      positiveOr(separation, 1);
  }

  function cleanWavelength(wavelength) {
    return positiveOr(wavelength, 1);
  }

  function cleanTolerance(tol) {
    tol = tol === undefined ? 1e-6 : Math.abs(Number(tol));
    return isFinite(tol) ? tol : 1e-6;
  }

  function isConstructive(pathDiff, wavelength, tol) {
    tol = cleanTolerance(tol);
    var n = num(pathDiff, 0) / cleanWavelength(wavelength);
    return Math.abs(n - Math.round(n)) <= tol;
  }

  function isDestructive(pathDiff, wavelength, tol) {
    tol = cleanTolerance(tol);
    var n = num(pathDiff, 0) / cleanWavelength(wavelength) - 0.5;
    return Math.abs(n - Math.round(n)) <= tol;
  }

  function colorForIntensity(v, max) {
    var t = clamp(max > 0 ? Math.sqrt(v / max) : 0, 0, 1);
    return [
      Math.round(clamp(255 * Math.pow(t, 2.2), 0, 255)),
      Math.round(clamp(255 * Math.pow(t, 1.3), 0, 255)),
      Math.round(clamp(60 + 195 * Math.pow(t, 0.6), 0, 255))
    ];
  }

  /* ---------- Karplus-Strong and FM synthesis ---------- */

  function noteToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function frequencyToNote(freq) {
    return 69 + 12 * Math.log2(freq / 440);
  }

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function midiToName(midi) {
    var m = Math.round(midi);
    return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  function karplusStrong(opts) {
    opts = opts || {};
    var freq = clamp(opts.frequency === undefined ? 220 : opts.frequency, 20, 8000);
    var sr = clamp(opts.sampleRate === undefined ? DEFAULT_SAMPLE_RATE : opts.sampleRate, 8000, 96000);
    var dur = clamp(opts.duration === undefined ? 1 : opts.duration, 0.01, 10);
    var n = Math.max(1, Math.floor(sr * dur));
    var N = Math.max(2, Math.round(sr / freq));
    var damping = clamp(opts.damping === undefined ? 0.996 : opts.damping, 0, 1);
    var amp = clamp(opts.amplitude === undefined ? 1 : opts.amplitude, 0, 1);
    var seed = opts.seed === undefined ? 1337 : (opts.seed >>> 0);
    var rand = rng(seed);
    var line = new Float64Array(N);
    /* Zero-mean the excitation noise: a nonzero mean survives as a DC
       offset under the lossy feedback loop and pollutes level meters.
       Rescale afterwards so centering can never push a sample past one. */
    var mean = 0;
    for (var i = 0; i < N; i++) { line[i] = 2 * rand() - 1; mean += line[i]; }
    mean /= N;
    var excPeak = 0;
    for (i = 0; i < N; i++) {
      line[i] -= mean;
      var av = Math.abs(line[i]);
      if (av > excPeak) excPeak = av;
    }
    if (excPeak > 1) {
      for (i = 0; i < N; i++) line[i] /= excPeak;
    }
    var out = new Float64Array(n);
    var idx = 0;
    for (var j = 0; j < n; j++) {
      var cur = line[idx];
      var nxt = line[(idx + 1) % N];
      out[j] = cur * amp;
      line[idx] = 0.5 * (cur + nxt) * damping;
      idx = (idx + 1) % N;
    }
    return out;
  }

  function fmSample(t, carrier, modulator, index, amp) {
    amp = num(amp === undefined ? 1 : amp, 0);
    t = num(t, 0);
    carrier = Math.max(0, num(carrier, 0));
    modulator = Math.max(0, num(modulator, 0));
    index = num(index, 0);
    var arg = TAU * carrier * t + index * Math.sin(TAU * modulator * t);
    if (!isFinite(arg)) return 0;
    return amp * Math.sin(arg);
  }

  function fmBuffer(opts) {
    opts = opts || {};
    var carrier = clamp(opts.frequency === undefined ? 220 : opts.frequency, 20, 8000);
    var sr = clamp(opts.sampleRate === undefined ? DEFAULT_SAMPLE_RATE : opts.sampleRate, 8000, 96000);
    var dur = clamp(opts.duration === undefined ? 1 : opts.duration, 0.01, 10);
    var ratio = clamp(opts.modRatio === undefined ? 2 : opts.modRatio, 0.1, 16);
    var index = clamp(opts.modIndex === undefined ? 3 : opts.modIndex, 0, 20);
    var amp = clamp(opts.amplitude === undefined ? 0.8 : opts.amplitude, 0, 1);
    var n = Math.max(1, Math.floor(sr * dur));
    var out = new Float64Array(n);
    for (var j = 0; j < n; j++) {
      var t = j / sr;
      var env = Math.min(1, j / (0.005 * sr)) * Math.exp(-3 * j / n);
      out[j] = amp * env * Math.sin(TAU * carrier * t + index * Math.sin(TAU * carrier * ratio * t));
    }
    return out;
  }

  function rms(buf) {
    var s = 0;
    for (var i = 0; i < buf.length; i++) {
      var v = num(buf[i], 0);
      s += v * v;
    }
    return buf.length ? Math.sqrt(s / buf.length) : 0;
  }

  function peak(buf) {
    var p = 0;
    for (var i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(num(buf[i], 0)));
    return p;
  }

  function autocorrelation(buf, lag) {
    var n = buf.length;
    lag = Math.floor(Number(lag));
    if (!(lag >= 0) || lag >= n) return 0;
    var acc = 0;
    var e0 = 0;
    var e1 = 0;
    for (var i = 0; i + lag < n; i++) {
      var a = num(buf[i], 0);
      var b = num(buf[i + lag], 0);
      acc += a * b;
      e0 += a * a;
      e1 += b * b;
    }
    var den = Math.sqrt(e0 * e1);
    return den > 0 ? acc / den : 0;
  }

  function encodeWav(samples, sampleRate) {
    sampleRate = Math.round(Number(sampleRate));
    if (!isFinite(sampleRate) || sampleRate < 1) sampleRate = DEFAULT_SAMPLE_RATE;
    if (sampleRate > 96000) sampleRate = 96000;
    if (!samples || typeof samples.length !== 'number' || typeof samples === 'string') {
      samples = [];
    }
    var n = Math.max(0, Math.floor(samples.length));
    var bytes = new Uint8Array(44 + n * 2);
    var dv = new DataView(bytes.buffer);
    function put(off, text) {
      for (var i = 0; i < text.length; i++) dv.setUint8(off + i, text.charCodeAt(i));
    }
    put(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); put(8, 'WAVE');
    put(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true); dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true); put(36, 'data'); dv.setUint32(40, n * 2, true);
    for (var j = 0; j < n; j++) {
      var s = Number(samples[j]);
      if (!isFinite(s)) s = 0;
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      /* Round to the nearest int16; truncating here would cost up to one
         LSB and skew positive and negative half cycles differently. */
      dv.setInt16(44 + j * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
    }
    return bytes;
  }

  /* ---------- Deterministic state serialization ---------- */

  var DEFAULT_STATE = {
    version: VERSION,
    audioOn: false,
    sources: [
      { x: 0.28, y: 0.5, amplitude: 1, phase: 0 },
      { x: 0.72, y: 0.5, amplitude: 1, phase: 0 }
    ],
    optics: { wavelength: 26, spreading: 0.004, time: 0 },
    synth: {
      mode: 'ks', frequency: 220, midi: 57, damping: 0.996,
      modRatio: 2, modIndex: 3, sampleRate: DEFAULT_SAMPLE_RATE,
      duration: 1, seed: 1337, amplitude: 0.8
    },
    view: { width: 320, height: 180, step: 2, palette: 'ice' }
  };

  function merge(dst, src) {
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      /* Keys that can rewrite prototypes or constructors are never merged;
         a crafted state file must not be able to pollute Object.prototype. */
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      var v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) {
        merge(dst[k], v);
      } else {
        dst[k] = v;
      }
    }
    return dst;
  }

  function createState(overrides) {
    var s = JSON.parse(JSON.stringify(DEFAULT_STATE));
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      merge(s, overrides);
    }
    s.version = typeof s.version === 'string' ? s.version : VERSION;
    s.audioOn = s.audioOn === true;

    /* Build a dense normalized source list: Array#map would copy holes
       through from a sparse input array and crash later consumers. */
    var raw = Array.isArray(s.sources) ? s.sources.slice(0, 4) : [];
    while (raw.length < 2) {
      raw.push({ x: 0.5, y: 0.5, amplitude: 1, phase: 0 });
    }
    s.sources = [];
    for (var si = 0; si < raw.length; si++) {
      var p = raw[si] && typeof raw[si] === 'object' ? raw[si] : {};
      var ds = DEFAULT_STATE.sources[si % 2];
      s.sources.push({
        x: roundTo(clamp(p.x === undefined ? ds.x : p.x, 0, 1)),
        y: roundTo(clamp(p.y === undefined ? ds.y : p.y, 0, 1)),
        amplitude: roundTo(clamp(p.amplitude === undefined ? 1 : p.amplitude, 0, 2)),
        phase: roundTo(clamp(p.phase === undefined ? 0 : p.phase, -TAU, TAU))
      });
    }

    var op = s.optics && typeof s.optics === 'object' ? s.optics : {};
    s.optics = {
      wavelength: roundTo(clamp(op.wavelength === undefined ? 26 : op.wavelength, 4, 200)),
      spreading: roundTo(clamp(op.spreading === undefined ? 0.004 : op.spreading, 0, 0.5)),
      time: roundTo(clamp(op.time === undefined ? 0 : op.time, 0, 100))
    };

    var sy = s.synth && typeof s.synth === 'object' ? s.synth : {};
    s.synth = {
      mode: sy.mode === 'fm' ? 'fm' : 'ks',
      frequency: roundTo(clamp(sy.frequency === undefined ? 220 : sy.frequency, 20, 8000)),
      midi: Math.round(clamp(sy.midi === undefined ? 57 : sy.midi, 0, 127)),
      damping: roundTo(clamp(sy.damping === undefined ? 0.996 : sy.damping, 0, 1)),
      modRatio: roundTo(clamp(sy.modRatio === undefined ? 2 : sy.modRatio, 0.1, 16)),
      modIndex: roundTo(clamp(sy.modIndex === undefined ? 3 : sy.modIndex, 0, 20)),
      sampleRate: Math.round(clamp(sy.sampleRate === undefined ? DEFAULT_SAMPLE_RATE : sy.sampleRate, 8000, 96000)),
      duration: roundTo(clamp(sy.duration === undefined ? 1 : sy.duration, 0.05, 10)),
      seed: (function () {
        var sd = Math.abs(Math.round(Number(sy.seed) || 0)) % 4294967296;
        return isFinite(sd) ? sd : 0;
      })(),
      amplitude: roundTo(clamp(sy.amplitude === undefined ? 0.8 : sy.amplitude, 0, 1))
    };
    /* When the caller gave a frequency but no note, derive the note readout
       from the frequency so the two fields cannot contradict each other.
       This checks the raw overrides, not the merged object. */
    var rawSy = overrides && overrides.synth && typeof overrides.synth === 'object' ? overrides.synth : {};
    if (rawSy.midi === undefined && rawSy.frequency !== undefined) {
      s.synth.midi = Math.round(clamp(frequencyToNote(s.synth.frequency), 0, 127));
    }

    var vw = s.view && typeof s.view === 'object' ? s.view : {};
    s.view = {
      width: Math.round(clamp(vw.width === undefined ? 320 : vw.width, 64, 2000)),
      height: Math.round(clamp(vw.height === undefined ? 180 : vw.height, 64, 2000)),
      step: Math.round(clamp(vw.step === undefined ? 2 : vw.step, 1, 8)),
      palette: (vw.palette === 'ember' || vw.palette === 'mono') ? vw.palette : 'ice'
    };
    return s;
  }

  /* Sort every key and round every number so object insertion order and
     float noise can never change the serialized bytes. */
  function canonicalize(v, depth) {
    depth = depth || 0;
    /* Circular structures and pathological nesting bottom out at null
       instead of overflowing the stack. */
    if (depth > 64) return null;
    if (typeof v === 'bigint') {
      var bn = Number(v);
      return Number.isSafeInteger(bn) ? bn : String(v);
    }
    if (typeof v === 'function' || typeof v === 'symbol' || v === undefined) return null;
    if (Array.isArray(v)) {
      return v.map(function (item) { return canonicalize(item, depth + 1); });
    }
    if (v && typeof v === 'object') {
      var keys = Object.keys(v).sort();
      var out = {};
      for (var i = 0; i < keys.length; i++) {
        /* defineProperty so a literal "__proto__" key stays an own property
           instead of rewriting the prototype of the output object. */
        Object.defineProperty(out, keys[i], {
          value: canonicalize(v[keys[i]], depth + 1),
          writable: true, enumerable: true, configurable: true
        });
      }
      return out;
    }
    if (typeof v === 'number') {
      if (!isFinite(v)) return 0;
      var r = Math.round(v * PRECISION) / PRECISION;
      /* Values past about 1.8e302 overflow the multiply; keep the original
         finite number rather than collapsing it to null in the JSON. */
      if (!isFinite(r)) return v;
      return Object.is(r, -0) ? 0 : r;
    }
    return v;
  }

  function serializeState(state) {
    var s = JSON.stringify(canonicalize(state));
    return s === undefined ? 'null' : s;
  }

  function deserializeState(text) {
    var obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('state must be a JSON object');
    }
    return createState(obj);
  }

  function cloneState(state) {
    return deserializeState(serializeState(state));
  }

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function stateHash(state) {
    return fnv1a(serializeState(state));
  }

  /* ---------- Copyable standalone data URI ---------- */

  /* Percent encode only the characters that would otherwise break a data
     URI: percent signs (escape ambiguity), hashes (fragment delimiter),
     double quotes (attribute embedding) and line breaks. Everything else
     stays literal so the URI remains small enough for the byte budget. */
  function encodeDataUri(html) {
    return URI_PREFIX + String(html).replace(/[%\r\n#"]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
    });
  }

  function decodeDataUri(uri) {
    var s = String(uri);
    if (s.indexOf(URI_PREFIX) !== 0) throw new Error('not a NanoSynth data uri');
    return decodeURIComponent(s.slice(URI_PREFIX.length));
  }

  return {
    VERSION: VERSION, TAU: TAU, SPEED_OF_SOUND: SPEED_OF_SOUND,
    DEFAULT_SAMPLE_RATE: DEFAULT_SAMPLE_RATE, URI_PREFIX: URI_PREFIX,
    NOTE_NAMES: NOTE_NAMES,
    clamp: clamp, lerp: lerp, roundTo: roundTo, rng: rng,
    distance: distance, waveNumber: waveNumber,
    frequencyToWavelength: frequencyToWavelength,
    wavelengthToFrequency: wavelengthToFrequency,
    sourcePhase: sourcePhase, waveDisplacement: waveDisplacement,
    superpose: superpose, phasorAt: phasorAt, intensityAt: intensityAt,
    intensityField: intensityField, pathDifference: pathDifference,
    fringeSpacing: fringeSpacing, isConstructive: isConstructive,
    isDestructive: isDestructive, colorForIntensity: colorForIntensity,
    noteToFrequency: noteToFrequency, frequencyToNote: frequencyToNote,
    midiToName: midiToName, karplusStrong: karplusStrong,
    fmSample: fmSample, fmBuffer: fmBuffer, rms: rms, peak: peak,
    autocorrelation: autocorrelation, encodeWav: encodeWav,
    createState: createState, canonicalize: canonicalize,
    serializeState: serializeState, deserializeState: deserializeState,
    cloneState: cloneState, stateHash: stateHash, fnv1a: fnv1a,
    encodeDataUri: encodeDataUri, decodeDataUri: decodeDataUri
  };
});
