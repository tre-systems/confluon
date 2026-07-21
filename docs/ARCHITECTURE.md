# Architecture

## System boundary

Confluence is a static web app with no server-side runtime. It has three cooperating
parts:

1. `src/simulation.rs` owns deterministic particle state, the energy-inspired motion
   rule, performance forces, and collective metrics.
2. `web/renderer.js` uploads the snapshot to WebGPU. An instanced additive pass splats
   each particle's species-specific shell kernel into an `rgba16float` texture at one
   third display resolution. A full-screen pass maps the accumulated field through
   the same growth-response ranges as the simulation, then a second instanced pass
   draws the small particle cores. There are no hulls or inferred nuclei: visible
   membranes are made by the particles and their measured field. A cached-sprite
   Canvas 2D fallback keeps the instrument usable when WebGPU is unavailable.
3. `web/audio.js` maps the same metrics onto a slow, layered WebAudio graph.

`web/app.js` is the thin frame coordinator. Simulation state does not live in the
renderer or audio layer.

## Frame contract

At a fixed timestep the browser calls:

```text
Engine.step(dt, pointer_x, pointer_y, pointer_strength, pointer_twist, settle)
```

The engine exposes two flat arrays:

- `snapshot()`: repeated `[x, y, species + energy, speed]` records. The integer
  portion of the packed third value is the population (`0..2`); its fractional
  portion is normalised energy.
- `metrics()`: `[energy, coherence, activity, density, formations, transition,
  encounters]`.

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
six partial oscillators -> voice gains/panners -> warm low-pass -> field pan -> dry
sub oscillator -> low-pass -----------------------------------------------------> dry
filtered noise ----------------------------------------------------------------> dry
sparse scale tones ------------------------------------------------------------> dry
dry -> delay -> filtered feedback -> wet -------------------------------------> master
dry -> generated impulse response -> wet -------------------------------------> master
dry --------------------------------------------------------------------------> master
master -> subsonic high-pass -> compressor -> analyser -> output
```

Audio starts only after an explicit user gesture and is re-resumed after browser or
device suspension. Parameter changes are smoothed with `AudioParam.setTargetAtTime`;
transitions create bounded resonant voices, while a slow metric-derived scheduler adds
space between longer tones. The Tone setting changes the resonator and noise spectral
tilt while preserving the same metric mapping. The analyser exposes RMS and peak
output for smoke tests.

## Performance constraints

- The normal field contains 1,200 particles in 24 compact colonies and is capped at
  1,600 after performed seeding.
- A wrapped 20-by-20 spatial grid limits each field and force calculation to nearby
  particles instead of scanning every possible pair.
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
