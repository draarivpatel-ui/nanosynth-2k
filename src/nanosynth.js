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
    return Object.is(r, -0) ? 0 : r;
  }

  /* Mulberry32. Small, fast, fully deterministic across engines. */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
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

  function waveNumber(wavelength) {
    return TAU / wavelength;
  }

  function frequencyToWavelength(freq, speed) {
    return (speed === undefined ? SPEED_OF_SOUND : speed) / freq;
  }

  function wavelengthToFrequency(wavelength, speed) {
    return (speed === undefined ? SPEED_OF_SOUND : speed) / wavelength;
  }

  function sourcePhase(source, x, y, k, t, omega) {
    var d = distance(source.x, source.y, x, y);
    return k * d - omega * t + (source.phase || 0);
  }

  function waveDisplacement(source, x, y, k, t, omega, spreading) {
    var d = distance(source.x, source.y, x, y);
    var s = spreading === undefined ? 0 : spreading;
    var a = (source.amplitude === undefined ? 1 : source.amplitude) /
      Math.sqrt(1 + s * d);
    return a * Math.sin(k * d - omega * t + (source.phase || 0));
  }

  function superpose(sources, x, y, wavelength, t, omega, spreading) {
    var k = waveNumber(wavelength);
    var sum = 0;
    for (var i = 0; i < sources.length; i++) {
      sum += waveDisplacement(sources[i], x, y, k, t, omega, spreading);
    }
    return sum;
  }

  /* Coherent phasor sum. Time independent for sources sharing one frequency. */
  function phasorAt(sources, x, y, wavelength, spreading) {
    var k = waveNumber(wavelength);
    var s = spreading === undefined ? 0 : spreading;
    var re = 0;
    var im = 0;
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      var d = distance(src.x, src.y, x, y);
      var a = (src.amplitude === undefined ? 1 : src.amplitude) /
        Math.sqrt(1 + s * d);
      var p = k * d + (src.phase || 0);
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
    step = step || 2;
    var w = Math.max(1, Math.floor(width));
    var h = Math.max(1, Math.floor(height));
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
    var d0 = distance(sources[0].x, sources[0].y, x, y);
    var diffs = [];
    for (var i = 1; i < sources.length; i++) {
      diffs.push(d0 - distance(sources[i].x, sources[i].y, x, y));
    }
    return diffs.length === 1 ? diffs[0] : diffs;
  }

  /* Young double slit fringe spacing on a distant screen. */
  function fringeSpacing(wavelength, separation, screenDistance) {
    return wavelength * screenDistance / separation;
  }

  function isConstructive(pathDiff, wavelength, tol) {
    tol = tol === undefined ? 1e-6 : tol;
    var n = pathDiff / wavelength;
    return Math.abs(n - Math.round(n)) <= tol;
  }

  function isDestructive(pathDiff, wavelength, tol) {
    tol = tol === undefined ? 1e-6 : tol;
    var n = pathDiff / wavelength - 0.5;
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
    var seed = opts.seed === undefined ? 1337 : (opts.seed >>> 0);
    var rand = rng(seed);
    var line = new Float64Array(N);
    for (var i = 0; i < N; i++) line[i] = 2 * rand() - 1;
    var out = new Float64Array(n);
    var idx = 0;
    for (var j = 0; j < n; j++) {
      var cur = line[idx];
      var nxt = line[(idx + 1) % N];
      out[j] = cur;
      line[idx] = 0.5 * (cur + nxt) * damping;
      idx = (idx + 1) % N;
    }
    return out;
  }

  function fmSample(t, carrier, modulator, index, amp) {
    amp = amp === undefined ? 1 : amp;
    return amp * Math.sin(TAU * carrier * t + index * Math.sin(TAU * modulator * t));
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
    for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return buf.length ? Math.sqrt(s / buf.length) : 0;
  }

  function peak(buf) {
    var p = 0;
    for (var i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
    return p;
  }

  function autocorrelation(buf, lag) {
    var n = buf.length;
    if (lag < 0 || lag >= n) return 0;
    var num = 0;
    var e0 = 0;
    var e1 = 0;
    for (var i = 0; i + lag < n; i++) {
      num += buf[i] * buf[i + lag];
      e0 += buf[i] * buf[i];
      e1 += buf[i + lag] * buf[i + lag];
    }
    var den = Math.sqrt(e0 * e1);
    return den > 0 ? num / den : 0;
  }

  function encodeWav(samples, sampleRate) {
    sampleRate = Math.round(sampleRate || DEFAULT_SAMPLE_RATE);
    var n = samples.length;
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
      var s = clamp(samples[j], -1, 1);
      dv.setInt16(44 + j * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
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
    s.audioOn = !!s.audioOn;

    var raw = Array.isArray(s.sources) ? s.sources.slice(0, 4) : [];
    while (raw.length < 2) {
      raw.push({ x: 0.5, y: 0.5, amplitude: 1, phase: 0 });
    }
    s.sources = raw.map(function (p, i) {
      p = p && typeof p === 'object' ? p : {};
      var d = DEFAULT_STATE.sources[i % 2];
      return {
        x: roundTo(clamp(p.x === undefined ? d.x : p.x, 0, 1)),
        y: roundTo(clamp(p.y === undefined ? d.y : p.y, 0, 1)),
        amplitude: roundTo(clamp(p.amplitude === undefined ? 1 : p.amplitude, 0, 2)),
        phase: roundTo(clamp(p.phase === undefined ? 0 : p.phase, -TAU, TAU))
      };
    });

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
      seed: Math.abs(Math.round(Number(sy.seed) || 0)) % 4294967296,
      amplitude: roundTo(clamp(sy.amplitude === undefined ? 0.8 : sy.amplitude, 0, 1))
    };

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
  function canonicalize(v) {
    if (Array.isArray(v)) return v.map(canonicalize);
    if (v && typeof v === 'object') {
      var keys = Object.keys(v).sort();
      var out = {};
      for (var i = 0; i < keys.length; i++) out[keys[i]] = canonicalize(v[keys[i]]);
      return out;
    }
    if (typeof v === 'number') {
      if (!isFinite(v)) return 0;
      var r = Math.round(v * PRECISION) / PRECISION;
      return Object.is(r, -0) ? 0 : r;
    }
    return v;
  }

  function serializeState(state) {
    return JSON.stringify(canonicalize(state));
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
