/* Optics fringe and harmonic spectrum lab for NanoSynth-2K. Pure JS and
   fully deterministic: far-field phasor intensity profiles, autocorrelation
   pitch tracking, a radix-2 FFT spectrum, a FIPS 180-4 SHA-256 audited
   brief exporter, and the strict fail-closed #ns= share codec. Runs in
   Node and in the browser and never touches any audio device. */
(function (root, factory) {
  'use strict';
  var api;
  if (typeof module === 'object' && module && module.exports) {
    api = factory(require('./nanosynth.js'));
    module.exports = api;
  } else if (root) {
    api = factory(root ? root.NanoSynth : null);
    root.NanoSynthLab = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (N) {
  'use strict';

  var LAB_VERSION = '1.0.0';
  var TAU = Math.PI * 2;
  var SCHEMA = 'nanosynth-2k/lab-brief@1';
  var HASH_RE = /^[0-9a-f]{64}$/;
  var MAX_BOOKMARK_CHARS = 4096;
  var DIGEST_CACHE_LIMIT = 64;

  /* The four optics benches in pixel space. Sources sit on a vertical
     slit line at x = 0 (the quad array also staggers x) and the detector
     is a transverse line at x = screenDistance. */
  var OPTICS_PRESETS = {
    'double-slit': {
      label: 'Double slit',
      sources: [
        { x: 0, y: -80, amplitude: 1, phase: 0 },
        { x: 0, y: 80, amplitude: 1, phase: 0 }
      ],
      wavelength: 18, screenDistance: 400, slitSeparation: 160
    },
    'antiphase': {
      label: 'Antiphase pair',
      sources: [
        { x: 0, y: -80, amplitude: 1, phase: 0 },
        { x: 0, y: 80, amplitude: 1, phase: Math.PI }
      ],
      wavelength: 18, screenDistance: 400, slitSeparation: 160
    },
    'quad-array': {
      label: 'Quad array',
      sources: [
        { x: -60, y: -80, amplitude: 1, phase: 0 },
        { x: 60, y: -80, amplitude: 1, phase: 0 },
        { x: -60, y: 80, amplitude: 1, phase: 0 },
        { x: 60, y: 80, amplitude: 1, phase: 0 }
      ],
      wavelength: 22, screenDistance: 400, slitSeparation: 160
    },
    'three-slit': {
      label: 'Three slit',
      sources: [
        { x: 0, y: -75, amplitude: 1, phase: 0 },
        { x: 0, y: 0, amplitude: 1, phase: 0 },
        { x: 0, y: 75, amplitude: 1, phase: 0 }
      ],
      wavelength: 20, screenDistance: 400, slitSeparation: 150
    }
  };
  var OPTICS_PRESET_NAMES = ['double-slit', 'antiphase', 'quad-array', 'three-slit'];
  var VOICE_NAMES = ['karplus-strong', 'fm-2op'];
  var VOICE_LABELS = { 'karplus-strong': 'Karplus-Strong', 'fm-2op': 'FM 2-op' };
  var VOICE_TO_APP = { 'karplus-strong': 'ks', 'fm-2op': 'fm' };
  var APP_TO_VOICE = { ks: 'karplus-strong', fm: 'fm-2op' };

  /* ---------- small numeric guards ---------- */

  function fin(v, d) {
    v = Number(v);
    return isFinite(v) ? v : d;
  }

  function clamp(v, lo, hi, d) {
    v = Number(v);
    if (!isFinite(v)) v = d;
    return v < lo ? lo : v > hi ? hi : v;
  }

  function hasCore() {
    return !!(N && N.intensityAt && N.karplusStrong && N.fmBuffer);
  }

  function requireCore() {
    if (!hasCore()) throw new Error('NanoSynth core is required for this call');
  }

  /* ---------- UTF-8 and FIPS 180-4 SHA-256 ---------- */

  /* Encodes a JS string to UTF-8 bytes with the same behavior as
     TextEncoder: a lone surrogate becomes U+FFFD. */
  function utf8Bytes(str) {
    str = String(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          i++;
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
            0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else {
          out.push(0xef, 0xbf, 0xbd);
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        out.push(0xef, 0xbf, 0xbd);
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function toHex32(v) {
    var s = '';
    for (var i = 7; i >= 0; i--) s += '0123456789abcdef'[(v >>> (i * 4)) & 15];
    return s;
  }

  /* SHA-256 over the UTF-8 bytes of the string form of the input. */
  function sha256(message) {
    var bytes = utf8Bytes(message);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(bitLen / 0x100000000);
    var lo = bitLen >>> 0;
    for (var i = 3; i >= 0; i--) bytes.push((hi >>> (i * 8)) & 0xff);
    for (i = 3; i >= 0; i--) bytes.push((lo >>> (i * 8)) & 0xff);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    var a, b, c, d, e, f, g, h, t;
    for (var off = 0; off < bytes.length; off += 64) {
      for (t = 0; t < 16; t++) {
        w[t] = ((bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) |
                (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3]) | 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      a = H[0]; b = H[1]; c = H[2]; d = H[3];
      e = H[4]; f = H[5]; g = H[6]; h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA256_K[t] + w[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
      H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
      H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = '';
    for (t = 0; t < 8; t++) out += toHex32(H[t]);
    return out;
  }

  /* ---------- base64url (strict, padding-free) ---------- */

  var B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64URL_RE = /^[A-Za-z0-9_-]*$/;

  function bytesToBase64Url(bytes) {
    if (!bytes || typeof bytes.length !== 'number') return '';
    var out = '';
    for (var i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] +
             B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      var v = bytes[i] << 16;
      out += B64_ALPHABET[(v >> 18) & 63] + B64_ALPHABET[(v >> 12) & 63];
    } else if (rem === 2) {
      var v2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64_ALPHABET[(v2 >> 18) & 63] + B64_ALPHABET[(v2 >> 12) & 63] +
             B64_ALPHABET[(v2 >> 6) & 63];
    }
    return out.replace(/\+/g, '-').replace(/\//g, '_');
  }

  function base64UrlToBytes(str) {
    if (typeof str !== 'string' || !B64URL_RE.test(str)) return null;
    var std = str.replace(/-/g, '+').replace(/_/g, '/');
    if (std.length % 4 === 1) return null;
    var pad = (4 - (std.length % 4)) % 4;
    std += '===='.slice(0, pad);
    var bytes = [];
    var val = 0, bits = 0;
    for (var i = 0; i < std.length; i++) {
      var idx = B64_ALPHABET.indexOf(std.charAt(i));
      if (std.charAt(i) === '=') break;
      if (idx < 0) return null;
      val = (val << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((val >>> bits) & 0xff);
      }
    }
    /* Strict means canonical: unused low bits in the final base64url
       character must be zero. Re-encoding the decoded bytes is the exact
       check and rejects otherwise undetectable twin encodings. */
    if (bytesToBase64Url(bytes) !== str) return null;
    return bytes;
  }

  function utf8FromBytes(bytes) {
    if (!bytes || typeof bytes.length !== 'number') return null;
    var out = '';
    function continuation(b) {
      return b >= 0x80 && b <= 0xbf;
    }
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (!Number.isInteger(b) || b < 0 || b > 0xff) return null;
      if (b < 0x80) {
        out += String.fromCharCode(b);
      } else if (b >= 0xc2 && b <= 0xdf && i + 1 < bytes.length) {
        var b2 = bytes[++i];
        if (!continuation(b2)) return null;
        out += String.fromCharCode(((b & 31) << 6) | (b2 & 63));
      } else if (b >= 0xe0 && b <= 0xef && i + 2 < bytes.length) {
        var c2 = bytes[++i], c3 = bytes[++i];
        if (!continuation(c2) || !continuation(c3)) return null;
        var cp3 = ((b & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63);
        if (cp3 < 0x800 || (cp3 >= 0xd800 && cp3 <= 0xdfff)) return null;
        out += String.fromCharCode(cp3);
      } else if (b >= 0xf0 && b <= 0xf4 && i + 3 < bytes.length) {
        var d2 = bytes[++i], d3 = bytes[++i], d4 = bytes[++i];
        if (!continuation(d2) || !continuation(d3) || !continuation(d4)) return null;
        var cp = ((b & 7) << 18) | ((d2 & 63) << 12) | ((d3 & 63) << 6) | (d4 & 63);
        if (cp < 0x10000 || cp > 0x10ffff) return null;
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        return null;
      }
    }
    return out;
  }

  /* ---------- radix-2 FFT spectrum ---------- */

  function nextPow2(n) {
    n = Math.ceil(Number(n));
    if (!isFinite(n) || n < 1) return 1;
    var p = 1;
    while (p < n && p < 1073741824) p <<= 1;
    return p;
  }

  /* In-place iterative Cooley-Tukey FFT with negative exponent. The twiddle
     for every butterfly is computed by direct trig so nothing drifts at
     large sizes. Returns false for anything that is not a power of two
     pair of equal length real/imag arrays. */
  function fft(re, im) {
    if (!re || !im || re.length !== im.length) return false;
    var n = re.length;
    if (n < 1 || (n & (n - 1)) !== 0) return false;
    var i, j;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var half = len >> 1;
      var ang = -TAU / len;
      for (i = 0; i < n; i += len) {
        for (j = 0; j < half; j++) {
          var a = ang * j;
          var wr = Math.cos(a), wi = Math.sin(a);
          var xi = i + j + half;
          var xr = re[xi] * wr - im[xi] * wi;
          var xq = re[xi] * wi + im[xi] * wr;
          var ur = re[i + j], uq = im[i + j];
          re[i + j] = ur + xr; im[i + j] = uq + xq;
          re[xi] = ur - xr; im[xi] = uq - xq;
        }
      }
    }
    return true;
  }

  function fftSizeFor(len, capPow) {
    var cap = 1 << (capPow === undefined ? 16 : clamp(capPow, 4, 24, 16));
    var n = nextPow2(len || 1);
    return n > cap ? cap : n;
  }

  /* Log-magnitude spectrum of a real buffer, normalized so a unit sine at
     a bin center reads about 0 dB. Output is the non negative half. */
  function magnitudeDb(buf, opts) {
    opts = opts || {};
    if (!buf || typeof buf.length !== 'number' || buf.length < 1) {
      buf = new Float64Array(1);
    }
    var size = Math.max(2, fftSizeFor(opts.fftSize || buf.length, opts.capPow));
    var re = new Float64Array(size);
    var im = new Float64Array(size);
    var take = Math.min(buf.length, size);
    for (var i = 0; i < take; i++) {
      var v = Number(buf[i]);
      re[i] = isFinite(v) ? v : 0;
    }
    fft(re, im);
    var half = size >> 1;
    var mags = new Float64Array(half);
    var magsDb = new Float64Array(half);
    for (i = 0; i < half; i++) {
      var m = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      mags[i] = m;
      var amp = (i === 0 ? m : 2 * m) / size;
      magsDb[i] = amp > 0 ? Math.max(-180, 20 * Math.log10(amp)) : -180;
    }
    var sr = clamp(opts.sampleRate, 1, 1e9, 44100);
    return { size: size, binHz: sr / size, mags: mags, magsDb: magsDb };
  }

  function spectralCentroid(buf, sampleRate, fftSize) {
    var s = magnitudeDb(buf, { sampleRate: sampleRate, fftSize: fftSize });
    var num = 0, den = 0;
    for (var i = 0; i < s.mags.length; i++) {
      num += i * s.binHz * s.mags[i];
      den += s.mags[i];
    }
    return den > 0 ? num / den : 0;
  }

  function topPeaks(buf, opts) {
    opts = opts || {};
    var s = magnitudeDb(buf, opts);
    var want = Math.max(1, Math.min(32, Math.floor(fin(opts.count, 5)) || 5));
    var floorDb = fin(opts.floorDb, -120);
    var list = [];
    for (var i = 1; i < s.magsDb.length - 1; i++) {
      var v = s.magsDb[i];
      if (v > floorDb && v > s.magsDb[i - 1] && v >= s.magsDb[i + 1]) {
        list.push({ bin: i, freqHz: i * s.binHz, db: v, magnitude: s.mags[i] });
      }
    }
    list.sort(function (x, y) { return y.magnitude - x.magnitude; });
    return { size: s.size, binHz: s.binHz, peaks: list.slice(0, want) };
  }

  /* YIN-style difference function: a periodic buffer has a deep minimum
     at each integer multiple of its period. Fractional lags compare
     against a linearly interpolated copy, which exposes the true
     sub-sample period a raw integer lag cannot see. */
  function diffFunction(buf, tau) {
    var n = buf.length;
    var i0 = Math.floor(tau);
    var frac = tau - i0;
    var s = 0;
    for (var i = 0; i + i0 + 1 < n; i++) {
      var x1 = buf[i + i0] + (buf[i + i0 + 1] - buf[i + i0]) * frac;
      var d = buf[i] - x1;
      s += d * d;
    }
    return s;
  }

  /* Autocorrelation pitch estimate in a window around the expected
     period, refined by a sub-sample sweep of the difference function
     minimum so the estimate sees the true loop period. */
  function detectPitch(buf, sampleRate, targetHz) {
    requireCore();
    var n = buf && typeof buf.length === 'number' ? buf.length : 0;
    var sr = clamp(sampleRate, 1000, 192000, 44100);
    var target = clamp(targetHz, 1, 20000, 220);
    if (n < 8) {
      return { lag: -1, refinedLag: -1, estimateHz: 0, targetHz: target,
        errorHz: -target, errorCents: 0, r: 0 };
    }
    var expected = sr / target;
    var lo = Math.max(2, Math.floor(expected * 0.75));
    var hi = Math.min(n - 1, Math.ceil(expected * 1.34));
    if (hi <= lo) hi = Math.min(n - 1, lo + 4);
    var best = -Infinity, bestLag = -1;
    for (var lag = lo; lag <= hi; lag++) {
      var v = N.autocorrelation(buf, lag);
      if (v > best) { best = v; bestLag = lag; }
    }
    if (bestLag < 0 || best <= 1e-9) {
      return { lag: -1, refinedLag: -1, estimateHz: 0, targetHz: target,
        errorHz: -target, errorCents: 0, r: best > 0 ? best : 0 };
    }
    var refined = bestLag;
    if (bestLag > lo && bestLag < hi) {
      var bestD = Infinity;
      for (var tau = bestLag - 1; tau <= bestLag + 1.0001; tau += 0.05) {
        var dv = diffFunction(buf, tau);
        if (dv < bestD) { bestD = dv; refined = tau; }
      }
    }
    var est = refined > 0 ? sr / refined : 0;
    var cents = est > 0 ? 1200 * Math.log2(est / target) : 0;
    return { lag: bestLag, refinedLag: refined, estimateHz: est, targetHz: target,
      errorHz: est - target, errorCents: cents, r: best };
  }

  /* ---------- optics: far-field detector profile ---------- */

  function cleanSource(s) {
    s = s && typeof s === 'object' ? s : {};
    return {
      x: fin(s.x, 0), y: fin(s.y, 0),
      amplitude: clamp(s.amplitude === undefined ? 1 : s.amplitude, 0, 4, 1),
      phase: fin(s.phase, 0)
    };
  }

  /* Accepts a preset name or a raw preset-shaped object. Always returns a
     sanitized copy; returns null for an unknown name. */
  function normalizePreset(p) {
    var raw = null;
    if (typeof p === 'string') {
      raw = OPTICS_PRESETS[p] || null;
    } else if (p && typeof p === 'object' && !Array.isArray(p)) {
      raw = p;
    }
    if (!raw) return null;
    var srcs = Array.isArray(raw.sources) ? raw.sources.slice(0, 8).map(cleanSource) : [];
    if (srcs.length < 1) return null;
    var d = fin(raw.slitSeparation, NaN);
    if (!(d > 0)) {
      var lo = Infinity, hi = -Infinity;
      for (var i = 0; i < srcs.length; i++) {
        if (srcs[i].y < lo) lo = srcs[i].y;
        if (srcs[i].y > hi) hi = srcs[i].y;
      }
      d = (hi - lo) > 0 ? (hi - lo) : 1;
    }
    return {
      name: typeof p === 'string' ? p : 'custom',
      label: typeof raw.label === 'string' ? raw.label : (typeof p === 'string' ? p : 'custom'),
      sources: srcs,
      wavelength: clamp(raw.wavelength, 0.01, 1e5, 18),
      screenDistance: clamp(raw.screenDistance, 1, 1e6, 400),
      slitSeparation: d
    };
  }

  /* Exact Fresnel phasor sum on a transverse detector line at
     x = screenDistance, sweeping y in [-span, span]. */
  function farFieldProfile(preset, opts) {
    requireCore();
    var p = normalizePreset(preset);
    if (!p) return null;
    opts = opts || {};
    var points = Math.floor(clamp(opts.points, 3, 4097, 401));
    if (points % 2 === 0) points += 1;
    var span = clamp(opts.span, 1, 1e5, 300);
    var spreading = clamp(opts.spreading, 0, 1, 0);
    var xs = new Float64Array(points);
    var prof = new Float64Array(points);
    var max = -Infinity, min = Infinity, sum = 0;
    for (var i = 0; i < points; i++) {
      var t = -span + (2 * span * i) / (points - 1);
      xs[i] = t;
      var v = N.intensityAt(p.sources, p.screenDistance, t, p.wavelength, spreading);
      prof[i] = isFinite(v) ? v : 0;
      if (prof[i] > max) max = prof[i];
      if (prof[i] < min) min = prof[i];
      sum += prof[i];
    }
    var margin = 0.001 * (max - min);
    var maxima = [], minima = [];
    for (i = 1; i < points - 1; i++) {
      if (prof[i] > prof[i - 1] && prof[i] >= prof[i + 1] && prof[i] > min + margin) {
        maxima.push({ x: xs[i], i: i, intensity: prof[i] });
      }
      if (prof[i] < prof[i - 1] && prof[i] <= prof[i + 1] && prof[i] < max - margin) {
        minima.push({ x: xs[i], i: i, intensity: prof[i] });
      }
    }
    var measured = 0;
    if (maxima.length > 1) {
      var acc = 0;
      for (i = 1; i < maxima.length; i++) acc += maxima[i].x - maxima[i - 1].x;
      measured = acc / (maxima.length - 1);
    }
    var vis = (max + min) > 0 ? (max - min) / (max + min) : 0;
    var mid = (points - 1) / 2;
    return {
      preset: p.name, label: p.label,
      wavelength: p.wavelength, slitSeparation: p.slitSeparation,
      screenDistance: p.screenDistance, spreading: spreading,
      points: points, span: span, xs: xs, profile: prof,
      max: max, min: min, mean: sum / points,
      centerIntensity: prof[mid],
      visibility: vis,
      theoreticalSpacing: N.fringeSpacing(p.wavelength, p.slitSeparation, p.screenDistance),
      measuredSpacing: measured,
      maxima: maxima, minima: minima
    };
  }

  /* The serializable optics metrics only (no sample arrays). */
  function analyzeOptics(preset, opts) {
    var f = farFieldProfile(preset, opts);
    if (!f) return null;
    return {
      preset: f.preset, label: f.label, wavelength: f.wavelength,
      slitSeparation: f.slitSeparation, screenDistance: f.screenDistance,
      spreading: f.spreading, points: f.points, span: f.span,
      max: f.max, min: f.min, mean: f.mean,
      centerIntensity: f.centerIntensity, visibility: f.visibility,
      theoreticalSpacing: f.theoreticalSpacing, measuredSpacing: f.measuredSpacing,
      maximaCount: f.maxima.length, minimaCount: f.minima.length
    };
  }

  /* ---------- voice analysis ---------- */

  function voiceBuffer(voice, opts) {
    requireCore();
    var o = opts || {};
    var shared = {
      frequency: clamp(o.frequency, 20, 8000, 220),
      sampleRate: Math.round(clamp(o.sampleRate, 8000, 96000, 22050)),
      duration: clamp(o.duration, 0.05, 2, 0.5),
      amplitude: clamp(o.amplitude, 0, 1, 0.8)
    };
    if (voice === 'fm-2op') {
      return {
        buf: N.fmBuffer({
          frequency: shared.frequency, sampleRate: shared.sampleRate,
          duration: shared.duration, amplitude: shared.amplitude,
          modRatio: clamp(o.modRatio, 0.1, 16, 2),
          modIndex: clamp(o.modIndex, 0, 20, 3)
        }),
        params: shared
      };
    }
    return {
      buf: N.karplusStrong({
        frequency: shared.frequency, sampleRate: shared.sampleRate,
        duration: shared.duration, amplitude: shared.amplitude,
        damping: clamp(o.damping, 0, 1, 0.996),
        seed: o.seed === undefined ? 1337 : (Math.abs(Math.round(Number(o.seed) || 0)) % 4294967296)
      }),
      params: shared
    };
  }

  function analyzeVoice(voice, opts) {
    requireCore();
    if (VOICE_NAMES.indexOf(voice) < 0) return null;
    opts = opts || {};
    var made = voiceBuffer(voice, opts);
    var buf = made.buf;
    var sr = made.params.sampleRate;
    var spec = topPeaks(buf, { sampleRate: sr, fftSize: opts.fftSize, count: 5 });
    var centroid = spectralCentroid(buf, sr, opts.fftSize);
    var wav = N.encodeWav(buf, sr);
    var dc = 0;
    for (var i = 0; i < buf.length; i++) dc += buf[i];
    dc = buf.length ? dc / buf.length : 0;
    var headerOk = wav.length >= 44 &&
      wav[0] === 0x52 && wav[1] === 0x49 && wav[2] === 0x46 && wav[3] === 0x46 &&
      wav[8] === 0x57 && wav[9] === 0x41 && wav[10] === 0x56 && wav[11] === 0x45;
    var pitch = detectPitch(buf, sr, made.params.frequency);
    var params = {
      frequency: made.params.frequency, sampleRate: sr,
      duration: made.params.duration, amplitude: made.params.amplitude
    };
    if (voice === 'fm-2op') {
      params.modRatio = clamp(opts.modRatio, 0.1, 16, 2);
      params.modIndex = clamp(opts.modIndex, 0, 20, 3);
    } else {
      params.damping = clamp(opts.damping, 0, 1, 0.996);
      params.seed = opts.seed === undefined ? 1337 :
        (Math.abs(Math.round(Number(opts.seed) || 0)) % 4294967296);
    }
    return {
      voice: voice, label: VOICE_LABELS[voice], params: params,
      sampleCount: buf.length, peak: N.peak(buf), rms: N.rms(buf), dc: dc,
      pitch: pitch,
      spectrum: {
        size: spec.size, binHz: spec.binHz, centroidHz: centroid, peaks: spec.peaks
      },
      wav: { bytes: wav.length, headerOk: headerOk }
    };
  }

  function compare(preset, voice, opts) {
    var o = analyzeOptics(preset, opts);
    var a = analyzeVoice(voice, opts);
    if (!o || !a) return null;
    return { preset: o.preset, voice: a.voice, optics: o, audio: a };
  }

  function compareAll(opts) {
    var rows = [];
    for (var i = 0; i < OPTICS_PRESET_NAMES.length; i++) {
      for (var j = 0; j < VOICE_NAMES.length; j++) {
        rows.push(compare(OPTICS_PRESET_NAMES[i], VOICE_NAMES[j], opts));
      }
    }
    return rows;
  }

  /* ---------- audited brief: one canonical digest everywhere ---------- */

  /* The digest is stamped once per canonical state key and cached, so the
     on-page fingerprint, JSON export, CSV provenance line and Markdown
     footer can never disagree. */
  var digestCache = {};
  var digestCacheSize = 0;

  function stampedBrief(data) {
    var canonical = N.serializeState(data);
    var hit = digestCache[canonical];
    if (hit) return hit;
    var brief = { schema: SCHEMA, sha256: sha256(canonical), data: data };
    if (digestCacheSize >= DIGEST_CACHE_LIMIT) {
      digestCache = {};
      digestCacheSize = 0;
    }
    digestCache[canonical] = brief;
    digestCacheSize++;
    return brief;
  }

  function briefDigest(data) {
    return stampedBrief(data).sha256;
  }

  /* Pretty canonical JSON: keys already sorted by canonicalize, so the
     bytes stay deterministic. */
  function exportJson(data) {
    return JSON.stringify(N.canonicalize(stampedBrief(data)), null, 2) + '\n';
  }

  /* Formula-safe CSV cell: quote when the cell carries separators, and
     prefix a single quote on cells that a spreadsheet would read as a
     formula (= + - @ or a leading tab/CR). */
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/^[\t\r ]*[=+\-@]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s) || s !== s.trim()) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function flattenForCsv(data) {
    var rows = [];
    if (data && data.params && typeof data.params === 'object') {
      var keys = Object.keys(data.params).sort();
      for (var i = 0; i < keys.length; i++) {
        rows.push(['params', keys[i], data.params[keys[i]]]);
      }
    }
    var comp = data && Array.isArray(data.comparator) ? data.comparator : [];
    for (i = 0; i < comp.length; i++) {
      var row = comp[i];
      if (!row) continue;
      var tag = row.preset + '/' + row.voice;
      var ok = ['wavelength', 'slitSeparation', 'theoreticalSpacing', 'measuredSpacing',
        'max', 'min', 'centerIntensity', 'visibility', 'maximaCount', 'minimaCount'];
      for (var k = 0; k < ok.length; k++) {
        rows.push(['optics', tag + '.' + ok[k], row.optics[ok[k]]]);
      }
      var ak = ['sampleCount', 'peak', 'rms', 'dc'];
      for (k = 0; k < ak.length; k++) {
        rows.push(['audio', tag + '.' + ak[k], row.audio[ak[k]]]);
      }
      var pk = ['lag', 'refinedLag', 'estimateHz', 'errorHz', 'errorCents', 'r'];
      for (k = 0; k < pk.length; k++) {
        rows.push(['pitch', tag + '.' + pk[k], row.audio.pitch[pk[k]]]);
      }
      rows.push(['spectrum', tag + '.size', row.audio.spectrum.size]);
      rows.push(['spectrum', tag + '.binHz', row.audio.spectrum.binHz]);
      rows.push(['spectrum', tag + '.centroidHz', row.audio.spectrum.centroidHz]);
      var peaks = row.audio.spectrum.peaks || [];
      for (k = 0; k < peaks.length; k++) {
        rows.push(['peak', tag + '.' + k + '.freqHz', peaks[k].freqHz]);
        rows.push(['peak', tag + '.' + k + '.db', peaks[k].db]);
      }
      rows.push(['wav', tag + '.bytes', row.audio.wav.bytes]);
      rows.push(['wav', tag + '.headerOk', row.audio.wav.headerOk]);
    }
    return rows;
  }

  function exportCsv(data) {
    var brief = stampedBrief(data);
    var lines = [
      '# nanosynth-2k optics and dsp lab brief',
      '# schema: ' + brief.schema,
      '# sha256: ' + brief.sha256,
      'section,key,value'
    ];
    var rows = flattenForCsv(data);
    for (var i = 0; i < rows.length; i++) {
      lines.push(csvCell(rows[i][0]) + ',' + csvCell(rows[i][1]) + ',' + csvCell(rows[i][2]));
    }
    return lines.join('\n') + '\n';
  }

  function exportMarkdown(data) {
    var brief = stampedBrief(data);
    var out = [];
    out.push('## NanoSynth-2K optics and DSP lab brief');
    out.push('');
    out.push('Schema: `' + brief.schema + '`');
    out.push('');
    if (data && data.params) {
      out.push('### Parameters');
      out.push('');
      var keys = Object.keys(data.params).sort();
      for (var i = 0; i < keys.length; i++) {
        out.push('- `' + keys[i] + '` = ' + data.params[keys[i]]);
      }
      out.push('');
    }
    var comp = data && Array.isArray(data.comparator) ? data.comparator : [];
    if (comp.length) {
      out.push('### Comparator');
      out.push('');
      out.push('| Preset | Voice | Spacing px | Visibility | Pitch cents | Centroid Hz | WAV bytes | RMS |');
      out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (i = 0; i < comp.length; i++) {
        var r = comp[i];
        if (!r) continue;
        out.push('| ' + r.preset + ' | ' + r.voice + ' | ' +
          r.optics.theoreticalSpacing.toFixed(3) + ' | ' +
          r.optics.visibility.toFixed(4) + ' | ' +
          r.audio.pitch.errorCents.toFixed(2) + ' | ' +
          r.audio.spectrum.centroidHz.toFixed(1) + ' | ' +
          r.audio.wav.bytes + ' | ' +
          r.audio.rms.toFixed(4) + ' |');
      }
      out.push('');
    }
    out.push('---');
    out.push('SHA-256: `' + brief.sha256 + '`');
    out.push('');
    return out.join('\n');
  }

  function verifyBrief(text) {
    var obj;
    try {
      obj = JSON.parse(String(text));
    } catch (e) {
      return { ok: false, reason: 'not-json', expected: null, actual: null };
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, reason: 'not-object', expected: null, actual: null };
    }
    if (obj.schema !== SCHEMA) {
      return { ok: false, reason: 'bad-schema', expected: null, actual: null };
    }
    if (typeof obj.sha256 !== 'string' || !HASH_RE.test(obj.sha256)) {
      return { ok: false, reason: 'bad-digest', expected: null, actual: null };
    }
    var actual = sha256(N.serializeState(obj.data));
    return { ok: actual === obj.sha256, reason: actual === obj.sha256 ? 'match' : 'mismatch',
      expected: obj.sha256, actual: actual };
  }

  /* Produces a JSON brief that still parses but fails verification, for
     the interactive tamper demo. */
  function tamperJson(text) {
    var obj;
    try { obj = JSON.parse(String(text)); } catch (e) { return String(text); }
    if (!obj || typeof obj !== 'object') return text;
    var path = obj.data && obj.data.comparator && obj.data.comparator[0];
    if (path && path.optics && typeof path.optics.visibility === 'number') {
      path.optics.visibility = path.optics.visibility + 0.01;
    } else if (obj.data && obj.data.params && typeof obj.data.params.frequency === 'number') {
      obj.data.params.frequency += 1;
    } else {
      obj.data = obj.data && typeof obj.data === 'object' ? obj.data : {};
      obj.data.tampered = true;
    }
    return JSON.stringify(obj, null, 2) + '\n';
  }

  /* ---------- strict #ns= bookmark codec ---------- */

  /* A literal __proto__ entry would set the prototype, not an own
     property, so banned keys are compared as plain strings. */
  function isBannedKey(k) {
    return k === '__proto__' || k === 'constructor' || k === 'prototype';
  }

  /* Normalizes a raw decoded bookmark object. Only allowlisted own keys
     are read through hasOwnProperty, so __proto__ and constructor keys
     never reach the output. Returns null when the object is hostile or
     carries no usable field. */
  function normalizeBookmark(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && isBannedKey(k)) {
        return null;
      }
    }
    var out = {};
    var used = 0;
    var has = Object.prototype.hasOwnProperty;
    if (has.call(obj, 'p') && typeof obj.p === 'string' && OPTICS_PRESETS[obj.p]) {
      out.p = obj.p; used++;
    }
    if (has.call(obj, 'm') && (obj.m === 'ks' || obj.m === 'fm')) {
      out.m = obj.m; used++;
    }
    if (has.call(obj, 'f')) {
      var f = Number(obj.f);
      if (isFinite(f)) { out.f = clamp(f, 20, 8000, 220); used++; }
    }
    if (has.call(obj, 'w')) {
      var w = Number(obj.w);
      if (isFinite(w)) { out.w = clamp(w, 4, 200, 26); used++; }
    }
    if (has.call(obj, 'd')) {
      var d = Number(obj.d);
      if (isFinite(d)) { out.d = clamp(d, 0, 1, 0.996); used++; }
    }
    if (has.call(obj, 'i')) {
      var mi = Number(obj.i);
      if (isFinite(mi)) { out.i = clamp(mi, 0, 20, 3); used++; }
    }
    return used ? out : null;
  }

  function encodeBookmark(bm) {
    var norm = normalizeBookmark(bm);
    if (!norm) return null;
    return '#ns=' + bytesToBase64Url(utf8Bytes(N.serializeState(norm)));
  }

  function decodeBookmark(raw) {
    if (typeof raw !== 'string') return null;
    var s = raw.replace(/^\s+|\s+$/g, '');
    var m = s.match(/^#?ns=([A-Za-z0-9_-]*)$/);
    if (!m) return null;
    if (s.length > MAX_BOOKMARK_CHARS) return null;
    var bytes = base64UrlToBytes(m[1]);
    if (!bytes || !bytes.length) return null;
    var text = utf8FromBytes(bytes);
    if (text === null) return null;
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return null; }
    return normalizeBookmark(obj);
  }

  /* Guesses which lab preset a normalized bench source list came from,
     so the share link can name it. */
  function detectPresetName(sources) {
    if (!Array.isArray(sources)) return null;
    if (sources.length === 4) return 'quad-array';
    if (sources.length === 3) return 'three-slit';
    if (sources.length === 2) {
      var ph = Math.abs(fin(sources[1] && sources[1].phase, 0)) % TAU;
      var distToPi = Math.abs(ph - Math.PI);
      return distToPi < 0.5 ? 'antiphase' : 'double-slit';
    }
    return null;
  }

  function voiceToApp(voice) {
    return VOICE_TO_APP[voice] || 'ks';
  }

  function voiceFromApp(mode) {
    return APP_TO_VOICE[mode] || 'karplus-strong';
  }

  /* ---------- in-page deterministic self tests ---------- */

  function ok(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || '' };
  }

  function selfTests() {
    var out = [];
    function t(name, fn) {
      try { out.push(fn()); }
      catch (e) { out.push(ok(name, false, String(e && e.message || e))); }
    }
    function eq(a, b) { return a === b; }
    function near(a, b, tol) { return Math.abs(a - b) <= tol; }

    t('sha256 empty string KAT', function () {
      return ok('sha256 empty string KAT',
        eq(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
    });
    t('sha256 abc KAT', function () {
      return ok('sha256 abc KAT',
        eq(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
    });
    t('sha256 two-block KAT', function () {
      return ok('sha256 two-block KAT',
        eq(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
          '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'));
    });
    t('sha256 one million a KAT', function () {
      var s = '';
      for (var i = 0; i < 100; i++) s += 'aaaaaaaaaa'; /* 1000 */
      var big = '';
      for (i = 0; i < 1000; i++) big += s; /* 1e6 */
      return ok('sha256 one million a KAT',
        eq(sha256(big), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'));
    });
    t('young fringe spacing exactness', function () {
      return ok('young fringe spacing exactness',
        eq(N.fringeSpacing(18, 160, 400), 45));
    });
    t('antiphase central null', function () {
      var f = farFieldProfile('antiphase');
      return ok('antiphase central null',
        f && f.centerIntensity < 1e-9, 'I(0)=' + (f ? f.centerIntensity : 'null'));
    });
    t('double-slit center is a constructive maximum', function () {
      var f = farFieldProfile('double-slit');
      return ok('double-slit center is a constructive maximum',
        f && near(f.centerIntensity, f.max, 1e-9) && f.visibility > 0.9);
    });
    t('autocorrelation pitch accuracy on a synthetic tone', function () {
      var b = new Float64Array(22050);
      for (var i = 0; i < b.length; i++) b[i] = Math.sin(TAU * 220 * i / 22050);
      var p = detectPitch(b, 22050, 220);
      return ok('autocorrelation pitch accuracy on a synthetic tone',
        Math.abs(p.errorCents) < 3, p.errorCents.toFixed(2) + ' cents');
    });
    t('karplus-strong pitch estimate tracks the string', function () {
      var b = N.karplusStrong({ frequency: 220, sampleRate: 22050, duration: 0.4, seed: 7 });
      var p = detectPitch(b, 22050, 220);
      return ok('karplus-strong pitch estimate tracks the string',
        p.lag === Math.round(22050 / 220) && Math.abs(p.errorCents) < 25,
        p.estimateHz.toFixed(2) + ' Hz');
    });
    t('fft parseval energy conservation', function () {
      var buf = new Float64Array(256);
      for (var i = 0; i < buf.length; i++) buf[i] = Math.sin(i * 0.7) * 0.5;
      var energy = 0;
      for (i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
      var re = Float64Array.from(buf), im = new Float64Array(buf.length);
      fft(re, im);
      var e2 = 0;
      for (i = 0; i < re.length; i++) e2 += re[i] * re[i] + im[i] * im[i];
      return ok('fft parseval energy conservation',
        near(e2, energy * re.length, energy * re.length * 1e-9));
    });
    t('fft rejects a non power of two input', function () {
      return ok('fft rejects a non power of two input',
        eq(fft(new Float64Array(3), new Float64Array(3)), false));
    });
    t('wav riff header and byte count', function () {
      var w = N.encodeWav(new Float64Array(100), 22050);
      var dv = new DataView(w.buffer);
      return ok('wav riff header and byte count',
        w.length === 244 && String.fromCharCode(w[0], w[1], w[2], w[3]) === 'RIFF' &&
        dv.getUint32(40, true) === 200);
    });
    t('canonical payload digest is deterministic', function () {
      var data = { comparator: compareAll({ duration: 0.2 }), params: { frequency: 220 } };
      return ok('canonical payload digest is deterministic',
        eq(briefDigest(data), briefDigest(data)) &&
        eq(stampedBrief(data), stampedBrief(data)));
    });
    t('digest parity across json csv and markdown', function () {
      var data = { comparator: compareAll({ duration: 0.2 }), params: { frequency: 220 } };
      var d = briefDigest(data);
      return ok('digest parity across json csv and markdown',
        exportJson(data).indexOf(d) >= 0 && exportCsv(data).indexOf(d) >= 0 &&
        exportMarkdown(data).indexOf(d) >= 0);
    });
    t('csv formula escaping', function () {
      return ok('csv formula escaping',
        eq(csvCell('=2+5'), "'=2+5") && csvCell('a,b').charAt(0) === '"' &&
        eq(csvCell('\t=x'), "'\t=x"));
    });
    t('tamper detection on a json brief', function () {
      var data = { comparator: compareAll({ duration: 0.2 }), params: { frequency: 220 } };
      var good = verifyBrief(exportJson(data));
      var bad = verifyBrief(tamperJson(exportJson(data)));
      return ok('tamper detection on a json brief', good.ok && !bad.ok);
    });
    t('ns bookmark round trip', function () {
      var bm = { p: 'three-slit', m: 'fm', f: 330, w: 20, d: 0.99, i: 4.5 };
      var dec = decodeBookmark(encodeBookmark(bm));
      return ok('ns bookmark round trip',
        dec && dec.p === 'three-slit' && dec.m === 'fm' && dec.f === 330 &&
        dec.w === 20 && dec.d === 0.99 && dec.i === 4.5);
    });
    t('ns bookmark rejects hostile hash', function () {
      var hostile = '#ns=' + bytesToBase64Url(utf8Bytes('{"__proto__":{"x":1},"f":440}'));
      return ok('ns bookmark rejects hostile hash',
        decodeBookmark(hostile) === null &&
        decodeBookmark('#ns=%%%') === null &&
        decodeBookmark('not a hash') === null);
    });
    t('preset detection on bench source lists', function () {
      return ok('preset detection on bench source lists',
        detectPresetName(OPTICS_PRESETS['quad-array'].sources) === 'quad-array' &&
        detectPresetName(OPTICS_PRESETS['three-slit'].sources) === 'three-slit' &&
        detectPresetName(OPTICS_PRESETS['antiphase'].sources) === 'antiphase' &&
        detectPresetName(OPTICS_PRESETS['double-slit'].sources) === 'double-slit');
    });
    return out;
  }

  return {
    LAB_VERSION: LAB_VERSION, SCHEMA: SCHEMA,
    OPTICS_PRESETS: OPTICS_PRESETS, OPTICS_PRESET_NAMES: OPTICS_PRESET_NAMES,
    VOICE_NAMES: VOICE_NAMES, VOICE_LABELS: VOICE_LABELS,
    utf8Bytes: utf8Bytes, utf8FromBytes: utf8FromBytes,
    sha256: sha256,
    bytesToBase64Url: bytesToBase64Url, base64UrlToBytes: base64UrlToBytes,
    nextPow2: nextPow2, fftSizeFor: fftSizeFor, fft: fft,
    magnitudeDb: magnitudeDb, spectralCentroid: spectralCentroid,
    topPeaks: topPeaks, detectPitch: detectPitch,
    normalizePreset: normalizePreset, farFieldProfile: farFieldProfile,
    analyzeOptics: analyzeOptics, analyzeVoice: analyzeVoice,
    voiceBuffer: voiceBuffer,
    compare: compare, compareAll: compareAll,
    stampedBrief: stampedBrief, briefDigest: briefDigest,
    exportJson: exportJson, exportCsv: exportCsv, exportMarkdown: exportMarkdown,
    csvCell: csvCell, verifyBrief: verifyBrief, tamperJson: tamperJson,
    normalizeBookmark: normalizeBookmark,
    encodeBookmark: encodeBookmark, decodeBookmark: decodeBookmark,
    detectPresetName: detectPresetName,
    voiceToApp: voiceToApp, voiceFromApp: voiceFromApp,
    selfTests: selfTests
  };
});
