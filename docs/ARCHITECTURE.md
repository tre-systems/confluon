# Architecture

## System boundary

Confluence is a static web app with no server-side runtime. It has three cooperating
parts:

1. `src/simulation.rs` owns deterministic particle state, the energy-inspired motion
   rule, performance forces, collective metrics, and per-formation summaries.
2. `web/renderer.js` uploads the snapshot to WebGPU and runs an HDR pipeline. An
   instanced additive pass splats each particle's species-specific shell kernel into
   an `rgba16float` texture at one third display resolution. A ping-pong pair of
   half-resolution trail textures accumulates motion history with a frame-rate
   independent exponential fade. A full-screen pass composes the background, trails,
   and the field mapped through the same growth-response ranges as the simulation
   into a full-resolution HDR target, followed by an instanced pass for the particle
   cores. A quarter-resolution bloom chain (soft-knee extract, separable Gaussian
   blur) feeds the final pass, which applies ACES tone mapping, a gentle lift,
   vignette, and animated grain. There are no hulls or inferred nuclei: visible
   membranes are made by the particles and their measured field. A cached-sprite
   Canvas 2D fallback keeps the instrument usable when WebGPU is unavailable.
3. `web/audio.js` maps the same metrics and formation summaries onto a slow,
   layered WebAudio graph, and can record the master output to WAV through an
   `AudioWorklet` tap (`public/recorder.js`).

`web/app.js` is the thin frame coordinator. Simulation state does not live in the
renderer or audio layer.

## Frame contract

At a fixed timestep the browser calls:

```text
Engine.step(dt, pointer_x, pointer_y, pointer_strength, pointer_twist, settle)
```

The engine exposes three flat arrays:

- `snapshot()`: repeated `[x, y, species + energy, speed]` records. The integer
  portion of the packed third value is the population (`0..2`); its fractional
  portion is normalised energy.
- `metrics()`: `[energy, coherence, activity, density, formations, transition,
  encounters]`.
- `formations()`: up to eight of the largest connected same-species formations as
  `[x, y, size_share, species]` records, largest first, with toroidal centroids.

The normalised metrics remain bounded to `0..1` except formation count. `encounters`
measures cross-population sensing pressure. This small contract keeps the renderer
replaceable and makes offline reproduction practical.

## Determinism

The Rust core uses a small internal integer PRNG. The same engine version, seed,
particle count, fixed timestep, performance settings, and gesture stream reproduce a
take. Browser settings are encoded in the URL; future export work should save those
values as `instrument.json` alongside audio/video output.

Gather and Divide are opposite signed local radial forces. Orbit combines a small
radial bias with a tangential force and Gaussian distance falloff. Ecology scales the
existing cross-population energy derivative rather than adding a visual-only effect.

## Audio graph

```text
six partial oscillators (+ per-voice drift LFOs) -> gains/panners -> pad low-pass -> field pan -> dry
pad low-pass -> octave waveshaper -> band-pass -> shimmer gain ----------------> reverb (wet only)
eight formation voices (paired oscillators -> low-pass -> gain -> panner) -----> formation bus -> dry
sub oscillator -> low-pass ----------------------------------------------------> dry
filtered stereo noise ---------------------------------------------------------> dry
sparse scale tones ------------------------------------------------------------> dry
dry -> delay -> filtered feedback -> wet --------------------------------------> master
dry -> generated impulse response (early reflections + darkening tail) -> wet -> master
dry ---------------------------------------------------------------------------> master
master -> subsonic high-pass -> tape saturator -> tone low-pass -> compressor
       -> safety limiter -> analyser -> output (optional recorder worklet tap)
```

Audio starts only after an explicit user gesture and is re-resumed after browser or
device suspension. Parameter changes are smoothed with `AudioParam.setTargetAtTime`;
transitions create bounded resonant voices, while a slow metric-derived scheduler adds
space between longer tones. The Tone setting changes the resonator and noise spectral
tilt while preserving the same metric mapping. The analyser exposes RMS and peak
output for smoke tests.

The sound is tied to the image in three ways. Each of the up-to-eight visible
formations owns a sustained voice whose stereo pan tracks the formation's on-screen
position, whose level follows its share of the population, and whose pitch derives
from its species; a new formation rings a soft emergence bell from its own position.
Sparse field tones speak from a currently visible formation, and gesture strikes pan
to the pointer position. A single 0.1 Hz breath oscillator moves the pad filter,
sub level, and master brightness together so the whole mix breathes as one.

The Record control taps the limiter output through an `AudioWorklet`
(`public/recorder.js`), accumulates 32-bit float stereo blocks, and downloads the
take as a WAV named after the seed and duration. With the seed and URL-encoded
settings, a take is reproducible.

## Performance constraints

- The normal field contains 2,000 particles in 24 compact colonies; the Life setting
  ranges from 600 to the hard cap of 4,096, which also bounds performed seeding.
- A wrapped 8-by-8 counting-sort grid feeds a per-step pair list: every interacting
  pair within the sensing radius is found once via a half stencil, then the field,
  energy, and force accumulations each run linearly over that list, writing both
  sides of each pair. Scratch buffers are reused across steps, so the hot loop does
  not allocate. Formation counting and centroids reuse the same pair list through a
  union-find pass.
- The browser advances the deterministic simulation at 30 Hz and performs at most
  two catch-up steps per animation frame; rendering and audio control remain tied to
  display frames.
- Particle motion is finite, speed-limited, and wrapped on a torus.
- Master gain stays conservative and passes through a compressor.
- Rendering resolution is capped at device pixel ratio 2.
- The kernel field is rebuilt from the current snapshot each frame and introduces no
  hidden simulation state.

## Hosting and delivery

The production build is served as Cloudflare Workers Static Assets at
`geno-5.tre.systems`. `wrangler.toml` owns the custom-domain route and SPA fallback.
GitHub Actions runs the complete verification gate before deploying a push to `main`;
pull requests never deploy. Cloudflare credentials remain encrypted GitHub Actions
secrets and are not available to the browser build.
