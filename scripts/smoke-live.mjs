import { spawnSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const target = "https://confluon.tre.systems/";
const maximumAttempts = 5;

for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
  const result = spawnSync(
    process.execPath,
    ["scripts/smoke.mjs", "--url", target],
    { stdio: "inherit" },
  );
  if (result.status === 0) process.exit(0);
  if (attempt === maximumAttempts) process.exit(result.status || 1);

  const delaySeconds = attempt * 5;
  console.warn(
    `smoke:live attempt ${attempt} failed; retrying after ${delaySeconds}s for edge propagation`,
  );
  await wait(delaySeconds * 1000);
}
