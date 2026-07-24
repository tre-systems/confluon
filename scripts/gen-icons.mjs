import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = process.cwd();
const checkMode = process.argv.includes("--check");
const targets = [
  ["icon.svg", "icon-192.png", 192, 192],
  ["icon.svg", "icon-512.png", 512, 512],
  ["icon.svg", "apple-touch-icon.png", 180, 180],
  ["icon-maskable.svg", "icon-maskable-512.png", 512, 512],
];

try {
  execFileSync("rsvg-convert", ["--version"], { stdio: "ignore" });
} catch {
  console.error("gen-icons: rsvg-convert is required (brew install librsvg)");
  process.exit(1);
}

if (checkMode) {
  const temporary = mkdtempSync(join(tmpdir(), "confluon-icons-"));
  try {
    renderTargets(temporary, true);
    const drifted = targets
      .map(([, output]) => output)
      .filter(
        (file) =>
          !sameFile(join(temporary, file), join(root, "public", "icons", file)),
      );
    if (drifted.length) {
      console.error("gen-icons: committed launcher assets are stale:");
      for (const file of drifted) console.error(`- public/icons/${file}`);
      console.error("Run `npm run icons` and commit the regenerated files.");
      process.exit(1);
    }
    console.log(`gen-icons: ${targets.length} launcher assets match their SVG sources`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  renderTargets(join(root, "public", "icons"), false);
}

function renderTargets(outputDirectory, quiet) {
  for (const [source, output, width, height] of targets) {
    const input = join(root, "public", "icons", source);
    if (!existsSync(input)) throw new Error(`gen-icons: missing ${input}`);
    const destination = join(outputDirectory, output);
    mkdirSync(dirname(destination), { recursive: true });
    execFileSync("rsvg-convert", [
      "-w",
      String(width),
      "-h",
      String(height),
      input,
      "-o",
      destination,
    ]);
    if (!quiet) console.log(`gen-icons: ${source} -> ${output} (${width}x${height})`);
  }
}

function sameFile(expected, actual) {
  return existsSync(actual) && readFileSync(expected).equals(readFileSync(actual));
}
