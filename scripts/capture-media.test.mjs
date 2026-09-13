import assert from "node:assert/strict";
import test from "node:test";
import { assertPcmMaster, recorderTypes, validateLosslessOptions } from "./capture-media.mjs";

const options = { losslessAudio: true, silent: false, containers: ["mp4"] };
const probe = () => ({
  format: { duration: "30.01" },
  streams: [{ codec_type: "audio", codec_name: "pcm_f32le", channels: 2, sample_rate: "48000" }],
});

test("lossless codec selection never falls back to Opus", () => {
  assert.ok(recorderTypes(true).every((type) => type.endsWith(",pcm")));
  assert.ok(recorderTypes(false)[0].endsWith(",opus"));
});

test("lossless mode rejects incompatible output requests", () => {
  assert.doesNotThrow(() => validateLosslessOptions(options));
  assert.throws(() => validateLosslessOptions({ ...options, silent: true }), /silent/);
  assert.throws(() => validateLosslessOptions({ ...options, containers: ["webm"] }), /Matroska/);
  assert.doesNotThrow(() => validateLosslessOptions({ ...options, losslessAudio: false, silent: true }));
});

test("source-only retains PCM without requiring a delivery encode", () => {
  assert.doesNotThrow(() => validateLosslessOptions({ ...options, sourceOnly: true, containers: [] }));
  assert.throws(() => validateLosslessOptions({ ...options, losslessAudio: false, sourceOnly: true }), /requires/);
});

test("PCM master validation accepts stereo float without changing its sample rate", () => {
  assert.equal(assertPcmMaster(probe(), 30).sample_rate, "48000");
});

for (const [name, change] of [
  ["lossy audio", (p) => { p.streams[0].codec_name = "opus"; }],
  ["mono", (p) => { p.streams[0].channels = 1; }],
  ["low sample rate", (p) => { p.streams[0].sample_rate = "22050"; }],
  ["missing audio", (p) => { p.streams = []; }],
  ["multiple audio streams", (p) => { p.streams.push({ ...p.streams[0] }); }],
  ["short recording", (p) => { p.format.duration = "27"; }],
  ["long recording", (p) => { p.format.duration = "31"; }],
  ["unknown duration", (p) => { p.format.duration = "N/A"; }],
]) {
  test(`PCM master validation rejects ${name}`, () => {
    const input = probe();
    change(input);
    assert.throws(() => assertPcmMaster(input, 30));
  });
}
