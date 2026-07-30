import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const checkMode = process.argv.includes("--check");
const ledgerPath = join(root, "assets", "icons.generated.json");
const targets = [
  ["icons/icon.svg", "icons/icon-192.png", 192, 192],
  ["icons/icon.svg", "icons/icon-512.png", 512, 512],
  ["icons/icon.svg", "icons/apple-touch-icon.png", 180, 180],
  ["icons/icon-maskable.svg", "icons/icon-maskable-512.png", 512, 512],
  ["og-card.svg", "og-card.png", 1200, 630],
];

if (checkMode) {
  const errors = [];
  const ledger = existsSync(ledgerPath)
    ? JSON.parse(readFileSync(ledgerPath, "utf8"))
    : { icons: [] };
  for (const [source, output, width, height] of targets) {
    const sourcePath = join(root, "public", source);
    const outputPath = join(root, "public", output);
    const record = ledger.icons.find((icon) => icon.output === output);
    if (!record) {
      errors.push(`missing generation record for ${output}`);
      continue;
    }
    if (record.source !== source || record.width !== width || record.height !== height) {
      errors.push(`generation record does not match ${output}`);
    }
    if (record.sourceSha256 !== digest(sourcePath)) errors.push(`${source} changed`);
    if (record.outputSha256 !== digest(outputPath)) errors.push(`${output} changed`);
    const metadata = await sharp(outputPath).metadata();
    if (metadata.width !== width || metadata.height !== height) {
      errors.push(`${output} is ${metadata.width}x${metadata.height}, expected ${width}x${height}`);
    }
  }
  if (errors.length) {
    console.error("gen-icons: committed launcher assets are stale:");
    for (const error of errors) console.error(`- ${error}`);
    console.error("Run `npm run icons` and commit the regenerated files.");
    process.exit(1);
  }
  console.log(`gen-icons: ${targets.length} brand assets match their SVG sources`);
} else {
  await renderTargets(join(root, "public"), false);
  const ledger = {
    icons: targets.map(([source, output, width, height]) => ({
      source,
      output,
      width,
      height,
      sourceSha256: digest(join(root, "public", source)),
      outputSha256: digest(join(root, "public", output)),
    })),
  };
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

async function renderTargets(outputDirectory, quiet) {
  for (const [source, output, width, height] of targets) {
    const input = join(root, "public", source);
    if (!existsSync(input)) throw new Error(`gen-icons: missing ${input}`);
    const destination = join(outputDirectory, output);
    mkdirSync(dirname(destination), { recursive: true });
    await sharp(input).resize(width, height).png({ compressionLevel: 9 }).toFile(destination);
    if (!quiet) console.log(`gen-icons: ${source} -> ${output} (${width}x${height})`);
  }
}

function digest(path) {
  if (!existsSync(path)) return "";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
