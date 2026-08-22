import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(process.cwd());
const outputDir = join(root, "output", "itch");
const buildDir = join(outputDir, "build");
const archivePath = join(outputDir, "confluon-html5.zip");
const errors = [];

for (const path of [
  join(buildDir, "index.html"),
  join(buildDir, "assets"),
  archivePath,
  join(outputDir, "confluon-cover.png"),
  join(outputDir, "confluon-page-background.png"),
  join(outputDir, "confluon-field.jpg"),
  join(outputDir, "manifest.json"),
]) {
  if (!existsSync(path)) errors.push(`missing required artifact: ${path}`);
}

const index = readText(join(buildDir, "index.html"));
for (const token of [
  'data-distribution="itch"',
  "<title>Confluon — Field Current</title>",
  'id="standalone-link"',
  'src="./assets/',
  'href="./assets/',
]) {
  if (!index.includes(token)) errors.push(`index.html missing ${token}`);
}
for (const token of [
  "runtime-config.js",
  "telemetry.js",
  "pwa.js",
  'rel="manifest"',
  'src="/',
  'href="/',
  'value="/',
]) {
  if (index.includes(token)) errors.push(`index.html contains forbidden ${token}`);
}

if (existsSync(buildDir)) {
  for (const file of listFiles(buildDir)) {
    const relative = file.slice(buildDir.length + 1);
    if (relative.startsWith(".vite/") || file.endsWith(".map")) {
      errors.push(`development artifact present: ${relative}`);
    }
    if (![".css", ".html", ".js", ".wasm"].includes(extname(file))) {
      errors.push(`unexpected packaged file type: ${relative}`);
    }
  }
}

if (existsSync(archivePath)) {
  try {
    execFileSync("unzip", ["-tqq", archivePath]);
    const entries = execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" })
      .trim()
      .split("\n");
    if (entries[0] !== "index.html") errors.push("archive does not open with index.html at root");
    if (entries.some((entry) => entry.startsWith("build/") || entry.startsWith("/"))) {
      errors.push("archive contains a nested or absolute root");
    }
    if (!entries.some((entry) => entry.endsWith(".wasm"))) {
      errors.push("archive does not contain the WASM engine");
    }
    if (statSync(archivePath).size > 10 * 1024 * 1024) {
      errors.push("archive exceeds the 10 MiB performance budget");
    }
  } catch (error) {
    errors.push(`archive validation failed: ${error.message}`);
  }
}

await verifyImage("confluon-cover.png", 630, 500);
await verifyImage("confluon-page-background.png", 1920, 1200);
await verifyImage("confluon-field.jpg", 1600, 900, "jpeg");

try {
  const manifest = JSON.parse(readText(join(outputDir, "manifest.json")));
  if (manifest.format !== "confluon-itch-package-v1") {
    errors.push("manifest has the wrong format identifier");
  }
  for (const record of [
    manifest.archive,
    manifest.listingAssets?.cover,
    manifest.listingAssets?.background,
    manifest.listingAssets?.screenshot,
  ]) {
    if (!record?.file) {
      errors.push("manifest contains an incomplete file record");
      continue;
    }
    const path = join(outputDir, record.file);
    if (!existsSync(path)) {
      errors.push(`manifest references missing ${record.file}`);
      continue;
    }
    const bytes = readFileSync(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (record.bytes !== bytes.length || record.sha256 !== digest) {
      errors.push(`manifest checksum mismatch for ${record.file}`);
    }
  }
} catch (error) {
  errors.push(`manifest validation failed: ${error.message}`);
}

if (errors.length) {
  console.error("verify-itch-build failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("verify-itch-build: relative HTML5 package, checksums, and listing artwork verified");

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
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

async function verifyImage(file, width, height, format = "png") {
  const path = join(outputDir, file);
  if (!existsSync(path)) return;
  const metadata = await sharp(path).metadata();
  if (metadata.format !== format || metadata.width !== width || metadata.height !== height) {
    errors.push(
      `${file} is ${metadata.format} ${metadata.width}x${metadata.height}, expected ${format.toUpperCase()} ${width}x${height}`,
    );
  }
}
