# Agent Notes

## Project

Geno-5 // Confluence is a local-first generative audiovisual instrument. A
deterministic Rust/WASM swarm drives both WebGPU visuals and WebAudio music.

Read `README.md`, `docs/CONCEPT.md`, `docs/ARCHITECTURE.md`, and
`docs/RESEARCH.md` before substantial work.

## Workflow

- Work directly on `main`; do not create branches or worktrees.
- Check `git status --short --branch` before editing.
- Preserve unrelated local changes.
- Run `npm run check` before committing.
- Commit and push completed slices.

## Product Rules

- The simulation, seed, and performance parameters must reproduce a take.
- Audio and visuals must derive from the same state.
- Publishing and deployment require explicit human approval.
- Keep creative language original and source references factual.
- Do not commit renders, credentials, tokens, or private account details.
