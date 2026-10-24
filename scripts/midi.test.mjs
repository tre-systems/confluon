import assert from "node:assert/strict";
import test from "node:test";
import {
  MidiPerformance,
  MIDI_PARAMETERS,
  parameterUnit,
  parameterValue,
} from "../web/midi-mapping.js";
import { parsePerformanceSettings } from "../web/performance-state.js";

function rig() {
  const settings = parsePerformanceSettings("https://confluon.invalid/");
  const events = [];
  let now = 0;
  const midi = new MidiPerformance({
    settings: () => settings,
    parameter: (key, value) => {
      settings[key] = parameterValue(key, value);
      events.push(["parameter", key, value]);
    },
    action: (...args) => events.push(["action", ...args]),
    gesture: (...args) => events.push(["gesture", ...args]),
    release: (...args) => events.push(["release", ...args]),
    feedback: () => events.push(["feedback"]),
    status: () => {},
    now: () => now,
  });
  return {
    midi,
    settings,
    events,
    advance: (ms) => {
      now += ms;
      midi.tick();
    },
    launch: (cc, value, id = "launch") =>
      midi.receive(id, "launch", [0xbf, cc, value]),
    touch: (cc, value) => midi.receive("ipad", "touch", [0xbe, cc, value]),
  };
}

test("faders wait for pickup, accept crossings in either direction, then follow", () => {
  const r = rig();
  const original = r.settings.tone;
  r.launch(10, 0);
  r.launch(10, 50);
  assert.equal(r.settings.tone, original);
  r.launch(10, 85);
  assert.equal(r.settings.tone, 85 / 127);
  r.launch(10, 40);
  assert.equal(r.settings.tone, 40 / 127);
  r.settings.tone = 0.7;
  r.launch(10, 110);
  assert.equal(r.settings.tone, 0.7);
  r.launch(10, 80);
  assert.equal(r.settings.tone, 80 / 127);
});

test("pickup can acquire on the first near-target value, including endpoints", () => {
  const r = rig();
  r.settings.level = 0;
  r.launch(11, 0);
  r.launch(11, 1);
  assert.equal(r.settings.level, 1 / 127);
  r.settings.level = 1;
  r.launch(11, 0);
  r.launch(11, 127);
  assert.equal(r.settings.level, 1);
});

test("UI, iPad and other devices re-arm pickup independently", () => {
  const r = rig();
  r.launch(10, 70);
  r.launch(10, 100);
  r.touch(25, 20);
  r.launch(10, 99);
  assert.equal(r.settings.tone, 20 / 127);
  r.launch(10, 21);
  assert.equal(r.settings.tone, 21 / 127);
  r.launch(10, 120, "second");
  assert.equal(r.settings.tone, 21 / 127);
  r.launch(10, 21, "second");
  r.launch(10, 30, "second");
  r.launch(10, 20);
  assert.equal(r.settings.tone, 30 / 127);
});

test("all seven faders scale to the canonical parameter bounds; eighth is reserved", () => {
  const r = rig();
  MIDI_PARAMETERS.forEach((item, i) => {
    r.launch(5 + i, Math.round(parameterUnit(item.property, r.settings) * 127));
    r.launch(5 + i, 127);
    assert.equal(r.settings[item.property], item.maximum);
    r.launch(5 + i, 0);
    assert.equal(r.settings[item.property], item.minimum);
  });
  const count = r.events.length;
  r.launch(12, 127);
  r.launch(20, 127);
  assert.equal(r.events.length, count);
});

test("absolute encoders use pickup; custom binary-offset encoders adjust finely and clamp", () => {
  const r = rig();
  r.launch(18, 0);
  assert.equal(r.settings.tone, 0.55);
  r.launch(18, 70);
  assert.equal(r.settings.tone, 70 / 127);
  r.midi.encoderMode = "relative";
  r.launch(18, 65);
  assert.ok(Math.abs(r.settings.tone - (70 / 127 + 1 / 508)) < 1e-10);
  r.launch(18, 63);
  r.launch(18, 64);
  assert.equal(r.settings.tone, 70 / 127);
  r.settings.level = 1;
  r.launch(19, 68);
  assert.equal(r.settings.level, 1);
  r.settings.level = 0;
  r.launch(19, 60);
  assert.equal(r.settings.level, 0);
});

test("buttons act only on press edges; Settle also reports release, and Play works", () => {
  const r = rig();
  r.launch(41, 127);
  r.launch(41, 127);
  r.launch(41, 0);
  r.launch(43, 127);
  r.launch(43, 0);
  r.launch(116, 127);
  r.launch(116, 0);
  assert.deepEqual(r.events, [
    ["action", "pause", true, "launch"],
    ["action", "settle", true, "launch"],
    ["action", "settle", false, "launch"],
    ["action", "pause", true, "launch"],
  ]);
});

test("malformed, unrelated, other-channel and note messages cannot move controls", () => {
  const r = rig();
  for (const data of [
    [],
    [0xbf, 5],
    [0xbf, 5, 128],
    [0xbf, 5, -1],
    [0xbf, 5, NaN],
    [0xbf, 5, 1.5],
    [0xb0, 5, 127],
    [0x9f, 37, 127],
    [0xf8],
    [0xbf, 99, 127],
  ])
    r.midi.receive("a", "launch", data);
  assert.deepEqual(r.events, []);
});

test("XY commits a high-resolution pair before the gate, with explicit press ownership", () => {
  const r = rig();
  r.touch(83, 127);
  r.touch(16, 100);
  r.touch(48, 12);
  r.touch(17, 20);
  r.touch(49, 60);
  assert.deepEqual(r.events, []);
  r.touch(82, 127);
  assert.deepEqual(r.events.at(-1), [
    "gesture",
    "ipad",
    { x: 12812 / 16383, y: 2620 / 16383, active: true, pressed: true },
  ]);
  r.touch(16, 101);
  r.touch(48, 12);
  r.touch(17, 20);
  assert.equal(r.events.length, 1);
  r.touch(49, 61);
  assert.equal(r.events.length, 2);
  assert.equal(r.events.at(-1)[2].pressed, false);
  r.touch(82, 0);
  assert.equal(r.events.at(-1)[2].active, false);
});

test("TouchOSC heartbeat releases stalled holds and requires a fresh press", () => {
  const r = rig();
  r.touch(82, 127);
  r.touch(43, 127);
  assert.deepEqual(r.events, []);
  r.touch(83, 127);
  r.touch(82, 127);
  r.touch(43, 127);
  r.advance(800);
  r.touch(83, 127);
  r.advance(800);
  assert.equal(r.events.filter(([type]) => type === "release").length, 0);
  r.advance(201);
  assert.deepEqual(r.events.at(-1), ["release", "ipad"]);
  r.touch(82, 127);
  r.touch(43, 127);
  assert.deepEqual(r.events.at(-1), ["release", "ipad"]);
  r.touch(83, 127);
  r.touch(82, 127);
  assert.equal(r.events.at(-1)[2].pressed, true);
});

test("disconnect releases only that source and arms pickup on reconnection", () => {
  const r = rig();
  r.launch(10, 70);
  r.launch(43, 127);
  r.touch(83, 127);
  r.touch(43, 127);
  r.midi.releaseSource("launch");
  assert.deepEqual(r.events.at(-1), ["release", "launch"]);
  assert.ok(r.midi.sources.has("ipad"));
  r.launch(10, 127);
  assert.equal(r.settings.tone, 70 / 127);
  r.midi.releaseAll();
  assert.equal(r.midi.sources.size, 0);
});

test("reset releases forces without forgetting held button edges", () => {
  const r = rig();
  r.launch(42, 127);
  r.midi.releaseHolds();
  r.launch(42, 127);
  assert.equal(
    r.events.filter(([type, action]) => type === "action" && action === "reset")
      .length,
    1,
  );
  r.launch(42, 0);
  r.launch(42, 127);
  assert.equal(
    r.events.filter(([type, action]) => type === "action" && action === "reset")
      .length,
    2,
  );
});
