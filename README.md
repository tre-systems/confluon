# Geno-5 // Confluence

Confluence is an original interactive audiovisual instrument in which a deterministic
particle swarm composes long-form electronic music. Local crowding excites resonant
voices, coherent movement opens a shared drone, and changes in collective energy
produce strikes and transitions.

The same Rust/WASM simulation drives WebGPU visuals and WebAudio sound. There is no
sequencer and no separate audio-reactive animation: the image and music are two views
of one evolving state.

## What is here

- An energy-inspired particle model with a shell field, preferred local density,
  close-range repulsion, and performance forces.
- Deterministic reproduction from an integer seed and fixed simulation timestep.
- A WebGPU particle-field renderer with a Canvas 2D fallback.
- A conservative WebAudio resonator, noise, delay, and generated-reverb graph.
- Direct gestures for herding, repelling, seeding, settling, pausing, and resetting.
- Native Rust tests for determinism, stability, bounded metrics, interaction, and
  particle-count conservation.

## Play locally

Requires Node.js 22+, `wasm-pack`, and stable Rust with the
`wasm32-unknown-unknown` target.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite and choose **Begin with sound**. Browsers require
that explicit gesture before starting WebAudio.

Run the complete verification gate with:

```sh
npm run check
```

## Performance map

- Press and drag: herd the swarm toward the pointer.
- Option/Alt + drag: repel particles and open a cavity.
- Double click/tap: seed eighteen particles at the pointer.
- Hold `S` or **Hold to settle**: move toward a quieter common state.
- Release Settle: return to local negotiation, often provoking a transition.
- `R`: rebuild the displayed seed.
- `Space`: pause or resume.
- `H`: show or hide the performance map.

Append `?seed=12345` to the URL to start from a specific field.

## Design documents

- [Concept](docs/CONCEPT.md) — creative axes and musical mapping.
- [Architecture](docs/ARCHITECTURE.md) — simulation, render, and audio contracts.
- [Research basis](docs/RESEARCH.md) — what was learned from the Particle Lenia
  reference and what this implementation changes.

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
- Move the field renderer to a feedback texture for persistent trails and energy
  contours.
- Add an offline render path that uses the same fixed-step contract.
- Test and tune several six-minute seeds by listening, then record defended seeds in a
  small local preset ledger.

Publishing and deployment remain explicit human decisions.

## License

Apache-2.0. See [LICENSE](LICENSE).
