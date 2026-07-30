import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const options = parseArguments(process.argv.slice(2));
let server;
let baseUrl = options.url;

if (!baseUrl) {
  ({ server, url: baseUrl } = await startStaticServer(options.dir || "dist"));
}

const browserErrors = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let page = await context.newPage();
  watchPage(page, browserErrors);

  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`root returned ${response?.status()}`);
  await page.waitForFunction(() => Boolean(window.confluon), null, { timeout: 30_000 });
  await page.waitForTimeout(750);

  const initial = await page.evaluate(() => ({
    title: document.title,
    renderer: window.confluon.renderer(),
    particles: window.confluon.particleCount(),
    canvasWidth: document.querySelector("#field")?.width || 0,
    canvasHeight: document.querySelector("#field")?.height || 0,
    feedbackHidden: document.querySelector("#feedback-button")?.hidden,
    supportHref: document.querySelector(".panel-support a")?.href,
    manifestHref: document.querySelector('link[rel="manifest"]')?.href,
    marketingOverlay: Boolean(document.querySelector("#welcome, #gesture-hint")),
    controlsCollapsed: document.querySelector("#controls")?.classList.contains("collapsed"),
  }));
  if (initial.title !== "Confluon") throw new Error(`unexpected title: ${initial.title}`);
  if (!["WEBGPU", "CANVAS"].includes(initial.renderer)) {
    throw new Error(`unexpected renderer: ${initial.renderer}`);
  }
  if (initial.particles !== 2000 || initial.canvasWidth === 0 || initial.canvasHeight === 0) {
    throw new Error(`instrument is not drawing: ${JSON.stringify(initial)}`);
  }
  if (!initial.supportHref?.startsWith("https://ko-fi.com/robgilks")) {
    throw new Error("Ko-fi support link is missing");
  }
  if (!initial.manifestHref?.endsWith("/site.webmanifest")) {
    throw new Error("PWA manifest link is missing");
  }
  if (initial.marketingOverlay || !initial.controlsCollapsed) {
    throw new Error(`instrument did not open directly onto the field: ${JSON.stringify(initial)}`);
  }

  await page.mouse.click(640, 400);
  await page.waitForFunction(
    () => ["running", "suspended"].includes(window.confluon.audioState()),
    null,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(750);

  await page.mouse.move(1120, 650);
  await page.mouse.move(180, 130);
  const fastHover = await page.evaluate(() => window.confluon.interaction());
  if (!fastHover.present || !fastHover.influencing || fastHover.strength >= 0) {
    throw new Error(`fast hover did not alarm the field: ${JSON.stringify(fastHover)}`);
  }

  await page.mouse.move(640, 400);
  await page.mouse.down();
  const poke = await page.evaluate(() => window.confluon.interaction());
  await page.waitForTimeout(40);
  const audiblePoke = await page.evaluate(() => window.confluon.audioResponse().interaction);
  await page.mouse.up();
  await page.waitForTimeout(45);
  const releasedPoke = await page.evaluate(() => window.confluon.interaction());
  // Slower CI runners may advance one or two fixed steps before evaluate()
  // returns. The envelope should still be active and decisively repulsive.
  if (!poke.active || poke.impulse < 0.5 || poke.strength >= -0.5) {
    throw new Error(`pointer poke did not startle the field: ${JSON.stringify(poke)}`);
  }
  if (!releasedPoke.influencing || releasedPoke.impulse <= 0) {
    throw new Error(`pointer poke vanished on release: ${JSON.stringify(releasedPoke)}`);
  }
  if (!audiblePoke.influencing || Math.abs(audiblePoke.strength) < 0.1) {
    throw new Error(`pointer poke did not reach audio: ${JSON.stringify(audiblePoke)}`);
  }

  const touchClient = await context.newCDPSession(page);
  await touchClient.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const touchTap = async (id) => {
    await touchClient.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 900, y: 560, radiusX: 8, radiusY: 8, force: 1, id }],
    });
    await page.waitForTimeout(35);
    await touchClient.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const beforeDoubleTap = await page.evaluate(() => window.confluon.particleCount());
  await touchTap(1);
  await page.waitForTimeout(120);
  await touchTap(2);
  await page.waitForTimeout(120);
  const afterDoubleTap = await page.evaluate(() => window.confluon.particleCount());
  if (afterDoubleTap !== beforeDoubleTap + 50) {
    throw new Error(
      `native double-tap seeded ${afterDoubleTap - beforeDoubleTap} particles, expected 50`,
    );
  }

  await page.click("#controls-toggle");
  await page.waitForTimeout(500);
  const audibleControl = await page.evaluate(() => {
    const tuning = document.querySelector(".tuning");
    const halo = document.querySelector("#glow");
    tuning.open = true;
    halo.value = "140";
    halo.dispatchEvent(new Event("input", { bubbles: true }));
    return window.confluon.audioResponse();
  });
  if (
    audibleControl.performance.glow !== 1.4 ||
    audibleControl.lastControlCue?.kind !== "glow"
  ) {
    throw new Error(`Halo did not reach audio: ${JSON.stringify(audibleControl)}`);
  }

  const manifestResponse = await context.request.get(new URL("/site.webmanifest", baseUrl).href);
  if (!manifestResponse.ok()) throw new Error(`manifest returned ${manifestResponse.status()}`);
  const manifest = await manifestResponse.json();
  if (manifest.name?.startsWith("Confluon") !== true || manifest.icons?.length < 3) {
    throw new Error("manifest metadata is incomplete");
  }

  const privacyResponse = await context.request.get(new URL("/privacy", baseUrl).href);
  if (!privacyResponse.ok()) throw new Error(`privacy route returned ${privacyResponse.status()}`);
  const missingResponse = await context.request.get(
    new URL(`/smoke-missing-${Date.now()}`, baseUrl).href,
  );
  if (missingResponse.status() !== 404) {
    throw new Error(`missing route returned ${missingResponse.status()}, expected 404`);
  }

  if (options.url) {
    const headers = response.headers();
    for (const header of ["content-security-policy", "strict-transport-security", "x-content-type-options"]) {
      if (!headers[header]) throw new Error(`production response missing ${header}`);
    }
  }

  const serviceWorkerState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolveController, rejectController) => {
        const timeout = window.setTimeout(
          () => rejectController(new Error("service worker did not claim the page")),
          10_000,
        );
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            window.clearTimeout(timeout);
            resolveController();
          },
          { once: true },
        );
      });
    }
    return registration.active?.state || "missing";
  });
  if (serviceWorkerState !== "activated") {
    throw new Error(`service worker is ${serviceWorkerState}`);
  }

  await page.close();
  page = await context.newPage();
  watchPage(page, browserErrors);
  await page.goto(new URL("/?renderer=canvas-locked&seed=424242", baseUrl).href, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => Boolean(window.confluon), null, { timeout: 20_000 });
  const fallbackRenderer = await page.evaluate(() => window.confluon.renderer());
  if (fallbackRenderer !== "CANVAS") {
    throw new Error(`Canvas fallback returned ${fallbackRenderer}`);
  }

  await context.setOffline(true);
  const offlineShell = await page.evaluate(async () => {
    const response = await fetch("/", { cache: "reload" });
    return {
      ok: response.ok,
      containsInstrument: (await response.text()).includes('id="instrument"'),
    };
  });
  if (!offlineShell.ok || !offlineShell.containsInstrument) {
    throw new Error("service worker did not serve the cached app shell offline");
  }
  await context.setOffline(false);

  const ignoredErrors = browserErrors.filter(
    (message) =>
      !/Failed to load resource: the server responded with a status of 404/i.test(message),
  );
  if (ignoredErrors.length) {
    throw new Error(`browser runtime errors:\n${ignoredErrors.map((item) => `- ${item}`).join("\n")}`);
  }

  console.log(
    `smoke: ${initial.renderer.toLowerCase()}, Canvas fallback, ${initial.particles} particles, direct field opening, pointer/audio response, 50-particle double-tap, musical controls, offline PWA/privacy/404 healthy`,
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
}

function watchPage(page, browserErrors) {
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--url") parsed.url = args[++index];
    else if (args[index] === "--dir") parsed.dir = args[++index];
  }
  if (parsed.url) parsed.url = new URL(parsed.url).href;
  return parsed;
}

async function startStaticServer(directory) {
  const root = resolve(process.cwd(), directory);
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const cleanRoutes = new Map([
      ["/", "index.html"],
      ["/field", "field.html"],
      ["/sound", "sound.html"],
      ["/engineering", "engineering.html"],
      ["/privacy", "privacy.html"],
    ]);
    const requested = cleanRoutes.get(url.pathname) || url.pathname.slice(1);
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    let path = join(root, safePath);
    let status = 200;
    try {
      if (!statSync(path).isFile()) throw new Error("not a file");
    } catch {
      path = join(root, "404.html");
      status = 404;
    }
    const content = readFileSync(path);
    response.writeHead(status, {
      "Content-Type": mimeType(path),
      "Cache-Control": "no-cache",
    });
    response.end(content);
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

function mimeType(path) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".wasm": "application/wasm",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".xml": "application/xml; charset=utf-8",
    }[extname(path)] || "application/octet-stream"
  );
}
