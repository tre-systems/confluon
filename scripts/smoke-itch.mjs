import { createServer } from "node:http";
import { chromium } from "playwright";
import { startStaticServer } from "./static-server.mjs";

const buildServer = await startStaticServer("output/itch");
const instrumentUrl = new URL(
  "build/index.html?seed=424242&renderer=canvas",
  buildServer.url,
).href;
const embedServer = createEmbedServer(instrumentUrl);
let browser;

try {
  const embedUrl = await listen(embedServer);
  browser = await chromium.launch({
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  const response = await page.goto(embedUrl, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`embed returned ${response?.status()}`);
  let frame;
  for (let attempt = 0; attempt < 50 && !frame; attempt += 1) {
    frame = page.frames().find((candidate) => candidate.url().includes("/build/index.html"));
    if (!frame) await page.waitForTimeout(100);
  }
  if (!frame) throw new Error("cross-origin instrument iframe did not load");
  await frame.waitForFunction(() => Boolean(window.confluon), null, { timeout: 30_000 });
  await frame.waitForTimeout(500);

  const initial = await frame.evaluate(() => {
    const field = document.querySelector("#field");
    const rect = field.getBoundingClientRect();
    return {
      distribution: window.confluon.distribution,
      renderer: window.confluon.renderer(),
      particles: window.confluon.particleCount(),
      title: document.title,
      standaloneLink: Boolean(document.querySelector("#standalone-link")),
      docLinks: Array.from(document.querySelectorAll(".article-link"), (link) => link.href),
      rootRelativeResources: Array.from(document.querySelectorAll("[src], [href]"))
        .map((element) => element.getAttribute("src") || element.getAttribute("href"))
        .filter((value) => value?.startsWith("/")),
      manifest: Boolean(document.querySelector('link[rel="manifest"]')),
      viewportGaps: {
        top: rect.top,
        left: rect.left,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
      },
    };
  });

  if (
    initial.distribution !== "itch" ||
    initial.renderer !== "CANVAS" ||
    initial.particles !== 2000 ||
    initial.title !== "Confluon — Field Current"
  ) {
    throw new Error(`itch runtime contract failed: ${JSON.stringify(initial)}`);
  }
  if (
    initial.standaloneLink ||
    initial.docLinks.length !== 4 ||
    !initial.docLinks.every(hasCampaign)
  ) {
    throw new Error(`itch acquisition links failed: ${JSON.stringify(initial)}`);
  }
  if (
    initial.manifest ||
    initial.rootRelativeResources.length ||
    Object.values(initial.viewportGaps).some((gap) => Math.abs(gap) > 1)
  ) {
    throw new Error(`itch embed packaging failed: ${JSON.stringify(initial)}`);
  }

  await frame.locator("#field").click({ position: { x: 640, y: 400 } });
  await frame.waitForFunction(
    () => ["running", "suspended"].includes(window.confluon.audioState()),
    null,
    { timeout: 15_000 },
  );
  await frame.locator("#controls-toggle").click();
  await frame.locator("#field-score").selectOption({ label: "Ember Rift" });
  await frame.waitForFunction(() => window.confluon.seed() === 153812312);
  const featured = await frame.evaluate(() => ({
    path: window.location.pathname,
    seed: window.confluon.seed(),
    particles: window.confluon.particleCount(),
    mode: window.confluon.gestureMode(),
  }));
  if (
    !featured.path.endsWith("/build/index.html") ||
    featured.seed !== 153812312 ||
    featured.particles !== 2600 ||
    featured.mode !== "divide"
  ) {
    throw new Error(`featured field escaped the itch subdirectory: ${JSON.stringify(featured)}`);
  }

  await page.setViewportSize({ width: 390, height: 700 });
  await frame.waitForFunction(() => {
    const rect = document.querySelector("#field")?.getBoundingClientRect();
    return rect && Math.abs(window.innerHeight - rect.bottom) <= 1;
  });
  const mobile = await frame.evaluate(() => {
    const rect = document.querySelector("#field").getBoundingClientRect();
    return {
      gaps: {
        top: rect.top,
        left: rect.left,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
      },
    };
  });
  if (Object.values(mobile.gaps).some((gap) => Math.abs(gap) > 1)) {
    throw new Error(`mobile itch embed failed: ${JSON.stringify(mobile)}`);
  }

  if (runtimeErrors.length) {
    throw new Error(`browser runtime errors:\n${runtimeErrors.map((item) => `- ${item}`).join("\n")}`);
  }
  console.log(
    "smoke-itch: cross-origin iframe, relative assets/WASM, Canvas, Web Audio, featured scores, article campaign links, button-free field, and responsive viewport verified",
  );
} finally {
  await browser?.close();
  await close(embedServer);
  await close(buildServer.server);
}

function hasCampaign(value) {
  const url = new URL(value);
  return (
    url.origin === "https://confluon.com" &&
    url.searchParams.get("utm_source") === "itchio" &&
    url.searchParams.get("utm_medium") === "referral" &&
    url.searchParams.get("utm_campaign") === "field-current"
  );
}

function createEmbedServer(src) {
  return createServer((_request, response) => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#05070a}</style></head><body><iframe title="Confluon itch preview" allow="autoplay; fullscreen" src="${src}"></iframe></body></html>`;
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
    });
    response.end(html);
  });
}

async function listen(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("embed server did not bind");
  return `http://localhost:${address.port}/`;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolveClose) => server.close(resolveClose));
}
