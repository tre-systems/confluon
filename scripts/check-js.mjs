import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

const roots = ["web", "public", "scripts"];
const files = ["vite.config.js", "worker.js"];

for (const root of roots) collect(root, files);
const modules = files
  .filter((file) => [".js", ".mjs"].includes(extname(file)))
  .sort();
for (const file of modules) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`check-js: ${modules.length} JavaScript modules parsed`);

function collect(dir, output) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, output);
    else if (entry.isFile()) output.push(path);
  }
}
