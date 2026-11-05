import { XL3, xl3Pairs } from "./xl3.js";
import { controllerPanel } from "./controller-panel.js";
import {
  controllerBindings,
  CONFLUON_XL3_LAYOUT,
} from "./controller-bindings.js";
import { ViewFeedback } from "./view-feedback.js";

export function createXL3Surface({
  root,
  settings,
  parameter,
  transport,
  play,
  arm,
  gesture,
  settle,
  seed,
  pause,
  reset,
  field,
  release,
  close,
  standard,
}) {
  let access,
    connecting = false,
    generation = 0;
  let holding = false;
  const point = { x: 0.5, y: 0.5 };
  const bindings = controllerBindings({
    settings,
    setParameter: parameter,
    point: () => point,
    setPoint(axis, value) {
      point[axis] = value;
      if (holding) gesture({ ...point, active: true, pressed: false });
    },
  });
  const preview = document.createElement("canvas");
  preview.className = "xl3-preview";
  preview.width = 240;
  preview.height = 150;
  preview.setAttribute("aria-label", "Live field preview");
  const previewContext = preview.getContext("2d");
  let previewAt = -Infinity;
  const paint = new ViewFeedback(() => panel.refresh());
  const driver = new XL3({
    ...bindings,
    change(slot, value) {
      if (!document.hidden) {
        bindings.change(slot, value);
        invalidate();
      }
    },
    action(cc, shift) {
      if (!document.hidden) action(cc, shift, true);
    },
    feedback(event) {
      if (event.buttonsReset) releaseHolds(true);
      if (event.button !== undefined) {
        panel.press(event.button, event.down);
        if (!event.down && [40, 41].includes(event.button))
          action(event.button, false, false);
      }
      if (event.slot !== undefined)
        panel.focus(
          event.slot,
          event.reason ||
            (event.picked === false
              ? `Move fader ${event.direction} to pick up`
              : undefined),
        );
      if (event.mode !== undefined)
        panel.message(
          event.active ? "DAW Control ready" : "Select DAW Control on the XL3",
        );
      paint.schedule();
    },
  });
  const panel = controllerPanel(root, {
    ...bindings,
    change(slot, value) {
      bindings.change(slot, value);
      invalidate();
    },
    action,
    connect,
    disconnect,
    layout: CONFLUON_XL3_LAYOUT,
    onClose: close,
    preview,
  });

  function action(cc, shift = false, down = true) {
    if (cc === 40) {
      holding = down;
      gesture({ ...point, active: down, pressed: down });
    } else if (cc === 41) settle(down);
    else if (!down) return;
    else if (cc === 116) void play();
    else if (cc === 104) close();
    else if (cc === 106 || cc === 107) panel.row(cc === 106 ? -1 : 1);
    else if (cc >= 37 && cc <= 39)
      gesture(null, ["gather", "orbit", "divide"][cc - 37]);
    else if (cc === 42) seed(point);
    else if (cc === 43) pause();
    else if (cc === 44) {
      if (shift) reset();
      else panel.message("Hold Shift to reset the field");
    } else if (cc >= 45 && cc <= 47) field(cc - 44);
    else if (cc === 48) release();
    else if (cc >= 49 && cc <= 51) panel.focus([29, 24, 27][cc - 49]);
    else if (cc === 52) standard();
    invalidate();
  }
  function releaseHolds(resetButtons = false) {
    if (holding) gesture({ ...point, active: false, pressed: false });
    holding = false;
    settle(false);
    driver.pickup.clear();
    if (resetButtons) {
      driver.down.clear();
      driver.shift = false;
      panel.resetPresses();
    }
    invalidate();
  }
  async function connect() {
    if (connecting) return;
    if (!navigator.requestMIDIAccess) {
      panel.message("Web MIDI needs Chrome or Edge on this computer");
      return;
    }
    connecting = true;
    panel.connecting(true);
    const attempt = ++generation;
    try {
      // Unlock audio in this click, before asking for MIDI permission. Arming a
      // stopped instrument is silent; it does not load or reset a score.
      const armed = arm();
      const [nextAccess] = await Promise.all([
        navigator.requestMIDIAccess({ sysex: false }),
        armed,
      ]);
      if (attempt !== generation) return;
      access?.removeEventListener("statechange", connectionChanged);
      access = nextAccess;
      access.addEventListener("statechange", connectionChanged);
      const pairs = xl3Pairs(access);
      if (pairs.length !== 1) {
        disconnect();
        panel.message(
          pairs.length
            ? "Connect one XL3 at a time"
            : "No XL3 DAW port found. Connect it by USB, then retry.",
        );
        return;
      }
      if ((await driver.connect(pairs[0])) && attempt === generation) {
        panel.connected(pairs[0].input.name);
        panel.message("Ready · Play starts; press again to fade");
        invalidate();
      }
    } catch (error) {
      if (attempt !== generation) return;
      disconnect();
      panel.message(
        error.name === "NotAllowedError"
          ? "MIDI permission not granted"
          : "Connection failed. Check audio permission and USB, then retry.",
      );
    } finally {
      connecting = false;
      panel.connecting(false);
    }
  }
  function connectionChanged() {
    if (
      driver.input &&
      (driver.input.state !== "connected" ||
        driver.output?.state !== "connected")
    ) {
      disconnect();
      panel.message("XL3 disconnected · reconnect when ready");
    }
  }
  function disconnect() {
    generation++;
    access?.removeEventListener("statechange", connectionChanged);
    access = null;
    driver.disconnect();
    panel.connected(null);
  }
  function invalidate() {
    const state = transport();
    const playing = state.started && state.running;
    panel.setKey(116, {
      pressed: playing,
      label: state.ending ? "Fading…" : playing ? "↘" : "▶",
      disabled: state.ending || state.starting,
    });
    panel.setKey(43, { pressed: state.started && !state.running });
    panel.setKey(40, { pressed: holding });
    panel.setKey(41, { pressed: state.settle });
    for (let i = 0; i < 3; i++) {
      const active = settings().mode === ["gather", "orbit", "divide"][i];
      panel.setKey(37 + i, { pressed: active });
      driver.led(37 + i, active ? 21 : 1);
    }
    driver.led(116, playing ? 21 : 1);
    driver.led(40, holding ? 21 : 1);
    driver.led(41, state.settle ? 21 : 1);
    for (const [, cc] of CONFLUON_XL3_LAYOUT.buttons)
      if (![37, 38, 39, 40, 41, 116].includes(cc)) driver.led(cc, 1);
    driver.sync();
    paint.schedule();
  }
  function drawPreview(canvases, time) {
    if (!panel.open || time - previewAt < 1000 / 20) return;
    previewAt = time;
    previewContext.fillStyle = "#05070a";
    previewContext.fillRect(0, 0, preview.width, preview.height);
    for (const canvas of canvases) {
      if (
        !canvas ||
        canvas.style.display === "none" ||
        !canvas.width ||
        !canvas.height
      )
        continue;
      const scale = Math.min(
        preview.width / canvas.width,
        preview.height / canvas.height,
      );
      const w = canvas.width * scale,
        h = canvas.height * scale;
      previewContext.drawImage(
        canvas,
        (preview.width - w) / 2,
        (preview.height - h) / 2,
        w,
        h,
      );
    }
  }
  return {
    panel,
    invalidate,
    disconnect,
    releaseHolds,
    drawPreview,
    get connected() {
      return !!driver.input;
    },
  };
}
