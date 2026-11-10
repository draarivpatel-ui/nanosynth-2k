/* Regenerate DATA_URI.txt from shrink.html. Deterministic and side effect
   free beyond writing the one output file. */
'use strict';
const fs = require('fs');
const path = require('path');
const N = require('../src/nanosynth.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'shrink.html'), 'utf8');
const uri = N.encodeDataUri(html);
const bytes = Buffer.byteLength(uri);

if (html.length >= 2950) throw new Error('shrink.html must stay below 2950 bytes');
if (bytes >= 3072) throw new Error('data uri must stay below 3072 bytes');
if (N.decodeDataUri(uri) !== html) throw new Error('data uri did not round trip');

const doc = [
  'NanoSynth-2K standalone sandbox, copyable data URI',
  'Shrink HTML bytes: ' + Buffer.byteLength(html),
  'Data URI bytes: ' + bytes,
  'Audio is OFF on load. No audio context is created until the user clicks Audio: OFF.',
  '',
  'Copy the single line below into a browser address bar.',
  '',
  uri,
  ''
].join('\n');

fs.writeFileSync(path.join(root, 'DATA_URI.txt'), doc);
console.log('shrink.html ' + Buffer.byteLength(html) + ' B, data uri ' + bytes + ' B');
