import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const outDir = resolve(root, "dist");
const manifestPath = join(outDir, ".vite", "manifest.json");
const serviceWorkerPath = join(outDir, "sw.js");

if (!existsSync(manifestPath)) throw new Error("finalize-build: Vite manifest is missing");
if (!existsSync(serviceWorkerPath)) throw new Error("finalize-build: service worker is missing");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entry = Object.values(manifest).find((record) => record.isEntry);
if (!entry) throw new Error("finalize-build: Vite entry is missing");

const hash = createHash("sha256");
for (const file of listFiles(outDir).filter((file) => !file.includes("/.vite/")).sort()) {
  if (file.endsWith("/runtime-config.js") || file.endsWith("/build-meta.js") || file.endsWith("/sw.js")) {
    continue;
  }
  hash.update(file.slice(outDir.length));
  hash.update(readFileSync(file));
}
const buildId = hash.digest("hex").slice(0, 16);
const release =
  process.env.SENTRY_RELEASE ||
  process.env.GITHUB_SHA ||
  readGitRevision() ||
  buildId;
const environment = process.env.SENTRY_ENVIRONMENT || "production";
const configuredTraceRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
const sentryTracesSampleRate =
  Number.isFinite(configuredTraceRate) &&
  configuredTraceRate >= 0 &&
  configuredTraceRate <= 1
    ? configuredTraceRate
    : 0.05;

const runtimeConfig = {
  sentryDsn: process.env.SENTRY_DSN || "",
  sentryTracesSampleRate,
  analyticsToken:
    process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN ||
    process.env.CF_WEB_ANALYTICS_TOKEN ||
    "",
  environment,
  release,
};
const serializedConfig = JSON.stringify(runtimeConfig, null, 2).replaceAll("<", "\\u003c");
writeFileSync(
  join(outDir, "runtime-config.js"),
  `window.CONFLUON_RUNTIME_CONFIG = Object.freeze(${serializedConfig});\n`,
);
writeFileSync(join(outDir, "build-meta.js"), `export const BUILD_ID = ${JSON.stringify(buildId)};\n`);

const precache = new Set([
  "/",
  "/article.css",
  "/article.js",
  "/build-meta.js",
  "/engineering",
  "/field",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/icon.svg",
  "/privacy",
  "/pwa-update.js",
  "/pwa.js",
  "/runtime-config.js",
  "/site.webmanifest",
  "/sound",
  "/telemetry.js",
]);
collectEntryFiles(entry, manifest, precache);

const serviceWorker = readFileSync(serviceWorkerPath, "utf8")
  .replace("__CONFLUON_BUILD__", buildId)
  .replace("__CONFLUON_PRECACHE__", JSON.stringify([...precache].sort(), null, 2));
if (serviceWorker.includes("__CONFLUON_")) {
  throw new Error("finalize-build: service worker placeholders remain");
}
writeFileSync(serviceWorkerPath, serviceWorker);
rmSync(join(outDir, ".vite"), { recursive: true, force: true });

console.log(
  `finalize-build: release ${release.slice(0, 12)}, build ${buildId}, ${precache.size} precached URLs`,
);

function collectEntryFiles(record, records, output, visited = new Set()) {
  if (!record || visited.has(record.file)) return;
  visited.add(record.file);
  if (record.file) output.add(`/${record.file}`);
  for (const file of record.css || []) output.add(`/${file}`);
  for (const file of record.assets || []) output.add(`/${file}`);
  for (const imported of record.imports || []) {
    collectEntryFiles(records[imported], records, output, visited);
  }
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile() && statSync(path).isFile()) files.push(path);
  }
  return files;
}

function readGitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
