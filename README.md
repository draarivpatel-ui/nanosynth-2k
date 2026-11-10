# NanoSynth-2K

A 2D wave interference optics bench and a Karplus-Strong / FM synthesizer that
share one deterministic state. Plain HTML, CSS, and JavaScript, zero
dependencies, no build step, no network calls.

Live workbench: <https://aariv.me/nanosynth-2k/>
Repository: <https://github.com/draarivpatel-ui/nanosynth-2k>

Audio is muted on load. No `AudioContext` is created until the user clicks the
audio toggle. There is no autoplay of any kind.

## Why this exists

Interference fringes and a plucked string are the same equation seen from two
sides: coherent sums of delayed copies of a signal. NanoSynth-2K puts both in
one instrument so you can drag a wave source, watch the phasor sum change, and
hear a delay line sing at the frequency implied by the picture. Everything is
computed locally and serialized to one canonical JSON object, so a given bench
state always produces identical bytes, an identical hash, and an identical
waveform.

## Quick start

```bash
git clone https://github.com/draarivpatel-ui/nanosynth-2k.git
cd nanosynth-2k
node --test test/nanosynth.test.js
```

Open `index.html` directly in a modern browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/
```

To regenerate the copyable data URI from `shrink.html`:

```bash
node tools/generate_data_uri.js
```

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Full modular workbench markup and styles |
| `app.js` | Workbench controller, rendering, audio, and state UI |
| `src/nanosynth.js` | Shared math core, usable in Node and the browser |
| `test/nanosynth.test.js` | 60+ `node --test` unit tests |
| `shrink.html` | Standalone sandbox, under 2,950 bytes |
| `DATA_URI.txt` | Copyable `data:text/html,...` artifact, under 3,072 bytes |
| `tools/generate_data_uri.js` | Regenerates `DATA_URI.txt` deterministically |

## The two halves

### 2D wave interference optics

Each source emits a sinusoid with amplitude falling as one over the square root
of distance. The renderer sums every source as a complex phasor and maps the
squared magnitude to color, which gives stable, time independent intensity
fringes. The math core also exposes instantaneous superposition for the motion
view, path difference, constructive and destructive fringe tests, and the Young
double slit fringe spacing `lambda * L / d`. Presets cover a double slit, an
antiphase pair, a quad array, and a three slit grating.

### Karplus-Strong and FM synthesis

The string voice fills a delay line of length `sampleRate / frequency` with
seeded white noise, then repeatedly averages adjacent samples with a damping
factor. Autocorrelation of the result peaks at the expected period. The FM
voice is a two operator sine pair with an exponential envelope, a carrier to
modulator ratio, and a modulation index. Both voices can be previewed, played,
and exported as a 16 bit mono WAV file.

## Deterministic state

`createState` clamps and normalizes every field. `serializeState` sorts all
object keys and rounds all numbers to six decimals, so object insertion order
and floating point noise cannot change the bytes. `stateHash` is an FNV-1a of
those canonical bytes. `cloneState` and `deserializeState` round trip cleanly.
The workbench text box accepts canonical JSON and the state panel shows the
hash and byte count.

## Byte budget

`shrink.html` is a complete interactive sandbox in a single file. It keeps
both synthesis voices, the two source interference field, a draggable source,
sliders, and the muted-by-default audio gate. `DATA_URI.txt` percent encodes
only the characters that would otherwise break a data URI, so the copyable URI
stays well under the 3,072 byte cap. The test suite enforces both budgets with
`Buffer.byteLength` and verifies that the URI decodes back to the file exactly.

## Audio rule

The audio flag starts at zero in the standalone file and at `false` in the
workbench. The only path that constructs or resumes an `AudioContext` is the
explicit user click handler. Tests assert the gate order, the absence of
autoplay in the standalone file, and the `Audio: OFF` start label.

## License

MIT. See `LICENSE`.
