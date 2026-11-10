/* NanoSynth-2K workbench controller. Wires the shared core to the DOM. */
(function () {
  'use strict';
  var N = window.NanoSynth;
  if (!N) throw new Error('nanosynth.js failed to load');

  var $ = function (id) { return document.getElementById(id); };
  var field = $('field');
  var fx = field.getContext('2d');
  var waveCv = $('wave');
  var wx = waveCv.getContext('2d');
  var state = N.createState();
  var audioOn = false;
  var audioCtx = null;
  var animTimer = null;
  var lastBuffer = null;
  var dragIdx = -1;
  var probe = { x: 0.5, y: 0.5 };
  var shrinkCache = null;

  document.getElementById('verTag').textContent = 'v' + N.VERSION;

  /* ---------- State to controls ---------- */

  function pushControls() {
    $('wl').value = state.optics.wavelength;
    $('sp').value = state.optics.spreading;
    $('ph').value = state.sources[1].phase;
    $('am').value = state.sources[1].amplitude;
    $('srcCount').value = String(state.sources.length);
    $('palette').value = state.view.palette;
    $('step').value = String(state.view.step);
    $('mode').value = state.synth.mode;
    $('freq').value = state.synth.frequency;
    $('midi').value = state.synth.midi;
    $('amp').value = state.synth.amplitude;
    $('damp').value = state.synth.damping;
    $('seed').value = state.synth.seed;
    $('ratio').value = state.synth.modRatio;
    $('index').value = state.synth.modIndex;
    $('dur').value = state.synth.duration;
    $('sr').value = String(state.synth.sampleRate);
    $('ksRow').style.display = state.synth.mode === 'ks' ? 'flex' : 'none';
    $('fmRow').style.display = state.synth.mode === 'fm' ? 'flex' : 'none';
  }

  function readControls() {
    state = N.createState({
      audioOn: audioOn,
      sources: state.sources,
      optics: {
        wavelength: $('wl').value,
        spreading: $('sp').value,
        time: state.optics.time
      },
      synth: {
        mode: $('mode').value,
        frequency: $('freq').value,
        midi: $('midi').value,
        amplitude: $('amp').value,
        damping: $('damp').value,
        seed: $('seed').value,
        modRatio: $('ratio').value,
        modIndex: $('index').value,
        duration: $('dur').value,
        sampleRate: $('sr').value
      },
      view: {
        width: field.width,
        height: field.height,
        step: $('step').value,
        palette: $('palette').value
      }
    });
  }

  function refreshLabels() {
    $('wlVal').textContent = state.optics.wavelength;
    $('spVal').textContent = state.optics.spreading.toFixed(3);
    $('phVal').textContent = state.sources[1].phase.toFixed(2);
    $('amVal').textContent = state.sources[1].amplitude.toFixed(2);
    $('freqVal').textContent = state.synth.frequency.toFixed(1);
    $('noteVal').textContent = N.midiToName(state.synth.midi) +
      ' / ' + state.synth.frequency.toFixed(1) + ' Hz';
    $('ampVal').textContent = state.synth.amplitude.toFixed(2);
    $('dampVal').textContent = state.synth.damping.toFixed(3);
    $('ratioVal').textContent = state.synth.modRatio.toFixed(1);
    $('indexVal').textContent = state.synth.modIndex.toFixed(1);
    $('durVal').textContent = state.synth.duration.toFixed(1);
  }

  function refreshStatePanel() {
    var json = N.serializeState(state);
    $('stateBox').value = json;
    $('sHash').textContent = N.stateHash(state);
    $('sBytes').textContent = new TextEncoder().encode(json).length;
  }

  /* ---------- Interference rendering ---------- */

  function paletteColor(u, pal) {
    var r, g, b;
    if (pal === 'ember') {
      r = 255 * Math.pow(u, 0.7); g = 150 * Math.pow(u, 1.6); b = 40 * Math.pow(u, 3.2);
    } else if (pal === 'mono') {
      r = g = b = 255 * Math.pow(u, 1.1);
    } else {
      r = 255 * Math.pow(u, 2.2); g = 230 * Math.pow(u, 1.3); b = 60 + 195 * Math.pow(u, 0.6);
    }
    return [r | 0, g | 0, b | 0];
  }

  function drawField() {
    var w = field.width, h = field.height;
    var srcs = state.sources.map(function (s) {
      return { x: s.x * w, y: s.y * h, amplitude: s.amplitude, phase: s.phase };
    });
    var step = state.view.step;
    var img = fx.createImageData(w, h);
    var data = img.data;
    var wl = state.optics.wavelength;
    var sprd = state.optics.spreading;
    var t = state.optics.time;
    var omega = 2 * Math.PI;
    var maxSeen = 0;
    var sumSeen = 0;
    var count = 0;
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        var v = N.intensityAt(srcs, x, y, wl, sprd);
        if (t > 0) {
          var inst = N.superpose(srcs, x, y, wl, t, omega, sprd);
          v = 0.6 * v + 0.4 * inst * inst;
        }
        if (v > maxSeen) maxSeen = v;
        sumSeen += v;
        count++;
        var u = Math.min(1, v / (state.sources.length * state.sources.length));
        var c = paletteColor(u, state.view.palette);
        for (var dy = 0; dy < step && y + dy < h; dy++) {
          for (var dx = 0; dx < step && x + dx < w; dx++) {
            var i = ((y + dy) * w + (x + dx)) * 4;
            data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
          }
        }
      }
    }
    fx.putImageData(img, 0, 0);
    for (var s = 0; s < srcs.length; s++) {
      fx.beginPath();
      fx.arc(srcs[s].x, srcs[s].y, 5, 0, N.TAU);
      fx.fillStyle = s === 0 ? '#4fd6c9' : '#ffb347';
      fx.fill();
      fx.strokeStyle = '#04070f';
      fx.lineWidth = 1.5;
      fx.stroke();
    }
    $('sField').textContent = maxSeen.toFixed(3) + ' / ' + (count ? sumSeen / count : 0).toFixed(3);
    updateProbe(srcs, wl);
  }

  function updateProbe(srcs, wl) {
    var x = probe.x * field.width, y = probe.y * field.height;
    var inten = N.intensityAt(srcs, x, y, wl, state.optics.spreading);
    var pd = N.pathDifference(srcs, x, y);
    var pdv = Array.isArray(pd) ? pd[0] : pd;
    $('sInt').textContent = inten.toFixed(3);
    $('sPath').textContent = pdv.toFixed(2) + ' px';
    $('sVerdict').textContent = N.isConstructive(pdv, wl, 0.08) ? 'constructive' :
      N.isDestructive(pdv, wl, 0.08) ? 'destructive' : 'partial';
    var sep = Math.abs(srcs[1].x - srcs[0].x) || 1;
    $('sFringe').textContent = N.fringeSpacing(wl, sep, 400).toFixed(2) + ' px';
  }

  /* ---------- Synth ---------- */

  function buildBuffer() {
    var sy = state.synth;
    var opts = {
      frequency: sy.frequency,
      sampleRate: sy.sampleRate,
      duration: sy.duration,
      amplitude: sy.amplitude,
      damping: sy.damping,
      seed: sy.seed,
      modRatio: sy.modRatio,
      modIndex: sy.modIndex
    };
    lastBuffer = sy.mode === 'ks' ? N.karplusStrong(opts) : N.fmBuffer(opts);
    return lastBuffer;
  }

  function drawWave(buf) {
    var w = waveCv.width, h = waveCv.height;
    wx.clearRect(0, 0, w, h);
    wx.fillStyle = '#0c1424';
    wx.fillRect(0, 0, w, h);
    wx.strokeStyle = '#22365a';
    wx.beginPath(); wx.moveTo(0, h / 2); wx.lineTo(w, h / 2); wx.stroke();
    if (!buf || !buf.length) return;
    var stride = Math.max(1, Math.floor(buf.length / w));
    wx.strokeStyle = '#4fd6c9';
    wx.lineWidth = 1;
    wx.beginPath();
    for (var x = 0; x < w; x++) {
      var s = buf[x * stride] || 0;
      var y = h / 2 - s * (h / 2 - 4);
      if (x === 0) wx.moveTo(x, y); else wx.lineTo(x, y);
    }
    wx.stroke();
    var pk = N.peak(buf), rm = N.rms(buf);
    $('sLevel').textContent = pk.toFixed(3) + ' / ' + rm.toFixed(3);
    var expected = Math.round(state.synth.sampleRate / state.synth.frequency);
    var best = 0, bestLag = -1;
    for (var lag = Math.max(2, expected - 12); lag <= expected + 12; lag++) {
      var a = N.autocorrelation(buf, lag);
      if (a > best) { best = a; bestLag = lag; }
    }
    $('sLag').textContent = bestLag > 0 ? bestLag + ' samples (r=' + best.toFixed(3) + ')' : '-';
    $('sPitch').textContent = bestLag > 0 ?
      (state.synth.sampleRate / bestLag).toFixed(2) + ' Hz' : '-';
  }

  function preview() {
    drawWave(buildBuffer());
  }

  function play() {
    if (!audioOn) {
      $('stateMsg').textContent = 'Audio is off. Click the Audio toggle first.';
      return;
    }
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    var buf = lastBuffer || buildBuffer();
    var sr = state.synth.sampleRate;
    var ab = audioCtx.createBuffer(1, buf.length, sr);
    var ch = ab.getChannelData(0);
    for (var i = 0; i < buf.length; i++) ch[i] = buf[i];
    var src = audioCtx.createBufferSource();
    var gain = audioCtx.createGain();
    gain.gain.value = 0.9;
    src.buffer = ab;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();
  }

  function downloadWav() {
    var buf = lastBuffer || buildBuffer();
    var bytes = N.encodeWav(buf, state.synth.sampleRate);
    var blob = new Blob([bytes], { type: 'audio/wav' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nanosynth-' + state.synth.mode + '-' + Math.round(state.synth.frequency) + '.wav';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function setAudio(on) {
    audioOn = on;
    state.audioOn = on;
    var b = $('audioBtn');
    b.textContent = 'Audio: ' + (on ? 'ON' : 'OFF');
    b.className = on ? 'on' : 'off';
    if (on) {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume();
      $('stateMsg').textContent = 'Audio enabled by user click.';
    } else if (audioCtx) {
      audioCtx.suspend();
      $('stateMsg').textContent = 'Audio muted.';
    }
    refreshStatePanel();
  }

  /* ---------- Presets ---------- */

  var PRESETS = {
    young: { sources: [{ x: 0.3, y: 0.5, amplitude: 1, phase: 0 }, { x: 0.7, y: 0.5, amplitude: 1, phase: 0 }], wavelength: 18 },
    antiphase: { sources: [{ x: 0.3, y: 0.5, amplitude: 1, phase: 0 }, { x: 0.7, y: 0.5, amplitude: 1, phase: Math.PI }], wavelength: 18 },
    quad: { sources: [{ x: 0.3, y: 0.3, amplitude: 1, phase: 0 }, { x: 0.7, y: 0.3, amplitude: 1, phase: 0 }, { x: 0.3, y: 0.7, amplitude: 1, phase: 0 }, { x: 0.7, y: 0.7, amplitude: 1, phase: 0 }], wavelength: 22 },
    grating: { sources: [{ x: 0.3, y: 0.35, amplitude: 1, phase: 0 }, { x: 0.3, y: 0.5, amplitude: 1, phase: 0 }, { x: 0.3, y: 0.65, amplitude: 1, phase: 0 }], wavelength: 20 }
  };

  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    state = N.createState({ sources: p.sources, optics: { wavelength: p.wavelength } });
    state.audioOn = audioOn;
    state.synth = N.createState({ synth: state.synth }).synth;
    pushControls();
    refreshLabels();
    refreshStatePanel();
    drawField();
    $('stateMsg').textContent = 'Preset loaded: ' + name;
  }

  /* ---------- Events ---------- */

  function onControlsChanged() {
    readControls();
    refreshLabels();
    pushControls();
    refreshStatePanel();
    drawField();
    preview();
  }

  ['wl', 'sp', 'ph', 'am', 'srcCount', 'palette', 'step', 'mode', 'freq', 'midi',
   'amp', 'damp', 'seed', 'ratio', 'index', 'dur', 'sr'].forEach(function (id) {
    $(id).addEventListener('input', onControlsChanged);
    $(id).addEventListener('change', onControlsChanged);
  });

  /* Keep note and frequency ranges loosely coupled without fighting the user. */
  $('midi').addEventListener('input', function () {
    $('freq').value = N.noteToFrequency(+$('midi').value).toFixed(1);
  });
  $('freq').addEventListener('input', function () {
    var n = Math.round(N.frequencyToNote(+$('freq').value));
    $('midi').value = Math.max(24, Math.min(96, n));
  });

  $('srcCount').addEventListener('change', function () {
    var want = +$('srcCount').value;
    var cur = state.sources.length;
    if (want > cur) {
      for (var i = cur; i < want; i++) {
        state.sources.push({ x: 0.3 + 0.13 * i, y: 0.3 + 0.2 * (i % 2), amplitude: 1, phase: 0 });
      }
    } else {
      state.sources.length = want;
    }
    state = N.createState(state);
    refreshStatePanel();
    drawField();
  });

  function pointerPos(e) {
    var r = field.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * field.width,
      y: (e.clientY - r.top) / r.height * field.height
    };
  }

  field.addEventListener('pointerdown', function (e) {
    var p = pointerPos(e);
    var best = -1, bestD = 400;
    state.sources.forEach(function (s, i) {
      var d = Math.hypot(p.x - s.x * field.width, p.y - s.y * field.height);
      if (d < bestD) { bestD = d; best = i; }
    });
    dragIdx = bestD < 22 ? best : 1;
    field.setPointerCapture(e.pointerId);
    moveSource(e);
  });
  field.addEventListener('pointermove', function (e) {
    probe = { x: pointerPos(e).x / field.width, y: pointerPos(e).y / field.height };
    if (dragIdx >= 0) moveSource(e);
    else drawField();
  });
  field.addEventListener('pointerup', function () { dragIdx = -1; });
  field.addEventListener('pointercancel', function () { dragIdx = -1; });

  function moveSource(e) {
    var p = pointerPos(e);
    var s = state.sources[dragIdx];
    if (!s) return;
    s.x = N.roundTo(N.clamp(p.x / field.width, 0, 1));
    s.y = N.roundTo(N.clamp(p.y / field.height, 0, 1));
    state = N.createState(state);
    refreshStatePanel();
    drawField();
  }

  $('animBtn').addEventListener('click', function () {
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = null;
      this.textContent = 'Play motion';
    } else {
      var self = this;
      self.textContent = 'Stop motion';
      animTimer = setInterval(function () {
        state.optics.time = N.roundTo(state.optics.time + 0.05, 4);
        drawField();
      }, 50);
    }
  });

  document.querySelectorAll('[data-preset]').forEach(function (el) {
    el.addEventListener('click', function () { applyPreset(el.getAttribute('data-preset')); });
  });

  $('audioBtn').addEventListener('click', function () { setAudio(!audioOn); });
  $('playBtn').addEventListener('click', play);
  $('wavBtn').addEventListener('click', downloadWav);
  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      play();
    }
  });

  function copyText(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        $('stateMsg').textContent = label + ' copied to clipboard.';
      }, function () { fallbackCopy(text, label); });
    } else fallbackCopy(text, label);
  }
  function fallbackCopy(text, label) {
    $('stateBox').value = text;
    $('stateBox').select();
    try { document.execCommand('copy'); $('stateMsg').textContent = label + ' copied.'; }
    catch (e) { $('stateMsg').textContent = label + ' placed in the text box for manual copy.'; }
  }

  $('copyState').addEventListener('click', function () {
    copyText(N.serializeState(state), 'State JSON');
  });
  $('copyUri').addEventListener('click', function () {
    getShrink().then(function (h) { copyText(N.encodeDataUri(h), 'Data URI'); });
  });
  $('loadState').addEventListener('click', function () {
    try {
      state = N.deserializeState($('stateBox').value);
      state.audioOn = audioOn;
      pushControls();
      refreshLabels();
      refreshStatePanel();
      drawField();
      preview();
      $('stateMsg').textContent = 'State loaded and canonicalized.';
    } catch (e) {
      $('stateMsg').textContent = 'Invalid state: ' + e.message;
    }
  });
  $('resetState').addEventListener('click', function () {
    state = N.createState();
    state.audioOn = audioOn;
    pushControls();
    refreshLabels();
    refreshStatePanel();
    drawField();
    preview();
    $('stateMsg').textContent = 'Reset to defaults.';
  });

  function getShrink() {
    if (shrinkCache) return Promise.resolve(shrinkCache);
    return fetch('shrink.html').then(function (r) {
      if (!r.ok) throw new Error('shrink.html unavailable');
      return r.text();
    }).then(function (t) { shrinkCache = t; return t; });
  }

  $('verifyBtn').addEventListener('click', function () {
    getShrink().then(function (h) {
      var uri = N.encodeDataUri(h);
      var hb = new TextEncoder().encode(h).length;
      var ub = new TextEncoder().encode(uri).length;
      var muted = /[,;]\s*A=0\b/.test(h) && /A=!A/.test(h) &&
        /Audio: OFF/.test(h) && !/autoplay/i.test(h);
      $('vHtml').textContent = hb + (hb < 2950 ? ' OK' : ' TOO BIG');
      $('vUri').textContent = ub + (ub < 3072 ? ' OK' : ' TOO BIG');
      $('vAudio').textContent = muted ? 'yes' : 'NO';
      var ok = hb < 2950 && ub < 3072 && muted && N.decodeDataUri(uri) === h;
      $('verifyMsg').textContent = ok ?
        'All budgets and the muted-by-default rule verified in the browser.' :
        'Verification failed. See the values above.';
      $('verifyMsg').style.color = ok ? 'var(--accent)' : 'var(--warn)';
    }).catch(function (e) {
      $('verifyMsg').textContent = 'Could not read shrink.html: ' + e.message;
    });
  });

  /* ---------- Boot ---------- */

  pushControls();
  refreshLabels();
  refreshStatePanel();
  drawField();
  preview();
})();
