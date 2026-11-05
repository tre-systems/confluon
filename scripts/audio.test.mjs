import assert from "node:assert/strict";
import test from "node:test";
import { ConfluonAudio } from "../web/audio.js";

test("controller fade follows audio time, cannot be undone by level edits, and ends at zero", async (t) => {
  installContext(t);
  const audio = new ConfluonAudio(424242);
  await audio.start();
  const events = [];
  for (const method of ["cancelScheduledValues", "setValueAtTime", "setTargetAtTime", "linearRampToValueAtTime"])
    audio.master.gain[method] = (...args) => events.push([method,...args]);
  audio.context.currentTime = 10;
  audio.fadeOut();
  assert.deepEqual(events.at(-1), ["linearRampToValueAtTime",0,18]);
  const count=events.length;
  audio.setLevel(0.3);
  await audio.resume();
  audio.fadeOut();
  assert.equal(events.length,count);
  assert.equal(audio.fadeFinished(),false);
  audio.context.currentTime=18;
  assert.equal(audio.fadeFinished(),true);
  audio.finishFade();
  assert.deepEqual(events.at(-1),["setValueAtTime",0,18]);
  audio.setPaused(true);
  assert.deepEqual(events.at(-1),["setTargetAtTime",0,18,0.1]);
  audio.setPaused(false);
  assert.deepEqual(events.at(-1),["setTargetAtTime",audio.targetLevel(),18,0.38]);
  assert.equal(audio.level,0.3);
});

const metrics = [0.3, 0.4, 0.2, 0.3, 0, 0, 0];

function fakeContext({ rate = 44100, resumedRate = rate, failBuffer = false, resumeGate } = {}) {
  const contexts = [];
  class Context {
    constructor() {
      this.sampleRate = rate;
      this.currentTime = 0;
      this.state = "suspended";
      this.destination = {};
      this.buffers = [];
      contexts.push(this);
    }
    async resume() {
      if (resumeGate) await resumeGate;
      this.sampleRate = resumedRate;
      this.state = "running";
    }
    async close() { this.state = "closed"; }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = { sampleRate, numberOfChannels: channels, getChannelData: (channel) => data[channel] };
      this.buffers.push(buffer);
      return buffer;
    }
    createConvolver() {
      const node = this.node();
      Object.defineProperty(node, "buffer", {
        set: (buffer) => {
          if (failBuffer || buffer.sampleRate !== this.sampleRate) {
            throw new DOMException("Convolver sample rate mismatch", "NotSupportedError");
          }
          node.impulse = buffer;
        },
      });
      return node;
    }
    node() {
      const node = {
        connect: () => node,
        start() {}, stop() {}, disconnect() {},
        getFloatTimeDomainData(samples) { samples.fill(0); },
      };
      for (const key of ["gain", "frequency", "detune", "pan", "Q", "threshold", "knee", "ratio", "attack", "release", "delayTime"]) {
        node[key] = {
          value: 0,
          setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {},
          linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
        };
      }
      return node;
    }
  }
  for (const kind of ["Gain", "BiquadFilter", "WaveShaper", "DynamicsCompressor", "Analyser", "MediaStreamDestination", "StereoPanner", "Oscillator", "BufferSource", "Delay"]) {
    Context.prototype[`create${kind}`] = Context.prototype.node;
  }
  return { Context, contexts };
}

function installContext(t, options) {
  const fake = fakeContext(options);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { AudioContext: fake.Context } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else delete globalThis.window;
  });
  return fake.contexts;
}

for (const rate of [44100, 48000]) {
  test(`audio initializes and updates at ${rate} Hz`, async (t) => {
    const contexts = installContext(t, { rate });
    const audio = new ConfluonAudio(1);
    await audio.start();
    assert.equal(audio.state(), "running");
    assert.equal(audio.voices.length, 6);
    assert.equal(audio.formationVoices.length, 8);
    assert.ok(contexts[0].buffers.every((buffer) => buffer.sampleRate === rate));
    assert.doesNotThrow(() => audio.update(metrics));
  });
}

test("buffers use the playback rate after the context resumes", async (t) => {
  const contexts = installContext(t, { rate: 48000, resumedRate: 44100 });
  const audio = new ConfluonAudio(1);
  await audio.start();
  assert.ok(contexts[0].buffers.every((buffer) => buffer.sampleRate === 44100));
  assert.doesNotThrow(() => audio.update(metrics));
});

test("a failed graph closes its context, isolates updates and permits a clean retry", async (t) => {
  const contexts = installContext(t, { failBuffer: true });
  const audio = new ConfluonAudio(1);
  await assert.rejects(audio.start(), { name: "NotSupportedError" });
  assert.equal(contexts[0].state, "closed");
  assert.equal(audio.context, null);
  assert.equal(audio.startPromise, null);
  assert.equal(audio.captureStream(), null);
  assert.equal(audio.voices.length, 0);
  assert.equal(audio.formationVoices.length, 0);
  assert.doesNotThrow(() => {
    audio.update(metrics);
    audio.setLevel(0.5);
    audio.setPaused(false);
    audio.reseed(2);
    audio.wake();
    audio.meter();
  });
  window.AudioContext = fakeContext({ rate: 44100 }).Context;
  await audio.start();
  assert.equal(audio.state(), "running");
  assert.equal(audio.voices.length, 6);
  assert.equal(audio.formationVoices.length, 8);
  assert.doesNotThrow(() => audio.update(metrics));
});

test("concurrent starts share initialization and frame updates cannot see its partial state", async (t) => {
  let release;
  const resumeGate = new Promise((resolve) => { release = resolve; });
  const contexts = installContext(t, { resumeGate });
  const audio = new ConfluonAudio(1);
  const first = audio.start();
  const second = audio.start();
  assert.equal(contexts.length, 1);
  assert.equal(audio.context, null);
  assert.doesNotThrow(() => audio.update(metrics));
  release();
  await Promise.all([first, second]);
  assert.equal(audio.state(), "running");
  assert.equal(audio.voices.length, 6);
});
