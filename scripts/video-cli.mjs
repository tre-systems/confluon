import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

export function flag(name) {
  return args.includes(name);
}

export function value(name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const result = args[index + 1];
  if (result == null || result.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return result;
}

export function numberValue(name, fallback) {
  const raw = value(name);
  if (raw == null) return fallback;
  const result = Number(raw);
  if (!Number.isFinite(result)) throw new Error(`${name} must be a number`);
  return result;
}

export function run(command, commandArgs, { inherit = false, allowFailure = false } = {}) {
  const options = inherit
    ? { stdio: "inherit" }
    : { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const result = spawnSync(command, commandArgs, options);
  if (!allowFailure && (result.error || result.status !== 0)) {
    if (!inherit) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    const detail = result.error?.message ?? `status ${result.status}`;
    throw new Error(`${command} ${commandArgs.join(" ")} failed (${detail})`);
  }
  return result;
}
