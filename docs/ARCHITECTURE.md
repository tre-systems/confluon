# Architecture

Confluon is a local-first generative audiovisual instrument. One deterministic
simulation is the source of both the image and the music; the renderer and audio
graph are projections of that state, not independent creative systems.

This document is both a system description and the set of patterns new work must
follow. The short version is:

> Keep deterministic domain state in Rust, keep browser integration at the edges,
> and pass one explicit, versioned state contract to every projection.

## Architectural principles

1. **One authoritative model.** Rust owns every value that can change the swarm's
   future. JavaScript may issue commands and read snapshots, but renderer, audio,
   controls, capture, and diagnostics must not maintain competing simulation state.
2. **Functional core, imperative shell.** Deterministic rules and invariants live in
   the Rust core. Pure JavaScript modules own codecs and schemas. `web/app.js` is the
   browser composition root that connects those pieces to DOM, timing, input, audio,
   GPU, and platform APIs.
3. **Same-state projections.** A display frame reads one raw metrics snapshot.
   WebGPU/Canvas and Web Audio both project that state. Visual interpolation may make
   the 30 Hz simulation look fluid, but interpolated values never feed the engine or
   audio.
4. **Explicit contracts over incidental coupling.** The WASM flat-array ABI lives in
   `web/simulation-contract.js`; URL performance state lives in
   `web/performance-state.js`; production capture exposes a versioned
   `window.confluon` API. Do not duplicate ABI indexes or score-handling defaults,
   limits, mode lists, and query keys elsewhere.
5. **Bounded real-time work.** The simulation uses a fixed step with bounded catch-up.
   Rendering, audio control, diagnostics, and input handling must not create an
   unbounded queue. Under sustained overload, performance time may slow rather than
   allowing input and audio to lag ever further behind the image.
6. **Disposable projections, durable score.** GPU textures, visual trails, AudioNodes,
   meters, and control labels are replaceable presentation state. Seed, engine
   version, population, settings, fixed-step command stream, and source revision are
   the durable score.
7. **Progressive capability.** WebGPU is preferred and Canvas 2D is the supported
   fallback. Audio starts only from a user gesture. Offline support, diagnostics,
   feedback, and analytics add capability without becoming startup requirements.
8. **Measure before distributing.** The current main-thread WASM call and native
   AudioNode graph are deliberate. Add a Worker, `SharedArrayBuffer`, AudioWorklet,
   frontend framework, or state library only when a measured constraint justifies
   its synchronisation and maintenance cost.

## System boundary and dependency direction

```text
URL score + pointer/keyboard commands
                  |
                  v
      web/app.js (composition root)
          | commands       | queries
          v                v
   Rust/WASM Engine ---- flat state contract
                              |
                    +---------+---------+
                    |                   |
                    v                   v
             WebGPU / Canvas       Web Audio graph
               projection            projection
                    |                   |
                    +---------+---------+
                              |
                         user / capture
```

Dependencies point inward toward contracts and the engine:

- The engine knows nothing about DOM, rendering, sound, capture, hosting, or
  monitoring.
- Renderers and audio never receive an `Engine`; they receive only arrays, settings,
  and interaction values selected by the composition root.
- Controls and featured fields update the canonical performance settings object and
  URL codec, then the composition root applies those values to the relevant adapters.
- Capture and smoke tests use the public diagnostics API instead of reaching into
  module-local state.
- Operational integrations may observe failures and runtime tags, but cannot change
  the score or block successful instrument startup.

## Module ownership

| Module | Owns | Must not own |
| --- | --- | --- |
| `src/simulation.rs` | PRNG, particles, neighbourhood pairs, forces, energy, metrics, formations | Browser time, pixels, audio scheduling, DOM |
| `src/lib.rs` | Narrow WASM command/query facade | A second model or browser policy |
| `web/simulation-contract.js` | ABI version, tuple indexes, strides, hard consumer limits | Dynamic engine state |
| `web/performance-state.js` | URL keys, defaults, bounds, seed/settings parse and encode | DOM controls or side effects |
| `web/viewport-projection.js` | Pure centred-cover projection and inverse pointer mapping | DOM, simulation state, renderer policy |
| `web/app.js` | Composition, frame clock, input state machine, adapter lifecycle, URL/history side effects, diagnostics facade | Particle rules, shader details, synthesis graph |
| `web/renderer.js` | WebGPU and Canvas strategies, visual history, presentation interpolation inputs | Commands to the engine, audio state |
| `web/audio.js` | Audio graph lifecycle, metric/formation mapping, browser-clock scheduling, capture tap | Commands to the engine, visual state |
| `web/monitoring.js` | Privacy boundary and optional operational diagnostics | Product analytics as simulation input, score data |
| `scripts/finalize-build.mjs` | Release config, build ID, manifest-derived service-worker precache | Hand-maintained asset lists |
| `scripts/produce-video.mjs` | Fresh-browser capture orchestration, chunk transfer, encoding and media verification | An alternative simulation or soundtrack |

`web/app.js` is intentionally a composition root and frame coordinator, not a
general-purpose service layer. It is currently a single application-lifetime module
because timing, input, capture, and adapter ownership share one lifecycle. Extract
new code from it in this order:

1. pure schemas/codecs/calculations;
2. adapters with narrow command/query interfaces;
3. stateful controllers only when their state and cleanup can be made explicit.

Avoid a global event bus or generic store. Direct calls make frame ordering, audio
coupling, and determinism easier to inspect. If input, frame-clock, or controls code
develops an independent lifecycle, extract an `InputController`, `InstrumentClock`,
or `ControlsView` with `start()`/`dispose()` rather than adding more global state.

## State authorities

Confluon has several kinds of state. Their precedence and durability differ:

1. **Engine state** is authoritative for the swarm and is changed only through
   commands.
2. **Performance state** is parsed from the URL into the application settings object.
   Controls mutate it, adapters are updated explicitly, and the complete state is
   encoded back into the URL. Featured fields are URLs using this same codec.
3. **Input envelope state** translates nondeterministic browser events into bounded
   commands sampled at fixed simulation steps.
4. **Projection state** includes interpolation buffers, GPU trail textures, AudioNode
   parameters, scheduler position, and meters. It is safe to reset or replace.
5. **Operational runtime config** enables diagnostics and analytics at build time. It
   is not performance state and must never alter the audiovisual result.

The URL codec is the canonical browser representation of a starting score. Unknown
query parameters such as renderer verification flags are preserved when score state
is written.

### Adding a performance parameter

A new user-visible parameter is incomplete until all applicable steps are done:

1. add its query key, default, scale, and bounds to
   `PERFORMANCE_PARAMETER_SCHEMA`;
2. add a control and label, if it is interactive;
3. map it explicitly to the engine, renderer, and audio where appropriate;
4. add URL decode/clamp/round-trip tests;
5. include it in capture metadata and user-facing documentation;
6. state whether it changes deterministic engine evolution or only a projection.

Where a concept can sensibly affect image and sound, it should affect both. A
visual-only or audio-only setting is allowed only when that asymmetry is deliberate
and documented.

## Commands, queries, and frame order

The WASM facade follows a command/query split.

Commands:

```text
reset(seed)
step(dt, pointer_x, pointer_y, pointer_strength, pointer_twist, settle)
set_ecology(value)
spawn_at(x, y, count)
```

Queries:

```text
snapshot()
metrics()
formations()
particle_count()
seed()
```

Only the composition root issues commands. Per display frame it performs this order:

1. calculate bounded elapsed time and fixed-step debt;
2. sample the current interaction envelope for each due simulation step;
3. issue at most two `Engine.step` commands;
4. read raw snapshot, metrics, and formations;
5. update the renderer from interpolated presentation copies;
6. update audio from raw metrics, formations, and interaction;
7. trigger a bounded strike when the raw transition metric crosses its threshold;
8. request the next animation frame.

This ordering is part of the architecture. In particular, audio must not read
smoothed visual metrics, and adapters must not query the engine independently.

## Simulation contract

The engine exposes three flat numeric arrays. Flat records avoid object
serialisation in the hot path and keep renderer implementations replaceable.
Consumer code uses the named indexes and strides from
`web/simulation-contract.js`.

- `snapshot()`: repeated `[x, y, species + energy, speed]`. The integer portion of
  the packed third value is species `0..2`; its fractional portion is normalised
  energy.
- `metrics()`: `[energy, coherence, activity, density, formations, transition,
  encounters]`.
- `formations()`: up to eight largest connected same-species formations as
  `[x, y, size_share, species]`, largest first, with toroidal centroids.

Metrics remain bounded to `0..1` except formation count. `encounters` measures
cross-population sensing pressure. Array lengths are multiples of their documented
strides; metrics has exactly seven entries. Any ABI change must:

1. update Rust producers and native tests;
2. increment `SIMULATION_CONTRACT_VERSION`;
3. update named JavaScript fields and every adapter;
4. update capture and browser smoke assertions;
5. update this document.

Do not pass rich serialised objects through WASM for these per-frame values. If
profiling shows array allocation/copying is a meaningful share of frame time, the
next optimisation is stable WASM-owned buffers exposed by pointer and length. Such
views must be reacquired after WebAssembly memory growth; zero-copy complexity is not
justified without a measured bottleneck.

## Determinism and reproducibility

The Rust core uses a small internal integer PRNG. There are two useful guarantees:

- **Engine-exact:** the same engine/source revision, seed, population, settings,
  fixed timestep, and commands at the same step indexes produce the same simulation
  state. Native tests assert exact same-seed snapshots and compare the neighbour
  grid against a brute-force oracle.
- **Performance-equivalent:** rendering and Web Audio are projections of that exact
  state, but pixels and PCM are not promised bit-identical across GPU drivers,
  browsers, sample rates, or output devices. Production capture records image and
  mastered audio from one browser clock and verifies frame cadence and media streams.

The fixed-step accumulator is a real-time delivery policy, not part of the engine.
Elapsed time is bounded and at most two catch-up steps are retained. A device that
cannot sustain the requested flow slows performance time instead of building
unbounded latency. Reproduction should therefore be driven by recorded step-indexed
commands, not assumed wall-clock event timestamps.

The URL is sufficient to reproduce an untouched or scripted starting score. A truly
interactive take additionally requires its gesture/command stream. Production
capture records source revision, seed, settings, environment, cadence, duration, and
codecs today; recording step-indexed interaction commands is the remaining requirement
for complete interactive take export.

Pointer input uses a deterministic short-lived alarm envelope so a poke persists
beyond release and cannot disappear between fixed steps. Fast hover movement alarms
nearby matter; a still mouse or hovering pen becomes a weak attractive presence.
Positive radial forces contain a repulsive inner core. Divide is fully repulsive.
Orbit combines radial and tangential forces with Gaussian distance falloff. Ecology
scales the existing cross-population energy derivative rather than adding a
visual-only substitute.

## Rendering strategy

`createRenderer()` is a strategy factory with one adapter shape:

```text
kind
render(snapshot, metrics, time)
setStyle(style)
resetTrails()
```

WebGPU uploads the snapshot and runs an HDR pipeline. An instanced additive pass
splats each particle's species-specific shell kernel into a one-third-resolution
`rgba16float` field. Half-resolution ping-pong textures accumulate motion history
with exponential fade. A full-screen pass composes background, trails, and field into
a full-resolution HDR target; deterministic particle variation adds cores and halos.
A quarter-resolution bloom chain feeds ACES tone mapping, lift, vignette, and grain.
Visible membranes are made from current particles and their measured field.

Canvas 2D uses cached deterministic sprites and CPU trails. It is a supported
fallback, not a second visual design. WebGPU loss is isolated: the composition root
replaces the projection with Canvas while retaining the engine and score.

Both renderers use the centred-cover contract in `web/viewport-projection.js`. The
square torus is uniformly scaled from the viewport's long edge, filling every aspect
ratio while cropping excess world space instead of stretching it or adding bars.
Pointer and touch coordinates use the exact inverse mapping, so a gesture acts on the
world position visibly beneath it. Browser selection, callout, drag, and pan/zoom
gestures are suppressed only on the field surface; native controls and page-level
accessibility zoom remain available.

The closed settings icon fades after 20 seconds of inactivity. Pointer movement,
screen presses, keyboard input, and wheel input restore it immediately. The idle
timer never hides an open control panel. Browser smoke coverage verifies the hidden
state, field-interaction wake-up, and subsequent control click separately.

Presentation interpolation is frame-rate independent and owns no domain truth. It
smooths wrapped coordinates, particle attributes, and visual metrics, with asymmetric
transition release. The raw snapshot still drives audio and future engine state.

## Audio strategy

The native Web Audio graph is self-contained and sample-free:

```text
six partial oscillators (+ drift LFOs) -> gains/panners -> pad low-pass -> dry
pad low-pass -> octave waveshaper -> band-pass -> shimmer -----------> reverb
eight paired formation voices -> filters/gains/panners -> formation bus -> dry
sub oscillator -> low-pass ------------------------------------------> dry
filtered stereo noise -----------------------------------------------> dry
sparse scale tones --------------------------------------------------> dry
control confirmation oscillator ------------------------------------> dry
dry -> delay/feedback + generated impulse response ------------------> wet
dry + wet -> master -> high-pass -> saturator -> tone filter -> compressor
          -> safety limiter -> analyser -> output + capture tap
```

The graph is created or resumed inside a user gesture. Continuous parameter changes
use AudioParam scheduling rather than timer-driven value jumps. Metrics steer
texture and musical density; formations retain voices by toroidal proximity; pointer
pressure, movement, and position modulate brightness, air, and pan. Controls provide
a restrained audible confirmation.

Web Audio intentionally uses its own high-resolution clock for AudioParam ramps and
sparse note scheduling. It consumes simulation state but does not become simulation
state. An AudioWorklet would be appropriate for custom sample-level DSP or an
offline-identical synthesis requirement; it is not needed for the current native
node graph.

## Lifecycle and failure isolation

The application has one page-lifetime composition root. Resource ownership follows
these rules:

- Create the engine before adapters; install controls and expose diagnostics only
  after all required adapters exist.
- Audio construction is cheap, but graph creation is deferred to a user gesture.
- A score reset replaces engine state and explicitly resets visual history and audio
  seed/scheduler state.
- Renderer loss replaces only the renderer. Simulation and audio continue.
- Capture preparation is idempotent in intent: silence audio, stop stepping, clear
  interactions and projection history, reset the engine, then begin from a clean
  first recorded frame.
- Optional diagnostics initialise concurrently and never gate startup or error
  presentation. A fatal bootstrap exception is sent after diagnostics become ready
  when possible.
- Monitoring, feedback, analytics, service worker, and offline failures degrade
  their own capability rather than the instrument.

Any future adapter that creates listeners, timers, GPU resources, workers, or audio
nodes with a shorter lifetime than the page must expose `dispose()` and be disposed
by its owner before replacement.

## Production capture

`npm run video` builds and serves the local production artifact, opens a fresh Chrome
profile at each requested output size, and drives `window.confluon`. The facade is
frozen and versioned; capture and smoke tools reject an unsupported API version.

`prepareCapture()` starts and silences audio, resets the seeded engine, clears visual
history, and returns active score metadata. `beginCapture()` releases simulation and
master gain on the first recorded frame. Canvas video and a
`MediaStreamAudioDestinationNode` tapped after the limiter enter one `MediaRecorder`,
keeping picture and mastered audio on the same browser clock.

Chunked WebM data is transferred to the local script rather than retained for a long
capture in browser memory. The script can keep VP9/Opus WebM and/or transcode
H.264/HEVC plus AAC MP4 with fast-start metadata. Every aspect ratio is a fresh run.
Each output receives a preview and JSON manifest with source revision, environment,
score, frame cadence, duration, and probed stream metadata. Renders and local account
details are never repository inputs.

Capture and browser smoke tools share `scripts/static-server.mjs`. Keep local
artifact routing, MIME types, root-path validation, and cache policy in that adapter
rather than maintaining test-specific HTTP servers.

## Performance constraints

- The normal field has 2,000 particles in 24 colonies. Life ranges from 600 to the
  hard 4,096 cap, which also bounds performed seeding.
- A wrapped 8-by-8 counting-sort grid creates each interacting pair once through a
  half stencil. Field, energy, and force accumulation update both particles and run
  linearly over that pair list. Reused scratch buffers keep the hot step allocation
  free; formation union-find reuses the same list.
- Simulation runs at a 30 Hz fixed step. Display and audio control run at display
  cadence, with at most two retained catch-up steps.
- Motion is finite, speed-limited, and toroidally wrapped.
- Render device pixel ratio is capped at two. Field, trail, and bloom passes use
  intentionally reduced intermediate resolutions.
- The field texture is rebuilt from the current snapshot and introduces no hidden
  domain state.
- Master gain is conservative and ends in compression and safety limiting.

Move simulation or rendering into a Worker only after production profiling shows
main-thread frame or input latency exceeding the budget on supported devices. A
Worker design must define snapshot ownership, transfer cadence, input step indexing,
GPU loss handling, and audio synchronisation first. `SharedArrayBuffer` also changes
cross-origin isolation and deployment requirements.

## Hosting, updates, and operational boundary

Vite builds fingerprinted JavaScript, CSS, and WASM. The finalizer derives runtime
config and the service-worker cache from Vite's actual entry manifest, then the
artifact verifier checks content and security policy. Avoid manually copying hashed
assets or maintaining a second precache list.

Cloudflare Workers Static Assets serves the production build. The small Worker exists
only for path/query-preserving canonical-host redirects before delegating to the
asset binding. Clean HTML routing and a real custom 404 are owned by `wrangler.toml`
and the assembled artifact.

The service worker precaches the instrument shell and article surface, uses
network-first navigation, and waits for explicit approval before activating a new
release. It keeps the stable `/sw.js` registration identity and bypasses the HTTP
cache with `updateViaCache: "none"`; release identity belongs in the worker's cache
name, not its URL. This prevents a returning player from receiving duplicate update
prompts. A release must never replace a running performance underneath the player.

Sentry and Cloudflare Web Analytics are build-time opt-ins. Query strings, fragments,
cookies, bodies, authorization headers, and user fields are removed from diagnostics;
replay and default PII are disabled. Feedback asks for no identity or screenshot.
Source maps exist only for authenticated upload and are removed from deployment.
Analytics is suppressed for Do Not Track. Operational config must remain optional and
must not enter shared score URLs or capture metadata.

## Verification architecture

Validation is layered so failures are found at the cheapest reliable boundary:

1. **Rust unit/property-style tests:** exact determinism, finite bounded evolution,
   conservation, interaction effects, toroidal behaviour, formation records, and
   neighbour-grid equivalence to brute force.
2. **Pure JavaScript tests:** performance-state defaults, bounds and URL round trips;
   PWA update state transitions.
3. **Static checks:** Rust formatting/clippy, JavaScript parsing, deterministic icon
   generation, dependency audits.
4. **Artifact checks:** manifest-derived files, build IDs, service-worker integrity,
   source-map exclusion, headers, and private-data indicators.
5. **Browser smoke:** instrument startup, versioned diagnostics API, WebGPU or Canvas
   drawing, forced Canvas fallback, audio startup and response, pointer gestures,
   controls, routes, security headers, service worker, and offline shell.
6. **Release checks:** the complete candidate is smoked before deployment and the
   public hostname is retried after deployment for edge propagation.

`npm run check` is the required local gate and CI gate. Chromium is the primary
integration target because it exercises WebGPU and capture. WebKit/mobile Safari and
Firefox coverage should be added when their supported renderer/audio paths can be
made stable in CI; responsive layout alone is not a substitute for testing real
touch, audio-resume, and graphics lifecycle behaviour.

## Technology decisions and reconsideration triggers

| Choice | Why it fits now | Reconsider when |
| --- | --- | --- |
| Rust + WASM | Deterministic numeric core, strong invariants, fast reusable pair loop | Cross-boundary copies dominate measured frame cost |
| Flat typed-array ABI | Compact hot-path interchange, direct GPU upload | Contract becomes sparse/optional or needs independent evolution |
| Vanilla ESM + DOM | Small single-screen UI, direct lifecycle and low framework weight | Multiple screens/components need independent ownership and testing |
| WebGPU + Canvas fallback | HDR particle field with a usable progressive fallback | A supported platform needs another maintained renderer |
| Native Web Audio nodes | Rich procedural graph, precise parameter automation, no sample assets | Custom sample-level DSP or bit-stable offline audio is required |
| Vite | Modern ESM development, fingerprinted static production artifact and manifest | Build requirements exceed static-client packaging |
| Playwright scripts | Real browser/API integration and production-artifact smoke | Test count needs fixtures, parallel projects, traces, and richer reporting |
| Cloudflare static assets + small Worker | Global static delivery and canonical redirects without an application server | Accounts, persistence, collaboration, or authenticated APIs enter scope |

The present tools are appropriate. The near-term engineering opportunity is stronger
contract testing and profiling, not a rewrite. If the JavaScript state surface keeps
growing, enable `tsc --checkJs` with JSDoc or migrate boundary modules to TypeScript
before adding a framework. Keep dependency upgrades—especially Vite major versions
and browser automation releases—as isolated, fully-smoked changes rather than mixing
them with audiovisual behaviour changes.
