'use strict';
/* Regression coverage for the 2026-11-24 local revamp. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../src/nanosynth.js');
const L = require('../src/optics-dsp-lab.js');

const ROOT = path.join(__dirname, '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('rng seed zero is distinct from seed one', () => {
  const zero = N.rng(0);
  const one = N.rng(1);
  const z = [zero(), zero(), zero()];
  const o = [one(), one(), one()];
  assert.notDeepEqual(z, o);
});

test('karplusStrong does not alias seed zero to seed one', () => {
  const opts = { frequency: 220, sampleRate: 8000, duration: 0.02 };
  const zero = N.karplusStrong(Object.assign({ seed: 0 }, opts));
  const one = N.karplusStrong(Object.assign({ seed: 1 }, opts));
  assert.notDeepEqual(Array.from(zero), Array.from(one));
});

test('fft accepts the length-one power of two as the identity transform', () => {
  const re = new Float64Array([3.25]);
  const im = new Float64Array([-1.5]);
  assert.equal(L.fft(re, im), true);
  assert.equal(re[0], 3.25);
  assert.equal(im[0], -1.5);
});

test('base64url decoding rejects non-zero trailing padding bits', () => {
  assert.equal(L.bytesToBase64Url([65]), 'QQ');
  assert.deepEqual(L.base64UrlToBytes('QQ'), [65]);
  assert.equal(L.base64UrlToBytes('QR'), null);
});

test('the strict bookmark codec rejects a non-canonical base64url twin', () => {
  const good = L.encodeBookmark({ p: 'antiphase', f: 300 });
  assert.ok(good.endsWith('Q'));
  const bad = good.slice(0, -1) + 'R';
  assert.notEqual(bad, good);
  assert.equal(L.decodeBookmark(bad), null);
});

test('interactive lab charts use group roles so probes stay exposed', () => {
  assert.match(IDX, /<svg id="labProfile" class="chart" viewBox="0 0 640 200" role="group"\s+aria-label="[^"]+"/);
  assert.match(IDX, /<svg id="labSpectrum" class="chart" viewBox="0 0 640 200" role="group"\s+aria-label="[^"]+"/);
});
