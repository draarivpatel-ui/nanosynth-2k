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
  var activeSrc = 1;
  var probe = { x: 0.5, y: 0.5 };
  var shrinkCache = null;

  document.getElementById('verTag').textContent = 'v' + N.VERSION;

  /* ---------- State to controls ---------- */

  /* A select has a fixed option list; a state value outside it would leave
     the control blank and silently change on the next input. Snap to the
     numerically nearest option so the visible control is always honest. */
  function snapSelect(el, v) {
    el.value = String(v);
    if (el.selectedIndex >= 0) return;
    var best = 0, bestD = Infinity;
    for (var i = 0; i < el.options.length; i++) {
      var d = Math.abs(Number(el.options[i].value) - Number(v));
      if (d < bestD) { bestD = d; best = i; }
    }
    el.selectedIndex = best;
  }

  function pushControls() {
    $('wl').value = state.optics.wavelength;
    $('sp').value = state.optics.spreading;
    $('ph').value = state.sources[1].phase;
    $('am').value = state.sources[1].amplitude;
    snapSelect($('srcCount'), state.sources.length);
    snapSelect($('palette'), state.view.palette);
    snapSelect($('step'), state.view.step);
    snapSelect($('mode'), state.synth.mode);
    $('freq').value = state.synth.frequency;
    $('midi').value = state.synth.midi;
    $('amp').value = state.synth.amplitude;
    $('damp').value = state.synth.damping;
    $('seed').value = state.synth.seed;
    $('ratio').value = state.synth.modRatio;
    $('index').value = state.synth.modIndex;
    $('dur').value = state.synth.duration;
    snapSelect($('sr'), state.synth.sampleRate);
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
      if (s === activeSrc) {
        fx.beginPath();
        fx.arc(srcs[s].x, srcs[s].y, 9, 0, N.TAU);
        fx.strokeStyle = '#d5e8ff';
        fx.lineWidth = 1.5;
        fx.stroke();
      }
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
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
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
    /* A preset only owns the source layout and wavelength; the synth voice,
       view settings, spreading and clock survive the swap. */
    state = N.createState({
      audioOn: audioOn,
      sources: p.sources,
      optics: {
        wavelength: p.wavelength,
        spreading: state.optics.spreading,
        time: state.optics.time
      },
      synth: state.synth,
      view: state.view
    });
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
    /* Only a press inside the grab ring starts a drag; pressing empty space
       moves the probe instead of teleporting source B to the pointer. */
    dragIdx = bestD < 22 ? best : -1;
    if (dragIdx >= 0) {
      activeSrc = dragIdx;
      field.setPointerCapture(e.pointerId);
      moveSource(e);
    } else {
      probe = { x: p.x / field.width, y: p.y / field.height };
      drawField();
    }
  });
  field.addEventListener('pointermove', function (e) {
    probe = { x: pointerPos(e).x / field.width, y: pointerPos(e).y / field.height };
    if (dragIdx >= 0) moveSource(e);
    else drawField();
  });
  field.addEventListener('pointerup', function () { dragIdx = -1; });
  field.addEventListener('pointercancel', function () { dragIdx = -1; });
  /* Arrow keys nudge the last grabbed source so the field is keyboard
     operable; Shift takes a bigger step. Brackets switch the source. */
  field.addEventListener('keydown', function (e) {
    var ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (e.key === '[' || e.key === ']') {
      activeSrc = (activeSrc + (e.key === ']' ? 1 : state.sources.length - 1)) % state.sources.length;
      drawField();
      return;
    }
    if (!ARROWS[e.key]) return;
    e.preventDefault();
    var s = state.sources[activeSrc] || state.sources[state.sources.length - 1];
    activeSrc = state.sources.indexOf(s);
    var px = e.shiftKey ? 10 : 2;
    s.x = N.roundTo(N.clamp(s.x + ARROWS[e.key][0] * px / field.width, 0, 1));
    s.y = N.roundTo(N.clamp(s.y + ARROWS[e.key][1] * px / field.height, 0, 1));
    state = N.createState(state);
    refreshStatePanel();
    drawField();
    $('stateMsg').textContent = 'Source ' + (activeSrc + 1) +
      ' at ' + s.x.toFixed(2) + ', ' + s.y.toFixed(2);
  });

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
      this.setAttribute('aria-pressed', 'false');
    } else {
      var self = this;
      self.textContent = 'Stop motion';
      self.setAttribute('aria-pressed', 'true');
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
    /* Space plays only when the press did not land on a control. Without
       this guard a focused button or select both activates natively and
       triggers play, and held keys would stack voices. */
    if (e.code === 'Space' && !e.repeat &&
        !/^(TEXTAREA|INPUT|SELECT|BUTTON|A)$/.test(e.target.tagName)) {
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
    getShrink().then(function (h) { copyText(N.encodeDataUri(h), 'Data URI'); })
      .catch(function (e) { $('stateMsg').textContent = 'Could not load shrink.html: ' + e.message; });
  });
  $('loadState').addEventListener('click', function () {
    try {
      state = N.deserializeState($('stateBox').value);
      state.audioOn = audioOn;
      pushControls();
      /* Values outside a control range are normalized now through the same
         read path a user input would take, instead of mutating silently
         later when the first control is touched. */
      readControls();
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

  /* ---------- Optics and spectrum lab ---------- */

  /* The lab module is optional: if src/optics-dsp-lab.js is absent the
     card is hidden and the rest of the bench is untouched. */
  var LAB = window.NanoSynthLab || null;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var LAB_TO_BENCH = { 'double-slit': 'young', 'antiphase': 'antiphase',
    'quad-array': 'quad', 'three-slit': 'grating' };
  var labBriefData = null;
  var labProfiles = {};
  var labSel = { preset: 'double-slit', voice: 'karplus-strong' };

  function labOpts() {
    /* Both voices are measured under one fixed setup so the comparator
       numbers are comparable; the bench tone controls carry through. */
    return {
      frequency: state.synth.frequency,
      sampleRate: 22050,
      duration: 0.4,
      damping: state.synth.damping,
      modRatio: state.synth.modRatio,
      modIndex: state.synth.modIndex,
      seed: state.synth.seed,
      amplitude: state.synth.amplitude
    };
  }

  function labData() {
    if (!labBriefData) {
      var o = labOpts();
      labBriefData = { comparator: LAB.compareAll(o), params: o };
    }
    return labBriefData;
  }

  function labInvalidate() {
    labBriefData = null;
    labProfiles = {};
  }

  function labTd(tr, text) {
    var c = document.createElement('td');
    c.textContent = text;
    tr.appendChild(c);
    return c;
  }

  function labSyncSelects() {
    $('labPreset').value = labSel.preset;
  }

  function labRenderTable() {
    var body = $('labRows');
    body.textContent = '';
    labData().comparator.forEach(function (r) {
      if (!r) return;
      var tr = document.createElement('tr');
      if (r.preset === labSel.preset && r.voice === labSel.voice) tr.className = 'sel';
      labTd(tr, r.preset);
      labTd(tr, r.audio.label);
      labTd(tr, r.optics.theoreticalSpacing.toFixed(2));
      labTd(tr, r.optics.measuredSpacing ? r.optics.measuredSpacing.toFixed(2) : '-');
      labTd(tr, r.optics.visibility.toFixed(4));
      var cents = r.audio.pitch.errorCents;
      labTd(tr, (cents >= 0 ? '+' : '') + cents.toFixed(1) + ' c');
      labTd(tr, r.audio.spectrum.centroidHz.toFixed(0));
      labTd(tr, r.audio.spectrum.peaks.length ?
        r.audio.spectrum.peaks[0].db.toFixed(1) + ' dB' : '-');
      labTd(tr, String(r.audio.wav.bytes));
      labTd(tr, r.audio.rms.toFixed(3));
      var cell = labTd(tr, '');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Apply';
      b.setAttribute('aria-label', 'Apply ' + r.preset + ' with ' + r.audio.label + ' to the bench');
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        labApplyToBench(r.preset, r.voice);
      });
      cell.appendChild(b);
      tr.addEventListener('click', function () {
        labSel = { preset: r.preset, voice: r.voice };
        labSyncSelects();
        labRenderTable();
        labRenderProfile();
        labRenderSpectrum();
      });
      body.appendChild(tr);
    });
  }

  function labApplyToBench(preset, voice) {
    var bench = LAB_TO_BENCH[preset];
    if (bench) applyPreset(bench);
    var sy = Object.assign({}, state.synth);
    sy.mode = LAB.voiceToApp(voice);
    state = N.createState({
      audioOn: audioOn, sources: state.sources, optics: state.optics,
      synth: sy, view: state.view
    });
    labSel = { preset: preset, voice: voice };
    labSyncSelects();
    pushControls();
    refreshLabels();
    refreshStatePanel();
    drawField();
    preview();
    labRenderAll();
    $('stateMsg').textContent = 'Lab preset applied to bench: ' + preset + ' / ' + LAB.VOICE_LABELS[voice];
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* Wires left and right arrow keys across a row of focusable probes. */
  function labProbeNav(list) {
    list.forEach(function (c, i) {
      c.addEventListener('keydown', function (e) {
        var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
        if (j >= 0 && j < list.length) { e.preventDefault(); list[j].focus(); }
      });
    });
  }

  function labGetProfile(preset) {
    if (!labProfiles[preset]) {
      labProfiles[preset] = LAB.farFieldProfile(preset, {
        points: 401,
        span: Number($('labSpan').value) || 300,
        spreading: state.optics.spreading
      });
    }
    return labProfiles[preset];
  }

  function labRenderProfile() {
    var svg = $('labProfile');
    svg.textContent = '';
    var f = labGetProfile(labSel.preset);
    if (!f) { $('labProfileRead').textContent = 'Profile unavailable.'; return; }
    var x0 = 30, x1 = 634, y0 = 10, y1 = 182;
    svg.appendChild(svgEl('line', { x1: x0, y1: y0, x2: x0, y2: y1, 'class': 'axis' }));
    svg.appendChild(svgEl('line', { x1: x0, y1: y1, x2: x1, y2: y1, 'class': 'axis' }));
    var maxY = f.max > 0 ? f.max : 1;
    var pts = '';
    for (var i = 0; i < f.points; i++) {
      var px = x0 + (x1 - x0) * (f.xs[i] + f.span) / (2 * f.span);
      var py = y1 - (y1 - y0) * f.profile[i] / maxY;
      pts += px.toFixed(1) + ',' + py.toFixed(1) + ' ';
    }
    svg.appendChild(svgEl('polyline', { points: pts, fill: 'none',
      stroke: '#4fd6c9', 'stroke-width': 1.4 }));
    var t = svgEl('text', { x: x0 + 4, y: y0 + 12 });
    t.textContent = 'I(x) ' + f.label + ', span +/-' + f.span + ' px';
    svg.appendChild(t);
    var probes = [];
    function probeAt(m, kind) {
      var px = x0 + (x1 - x0) * (m.x + f.span) / (2 * f.span);
      var py = y1 - (y1 - y0) * m.intensity / maxY;
      var c = svgEl('circle', { cx: px.toFixed(1), cy: py.toFixed(1),
        r: kind === 'max' ? 3 : 2.4, 'class': 'probe',
        fill: kind === 'max' ? '#4fd6c9' : '#e0556b', tabindex: '0' });
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', (kind === 'max' ? 'Constructive' : 'Destructive') +
        ' fringe at ' + m.x.toFixed(1) + ' px, intensity ' + m.intensity.toFixed(3));
      c.addEventListener('focus', function () {
        $('labProfileRead').textContent = (kind === 'max' ? 'Constructive' : 'Destructive') +
          ' fringe at ' + m.x.toFixed(1) + ' px, I=' + m.intensity.toFixed(4);
      });
      c.addEventListener('pointerenter', function () {
        $('labProfileRead').textContent = (kind === 'max' ? 'Constructive' : 'Destructive') +
          ' fringe at ' + m.x.toFixed(1) + ' px, I=' + m.intensity.toFixed(4);
      });
      probes.push(c);
      svg.appendChild(c);
    }
    f.maxima.forEach(function (m) { probeAt(m, 'max'); });
    f.minima.forEach(function (m) { probeAt(m, 'min'); });
    labProbeNav(probes);
    $('labProfileRead').textContent = 'Young spacing ' + f.theoreticalSpacing.toFixed(2) +
      ' px, measured ' + (f.measuredSpacing ? f.measuredSpacing.toFixed(2) : 'n/a') +
      ' px, visibility ' + f.visibility.toFixed(4) +
      ', ' + f.maxima.length + ' maxima, ' + f.minima.length + ' minima';
  }

  function labRenderSpectrum() {
    var svg = $('labSpectrum');
    svg.textContent = '';
    var o = labOpts();
    var colors = { 'karplus-strong': '#4fd6c9', 'fm-2op': '#ffb347' };
    var fmax = Math.min(o.sampleRate / 2, Math.max(3000, 4 * o.frequency));
    var x0 = 30, x1 = 634, y0 = 10, y1 = 182;
    var floorDb = -84;
    svg.appendChild(svgEl('line', { x1: x0, y1: y0, x2: x0, y2: y1, 'class': 'axis' }));
    svg.appendChild(svgEl('line', { x1: x0, y1: y1, x2: x1, y2: y1, 'class': 'axis' }));
    var t0 = svgEl('text', { x: x0 + 4, y: y0 + 10 });
    t0.textContent = 'dB';
    svg.appendChild(t0);
    var t1 = svgEl('text', { x: x1 - 66, y: y1 - 4 });
    t1.textContent = fmax.toFixed(0) + ' Hz';
    svg.appendChild(t1);
    LAB.VOICE_NAMES.forEach(function (v) {
      var made = LAB.voiceBuffer(v, o);
      var spec = LAB.magnitudeDb(made.buf, { sampleRate: o.sampleRate, fftSize: 16384 });
      var cols = x1 - x0;
      var pts = '';
      for (var c = 0; c <= cols; c++) {
        var h0 = fmax * c / cols, h1 = fmax * (c + 1) / cols;
        var b0 = Math.floor(h0 / spec.binHz);
        var b1 = Math.min(spec.magsDb.length - 1, Math.ceil(h1 / spec.binHz));
        var m = floorDb;
        for (var b = b0; b <= b1; b++) if (spec.magsDb[b] > m) m = spec.magsDb[b];
        pts += (x0 + c).toFixed(1) + ',' + (y1 - (y1 - y0) * (m - floorDb) / -floorDb).toFixed(1) + ' ';
      }
      svg.appendChild(svgEl('polyline', { points: pts, fill: 'none',
        stroke: colors[v], 'stroke-width': 1.2 }));
      var lg = svgEl('text', { x: x1 - 150 + LAB.VOICE_NAMES.indexOf(v) * 78, y: y0 + 10 });
      lg.setAttribute('fill', colors[v]);
      lg.textContent = LAB.VOICE_LABELS[v];
      svg.appendChild(lg);
    });
    var row = null;
    labData().comparator.forEach(function (r) {
      if (r && r.preset === labSel.preset && r.voice === labSel.voice) row = r;
    });
    var probes = [];
    if (row) {
      row.audio.spectrum.peaks.forEach(function (pk, i) {
        if (pk.freqHz > fmax) return;
        var px = x0 + (x1 - x0) * pk.freqHz / fmax;
        var py = y1 - (y1 - y0) * (Math.max(floorDb, pk.db) - floorDb) / -floorDb;
        var c = svgEl('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: 3,
          'class': 'probe', fill: colors[labSel.voice], tabindex: '0' });
        c.setAttribute('role', 'img');
        c.setAttribute('aria-label', 'Harmonic peak ' + (i + 1) + ' at ' +
          pk.freqHz.toFixed(1) + ' Hz, ' + pk.db.toFixed(1) + ' dB');
        c.addEventListener('focus', function () {
          $('labSpecRead').textContent = 'Peak ' + (i + 1) + ': ' + pk.freqHz.toFixed(1) +
            ' Hz at ' + pk.db.toFixed(1) + ' dB (' + row.audio.label + ')';
        });
        c.addEventListener('pointerenter', function () {
          $('labSpecRead').textContent = 'Peak ' + (i + 1) + ': ' + pk.freqHz.toFixed(1) +
            ' Hz at ' + pk.db.toFixed(1) + ' dB (' + row.audio.label + ')';
        });
        probes.push(c);
        svg.appendChild(c);
      });
    }
    labProbeNav(probes);
    var ksRow = labData().comparator[0], fmRow = labData().comparator[1];
    $('labSpecRead').textContent = 'Centroid ' +
      (ksRow ? ksRow.audio.spectrum.centroidHz.toFixed(0) : '-') + ' Hz KS / ' +
      (fmRow ? fmRow.audio.spectrum.centroidHz.toFixed(0) : '-') +
      ' Hz FM at ' + o.frequency.toFixed(1) + ' Hz target';
  }

  function labRenderDigest() {
    var d = LAB.briefDigest(labData());
    var el = $('labDigest');
    el.textContent = d.slice(0, 24) + '...';
    el.setAttribute('title', d);
  }

  function labRenderAll() {
    labRenderTable();
    labRenderProfile();
    labRenderSpectrum();
    labRenderDigest();
  }

  function labDownload(text, name, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* Restores a #ns= bookmark into bench state. The codec is fail-closed:
     a malformed or hostile hash returns null and nothing changes. Audio
     stays off regardless of what the bookmark carries. */
  function restoreFromHash() {
    if (!LAB || typeof location === 'undefined' || !location.hash) return;
    var bm = LAB.decodeBookmark(location.hash);
    if (!bm) return;
    var next = {
      audioOn: false,
      sources: state.sources,
      optics: state.optics,
      synth: state.synth,
      view: state.view
    };
    if (bm.p && LAB_TO_BENCH[bm.p] && PRESETS[LAB_TO_BENCH[bm.p]]) {
      var bp = PRESETS[LAB_TO_BENCH[bm.p]];
      next.sources = bp.sources;
      next.optics = Object.assign({}, state.optics, { wavelength: bp.wavelength });
    }
    var sy = Object.assign({}, next.synth);
    if (bm.m) sy.mode = bm.m;
    if (bm.f !== undefined) {
      sy.frequency = bm.f;
      delete sy.midi; /* let createState derive the note from the frequency */
    }
    if (bm.d !== undefined) sy.damping = bm.d;
    if (bm.i !== undefined) sy.modIndex = bm.i;
    next.synth = sy;
    if (bm.w !== undefined) {
      next.optics = Object.assign({}, next.optics, { wavelength: bm.w });
    }
    state = N.createState(next);
    state.audioOn = false;
    if (bm.p) labSel.preset = bm.p;
    if (bm.m) labSel.voice = LAB.voiceFromApp(bm.m);
    labInvalidate();
  }

  function initLab() {
    labSyncSelects();
    labRenderAll();
    $('labRefresh').addEventListener('click', function () {
      labInvalidate();
      labRenderAll();
      $('labMsg').textContent = 'Comparator recomputed from the current bench controls.';
    });
    $('labPreset').addEventListener('change', function () {
      labSel.preset = $('labPreset').value;
      labRenderTable();
      labRenderProfile();
    });
    $('labSpan').addEventListener('input', function () {
      $('labSpanVal').textContent = $('labSpan').value;
    });
    $('labSpan').addEventListener('change', function () {
      labProfiles = {};
      labRenderProfile();
    });
    $('labJson').addEventListener('click', function () {
      labDownload(LAB.exportJson(labData()), 'nanosynth-lab-brief.json', 'application/json');
      $('labMsg').textContent = 'JSON brief downloaded with digest ' +
        LAB.briefDigest(labData()).slice(0, 16) + '.';
    });
    $('labCsv').addEventListener('click', function () {
      labDownload(LAB.exportCsv(labData()), 'nanosynth-lab-brief.csv', 'text/csv');
      $('labMsg').textContent = 'CSV brief downloaded; provenance line carries the same digest.';
    });
    $('labMd').addEventListener('click', function () {
      labDownload(LAB.exportMarkdown(labData()), 'nanosynth-lab-brief.md', 'text/markdown');
      $('labMsg').textContent = 'Markdown brief downloaded; footer carries the same digest.';
    });
    $('labShare').addEventListener('click', function () {
      var code = LAB.encodeBookmark({
        p: LAB.detectPresetName(state.sources) || labSel.preset,
        m: state.synth.mode,
        f: state.synth.frequency,
        w: state.optics.wavelength,
        d: state.synth.damping,
        i: state.synth.modIndex
      });
      if (!code) { $('labMsg').textContent = 'Could not build a share link.'; return; }
      if (history.replaceState) history.replaceState(null, '', code);
      copyText(location.href.split('#')[0] + code, 'Share link');
    });
    $('labVerify').addEventListener('click', function () {
      var v = LAB.verifyBrief(LAB.exportJson(labData()));
      $('labMsg').textContent = v.ok ?
        'Digest verified: the brief payload hashes to the stamped value.' :
        'Verification failed (' + v.reason + ').';
      $('labMsg').style.color = v.ok ? 'var(--accent)' : 'var(--warn)';
    });
    $('labTamper').addEventListener('click', function () {
      var bad = LAB.tamperJson(LAB.exportJson(labData()));
      var v = LAB.verifyBrief(bad);
      $('labMsg').textContent = v.ok ?
        'Tamper check inconclusive: payload still verified.' :
        'Tamper detected: one flipped metric changed the digest (' + v.reason + ').';
      $('labMsg').style.color = v.ok ? 'var(--warn)' : 'var(--accent)';
    });
    $('labSelfTest').addEventListener('click', function () {
      var results = LAB.selfTests();
      var ol = $('labTests');
      ol.textContent = '';
      var pass = 0;
      results.forEach(function (r) {
        var li = document.createElement('li');
        li.className = r.pass ? 'ok' : 'bad';
        li.textContent = (r.pass ? 'pass' : 'FAIL') + '  ' + r.name +
          (r.detail ? '  (' + r.detail + ')' : '');
        ol.appendChild(li);
        if (r.pass) pass++;
      });
      $('labMsg').textContent = 'Lab self-tests: ' + pass + '/' + results.length + ' passed.';
      $('labMsg').style.color = pass === results.length ? 'var(--accent)' : 'var(--warn)';
    });
    ['wl', 'sp', 'freq', 'damp', 'seed', 'ratio', 'index', 'amp', 'dur', 'sr',
     'mode', 'midi', 'ph', 'am', 'srcCount'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        labInvalidate();
        labRenderAll();
      });
    });
    window.addEventListener('hashchange', function () {
      restoreFromHash();
      pushControls();
      refreshLabels();
      refreshStatePanel();
      drawField();
      preview();
      labRenderAll();
    });
  }

  /* ---------- Boot ---------- */

  restoreFromHash();
  pushControls();
  refreshLabels();
  refreshStatePanel();
  drawField();
  preview();
  if (LAB) initLab();
  else if ($('labCard')) $('labCard').style.display = 'none';
})();
