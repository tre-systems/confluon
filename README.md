# Geno-5 // Confluence

Confluence is an original interactive audiovisual instrument in which three
deterministic particle populations compose long-form electronic music. Each forms
its own structures while cyclic attraction and avoidance pull the populations into
encounters. Local crowding excites resonant voices, coherent movement opens a shared
drone, and changes in collective energy produce strikes and transitions.

The same Rust/WASM simulation drives WebGPU visuals and WebAudio sound. There is no
sequencer and no separate audio-reactive animation: the image and music are two views
of one evolving state.

## What is here

- An energy-inspired, three-population particle model with distinct shell fields,
  cyclic cross-population sensing, close-range repulsion, and performance forces.
  A per-step pair list over a counting-sort grid keeps the hot loop allocation-free.
- Deterministic reproduction from an integer seed and fixed simulation timestep.
- A 2,000-particle field (adjustable from 600 to 4,096) initialised as 24 compact
  colonies. The WebGPU renderer accumulates every particle's shell kernel into a
  floating-point field texture, layers GPU-accumulated motion trails beneath growth
  contours and luminous particle cores in an HDR target, then finishes with bloom,
  ACES tone mapping, vignette, and grain. A cached-sprite Canvas 2D fallback
  preserves the same point-built image.
- An audible WebAudio harmonic field with six sustained voices, a formation choir
  whose up-to-eight voices pan to the screen positions of the visible cell clusters,
  sub foundation, filtered air, shimmer, sparse scale-locked tones, delay, a
  generated early-reflection reverb, tape-style saturation, compression, limiting,
  and an output meter.
- Lossless recording: a Record control taps the master bus through an AudioWorklet
  and saves the take as a 32-bit float stereo WAV for release work.
- Touch-friendly Gather, Orbit, and Divide gestures, plus seeding, settling, pausing,
  and resetting. Gesture strikes sound from where they happen in the image.
- Shareable performance settings for ecology, flow, touch strength, halo, visual
  memory, tone, population, and level.
- A discreet control panel that closes out of the image and fades completely after
  nine seconds of inactivity.
- Native Rust tests for determinism, stability, bounded metrics, interaction, and
  particle-count conservation.

## Play locally

Requires Node.js 22+, `wasm-pack`, and stable Rust with the
`wasm32-unknown-unknown` target.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite and choose **Enter — Sound on**. Browsers require
that explicit gesture before starting WebAudio. The control icon in the top-left
opens the performance controls and fades away when left alone.

Run the complete verification gate with:

```sh
npm run check
```

## Produce video

Create a synchronized, share-ready video from a seed:

```sh
npm run video -- --seed 12345 --duration 30
```

The production helper records the WebGPU field and mastered audio together, then
encodes and verifies an H.264/AAC MP4. It supports landscape, square, 4:5 portrait,
9:16 story, 4K, and custom sizes; MP4 and WebM can be generated together:

```sh
npm run video -- \
  --seed 12345 \
  --duration 30 \
  --formats landscape,square,portrait,story \
  --containers mp4,webm
```

Each output includes a PNG preview and a JSON manifest with the engine revision,
seed, performance settings, resolution, frame cadence, duration, and codecs. See
[Video production](docs/VIDEO_PRODUCTION.md) for format presets, codec choices, and
requirements.

## Deployment

Every passing push to `main` deploys the production build to Cloudflare Workers
through GitHub Actions:

<https://geno-5.tre.systems>

The workflow builds and tests before deploying. Pull requests run the same checks but
never deploy. A manual production deployment can also be started from the repository's
Actions page. Local deployment is available to an authenticated operator with
`npm run deploy`.

## Performance map

- Choose **Gather**, **Orbit**, or **Divide**, then press and drag to sculpt the local
  field. The modes work with mouse, pen, and touch.
- Shift + drag: momentarily orbit without changing the selected mode.
- Option/Alt + drag: momentarily divide and open a cavity.
- Double click/tap: seed a compact 50-particle colony at the pointer.
- Hold `S` or **Hold to settle**: move toward a quieter common state.
- Release Settle: return to local negotiation, often provoking a transition.
- `R`: rebuild the displayed seed.
- `Space`: pause or resume.
- `G`, `O`, `D`: select Gather, Orbit, or Divide.

Append `?seed=12345` to the URL to start from a specific field.
Changing a performance setting records the complete configuration in the URL, so a
seed and its ecology, flow, look, tone, and selected gesture can be shared together.
Use **Copy link** at the foot of the controls to copy that complete performance URL.

## Design documents

- [Concept](docs/CONCEPT.md) — creative axes and musical mapping.
- [Architecture](docs/ARCHITECTURE.md) — simulation, render, and audio contracts.
- [Research basis](docs/RESEARCH.md) — what was learned from the Particle Lenia
  reference and what this implementation changes.
- [Video production](docs/VIDEO_PRODUCTION.md) — reproducible local capture and
  share-format exports.

## Research basis and attribution

The model is informed by *Particle Lenia and the energy-based formulation* by
Alexander Mordvintsev, Eyvind Niklasson, and Ettore Randazzo. Their article describes
the radial field, growth, repulsion, local-energy dynamics, and an initial per-particle
sonification experiment. Confluence is an independent implementation and uses a
collective musical mapping; it includes no upstream code or creative assets.

- [Research article](https://google-research.github.io/self-organising-systems/particle-lenia/)
- [Interactive reference demo](https://znah.net/lenia/)
- [Reproducible notebook](https://github.com/google-research/self-organising-systems/blob/master/notebooks/particle_lenia.ipynb)

## Next production slices

- Export a take as audio, video, seed, engine version, and gesture stream for direct
  ingestion into the Multivibrator review pipeline.
- Add bounded field feedback for longer-lived energy contours without obscuring the
  particle-built membranes.
- Add an offline render path that uses the same fixed-step contract.
- Test and tune several six-minute seeds by listening, then record defended seeds in a
  small local preset ledger.

Publishing and deployment remain explicit human decisions; the production deployment
above was enabled by the project owner on 2026-07-21.

## License

Apache-2.0. See [LICENSE](LICENSE).
