import { test } from "node:test";
import assert from "node:assert/strict";
import { XL3, xl3Pairs, transportIntent } from "../web/xl3.js";
import {
  controllerBindings,
  XL3_PARAMETERS,
  CONFLUON_XL3_LAYOUT,
} from "../web/controller-bindings.js";
import { parsePerformanceSettings } from "../web/performance-state.js";

function rig() {
  const values = Array(32).fill(0.5),
    changes = [],
    actions = [],
    feedback = [],
    sent = [];
  const input = { state: "connected", open: async () => {} },
    output = {
      state: "connected",
      open: async () => {},
      send: (b) => sent.push(b),
    };
  const c = new XL3({
    read: (slot) => ({ position: values[slot] }),
    change: (slot, v) => {
      values[slot] = v;
      changes.push([slot, v]);
    },
    action: (...a) => actions.push(a),
    feedback: (e) => feedback.push(e),
  });
  return { c, values, changes, actions, feedback, sent, input, output };
}
test("XL3 claims only one matching named DAW input/output pair", () => {
  const port = (name, state = "connected") => ({ name, state });
  const access = {
    inputs: new Map([
      [1, port("LCXL3 1 MIDI Out")],
      [2, port("LCXL3 1 DAW Out")],
      [3, port("Other DAW Out")],
    ]),
    outputs: new Map([
      [1, port("LCXL3 1 DAW In")],
      [2, port("Other DAW In")],
    ]),
  };
  assert.equal(xl3Pairs(access).length, 1);
  assert.equal(xl3Pairs(access)[0].input.name, "LCXL3 1 DAW Out");
  access.outputs.set(3, port("LCXL3 1 DAW Out"));
  assert.equal(xl3Pairs(access).length, 0);
});
test("DAW setup is volatile, all 24 encoders respond, wrong channels and echoes do not", async () => {
  const r = rig();
  await r.c.connect(r);
  assert.ok(r.sent.some((m) => String(m) === "159,12,127"));
  for (let slot = 0; slot < 24; slot++) r.c.receive([0xbf, 77 + slot, 65]);
  assert.equal(r.changes.length, 24);
  assert.ok(r.values.slice(0, 24).every((v) => v > 0.5));
  for (const msg of [
    [0xbe, 77, 65],
    [0xbf, 13, 127],
    [0xbf, 77, 64],
    [0xbf, 77, 128],
    [0xbf, 77, -1],
    [0xbf, 77, 2.5],
    [0xbf, 77, 65, 1],
  ])
    r.c.receive(msg);
  assert.equal(r.changes.length, 24);
  assert.ok(r.sent.every((m) => m.length === 3 && m[0] !== 0xf0));
  r.c.disconnect();
  assert.deepEqual(r.sent.at(-1), [0x9f, 12, 0]);
  assert.equal(r.input.onmidimessage, null);
});
test("physical faders keep pickup after relative knob movement or scene changes", async () => {
  const r = rig();
  await r.c.connect(r);
  r.c.receive([0xbf, 5, 0]);
  assert.equal(r.changes.length, 0);
  r.c.receive([0xbf, 5, 70]);
  assert.equal(r.changes.length, 1);
  r.values[24] = 0.2;
  r.c.receive([0xbf, 5, 71]);
  assert.equal(r.changes.length, 1);
  assert.equal(r.feedback.at(-1).picked, false);
  r.c.receive([0xbf, 5, 20]);
  assert.equal(r.changes.length, 2);
  r.c.receive([0xb6, 30, 29]);
  r.c.receive([0xbf, 5, 60]);
  assert.equal(r.changes.length, 2);
  r.c.receive([0xb6, 30, 2]);
  r.c.receive([0xbf, 5, 61]);
  assert.equal(r.changes.length, 2);
});
test("button release and held repeats never double transport; Shift gives fine steps", async () => {
  const r = rig();
  await r.c.connect(r);
  r.c.receive([0xb0, 116, 127]);
  r.c.receive([0xb0, 116, 127]);
  r.c.receive([0xb0, 116, 0]);
  r.c.receive([0xb0, 116, 127]);
  assert.deepEqual(r.actions, [
    [116, false],
    [116, false],
  ]);
  r.c.receive([0xb6, 63, 127]);
  r.c.receive([0xbf, 77, 65]);
  assert.ok(Math.abs(r.values[0] - 0.5 - 1 / 1270) < 1e-10);
  r.c.receive([0xbf, 77, 63]);
  assert.equal(r.values[0], 0.5);
  for (let n = 0; n < 1000; n++) r.c.receive([0xbf, 77, 0]);
  assert.equal(r.values[0], 0);
});
test("every mapped button reports press and release without repeating its action; Shift is feedback only", async () => {
  const r = rig();
  await r.c.connect(r);
  r.feedback.length = 0;
  const buttons = CONFLUON_XL3_LAYOUT.buttons.map(([, cc]) => cc);
  for (const cc of buttons) {
    r.c.receive([0xb0, cc, 127]);
    r.c.receive([0xb0, cc, 127]);
    r.c.receive([0xb0, cc, 0]);
    r.c.receive([0xb0, cc, 0]);
  }
  assert.deepEqual(
    r.actions,
    buttons.map((cc) => [cc, false]),
  );
  assert.deepEqual(
    r.feedback,
    buttons.flatMap((button) => [
      { button, down: true },
      { button, down: false },
    ]),
  );
  r.feedback.length = 0;
  for (const value of [127, 127, 0, 0]) r.c.receive([0xb6, 63, value]);
  assert.deepEqual(r.feedback, [
    { button: 63, down: true },
    { button: 63, down: false },
  ]);
  assert.equal(r.actions.length, buttons.length);
  r.c.disconnect();
});
test("mode changes and disconnect reset held button feedback without dispatching extra actions", async () => {
  const r = rig();
  await r.c.connect(r);
  r.c.receive([0xb0, 37, 127]);
  r.c.receive([0xb6, 63, 127]);
  r.feedback.length = 0;
  r.c.receive([0xb6, 30, 29]);
  assert.deepEqual(r.feedback, [
    { buttonsReset: true },
    { mode: 29, active: false },
  ]);
  assert.equal(r.c.shift, false);
  r.feedback.length = 0;
  r.c.receive([0xb0, 37, 0]);
  r.c.receive([0xb6, 63, 127]);
  assert.deepEqual(r.feedback, []);
  r.c.receive([0xb6, 30, 2]);
  r.c.receive([0xb0, 37, 127]);
  assert.deepEqual(r.actions, [
    [37, false],
    [37, false],
  ]);
  r.c.disconnect();
  assert.deepEqual(r.feedback.at(-1), { buttonsReset: true });
  assert.equal(r.c.down.size, 0);
});
test("transport covers idle, running, fade, export, double start and browser interruption", () => {
  assert.equal(transportIntent({}), "start");
  assert.equal(transportIntent({ running: true }), "fade");
  assert.equal(transportIntent({ running: true, suspended: true }), "resume");
  for (const state of [
    { ending: true },
    { starting: true },
    { exporting: true },
    { running: true, ending: true, suspended: true },
  ])
    assert.equal(transportIntent(state), "none");
});

test("Confluon bindings preserve preset values and expose only distinct existing parameters", () => {
  const settings = parsePerformanceSettings(
    "https://confluon.com/?seed=424242&ecology=72&flow=70&touch=88&halo=110&memory=64&tone=38&level=74&life=1600&mode=gather",
  );
  const before = { ...settings },
    point = { x: 0.5, y: 0.5 },
    changes = [];
  const b = controllerBindings({
    settings: () => settings,
    setParameter: (k, v) => {
      changes.push(k);
      settings[k] = v;
    },
    point: () => point,
    setPoint: (k, v) => (point[k] = v),
  });
  for (let i = 0; i < 32; i++) {
    const s = b.read(i);
    assert.ok(s.position >= 0 && s.position <= 1);
    assert.ok(s.label);
  }
  assert.deepEqual(settings, before);
  assert.equal(new Set(Object.values(XL3_PARAMETERS).map((v) => v[0])).size, 7);
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => b.read(24 + i).label),
    ["Ecology", "Flow", "Touch", "Halo", "Memory", "Tone", "—", "Level"],
  );
  assert.deepEqual(
    Array.from({ length: 24 }, (_, i) => i).filter((i) => !b.read(i).disabled),
    [11, 12],
  );
  for (let i = 0; i < 32; i++)
    if (b.read(i).disabled) assert.equal(b.change(i, 0.8), false);
  assert.deepEqual(settings, before);
  b.change(11, 0.1);
  b.change(12, 0.9);
  assert.deepEqual(settings, before);
  assert.deepEqual(point, { x: 0.1, y: 0.9 });
  b.change(29, 1);
  assert.deepEqual(changes, ["tone"]);
  assert.equal(settings.tone, 1);
  assert.equal(settings.level, before.level);
  b.change(31, 0);
  assert.equal(settings.level, 0);
  assert.equal(settings.tone, 1);
  assert.equal(b.change(32, 0.5), false);
  assert.equal(b.change(29, NaN), false);
  for (const [slot, [property]] of Object.entries(XL3_PARAMETERS)) {
    b.change(Number(slot), 0);
    const low = settings[property];
    b.change(Number(slot), 1);
    assert.ok(settings[property] > low);
  }
});

test("every assigned Confluon fader picks up independently and re-arms after a score change", async () => {
  const settings = parsePerformanceSettings(
    "https://confluon.com/?seed=424242",
  );
  const point = { x: 0.5, y: 0.5 },
    changes = [];
  const bindings = controllerBindings({
    settings: () => settings,
    setParameter: (property, value) => {
      settings[property] = value;
      changes.push(property);
    },
    point: () => point,
    setPoint: (axis, value) => {
      point[axis] = value;
    },
  });
  const driver = new XL3({ ...bindings, action() {} });
  await driver.connect({
    input: { state: "connected", open: async () => {} },
    output: { state: "connected", open: async () => {}, send() {} },
  });
  const assignments = [
    "ecology",
    "flow",
    "gesture",
    "glow",
    "memory",
    "tone",
    null,
    "level",
  ];
  for (let fader = 0; fader < 8; fader++) {
    const property = assignments[fader],
      before = { ...settings };
    driver.receive([0xbf, 5 + fader, 0]);
    assert.deepEqual(settings, before);
    driver.receive([0xbf, 5 + fader, 127]);
    if (!property) {
      assert.deepEqual(settings, before);
      continue;
    }
    assert.equal(changes.at(-1), property);
    assert.deepEqual(
      Object.keys(settings).filter((key) => settings[key] !== before[key]),
      [property],
    );
    // A new score puts the target below the physical fader: it must cross again.
    settings[property] = before[property];
    driver.receive([0xbf, 5 + fader, 126]);
    assert.equal(settings[property], before[property]);
    driver.receive([0xbf, 5 + fader, 0]);
    assert.ok(settings[property] < before[property]);
  }
  const before = { ...settings };
  for (let knob = 0; knob < 24; knob++) driver.receive([0xbf, 77 + knob, 65]);
  assert.deepEqual(settings, before);
  assert.ok(point.x > 0.5 && point.y > 0.5);
  driver.disconnect();
});
