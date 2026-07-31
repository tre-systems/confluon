# Confluon Video Production

The local video pipeline turns a deterministic Confluon seed and its performance
settings into synchronized, share-ready video. It records the WebGPU canvas and the
post-limiter Web Audio master on one browser clock, then verifies every output with
`ffprobe`.

## Quick start

```sh
npm run video -- --seed 12345 --duration 30
```

The default creates a 1920×1080 H.264/AAC MP4 in `renders/videos/`. Every capture
also writes:

- a PNG preview of its first frame;
- a JSON manifest containing the seed, settings, source revision, resolution,
  browser and platform, measured render cadence, browser recording codec, final
  stream codecs, canonical performance URL, and verified duration.

`renders/` is ignored by git. Renders are production artifacts, not source files.

## Social formats

Several output shapes can be generated in one command:

```sh
npm run video -- \
  --seed 12345 \
  --duration 30 \
  --formats landscape,square,portrait,story
```

| Name | Size | Typical use |
| --- | ---: | --- |
| `landscape` | 1920×1080 | YouTube and general playback |
| `square` | 1080×1080 | Square social posts |
| `portrait` | 1080×1350 | 4:5 social feeds |
| `story` | 1080×1920 | 9:16 stories and short-form video |
| `4k` | 3840×2160 | 4K landscape master |

Custom sizes use `WIDTHxHEIGHT`, for example `--formats 2560x1440`.

Each shape is a fresh run from the same seed and settings. Production is real-time:
four 30-second formats take roughly two minutes to capture, plus encoding time.

## Containers and codecs

MP4 is the default because H.264 video with AAC audio has the broadest sharing
compatibility:

```sh
npm run video -- --seed 42 --duration 20 --containers mp4
```

Create both a shareable MP4 and a high-quality VP9/Opus WebM:

```sh
npm run video -- \
  --seed 42 \
  --duration 20 \
  --formats landscape,square \
  --containers mp4,webm
```

Use HEVC inside MP4 for a smaller high-resolution master:

```sh
npm run video -- --seed 42 --duration 60 --formats 4k --codec hevc
```

`--codec auto` prefers macOS VideoToolbox H.264 when available and falls back to
software x264. `--quality` controls the CRF used by software H.264/H.265 encoders;
lower values retain more detail and create larger files. The default is 18.

## Performance settings

The capture command accepts the same values stored in a performance URL:

```sh
npm run video -- \
  --seed 12345 \
  --duration 45 \
  --formats story \
  --ecology 118 \
  --flow 90 \
  --halo 112 \
  --memory 68 \
  --tone 58 \
  --level 74 \
  --life 3000 \
  --mode gather
```

Supported flags are `--ecology`, `--flow`, `--touch`, `--halo`, `--memory`,
`--tone`, `--level`, `--life`, and `--mode`. The generated manifest stores the
canonical performance URL and the decoded settings.

The production run starts from a clean reset and contains no pointer gestures.
Use the same engine revision, seed, duration, settings, format, frame rate, browser,
platform, and comparable render cadence to reproduce it. WebGPU timing and
floating-point behaviour can vary across machines, so retain the source revision
and manifest with release masters.

## Options

```text
--fps 60
--label confluon-release-01
--out-dir renders/videos
--bitrate 36000000
--quality 18
--silent
--keep-source
--canonical-url https://example.org/
--no-build
--no-headless
--chrome /path/to/Chrome
```

`--silent` omits audio. `--keep-source` retains the browser-recorded WebM before
transcoding. Forks can use `--canonical-url` so the manifest points to their public
instrument rather than confluon.com. `--no-build` is only safe when `dist/` already
represents the source revision you intend to render.

## Requirements and limits

- Node.js 22+, the normal Rust/WASM toolchain, and project dependencies.
- Chrome or Chromium with WebGPU support.
- `ffmpeg` and `ffprobe` on `PATH` (`brew install ffmpeg` on macOS).
- Enough disk space for the chosen duration, resolution, and retained formats.

The browser capture is real-time rather than an offline frame renderer. The current
pipeline is intended for deterministic unperformed fields; a future take exporter
can add a recorded gesture stream without changing the manifest or transcoding
contract.
