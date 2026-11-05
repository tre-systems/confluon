import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "./static-server.mjs";

export async function smokeXL3(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(mockXL3);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const send = (status, cc, value) =>
    page.evaluate((args) => window.testXL3.send(...args), [status, cc, value]);
  const settings = () => page.evaluate(() => window.confluon.settings());
  const state = () => page.evaluate(() => window.confluon.transport());
  const button = (cc) => page.locator(`#xl3-panel button[data-cc="${cc}"]`);
  try {
    await page.goto(
      new URL("/?controller=1&seed=424242&renderer=canvas&life=600", baseUrl)
        .href,
    );
    await page.waitForFunction(() => Boolean(window.confluon));
    const original = await settings();
    assert.equal(await page.evaluate(() => window.testXL3.requests.length), 0);
    assert.equal((await state()).started, false);
    assert.equal(await page.locator(".xl3-knob").count(), 24);
    assert.equal(await page.locator(".xl3-fader").count(), 8);
    assert.equal(await page.locator(".xl3-cell input:enabled").count(), 9);
    assert.equal(await page.isVisible(".xl3-preview"), true);
    await page.click("#xl3-panel [data-connect]");
    await page.waitForFunction(() =>
      document.querySelector("#xl3-connection").textContent.includes("DAW"),
    );
    assert.deepEqual(await settings(), original);
    assert.equal((await state()).running, false);
    assert.deepEqual(await page.evaluate(() => window.testXL3.requests), [
      { sysex: false },
    ]);
    await send(0xbf, 77, 65);
    assert.ok((await settings()).tone > original.tone);
    await page.waitForFunction(
      () => document.querySelector("#tone").value === "56",
    );
    await send(0xbf, 12, 0);
    assert.equal((await settings()).level, original.level);
    await send(0xbf, 12, 100);
    assert.ok(Math.abs((await settings()).level - 100 / 127) < 1e-6);
    await send(0xbf, 5, 127);
    assert.equal((await settings()).ecology, original.ecology);
    await send(0xb0, 38, 127);
    await send(0xb0, 38, 0);
    assert.equal((await settings()).mode, "orbit");
    await send(0xb0, 40, 127);
    assert.equal(
      await page.evaluate(() => window.confluon.interaction().active),
      true,
    );
    await send(0xbf, 88, 80);
    assert.ok((await page.evaluate(() => window.confluon.interaction().x)) > 0);
    await send(0xb0, 40, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.interaction().active),
      false,
    );
    await button(41).focus();
    await page.keyboard.down("Space");
    assert.equal((await state()).settle, true);
    await page.keyboard.up("Space");
    assert.equal((await state()).settle, false);
    await send(0xb0, 41, 127);
    assert.equal((await state()).settle, true);
    await send(0xb6, 30, 29);
    assert.equal((await state()).settle, false);
    const beforeInactive = await settings();
    await send(0xbf, 77, 65);
    assert.deepEqual(await settings(), beforeInactive);
    await send(0xb6, 30, 2);
    await send(0xb0, 41, 127);
    assert.equal((await state()).settle, true);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal((await state()).settle, false);
    await send(0xb0, 41, 0);
    await send(0xb0, 116, 127);
    await send(0xb0, 116, 127);
    await send(0xb0, 116, 0);
    await page.waitForFunction(() => window.confluon.transport().running);
    assert.equal((await state()).ending, false);
    await page.waitForTimeout(500);
    await send(0xb0, 116, 127);
    await send(0xb0, 116, 0);
    assert.equal((await state()).ending, true);
    await send(0xb0, 116, 127);
    await send(0xb0, 116, 0);
    assert.equal((await state()).ending, true);
    await send(0xbf, 12, 110);
    await page.waitForFunction(
      () => !window.confluon.transport().ending,
      null,
      { timeout: 12000 },
    );
    assert.equal((await state()).running, false);
    await page.waitForTimeout(300);
    assert.ok(
      (await page.evaluate(() => window.confluon.audioMeter().rms)) < 0.00001,
    );
    // UI switching, hiding and idle connection feedback never change the score.
    const preserved = await settings();
    await page.click('#xl3-panel [data-interface="controls"]');
    await page.click('#controls-body [data-interface="xl3"]');
    assert.deepEqual(await settings(), preserved);
    await button(104).click();
    assert.equal(await page.isVisible("#xl3-panel"), false);
    await send(0xbf, 77, 65);
    assert.ok((await settings()).tone > preserved.tone);
    await page.click("#controls-toggle");
    await send(0xb0, 40, 127);
    await send(0xb0, 41, 127);
    await page.evaluate(() => window.testXL3.unplug());
    assert.equal((await state()).settle, false);
    assert.equal(
      await page.evaluate(() => window.confluon.interaction().active),
      false,
    );
    assert.equal(await page.textContent("#xl3-connection"), "Not connected");
    // Existing featured field values and six-decimal URL scores survive both layouts.
    await page.click('#xl3-panel [data-interface="controls"]');
    await page.selectOption("#field-score", { label: "Still Choir" });
    const score = await settings();
    assert.equal(score.ecology, 0.72);
    assert.equal(score.glow, 1.1);
    assert.equal(score.population, 1600);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.confluon));
    assert.deepEqual(await settings(), score);
    await page.click("#controls-toggle");
    await page.click('#controls-body [data-interface="xl3"]');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.ok(
      await page
        .locator(".xl3-scroll")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    );
    assert.equal(await page.isVisible("#xl3-panel [data-close]"), true);
    assert.deepEqual(errors, []);
    console.log(
      "XL3 smoke: silent arm, relative knobs, pickup, holds, transport/fade, disconnect, hidden panel, mobile and preset preservation pass",
    );
  } finally {
    await context.close();
  }
}

function mockXL3() {
  const sent = [],
    requests = [];
  const port = (id, name) => ({
    id,
    name,
    state: "connected",
    onmidimessage: null,
    open: async () => {},
    close: async () => {},
    send: (data) => sent.push([...data]),
  });
  const input = port("xl3-in", "LCXL3 1 DAW Out"),
    output = port("xl3-out", "LCXL3 1 DAW In");
  const access = new EventTarget();
  access.inputs = new Map([[input.id, input]]);
  access.outputs = new Map([[output.id, output]]);
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: async (options) => {
      requests.push(options);
      return access;
    },
    configurable: true,
  });
  window.testXL3 = {
    sent,
    requests,
    send: (...data) => input.onmidimessage?.({ data: new Uint8Array(data) }),
    unplug() {
      input.state = "disconnected";
      access.dispatchEvent(new Event("statechange"));
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { server, url } = await startStaticServer("dist", {
    cleanRoutes: { "/": "index.html" },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    await smokeXL3(browser, url);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
