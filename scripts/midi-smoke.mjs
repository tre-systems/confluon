import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "./static-server.mjs";

export async function smokeMidi(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(mockMidi);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(
      new URL("/?seed=424242&renderer=canvas&life=600", baseUrl).href,
    );
    await page.waitForFunction(() => Boolean(window.confluon));
    assert.equal(await page.evaluate(() => window.testMidi.requests.length), 0);
    await page.click("#controls-toggle");
    await page.click(".midi-controls summary");
    await page.click("#midi-enable");
    assert.equal(await page.inputValue("#midi-launch"), "launch");
    assert.equal(await page.inputValue("#midi-touch"), "touch");
    assert.equal(await page.inputValue("#midi-output"), "feedback");
    assert.deepEqual(await page.evaluate(() => window.testMidi.requests), [
      { sysex: false },
    ]);
    await page.waitForFunction(() => window.testMidi.sent.length >= 12);

    const send = (id, cc, value) =>
      page.evaluate(
        ([id, cc, value]) => window.testMidi.send(id, cc, value),
        [id, cc, value],
      );
    await send("launch", 10, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.settings().tone),
      0.55,
    );
    assert.match(await page.textContent("#midi-status"), /pick up/);
    await send("launch", 10, 80);
    assert.ok(
      Math.abs(
        (await page.evaluate(() => window.confluon.settings().tone)) - 80 / 127,
      ) < 0.000001,
    );
    await page.waitForFunction(
      () => document.querySelector("#tone").value === "63",
    );
    await send("touch", 25, 25);
    await send("launch", 10, 79);
    assert.ok(
      Math.abs(
        (await page.evaluate(() => window.confluon.settings().tone)) - 25 / 127,
      ) < 0.000001,
    );
    await send("launch", 10, 25);
    await send("launch", 10, 30);
    assert.ok(
      Math.abs(
        (await page.evaluate(() => window.confluon.settings().tone)) - 30 / 127,
      ) < 0.000001,
    );

    await page.selectOption("#midi-encoders", "relative");
    await send("launch", 18, 65);
    const fineTone = await page.evaluate(() => window.confluon.settings().tone);
    assert.ok(Math.abs(fineTone - (30 / 127 + 1 / 508)) < 0.000001);
    await page.locator("#ecology").fill("130");
    assert.equal(
      await page.evaluate(() => window.confluon.settings().tone),
      fineTone,
    );
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get("ecology") === "130",
    );

    await send("launch", 38, 127);
    await send("launch", 38, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.gestureMode()),
      "orbit",
    );
    await send("touch", 83, 127);
    await page.evaluate(() => {
      for (const [cc, value] of [
        [16, 96],
        [48, 0],
        [17, 96],
        [49, 0],
        [82, 127],
      ])
        window.testMidi.send("touch", cc, value);
    });
    let interaction = await page.evaluate(() => window.confluon.interaction());
    assert.ok(
      interaction.active &&
        interaction.type === "touch" &&
        interaction.twist > 0,
    );
    assert.ok(Math.abs(interaction.x - ((12288 / 16383) * 2 - 1)) < 1e-8);
    assert.ok(
      Math.abs(interaction.y - (((12288 / 16383) * 2 - 1) * 800) / 1280) < 1e-8,
    );

    // Local press owns the gesture until release; remote movement/release cannot
    // move or release it, and a stale local release cannot cancel a new MIDI press.
    await page.mouse.move(500, 650);
    await page.mouse.down();
    await page.evaluate(() => {
      for (const [cc, value] of [
        [16, 120],
        [48, 0],
        [17, 120],
        [49, 0],
        [82, 0],
      ])
        window.testMidi.send("touch", cc, value);
    });
    interaction = await page.evaluate(() => window.confluon.interaction());
    assert.equal(interaction.active, true);
    assert.ok(interaction.x < 0);
    await send("touch", 82, 127);
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.confluon.interaction().active),
      true,
    );
    await send("touch", 82, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.interaction().active),
      false,
    );

    await send("launch", 43, 127);
    await send("touch", 43, 127);
    await send("launch", 43, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.transport().settle),
      true,
    );
    await send("touch", 43, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.transport().settle),
      false,
    );
    await send("touch", 43, 127);
    await send("touch", 82, 127);
    await page.waitForFunction(
      () =>
        !window.confluon.interaction().active &&
        !window.confluon.transport().settle,
      null,
      { timeout: 2500 },
    );

    await send("touch", 83, 127);
    await send("touch", 43, 127);
    await send("touch", 82, 127);
    await page.evaluate(() =>
      window.testMidi.connection("touch", "disconnected"),
    );
    assert.equal(
      await page.evaluate(() => window.confluon.interaction().active),
      false,
    );
    assert.equal(
      await page.evaluate(() => window.confluon.transport().settle),
      false,
    );
    await page.evaluate(() => window.testMidi.connection("touch", "connected"));
    assert.equal(await page.inputValue("#midi-touch"), "touch");

    await send("launch", 41, 127);
    await send("launch", 41, 127);
    await send("launch", 41, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.transport().running),
      false,
    );
    await send("launch", 116, 127);
    await send("launch", 116, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.transport().running),
      true,
    );
    const count = await page.evaluate(() => window.confluon.particleCount());
    await send("launch", 40, 127);
    await send("launch", 40, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.particleCount()),
      count + 50,
    );
    await send("launch", 42, 127);
    await send("launch", 42, 0);
    assert.equal(
      await page.evaluate(() => window.confluon.particleCount()),
      count,
    );

    await send("launch", 43, 127);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal(
      await page.evaluate(() => window.confluon.transport().settle),
      false,
    );
    await page.click("#controls-toggle");
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS" })),
    );
    await send("launch", 43, 127);
    assert.equal(
      await page.evaluate(() => window.confluon.transport().settle),
      true,
    );
    await page.click("#midi-release");
    assert.equal(
      await page.evaluate(() => window.confluon.transport().settle),
      false,
    );
    await page.click("#midi-enable");
    const before = await page.evaluate(() => window.confluon.settings().tone);
    await send("launch", 10, 127);
    assert.equal(
      await page.evaluate(() => window.confluon.settings().tone),
      before,
    );
    await page.reload();
    await page.waitForFunction(() => Boolean(window.confluon));
    assert.equal(await page.inputValue("#midi-encoders"), "relative");
    assert.equal(await page.evaluate(() => window.testMidi.requests.length), 0);

    const layout = await context.request.get(
      new URL("/controllers/confluon.tosc", baseUrl).href,
    );
    assert.equal(layout.status(), 200);
    assert.ok((await layout.body()).length > 1000);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }

  for (const available of [false, true]) {
    const context = await browser.newContext();
    try {
      await context.addInitScript(
        (available) =>
          Object.defineProperty(navigator, "requestMIDIAccess", {
            value: available
              ? async () => {
                  throw new DOMException("Denied", "NotAllowedError");
                }
              : undefined,
          }),
        available,
      );
      const page = await context.newPage();
      await page.goto(new URL("/?renderer=canvas&life=600", baseUrl).href);
      await page.waitForFunction(() => Boolean(window.confluon));
      await page.click("#controls-toggle");
      await page.click(".midi-controls summary");
      if (available) {
        await page.click("#midi-enable");
        assert.match(await page.textContent("#midi-status"), /not granted/);
      } else assert.equal(await page.isDisabled("#midi-enable"), true);
      assert.equal(
        await page.evaluate(() => window.confluon.particleCount()),
        600,
      );
    } finally {
      await context.close();
    }
  }
  console.log(
    "midi smoke: pickup, mixed input, relative encoders, feedback, XY, holds, disconnect/reconnect, transport, denied/unsupported MIDI healthy",
  );
}

function mockMidi() {
  const requests = [],
    sent = [];
  function input(id, name) {
    return {
      id,
      name,
      state: "connected",
      onmidimessage: null,
      close: async () => {},
    };
  }
  const inputs = new Map([
    ["daw", input("daw", "LCXL3 DAW")],
    ["launch", input("launch", "Launch Control XL 3 MIDI")],
    ["touch", input("touch", "TouchOSC Bridge")],
  ]);
  const access = {
    inputs,
    outputs: new Map([
      [
        "feedback",
        {
          id: "feedback",
          name: "TouchOSC Bridge",
          state: "connected",
          send: (data) => sent.push(data),
        },
      ],
    ]),
    onstatechange: null,
  };
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: async (options) => {
      requests.push(options);
      return access;
    },
    configurable: true,
  });
  window.testMidi = {
    requests,
    sent,
    send: (id, cc, value) =>
      inputs
        .get(id)
        .onmidimessage?.({
          data: new Uint8Array([id === "touch" ? 0xbe : 0xbf, cc, value]),
        }),
    connection: (id, state) => {
      inputs.get(id).state = state;
      access.onstatechange?.({ port: inputs.get(id) });
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
    await smokeMidi(browser, url);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
