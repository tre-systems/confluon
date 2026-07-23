#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { flag, numberValue, run, value } from "./video-cli.mjs";

const FORMAT_PRESETS = Object.freeze({
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  "4k": { width: 3840, height: 2160 },
});

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
]);

function usage() {
  console.log(`Create synchronized, share-ready Confluon videos.

Usage:
  npm run video -- --seed 12345 --duration 30 --formats landscape,square,story

Options:
  --seed <N>             deterministic simulation/audio seed (default 1)
  --duration <seconds>   wall-clock capture duration (default 30)
  --formats <list>       landscape,square,portrait,story,4k or custom WxH
  --containers <list>    mp4,webm or both (default mp4)
  --fps <N>              capture frame rate (default 60)
  --codec <name>         h264, hevc, auto, or an ffmpeg encoder (default h264)
  --quality <N>          x264/x265 CRF value (default 18)
  --label <name>         output filename prefix
  --out-dir <path>       output directory (default renders/videos)
  --chrome <path>        Chrome/Chromium executable
  --no-build             use the existing dist/ directory
  --no-headless          show the capture browser
  --silent               omit the generated audio track
  --keep-source          retain the browser-recorded source WebM

Performance URL settings:
  --ecology --flow --touch --halo --memory --tone --level --life --mode

Examples:
  npm run video -- --seed 42 --duration 15 --formats square --containers mp4,webm
  npm run video -- --seed 42 --duration 60 --formats 4k --codec hevc
  npm run video -- --seed 42 --duration 20 --formats 1280x720 --silent
`);
}

function boundedNumber(name, fallback, minimum, maximum, integer = false) {
  const result = numberValue(name, fallback);
  if (result < minimum || result > maximum || (integer && !Number.isInteger(result))) {
    throw new Error(`${name} must be ${integer ? "an integer " : ""}between ${minimum} and ${maximum}`);
  }
  return result;
}

function parseFormats(raw) {
  const names = raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (names.length === 0) throw new Error("--formats must contain at least one format");
  return names.map((name) => {
    if (FORMAT_PRESETS[name]) return { name, ...FORMAT_PRESETS[name] };
    const match = /^(\d+)x(\d+)$/.exec(name);
    if (!match) {
      throw new Error(`Unknown video format "${name}"`);
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < 240 || height < 240 || width > 7680 || height > 7680) {
      throw new Error(`Custom format ${name} must be between 240x240 and 7680x7680`);
    }
    return { name, width, height };
  });
}

function parseContainers(raw) {
  const containers = [...new Set(raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (containers.length === 0 || containers.some((item) => !["mp4", "webm"].includes(item))) {
    throw new Error("--containers supports mp4 and webm");
  }
  return containers;
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function requireExecutable(command, args, hint) {
  if (!command) throw new Error(hint);
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.error || result.status !== 0) throw new Error(hint);
}

async function freePort() {
  const server = createTcpServer();
  server.unref();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!port) throw new Error("Could not allocate a local port");
  return port;
}

async function startStaticServer(directory) {
  const root = resolve(directory);
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end();
      return;
    }
    try {
      const url = new URL(request.url ?? "/", "http://capture.invalid");
      const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = resolve(root, pathname.replace(/^\/+/, ""));
      if (file !== root && !file.startsWith(root + sep)) throw new Error("Invalid path");
      const type = MIME_TYPES.get(extname(file)) ?? "application/octet-stream";
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": type,
      });
      if (request.method === "HEAD") {
        response.end();
      } else {
        createReadStream(file)
          .on("error", () => {
            if (!response.headersSent) response.writeHead(404);
            response.end();
          })
          .pipe(response);
      }
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function startChunkServer(directory) {
  let finish;
  const done = new Promise((resolveDone) => {
    finish = resolveDone;
  });
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://capture.invalid");
    if (url.searchParams.has("done")) {
      response.end("ok");
      finish();
      return;
    }
    const index = Number(url.searchParams.get("index"));
    if (request.method !== "POST" || !Number.isInteger(index) || index < 0) {
      response.writeHead(400);
      response.end("Invalid chunk");
      return;
    }
    const output = createWriteStream(join(directory, `${String(index).padStart(6, "0")}.part`));
    request.pipe(output);
    output.on("finish", () => response.end("ok"));
    output.on("error", (error) => {
      response.writeHead(500);
      response.end(error.message);
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return { server, done, url: `http://127.0.0.1:${address.port}/chunk` };
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", rejectOpen, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        console.error(
          "[browser]",
          details?.exception?.description ?? details?.text ?? "Uncaught exception",
        );
      } else if (message.method === "Runtime.consoleAPICalled") {
        const text = message.params.args
          .map((argument) => argument.value ?? argument.description ?? "")
          .join(" ");
        console.log(`[browser:${message.params.type}] ${text}`);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolvePending, rejectPending) => {
      this.pending.set(id, { resolve: resolvePending, reject: rejectPending });
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForJson(url, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Chrome has not opened its debugging endpoint yet.
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for Chrome at ${url}`);
}

async function evaluate(page, expression, timeout = 30_000) {
  let timer;
  try {
    const result = await Promise.race([
      page.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Browser evaluation timed out")), timeout);
      }),
    ]);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result?.value;
  } finally {
    clearTimeout(timer);
  }
}

function captureUrl(baseUrl, seed) {
  const url = new URL(baseUrl);
  url.searchParams.set("seed", String(seed));
  const options = {
    ecology: value("--ecology"),
    flow: value("--flow"),
    touch: value("--touch"),
    halo: value("--halo"),
    memory: value("--memory"),
    tone: value("--tone"),
    level: value("--level"),
    life: value("--life"),
    mode: value("--mode"),
  };
  for (const [key, option] of Object.entries(options)) {
    if (option != null) url.searchParams.set(key, option);
  }
  return url.toString();
}

async function appendChunks(directory, outputPath) {
  const files = readdirSync(directory).filter((file) => file.endsWith(".part")).sort();
  if (files.length === 0) throw new Error("MediaRecorder produced no video chunks");
  const output = createWriteStream(outputPath);
  for (const file of files) {
    if (!output.write(readFileSync(join(directory, file)))) {
      await new Promise((resolveDrain) => output.once("drain", resolveDrain));
    }
  }
  await new Promise((resolveEnd, rejectEnd) => {
    output.on("error", rejectEnd);
    output.end(resolveEnd);
  });
  return files.length;
}

function codecCandidates(requested) {
  const codec = requested.toLowerCase();
  if (codec === "auto") {
    return process.platform === "darwin" ? ["h264_videotoolbox", "libx264"] : ["libx264"];
  }
  if (codec === "h264") return ["libx264"];
  if (codec === "hevc" || codec === "h265") {
    return process.platform === "darwin" ? ["hevc_videotoolbox", "libx265"] : ["libx265"];
  }
  return [requested];
}

function encodeMp4(source, output, { codec, quality, fps, silent, width, height }) {
  const failures = [];
  for (const encoder of codecCandidates(codec)) {
    const hardware = encoder.includes("videotoolbox");
    const hevc = /hevc|h265|x265/i.test(encoder);
    const megapixels = (width * height) / 1_000_000;
    const bitrate = `${Math.max(8, Math.round(megapixels * fps * 0.12))}M`;
    const videoArgs = hardware
      ? ["-c:v", encoder, "-b:v", bitrate]
      : ["-c:v", encoder, "-preset", "medium", "-crf", String(hevc ? quality + 2 : quality)];
    const args = [
      "-hide_banner",
      "-y",
      "-fflags",
      "+genpts",
      "-i",
      source,
      "-map",
      "0:v:0",
      ...(silent ? [] : ["-map", "0:a:0?"]),
      "-vf",
      `fps=${fps},format=yuv420p`,
      ...videoArgs,
      ...(hevc ? ["-tag:v", "hvc1"] : []),
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      ...(silent ? ["-an"] : ["-c:a", "aac", "-b:a", "256k", "-ar", "48000"]),
      "-movflags",
      "+faststart",
      "-shortest",
      output,
    ];
    const result = run("ffmpeg", args, { allowFailure: true });
    if (!result.error && result.status === 0) return encoder;
    rmSync(output, { force: true });
    failures.push(`${encoder}: ${String(result.stderr ?? result.error?.message).trim().split("\n").slice(-2).join(" ")}`);
  }
  throw new Error(`MP4 encoding failed:\n${failures.join("\n")}`);
}

function encodeWebm(source, output) {
  run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-fflags",
    "+genpts",
    "-i",
    source,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    output,
  ]);
}

function inspectVideo(path, expected, silent) {
  const result = run("ffprobe", [
    "-hide_banner",
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height",
    "-of",
    "json",
    path,
  ]);
  const probe = JSON.parse(result.stdout);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  if (!video || video.width !== expected.width || video.height !== expected.height) {
    throw new Error(`Verification failed for ${path}: unexpected video dimensions`);
  }
  if (!silent && !audio) throw new Error(`Verification failed for ${path}: audio track is missing`);
  const duration = Number(probe.format.duration);
  if (!Number.isFinite(duration) || duration < expected.duration * 0.8) {
    throw new Error(`Verification failed for ${path}: duration is ${duration || "unknown"}s`);
  }
  return {
    audioCodec: audio?.codec_name ?? null,
    duration,
    videoCodec: video.codec_name,
  };
}

function sourceRevision() {
  const commit = run("git", ["rev-parse", "HEAD"], { allowFailure: true });
  const changes = run(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { allowFailure: true },
  );
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    trackedChanges: changes.status === 0 ? Boolean(changes.stdout.trim()) : null,
  };
}

async function recordFormat(options, format, baseUrl) {
  const artifactName = `${options.label}-${format.name}`;
  const previewPath = join(options.outDir, `${artifactName}-preview.png`);
  const manifestPath = join(options.outDir, `${artifactName}.json`);
  const sourcePath = join(options.outDir, `${artifactName}-source.webm`);
  const temporary = mkdtempSync(join(tmpdir(), "geno5-video-"));
  const chunks = join(temporary, "chunks");
  const profile = join(temporary, "profile");
  mkdirSync(chunks);
  mkdirSync(profile);

  const { server: chunkServer, done, url: chunkUrl } = await startChunkServer(chunks);
  const debugPort = await freePort();
  const chromeArgs = [
    `--remote-debugging-port=${debugPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--hide-scrollbars",
    `--window-size=${format.width},${format.height}`,
  ];
  if (options.headless) chromeArgs.push("--headless=new");
  chromeArgs.push("about:blank");

  const chrome = spawn(options.chrome, chromeArgs, { stdio: "ignore" });
  const chromeExited = new Promise((resolveExit) => {
    chrome.once("exit", resolveExit);
  });
  let page;
  let browser;
  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    browser = new Cdp(version.webSocketDebuggerUrl);
    await browser.open();
    const target = await browser.send("Target.createTarget", { url: "about:blank" });
    const tabs = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const tab = tabs.find((candidate) => candidate.id === target.targetId);
    if (!tab) throw new Error("Could not find the Chrome capture tab");
    page = new Cdp(tab.webSocketDebuggerUrl);
    await page.open();
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: format.width,
      height: format.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: format.width,
      screenHeight: format.height,
    });
    await page.send("Page.navigate", { url: captureUrl(baseUrl, options.seed) });

    const prepared = await evaluate(
      page,
      `(async () => {
        const started = performance.now();
        while (!window.geno5 && performance.now() - started < 30000) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!window.geno5) throw new Error("Geno-5 did not become ready");
        const style = document.createElement("style");
        style.textContent = "#welcome,#controls,#gesture-hint,#runtime-status{display:none!important}#instrument{min-height:0!important}body{cursor:none!important;overflow:hidden!important}";
        document.head.appendChild(style);
        const result = await window.geno5.prepareCapture();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const canvas = document.getElementById("field");
        return {...result, width: canvas.width, height: canvas.height};
      })()`,
      45_000,
    );
    if (prepared.renderer !== "WEBGPU") {
      throw new Error(`Production capture requires WebGPU; browser selected ${prepared.renderer}`);
    }
    if (prepared.width !== format.width || prepared.height !== format.height) {
      throw new Error(
        `Canvas size ${prepared.width}x${prepared.height} did not match ${format.width}x${format.height}`,
      );
    }

    const screenshot = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    writeFileSync(previewPath, Buffer.from(screenshot.data, "base64"));

    const result = await evaluate(
      page,
      `window.__geno5Capture = (async () => {
        const canvas = document.getElementById("field");
        const video = canvas.captureStream(${options.fps});
        const audio = window.geno5.captureAudioStream();
        if (!${options.silent} && !audio?.getAudioTracks().length) {
          throw new Error("The mastered audio capture stream is unavailable");
        }
        if (!${options.silent}) {
          for (const track of audio.getAudioTracks()) video.addTrack(track);
        }
        const mimeType = [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm;codecs=vp9",
          "video/webm"
        ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
        if (!mimeType) throw new Error("No WebM MediaRecorder codec is available");
        const recorder = new MediaRecorder(video, {
          mimeType,
          videoBitsPerSecond: ${options.captureBitrate}
        });
        let index = 0;
        const uploads = [];
        const samples = [];
        const timer = setInterval(() => {
          const fps = window.geno5.fps();
          if (fps > 0) samples.push(fps);
        }, 500);
        recorder.ondataavailable = (event) => {
          if (event.data?.size) {
            const current = index++;
            uploads.push(fetch(${JSON.stringify(chunkUrl)} + "?index=" + current, {
              method: "POST",
              body: event.data
            }));
          }
        };
        const stopped = new Promise((resolve, reject) => {
          recorder.onerror = () => reject(recorder.error || new Error("MediaRecorder failed"));
          recorder.onstop = async () => {
            try {
              clearInterval(timer);
              const responses = await Promise.all(uploads);
              if (responses.some((response) => !response.ok)) {
                throw new Error("The local chunk receiver rejected a video chunk");
              }
              const finished = await fetch(${JSON.stringify(chunkUrl)} + "?done=1", {
                method: "POST",
                body: new Blob()
              });
              if (!finished.ok) throw new Error("The local chunk receiver did not finish");
              const steady = samples.length > 2 ? samples.slice(2) : samples;
              resolve({
                chunks: index,
                fpsAverage: steady.length
                  ? steady.reduce((sum, sample) => sum + sample, 0) / steady.length
                  : 0,
                fpsMinimum: steady.length ? Math.min(...steady) : 0,
                mimeType,
                audioTracks: video.getAudioTracks().length
              });
            } catch (error) {
              reject(error);
            }
          };
        });
        recorder.start(1000);
        window.geno5.beginCapture();
        setTimeout(() => recorder.stop(), ${Math.round(options.duration * 1000)});
        return await stopped;
      })()`,
      Math.ceil(options.duration * 1000) + 60_000,
    );
    await done;
    if (!result.chunks) throw new Error("Capture completed without any MediaRecorder chunks");
    const chunkCount = await appendChunks(chunks, sourcePath);
    const artifacts = {};
    const probes = {};

    if (options.containers.includes("webm")) {
      const output = join(options.outDir, `${artifactName}.webm`);
      encodeWebm(sourcePath, output);
      artifacts.webm = output;
      probes.webm = inspectVideo(output, { ...format, duration: options.duration }, options.silent);
    }
    if (options.containers.includes("mp4")) {
      const output = join(options.outDir, `${artifactName}.mp4`);
      const encoder = encodeMp4(sourcePath, output, { ...options, ...format });
      artifacts.mp4 = output;
      probes.mp4 = {
        ...inspectVideo(output, { ...format, duration: options.duration }, options.silent),
        encoder,
      };
    }
    if (options.keepSource) artifacts.source = sourcePath;

    const manifest = {
      capturedAt: new Date().toISOString(),
      duration: options.duration,
      format,
      fps: options.fps,
      frameRate: {
        average: result.fpsAverage,
        minimum: result.fpsMinimum,
      },
      seed: options.seed,
      sourceUrl: captureUrl(baseUrl, options.seed),
      settings: prepared.settings,
      particles: prepared.particles,
      renderer: prepared.renderer,
      sourceRevision: options.sourceRevision,
      audio: !options.silent,
      browserMimeType: result.mimeType,
      chunks: chunkCount,
      artifacts: Object.fromEntries(
        Object.entries(artifacts).map(([key, path]) => [key, path.split(sep).at(-1)]),
      ),
      probes,
      preview: previewPath.split(sep).at(-1),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const cadence = result.fpsAverage > 0
      ? `${result.fpsAverage.toFixed(1)} fps avg`
      : "cadence unavailable (short capture)";
    console.log(`✓ ${format.name}: ${format.width}x${format.height}, ${cadence}`);
    if (result.fpsMinimum > 0 && result.fpsMinimum < options.fps * 0.85) {
      console.warn(
        `  ⚠ render cadence fell to ${result.fpsMinimum.toFixed(1)} fps; reduce resolution, life, or target fps`,
      );
    }
    for (const output of Object.values(artifacts)) {
      console.log(`  ${output} (${(statSync(output).size / 1_000_000).toFixed(1)} MB)`);
    }
    console.log(`  ${manifestPath}`);
  } finally {
    page?.close();
    browser?.close();
    await new Promise((resolveClose) => chunkServer.close(resolveClose));
    chrome.kill("SIGTERM");
    await Promise.race([chromeExited, delay(3000)]);
    if (!options.keepSource) rmSync(sourcePath, { force: true });
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (flag("--help")) {
  usage();
  process.exit(0);
}

const seed = boundedNumber("--seed", 1, 1, 0xffff_ffff, true);
const duration = boundedNumber("--duration", 30, 0.5, 86_400);
const fps = boundedNumber("--fps", 60, 1, 120, true);
const quality = boundedNumber("--quality", 18, 0, 51, true);
const formats = parseFormats(value("--formats", "landscape"));
const containers = parseContainers(value("--containers", "mp4"));
const outDir = resolve(value("--out-dir", "renders/videos"));
const defaultLabel = `confluon-${seed.toString(16).toUpperCase().padStart(8, "0")}`;
const label = value("--label", defaultLabel);
if (!/^[a-z0-9_.-]+$/i.test(label)) {
  throw new Error("--label may contain only letters, numbers, dots, dashes, and underscores");
}
const chrome = value("--chrome") || findChrome();
requireExecutable(
  chrome,
  ["--version"],
  "Chrome/Chromium is required; install it, set CHROME, or pass --chrome",
);
requireExecutable("ffmpeg", ["-version"], "ffmpeg is required (macOS: brew install ffmpeg)");
requireExecutable("ffprobe", ["-version"], "ffprobe is required (macOS: brew install ffmpeg)");

if (!flag("--no-build")) {
  console.log("● Building Geno-5…");
  run("npm", ["run", "build"], { inherit: true });
}
if (!existsSync("dist/index.html")) {
  throw new Error("dist/index.html is missing; run without --no-build");
}

const options = {
  captureBitrate: boundedNumber("--bitrate", 36_000_000, 1_000_000, 200_000_000, true),
  chrome,
  codec: value("--codec", "h264"),
  containers,
  duration,
  fps,
  headless: !flag("--no-headless"),
  keepSource: flag("--keep-source"),
  label,
  outDir,
  quality,
  seed,
  silent: flag("--silent"),
  sourceRevision: sourceRevision(),
};

mkdirSync(outDir, { recursive: true });
const { server: staticServer, url } = await startStaticServer("dist");
try {
  console.log(`● Capturing seed ${seed} for ${duration}s in ${formats.length} format(s)…`);
  for (const format of formats) {
    await recordFormat(options, format, url);
  }
  console.log("✓ Video production complete");
} finally {
  staticServer.close();
}
