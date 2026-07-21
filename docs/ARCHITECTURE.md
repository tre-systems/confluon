# Architecture

## System boundary

Confluence is a static web app with no server-side runtime. It has three cooperating
parts:

1. `src/simulation.rs` owns deterministic particle state, the energy-inspired motion
   rule, performance forces, and collective metrics.
2. `web/renderer.js` uploads the snapshot to WebGPU and renders the energy field. A
   Canvas 2D fallback keeps the instrument usable when WebGPU is unavailable.
3. `web/audio.js` maps the same metrics onto a restrained WebAudio graph.

`web/app.js` is the thin frame coordinator. Simulation state does not live in the
renderer or audio layer.

## Frame contract

At a fixed timestep the browser calls:

```text
Engine.step(dt, pointer_x, pointer_y, pointer_strength, settle)
```

The engine exposes two flat arrays:

- `snapshot()`: repeated `[x, y, energy, speed]` records;
- `metrics()`: `[energy, coherence, activity, density, formations, transition]`.

Both are values in documented bounded ranges. This small contract keeps the renderer
replaceable and makes offline reproduction practical.

## Determinism

The Rust core uses a small internal integer PRNG. The same engine version, seed,
particle count, fixed timestep, and gesture stream reproduce a take. Future export
work should save those values as `instrument.json` alongside audio/video output.

## Audio graph

```text
partial oscillators -> per-voice gains/panners -> resonant low-pass -> dry bus
                                                   |                |
filtered noise ------------------------------------+                +-> compressor -> master
                                                                    |
dry bus -> delay -> feedback filter -> delay -----------------------+
dry bus -> generated impulse response ------------------------------+
```

Audio starts only after an explicit user gesture. Parameter changes are smoothed with
`AudioParam.setTargetAtTime`; transitions create bounded, short-lived resonant voices.

## Performance constraints

- The simulation is capped at 320 particles.
- The browser advances at most four fixed steps per animation frame.
- Particle motion is finite, speed-limited, and wrapped on a torus.
- Master gain stays conservative and passes through a compressor.
- Rendering resolution is capped at device pixel ratio 2.
