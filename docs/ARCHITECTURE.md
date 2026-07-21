# Architecture

## System boundary

Confluence is a static web app with no server-side runtime. It has three cooperating
parts:

1. `src/simulation.rs` owns deterministic particle state, the energy-inspired motion
   rule, performance forces, and collective metrics.
2. `web/renderer.js` uploads the snapshot to WebGPU and renders the energy field. It
   also derives closed cell bodies from same-population connected components, so the
   translucent cytoplasm, doubled membranes, and nucleus-like centres deform, divide,
   and disappear with the actual ecology rather than playing as an independent visual
   effect. A Canvas 2D fallback keeps the instrument usable when WebGPU is unavailable.
3. `web/audio.js` maps the same metrics onto a slow, layered WebAudio graph.

`web/app.js` is the thin frame coordinator. Simulation state does not live in the
renderer or audio layer.

## Frame contract

At a fixed timestep the browser calls:

```text
Engine.step(dt, pointer_x, pointer_y, pointer_strength, settle)
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
particle count, fixed timestep, and gesture stream reproduce a take. Future export
work should save those values as `instrument.json` alongside audio/video output.

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
space between longer tones. The analyser exposes RMS and peak output for smoke tests.

## Performance constraints

- The simulation is capped at 320 particles.
- The browser advances at most four fixed steps per animation frame.
- Particle motion is finite, speed-limited, and wrapped on a torus.
- Master gain stays conservative and passes through a compressor.
- Rendering resolution is capped at device pixel ratio 2.
- Cell topology is recalculated from the current snapshot and does not introduce
  hidden simulation state.

## Hosting and delivery

The production build is served as Cloudflare Workers Static Assets at
`geno-5.tre.systems`. `wrangler.toml` owns the custom-domain route and SPA fallback.
GitHub Actions runs the complete verification gate before deploying a push to `main`;
pull requests never deploy. Cloudflare credentials remain encrypted GitHub Actions
secrets and are not available to the browser build.
