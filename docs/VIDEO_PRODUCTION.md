# Confluon Video Production

The local video pipeline turns a deterministic Confluon seed and its performance
settings into synchronized video. It records the WebGPU canvas and the post-limiter
Web Audio master on one browser clock, then verifies every output with `ffprobe`.

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

## Lossless audio source

For a release candidate, capture PCM audio alongside the image:

```sh
npm run video -- --seed 153812312 --duration 15 --formats landscape \
  --lossless-audio --label pcm-check-01
```

Qualify a short test before increasing duration. `--lossless-audio` requires MP4
delivery (or `--source-only`) and cannot be combined with `--silent`. It selects
VP9/PCM or VP8/PCM from
the browser's supported recorder types and fails if neither is available. It does
not fall back to Opus or change the synthesis graph.

One MediaRecorder receives the canvas and existing post-limiter audio tap. The
helper remuxes that recording into a retained `-source.mkv`, extracts a `.wav` by
stream copy, and produces the H.264/AAC `.mp4` from the same combined source. PCM
uses Matroska rather than the restricted WebM container. The WAV retains the
recorded sample rate and PCM format; it is an unedited source, not an approved
release master. The MP4 remains a lossy delivery file.

When the take needs editing or mastering, add `--source-only` to keep the combined
PCM/VP9 source, WAV, preview and manifest without first encoding an unused MP4.
Encode the finished film once from that source. `--source-only` requires
`--lossless-audio` and cannot be combined with `--containers`.

The manifest records source and WAV stream metadata, file SHA-256 hashes and a
decoded float32 audio hash that must match between source and WAV. Validation
requires one stereo PCM stream at 44.1 kHz or higher, duration within 150 ms of the
request and source audio/video start timestamps within 50 ms. The WAV begins at
its first audio sample; use the recorded start offset when aligning it separately
to picture. These checks do not prove gap-free playback, musical quality or
sample-accurate audiovisual synchronization. Inspect packet timing, listen through
the take and review the film before release.

Output names must be unused. Capture failures preserve partial artifacts and print
the temporary chunk directory for diagnosis; they do not delete the failed take.
Keep accepted masters, sources and manifests on the audio workspace and include
them in its backup plan. Preparation does not itself create a backup or publish.

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

MP4 is the default because H.264 video with AAC audio has broad playback support:

```sh
npm run video -- --seed 42 --duration 20 --containers mp4
```

Create both an H.264/AAC MP4 and a high-quality VP9/Opus WebM:

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
--lossless-audio
--canonical-url https://example.org/
--no-build
--no-headless
--chrome /path/to/Chrome
```

`--silent` omits audio. `--keep-source` retains the default browser-recorded WebM before
transcoding. Forks can use `--canonical-url` so the manifest points to their public
instrument rather than confluon.com. `--no-build` is only safe when `dist/` was built
from the source revision you intend to render.

## Requirements and limits

- Node.js 22+, the normal Rust/WASM toolchain, and project dependencies.
- Chrome or Chromium with WebGPU support.
- `ffmpeg` and `ffprobe` on `PATH` (`brew install ffmpeg` on macOS).
- Enough disk space for the chosen duration, resolution, and retained formats.

The browser capture is real-time rather than an offline frame renderer. The current
pipeline is intended for deterministic unperformed fields; a future take exporter
can add a recorded gesture stream without changing the manifest or transcoding
contract.
