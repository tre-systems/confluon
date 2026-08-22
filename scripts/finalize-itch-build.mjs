import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(process.cwd());
const outputDir = join(root, "output", "itch");
const buildDir = join(outputDir, "build");
const marketingDir = join(root, "marketing", "itch");
const archivePath = join(outputDir, "confluon-html5.zip");
const coverPath = join(outputDir, "confluon-cover.png");
const backgroundPath = join(outputDir, "confluon-page-background.png");
const screenshotPath = join(outputDir, "confluon-field.jpg");

for (const path of [
  join(buildDir, "index.html"),
  join(marketingDir, "cover.svg"),
  join(marketingDir, "page-background.svg"),
  join(root, "screenshot.png"),
]) {
  if (!existsSync(path)) throw new Error(`finalize-itch-build: missing ${path}`);
}

mkdirSync(outputDir, { recursive: true });
rmSync(join(buildDir, ".vite"), { recursive: true, force: true });

await Promise.all([
  sharp(join(marketingDir, "cover.svg")).png({ compressionLevel: 9 }).toFile(coverPath),
  sharp(join(marketingDir, "page-background.svg"))
    .png({ compressionLevel: 9 })
    .toFile(backgroundPath),
  sharp(join(root, "screenshot.png"))
    .resize(1600, 900, { fit: "cover" })
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(screenshotPath),
]);

rmSync(archivePath, { force: true });
execFileSync("zip", ["-X", "-q", "-r", archivePath, "index.html", "assets"], {
  cwd: buildDir,
});
execFileSync("unzip", ["-tqq", archivePath]);

const manifest = {
  format: "confluon-itch-package-v1",
  revision: readRevision(),
  archive: fileRecord(archivePath),
  listingAssets: {
    cover: fileRecord(coverPath),
    background: fileRecord(backgroundPath),
    screenshot: fileRecord(screenshotPath),
  },
};
writeFileSync(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `finalize-itch-build: ${formatBytes(manifest.archive.bytes)} HTML5 archive and polished listing assets prepared`,
);

function fileRecord(path) {
  const bytes = readFileSync(path);
  return {
    file: path.slice(outputDir.length + 1),
    bytes: statSync(path).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function readRevision() {
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

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`;
}
