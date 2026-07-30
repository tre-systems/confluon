# Contributing to Confluon

Confluon is a deterministic audiovisual instrument. Changes to motion, sound, timing,
or controls must preserve a simple rule: the same engine revision, seed, performance
settings, fixed timestep, and gesture stream reproduce the same take. Audio and image
must continue to read the same simulation state.

## Set up the project

You need Node.js 22 or newer, stable Rust, `wasm-pack`, and the
`wasm32-unknown-unknown` Rust target.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
npm ci
npm run dev
```

## Before opening a pull request

Keep changes focused and explain any creative or technical trade-off that is not
obvious from the diff. Do not commit generated builds, renders, credentials, tokens,
or private account details.

Run the complete local gate:

```sh
npm run check
npm run audit
```

For changes to browser behavior, also install Chromium once and run the production
smoke test:

```sh
npx playwright install chromium
npm run smoke
```

Native Rust tests should cover deterministic rules and invariants. Browser code
must follow the functional-core/imperative-shell, command/query, same-state
projection, and bounded-work patterns in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). In particular:

- change WASM tuple layouts only through `web/simulation-contract.js` and increment
  the contract version;
- change score query keys, defaults, bounds, or modes only through
  `web/performance-state.js` and its round-trip tests;
- keep renderers and audio independent of the `Engine`; `web/app.js` alone issues
  commands and passes state to those projections;
- discuss Workers, AudioWorklets, frameworks, or state libraries as measured
  architectural changes rather than introducing them incidentally.

The architecture and research notes in `docs/` describe the complete boundaries.

By submitting a contribution, you agree that it is licensed under the project's
Apache-2.0 licence.
