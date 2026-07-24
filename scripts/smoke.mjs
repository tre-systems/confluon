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
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`root returned ${response?.status()}`);
  await page.waitForFunction(() => Boolean(window.geno5), null, { timeout: 30_000 });
  await page.waitForTimeout(750);

  const initial = await page.evaluate(() => ({
    title: document.title,
    renderer: window.geno5.renderer(),
    particles: window.geno5.particleCount(),
    canvasWidth: document.querySelector("#field")?.width || 0,
    canvasHeight: document.querySelector("#field")?.height || 0,
    feedbackHidden: document.querySelector("#feedback-button")?.hidden,
    supportHref: document.querySelector(".panel-support a")?.href,
    manifestHref: document.querySelector('link[rel="manifest"]')?.href,
  }));
  if (initial.title !== "Confluon") throw new Error(`unexpected title: ${initial.title}`);
  if (!["WEBGPU", "CANVAS 2D"].includes(initial.renderer)) {
    throw new Error(`unexpected renderer: ${initial.renderer}`);
  }
  if (initial.particles < 600 || initial.canvasWidth === 0 || initial.canvasHeight === 0) {
    throw new Error(`instrument is not drawing: ${JSON.stringify(initial)}`);
  }
  if (!initial.supportHref?.startsWith("https://ko-fi.com/robgilks")) {
    throw new Error("Ko-fi support link is missing");
  }
  if (!initial.manifestHref?.endsWith("/site.webmanifest")) {
    throw new Error("PWA manifest link is missing");
  }

  await page.click("#begin");
  await page.waitForFunction(
    () => ["running", "suspended"].includes(window.geno5.audioState()),
    null,
    { timeout: 15_000 },
  );
  await page.click("#controls-toggle");
  await page.waitForTimeout(500);

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
  await context.setOffline(true);
  const offlineResponse = await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.geno5), null, { timeout: 20_000 });
  if (!offlineResponse?.ok()) throw new Error("offline app shell did not load");
  await context.setOffline(false);

  const ignoredErrors = browserErrors.filter(
    (message) =>
      !/Failed to load resource: the server responded with a status of 404/i.test(message),
  );
  if (ignoredErrors.length) {
    throw new Error(`browser runtime errors:\n${ignoredErrors.map((item) => `- ${item}`).join("\n")}`);
  }

  console.log(
    `smoke: ${initial.renderer.toLowerCase()}, ${initial.particles} particles, audio started, offline PWA/privacy/404 healthy`,
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
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
