# itch.io launch package

This is the publication-ready specification for Confluon's first low-traffic
growth experiment. The repository build creates the HTML5 archive and listing
artwork under `output/itch/`; generated files remain untracked.

## Project metadata

| Field | Value |
| --- | --- |
| Title | Confluon |
| Page URL | `confluon` if available |
| Kind | HTML |
| Classification | Tool |
| Release status | Released |
| Pricing | No payments |
| Short description | A deterministic audiovisual swarm instrument—shape the field, hear it respond, and share the score. |
| Upload | `output/itch/confluon-html5.zip` |
| Embed | Click to launch in fullscreen; click to play enabled |
| Inputs | Keyboard, mouse, touchscreen |
| Session length | A few minutes |
| Languages | English |
| Accessibility | High contrast |
| Community | Comments enabled |
| Visibility | Draft until explicit publication approval |

Suggested tags, ordered by relevance:

1. Generative Art
2. Procedural
3. Music
4. Experimental
5. Simulation
6. Sandbox
7. Audio
8. Instrument
9. Touch Friendly
10. Artificial Life

Set the AI generation disclosure to **Yes**, classifying **Graphics**, **Text &
Dialog**, and **Code**. The launch package was prepared with Codex assistance, so
this is the accurate provenance disclosure even though Confluon's runtime is a
self-contained deterministic simulation and does not use a trained model.

## Page copy

### A deterministic field you can hear

Three particle populations negotiate attraction, avoidance, crowding, and flow.
Their shared state drives both the image and the music: there is no sequencer and no
separate audio-reactive animation.

**[Launch Field Current →](https://confluon.com/?utm_source=itchio&utm_medium=referral&utm_campaign=field-current)**

Run Confluon here on itch.io, or open Field Current in its own full-screen browser
tab. Sound begins with your first click, touch, key press, or wheel gesture.

### Shape the field

- Move through the field and nearby organisms notice you.
- Press and drag to Gather, Orbit, or Divide matter.
- Double-click or double-tap to seed a new colony.
- Hold **S** to draw the system toward a quieter common state.
- Press **R** to reset and **Space** to pause.

Open the discreet control at the top left to tune ecology, flow, touch, halo,
memory, tone, population, and level. Try **Still Choir**, **Tidal Assembly**, and
**Ember Rift** as contrasting starting scores.

### Share the score

Every seed and performance setting is encoded in the URL. Copy the address after
shaping a field and someone else can open the same deterministic starting state.

The Rust/WASM simulation drives WebGPU visuals with a Canvas fallback and a
sample-free Web Audio instrument. Everything runs locally in the browser.

[How the field works](https://confluon.com/field?utm_source=itchio&utm_medium=referral&utm_campaign=field-current) ·
[How it becomes sound](https://confluon.com/sound?utm_source=itchio&utm_medium=referral&utm_campaign=field-current) ·
[Engineering](https://confluon.com/engineering?utm_source=itchio&utm_medium=referral&utm_campaign=field-current) ·
[Privacy](https://confluon.com/privacy?utm_source=itchio&utm_medium=referral&utm_campaign=field-current)

Confluon is an original instrument informed by the published Particle Lenia model.
It includes no upstream code, saved creatures, images, or audio assets.

## Listing artwork and theme

Upload these generated files:

| Use | File | Size |
| --- | --- | --- |
| Cover | `output/itch/confluon-cover.png` | 630 × 500 |
| Page background | `output/itch/confluon-page-background.png` | 1920 × 1200 |
| Screenshot | `output/itch/confluon-field.jpg` | 1600 × 900 |
| Screenshot | `output/itch/confluon-still-choir.png` | 1600 × 900 |
| Screenshot | `output/itch/confluon-tidal-assembly.png` | 1600 × 900 |
| Screenshot | `output/itch/confluon-ember-rift.png` | 1600 × 900 |

Use a fixed, non-repeating page background and the following theme values:

| Theme control | Value |
| --- | --- |
| Page background | `#030507` |
| Content background | `#081014` |
| Text | `#eee9df` |
| Links | `#76e6df` |
| Buttons | `#17363a` |
| Button text | `#f2eee5` |

Keep the project page single-column and restrained. The cover, screenshot, and live
embed carry the visual presentation; avoid decorative GIFs, emoji-heavy headings,
or unrelated badges.

## Draft QA and release checklist

- Build with `npm run build:itch`.
- Generate the three featured-score screenshots with `npm run capture:itch`.
- Run `npm run smoke:itch`.
- Confirm the archive checksum in `output/itch/manifest.json` before upload.
- Preview the draft in the signed-in creator browser; after publication approval,
  verify the public page once in an incognito browser.
- Launch the embed and confirm that the field fills the viewport.
- Confirm the first trusted gesture starts Web Audio.
- Select all three featured fields and change at least one performance control.
- Confirm the URL remains inside itch.io's uploaded project path.
- Open the standalone CTA and one article link; confirm the three campaign parameters.
- Check desktop and narrow mobile layouts.
- Confirm the project remains Draft after every edit and preview.
- Publish only after explicit human approval.

## Seven-day experiment

Start the observation window when the listing first becomes Public and close it
exactly 168 hours later. Do not run another acquisition campaign during the window.

Primary success criterion:

- at least 25 real-browser visits to Confluon; and
- at least five article visits beyond the instrument landing page.

Use Cloudflare Web Analytics visits and Sentry production sessions as the
real-browser signals, not raw zone requests. Attribute landings using the exact
`itchio / referral / field-current` campaign parameters and itch.io as the referring
site. Article paths are `/field`, `/sound`, `/engineering`, and `/privacy`.

Record itch.io page views and browser launches as diagnostic funnel steps. They are
useful for separating listing discovery from outbound conversion, but they do not
replace the primary Confluon-domain criterion.

At the end of the window, record:

| Metric | Result |
| --- | --- |
| itch.io listing views | |
| itch.io browser launches | |
| Confluon real-browser visits | |
| Confluon article visits | |
| Sentry production sessions | |
| Result | Pass / directional / no signal |

Treat 25 visits as a practical signal against the zero-traffic baseline, not as
statistical proof of durable channel fit.
