const PARTIALS = [1, 1.307, 1.503, 1.947, 2.557, 3.213];

export class ConfluenceAudio {
  constructor(seed) {
    this.seed = seed;
    this.context = null;
    this.voices = [];
    this.level = 0.62;
    this.paused = false;
    this.lastStrike = -Infinity;
  }

  async start() {
    if (this.context) {
      await this.context.resume();
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("WebAudio is not supported in this browser");
    }
    const context = new AudioContextClass({ latencyHint: "interactive" });
    this.context = context;

    this.master = context.createGain();
    this.master.gain.value = 0.0001;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.018;
    this.compressor.release.value = 0.32;
    this.master.connect(this.compressor).connect(context.destination);

    this.dry = context.createGain();
    this.dry.gain.value = 0.68;
    this.dry.connect(this.master);

    this.resonantFilter = context.createBiquadFilter();
    this.resonantFilter.type = "lowpass";
    this.resonantFilter.frequency.value = 620;
    this.resonantFilter.Q.value = 5.2;
    this.resonantFilter.connect(this.dry);

    const pans = [-0.76, 0.58, -0.34, 0.22, 0.73, -0.61];
    for (let index = 0; index < PARTIALS.length; index += 1) {
      const oscillator = context.createOscillator();
      oscillator.type = index < 3 ? "sine" : "triangle";
      const gain = context.createGain();
      gain.gain.value = 0.0001;
      const panner = context.createStereoPanner();
      panner.pan.value = pans[index];
      oscillator.connect(gain).connect(panner).connect(this.resonantFilter);
      oscillator.start();
      this.voices.push({ oscillator, gain, panner });
    }

    this.noiseSource = context.createBufferSource();
    this.noiseSource.buffer = makeNoiseBuffer(context, this.seed ^ 0xa5a5_41c3);
    this.noiseSource.loop = true;
    this.noiseFilter = context.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 480;
    this.noiseFilter.Q.value = 0.75;
    this.noiseGain = context.createGain();
    this.noiseGain.gain.value = 0.0001;
    this.noiseSource.connect(this.noiseFilter).connect(this.noiseGain).connect(this.dry);
    this.noiseSource.start();

    this.delaySend = context.createGain();
    this.delaySend.gain.value = 0.18;
    this.delay = context.createDelay(2.5);
    this.delay.delayTime.value = 0.67;
    this.feedbackFilter = context.createBiquadFilter();
    this.feedbackFilter.type = "lowpass";
    this.feedbackFilter.frequency.value = 1100;
    this.feedback = context.createGain();
    this.feedback.gain.value = 0.29;
    this.dry.connect(this.delaySend).connect(this.delay);
    this.delay.connect(this.feedbackFilter).connect(this.feedback).connect(this.delay);
    this.delay.connect(this.master);

    this.reverb = context.createConvolver();
    this.reverb.buffer = makeImpulseResponse(context, this.seed ^ 0x17c9_ef31, 3.8);
    this.reverbGain = context.createGain();
    this.reverbGain.gain.value = 0.25;
    this.dry.connect(this.reverb).connect(this.reverbGain).connect(this.master);

    await context.resume();
    this.master.gain.setTargetAtTime(this.level * 0.34, context.currentTime, 0.5);
  }

  update(metrics) {
    if (!this.context) {
      return;
    }
    const [energy, coherence, activity, density, formations] = metrics;
    const now = this.context.currentTime;
    const formationStep = Math.max(0, Math.min(7, Math.round(formations) - 1));
    const base = 38 * Math.pow(2, formationStep / 24) * (0.98 + energy * 0.06);

    this.voices.forEach((voice, index) => {
      const imperfectRatio = PARTIALS[index] * (1 + (energy - 0.5) * (index - 2.5) * 0.0025);
      voice.oscillator.frequency.setTargetAtTime(base * imperfectRatio, now, 0.34 + index * 0.08);
      const hierarchy = 1 / Math.pow(index + 1, 0.72);
      const voiceLevel =
        0.002 +
        hierarchy * (0.006 + coherence * 0.018) * (0.55 + density * 0.45) * (1 - activity * 0.2);
      voice.gain.gain.setTargetAtTime(voiceLevel, now, 0.22 + index * 0.04);
      const movingPan = Math.sin(now * (0.021 + index * 0.005) + index * 1.7) * (0.18 + activity * 0.34);
      voice.panner.pan.setTargetAtTime(movingPan, now, 0.7);
    });

    this.resonantFilter.frequency.setTargetAtTime(280 + density * 1450 + activity * 920, now, 0.18);
    this.resonantFilter.Q.setTargetAtTime(2.2 + energy * 7.4, now, 0.24);
    this.noiseFilter.frequency.setTargetAtTime(180 + density * 1200 + energy * 800, now, 0.28);
    this.noiseGain.gain.setTargetAtTime(0.002 + activity * 0.017 * (1 - coherence * 0.48), now, 0.16);
    this.delay.delayTime.setTargetAtTime(0.34 + (1 - coherence) * 0.68, now, 0.5);
    this.feedback.gain.setTargetAtTime(0.19 + activity * 0.23, now, 0.42);
    this.reverbGain.gain.setTargetAtTime(0.16 + coherence * 0.24, now, 0.55);
  }

  strike(intensity, energy = 0.5) {
    if (!this.context) {
      return;
    }
    const now = this.context.currentTime;
    if (now - this.lastStrike < 0.19) {
      return;
    }
    this.lastStrike = now;

    const oscillator = this.context.createOscillator();
    oscillator.type = energy > 0.55 ? "triangle" : "sine";
    const filter = this.context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 320 + energy * 980;
    filter.Q.value = 7 + intensity * 9;
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    panner.pan.value = ((this.lastStrike * 1.618) % 2) - 1;
    const partial = PARTIALS[Math.floor((this.lastStrike * 7) % PARTIALS.length)];
    oscillator.frequency.value = 52 * partial * (1 + energy * 0.35);
    oscillator.frequency.exponentialRampToValueAtTime(oscillator.frequency.value * 0.82, now + 1.4);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.018 + intensity * 0.034, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6 + intensity * 1.2);
    oscillator.connect(filter).connect(gain).connect(panner).connect(this.dry);
    oscillator.start(now);
    oscillator.stop(now + 3.2);
  }

  setLevel(level) {
    this.level = Math.max(0, Math.min(1, level));
    if (this.context && !this.paused) {
      this.master.gain.setTargetAtTime(this.level * 0.34, this.context.currentTime, 0.08);
    }
  }

  setPaused(paused) {
    this.paused = paused;
    if (!this.context) {
      return;
    }
    const target = paused ? 0.0001 : this.level * 0.34;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, paused ? 0.08 : 0.3);
  }
}

function makeNoiseBuffer(context, seed) {
  const length = context.sampleRate * 4;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededRandom(seed);
  let previous = 0;
  for (let index = 0; index < length; index += 1) {
    const white = random() * 2 - 1;
    previous = previous * 0.72 + white * 0.28;
    data[index] = previous;
  }
  return buffer;
}

function makeImpulseResponse(context, seed, seconds) {
  const length = Math.floor(context.sampleRate * seconds);
  const response = context.createBuffer(2, length, context.sampleRate);
  const random = seededRandom(seed);
  for (let channel = 0; channel < response.numberOfChannels; channel += 1) {
    const data = response.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const envelope = Math.pow(1 - index / length, 2.7);
      data[index] = (random() * 2 - 1) * envelope * 0.52;
    }
  }
  return response;
}

function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}
