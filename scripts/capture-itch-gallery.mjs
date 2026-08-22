import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startStaticServer } from "./static-server.mjs";

const outputDir = resolve("output", "itch");
const server = await startStaticServer(outputDir);
const scores = [
  {
    file: "confluon-still-choir.png",
    name: "Still Choir",
    query:
      "seed=424242&ecology=72&flow=70&touch=88&halo=110&memory=64&tone=38&level=74&life=1600&mode=gather",
  },
  {
    file: "confluon-tidal-assembly.png",
    name: "Tidal Assembly",
    query:
      "seed=3950471578&ecology=104&flow=90&touch=100&halo=118&memory=56&tone=55&level=74&life=2000&mode=orbit",
  },
  {
    file: "confluon-ember-rift.png",
    name: "Ember Rift",
    query:
      "seed=153812312&ecology=145&flow=118&touch=118&halo=95&memory=36&tone=72&level=72&life=2600&mode=divide",
  },
];

mkdirSync(outputDir, { recursive: true });
let browser;
const captures = [];
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });

  for (const score of scores) {
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    const url = new URL(`build/index.html?${score.query}&renderer=canvas`, server.url).href;
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) throw new Error(`${score.name} returned ${response?.status()}`);
    await page.waitForFunction(() => Boolean(window.confluon), null, { timeout: 30_000 });
    await page.waitForTimeout(7_000);
    await page.addStyleTag({
      content: ".controls,.pwa-update{display:none!important}",
    });
    const renderer = await page.evaluate(() => window.confluon.renderer());
    const path = join(outputDir, score.file);
    await page.screenshot({ path, type: "png" });
    if (runtimeErrors.length) {
      throw new Error(
        `${score.name} browser errors:\n${runtimeErrors.map((item) => `- ${item}`).join("\n")}`,
      );
    }
    captures.push({ file: score.file, name: score.name, renderer });
    await page.close();
  }

  writeFileSync(
    join(outputDir, "gallery.json"),
    `${JSON.stringify({ format: "confluon-itch-gallery-v1", captures }, null, 2)}\n`,
  );
  console.log(
    `capture-itch-gallery: ${captures.map((capture) => `${capture.name} (${capture.renderer.toLowerCase()})`).join(", ")}`,
  );
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.server.close(resolveClose));
}
