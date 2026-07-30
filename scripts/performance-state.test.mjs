import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPopulation,
  encodePerformanceState,
  formatSeed,
  parsePerformanceSettings,
  parseSeed,
} from "../web/performance-state.js";

test("performance settings have one canonical set of defaults", () => {
  assert.deepEqual(parsePerformanceSettings("https://confluon.com/"), {
    ecology: 1,
    flow: 1,
    gesture: 1,
    glow: 1,
    memory: 0.42,
    tone: 0.55,
    level: 0.74,
    population: 2000,
    mode: "gather",
  });
});

test("performance settings decode, clamp, and reject invalid modes", () => {
  assert.deepEqual(
    parsePerformanceSettings(
      "/?ecology=180&flow=25&touch=125&halo=999&memory=-5&tone=nope&level=0&life=9000&mode=fly",
    ),
    {
      ecology: 1.8,
      flow: 0.5,
      gesture: 1.25,
      glow: 1.55,
      memory: 0,
      tone: 0.55,
      level: 0,
      population: 4096,
      mode: "gather",
    },
  );
});

test("encoding preserves unrelated operational parameters and round-trips", () => {
  const settings = {
    ecology: 1.24,
    flow: 0.88,
    gesture: 1.11,
    glow: 1.2,
    memory: 0.33,
    tone: 0.67,
    level: 0.58,
    population: 1777,
    mode: "orbit",
  };
  const url = encodePerformanceState(
    "https://confluon.com/?renderer=canvas&verify=1",
    123456789,
    settings,
  );

  assert.equal(url.searchParams.get("renderer"), "canvas");
  assert.equal(url.searchParams.get("verify"), "1");
  assert.equal(parseSeed(url), 123456789);
  assert.deepEqual(parsePerformanceSettings(url), settings);
});

test("seed and population helpers enforce public contract bounds", () => {
  assert.equal(parseSeed("/?seed=1"), 1);
  assert.equal(parseSeed("/?seed=4294967295"), 0xffff_ffff);
  assert.equal(parseSeed("/?seed=0"), null);
  assert.equal(parseSeed("/?seed=4294967296"), null);
  assert.equal(formatSeed(0x7ab8_472), "07AB8472");
  assert.equal(clampPopulation(Number.NaN), 2000);
  assert.equal(clampPopulation(599.5), 600);
  assert.equal(clampPopulation(4096.4), 4096);
});
