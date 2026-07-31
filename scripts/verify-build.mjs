import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";

const outDir = resolve(process.cwd(), process.argv[2] || "dist");
const errors = [];
const requiredFiles = [
  "404.html",
  "_headers",
  "article.css",
  "article.js",
  "assets",
  "engineering.html",
  "field.html",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon.svg",
  "index.html",
  "og-card.png",
  "privacy.html",
  "pwa-update.js",
  "pwa.js",
  "robots.txt",
  "runtime-config.js",
  "site.webmanifest",
  "sitemap.xml",
  "sound.html",
  "sw.js",
  "telemetry.js",
];

if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
  console.error(`verify-build: deploy root does not exist: ${outDir}`);
  process.exit(1);
}

for (const file of requiredFiles) {
  if (!existsSync(join(outDir, file))) errors.push(`missing required artifact: ${file}`);
}

const textExtensions = new Set([".css", ".html", ".js", ".json", ".svg", ".txt", ".webmanifest", ".xml"]);
for (const file of listFiles(outDir)) {
  if (file.endsWith(".map")) errors.push(`public source map present: ${relative(file)}`);
  if (!textExtensions.has(extname(file))) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes("__CONFLUON_")) errors.push(`unstamped placeholder in ${relative(file)}`);
  if (/\bConfluence\b/i.test(text)) errors.push(`legacy name appears in ${relative(file)}`);
}

const index = readText("index.html");
const headers = readText("_headers");
const serviceWorker = readText("sw.js");
const pwa = readText("pwa.js");
const runtimeConfig = readText("runtime-config.js");
const manifest = readText("site.webmanifest");
const privacy = readText("privacy.html");

for (const token of [
  'rel="manifest"',
  'id="feedback-button"',
  "https://ko-fi.com/robgilks",
  'href="/privacy"',
  'src="/runtime-config.js"',
  'src="/pwa.js"',
]) {
  if (!index.includes(token)) errors.push(`index.html missing ${token}`);
}
for (const token of [
  "Content-Security-Policy:",
  "Strict-Transport-Security:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "X-Content-Type-Options: nosniff",
  "/sw.js",
]) {
  if (!headers.includes(token)) errors.push(`_headers missing ${token}`);
}
for (const token of ["CACHE_NAME", "SKIP_WAITING", '"/assets/', '"/privacy"']) {
  if (!serviceWorker.includes(token)) errors.push(`sw.js missing ${token}`);
}
for (const token of ["SERVICE_WORKER_URL", "SERVICE_WORKER_OPTIONS"]) {
  if (!pwa.includes(token)) errors.push(`pwa.js missing ${token}`);
}
if (pwa.includes("sw.js?v=")) errors.push("pwa.js gives the service worker an unstable URL");
for (const token of ["sentryDsn", "analyticsToken", "release"]) {
  if (!runtimeConfig.includes(token)) errors.push(`runtime-config.js missing ${token}`);
}
for (const token of ["Session replay is disabled", "does not use cookies", "Do Not Track"]) {
  if (!privacy.includes(token)) errors.push(`privacy.html missing ${token}`);
}

try {
  const parsed = JSON.parse(manifest);
  for (const size of ["192x192", "512x512"]) {
    if (!parsed.icons?.some((icon) => icon.sizes === size)) {
      errors.push(`site.webmanifest missing ${size} icon`);
    }
  }
} catch (error) {
  errors.push(`site.webmanifest is invalid JSON: ${error.message}`);
}
verifyPng("og-card.png", 1200, 630);
verifyPng("icons/apple-touch-icon.png", 180, 180);
verifyPng("icons/icon-192.png", 192, 192);
verifyPng("icons/icon-512.png", 512, 512);
verifyPng("icons/icon-maskable-512.png", 512, 512);

if (errors.length) {
  console.error("verify-build failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`verify-build: ${requiredFiles.length} production artifacts and policies verified`);

function readText(file) {
  const path = join(outDir, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function verifyPng(file, width, height) {
  const path = join(outDir, file);
  if (!existsSync(path)) return;
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    errors.push(`${file} is not a PNG`);
    return;
  }
  const actualWidth = bytes.readUInt32BE(16);
  const actualHeight = bytes.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    errors.push(`${file} is ${actualWidth}x${actualHeight}, expected ${width}x${height}`);
  }
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function relative(path) {
  return path.slice(outDir.length + 1);
}
