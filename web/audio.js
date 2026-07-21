const PARTIALS = [1, 1.25, 1.5, 2, 2.5, 3];
const SCALE = [0, 2, 5, 7, 9, 12, 14, 17];
const ROOT_STEPS = [0, 2, 5, 7, 9, 12];
const MASTER_LEVEL = 0.58;

export class ConfluenceAudio {
  constructor(seed) {
    this.seed = seed;
    this.random = seededRandom(seed ^ 0x91e1_0da5);
    this.context = null;
    this.voices = [];
    this.level = 0.74;
    this.paused = false;
    this.lastStrike = -Infinity;
    this.nextNoteTime = Infinity;
    this.currentRoot = 48;
    this.latestMetrics = [0.5, 0, 0, 0.5, 1, 0];
  }

  async start() {
    claimPlaybackSession();
    if (this.context) {
      await this.resume();
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser");

    const context = new AudioContextClass({ latencyHint: "interactive" });
    this.context = context;

    this.master = context.createGain();
    this.master.gain.value = 0.0001;
    this.highpass = context.createBiquadFilter();
    this.highpass.type = "highpass";
    this.highpass.frequency.value = 28;
    this.highpass.Q.value = 0.55;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 3.2;
    this.compressor.attack.value = 0.012;
    this.compressor.release.value = 0.38;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    this.master
      .connect(this.highpass)
      .connect(this.compressor)
      .connect(this.analyser)
      .connect(context.destination);

    this.dry = context.createGain();
    this.dry.gain.value = 0.88;
    this.dry.connect(this.master);

    this.fieldPan = context.createStereoPanner();
    this.padFilter = context.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 1.2;
    this.padFilter.connect(this.fieldPan).connect(this.dry);

    const pans = [-0.74, 0.62, -0.34, 0.26, 0.78, -0.58];
    for (let index = 0; index < PARTIALS.length; index += 1) {
      const oscillator = context.createOscillator();
      oscillator.type = index < 4 ? "sine" : "triangle";
      oscillator.frequency.value = this.currentRoot * PARTIALS[index];
      oscillator.detune.value = (index - 2.5) * 2.1;
      const gain = context.createGain();
      gain.gain.value = 0.0001;
      const panner = context.createStereoPanner();
      panner.pan.value = pans[index];
      oscillator.connect(gain).connect(panner).connect(this.padFilter);
      oscillator.start();
      this.voices.push({ oscillator, gain, panner });
    }

    this.sub = context.createOscillator();
    this.sub.type = "sine";
    this.sub.frequency.value = 36;
    this.subFilter = context.createBiquadFilter();
    this.subFilter.type = "lowpass";
    this.subFilter.frequency.value = 110;
    this.subGain = context.createGain();
    this.subGain.gain.value = 0.0001;
    this.sub.connect(this.subFilter).connect(this.subGain).connect(this.dry);
    this.sub.start();

    this.noiseSource = context.createBufferSource();
    this.noiseSource.buffer = makeNoiseBuffer(context, 0xa5a5_41c3);
    this.noiseSource.loop = true;
    this.noiseFilter = context.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 520;
    this.noiseFilter.Q.value = 0.58;
    this.noiseGain = context.createGain();
    this.noiseGain.gain.value = 0.0001;
    this.noiseSource.connect(this.noiseFilter).connect(this.noiseGain).connect(this.dry);
    this.noiseSource.start();

    this.delaySend = context.createGain();
    this.delaySend.gain.value = 0.24;
    this.delay = context.createDelay(2.5);
    this.delay.delayTime.value = 0.61;
    this.feedbackFilter = context.createBiquadFilter();
    this.feedbackFilter.type = "lowpass";
    this.feedbackFilter.frequency.value = 1350;
    this.feedback = context.createGain();
    this.feedback.gain.value = 0.28;
    this.delayWet = context.createGain();
    this.delayWet.gain.value = 0.25;
    this.dry.connect(this.delaySend).connect(this.delay);
    this.delay.connect(this.feedbackFilter).connect(this.feedback).connect(this.delay);
    this.delay.connect(this.delayWet).connect(this.master);

    this.reverb = context.createConvolver();
    this.reverb.buffer = makeImpulseResponse(context, 0x17c9_ef31, 4.6);
    this.reverbSend = context.createGain();
    this.reverbSend.gain.value = 0.34;
    this.reverbGain = context.createGain();
    this.reverbGain.gain.value = 0.38;
    this.dry.connect(this.reverbSend).connect(this.reverb).connect(this.reverbGain).connect(this.master);

    await context.resume();
    if (context.state !== "running") throw new Error(`Audio context remained ${context.state}`);
    this.master.gain.setTargetAtTime(this.targetLevel(), context.currentTime, 0.36);
    this.nextNoteTime = context.currentTime + 0.35;
  }

  async resume() {
    if (!this.context) return;
    claimPlaybackSession();
    await this.context.resume();
    if (this.context.state !== "running") {
      throw new Error(`Audio context remained ${this.context.state}`);
    }
    if (!this.paused) {
      this.master.gain.setTargetAtTime(this.targetLevel(), this.context.currentTime, 0.18);
    }
  }

  wake(metrics = this.latestMetrics) {
    if (!this.context) return;
    this.latestMetrics = Array.from(metrics);
    const now = this.context.currentTime;
    const root = this.currentRoot * 2;
    [0, 7, 14].forEach((semitones, index) => {
      this.playTone(root * Math.pow(2, semitones / 12), 0.09 - index * 0.012, now + index * 0.12, 3.8, -0.5 + index * 0.5);
    });
    this.nextNoteTime = now + 1.1;
  }

  update(metrics) {
    if (!this.context) return;
    this.latestMetrics = Array.from(metrics);
    const [energy, coherence, activity, density, formations] = metrics;
    const now = this.context.currentTime;
    const formation = Math.max(0, Math.round(formations) - 1);
    const rootStep = ROOT_STEPS[formation % ROOT_STEPS.length];
    const targetRoot = 45 * Math.pow(2, rootStep / 12) * (0.985 + energy * 0.03);
    this.currentRoot += (targetRoot - this.currentRoot) * 0.012;
    const breath = 0.9 + Math.sin(now * 0.52) * 0.1;

    this.voices.forEach((voice, index) => {
      const drift = Math.sin(now * (0.031 + index * 0.008) + index * 1.31) * (1.4 + activity * 2.8);
      voice.oscillator.frequency.setTargetAtTime(this.currentRoot * PARTIALS[index], now, 0.65 + index * 0.1);
      voice.oscillator.detune.setTargetAtTime((index - 2.5) * 2.1 + drift, now, 0.8);
      const hierarchy = 1 / Math.pow(index + 1, 0.62);
      const voiceLevel =
        (0.012 + hierarchy * (0.04 + coherence * 0.038) * (0.72 + density * 0.38)) *
        breath *
        (1 - activity * 0.12);
      voice.gain.gain.setTargetAtTime(voiceLevel, now, 0.34 + index * 0.05);
      const movingPan = Math.sin(now * (0.037 + index * 0.006) + index * 1.7) * (0.22 + activity * 0.42);
      voice.panner.pan.setTargetAtTime(movingPan, now, 0.75);
    });

    this.sub.frequency.setTargetAtTime(Math.max(32, this.currentRoot * 0.5), now, 0.8);
    this.subGain.gain.setTargetAtTime((0.026 + density * 0.032 + coherence * 0.018) * breath, now, 0.6);
    this.padFilter.frequency.setTargetAtTime(520 + density * 1650 + activity * 1100, now, 0.32);
    this.padFilter.Q.setTargetAtTime(0.8 + energy * 2.4, now, 0.4);
    this.fieldPan.pan.setTargetAtTime(Math.sin(now * 0.043) * (0.14 + coherence * 0.24), now, 0.9);
    this.noiseFilter.frequency.setTargetAtTime(260 + density * 1250 + energy * 760, now, 0.38);
    this.noiseGain.gain.setTargetAtTime(0.006 + activity * 0.026 * (1 - coherence * 0.42), now, 0.28);
    this.delay.delayTime.setTargetAtTime(0.43 + (1 - coherence) * 0.42, now, 0.7);
    this.feedback.gain.setTargetAtTime(0.23 + activity * 0.2, now, 0.6);
    this.reverbGain.gain.setTargetAtTime(0.3 + coherence * 0.18, now, 0.8);

    if (!this.paused && now >= this.nextNoteTime) {
      this.playFieldNote(metrics, now);
      const space = 1.55 - activity * 0.46 - density * 0.24 + this.random() * 0.55;
      this.nextNoteTime = now + Math.max(0.78, space);
    }
  }

  playFieldNote(metrics, when) {
    const [energy, coherence, activity, density, formations] = metrics;
    const walk = Math.floor(this.random() * Math.min(SCALE.length, 4 + Math.round(density * 4)));
    const octave = formations > 4 && this.random() > 0.62 ? 12 : 0;
    const semitones = SCALE[walk] + octave;
    const frequency = this.currentRoot * 2 * Math.pow(2, semitones / 12);
    const peak = 0.045 + coherence * 0.038 + activity * 0.024 + this.random() * 0.018;
    const duration = 2.7 + (1 - activity) * 2.6 + this.random() * 1.5;
    const pan = (this.random() * 2 - 1) * (0.46 + activity * 0.35);
    this.playTone(frequency * (0.995 + energy * 0.01), peak, when, duration, pan);
  }

  playTone(frequency, peak, when, duration, pan) {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    oscillator.type = frequency > 420 ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, when);
    oscillator.detune.setValueAtTime((this.random() - 0.5) * 5, when);
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = Math.min(3200, frequency * 4.5);
    filter.Q.value = 0.7;
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(filter).connect(gain).connect(panner).connect(this.dry);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.1);
  }

  strike(intensity, energy = 0.5) {
    if (!this.context || this.paused) return;
    const now = this.context.currentTime;
    if (now - this.lastStrike < 0.62) return;
    this.lastStrike = now;

    const oscillator = this.context.createOscillator();
    oscillator.type = energy > 0.55 ? "triangle" : "sine";
    const filter = this.context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420 + energy * 1050;
    filter.Q.value = 5 + intensity * 8;
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    panner.pan.value = this.random() * 1.6 - 0.8;
    const degree = SCALE[Math.floor(this.random() * 5)];
    oscillator.frequency.value = this.currentRoot * Math.pow(2, degree / 12);
    oscillator.frequency.exponentialRampToValueAtTime(oscillator.frequency.value * 0.72, now + 1.8);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055 + intensity * 0.065, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.1 + intensity);
    oscillator.connect(filter).connect(gain).connect(panner).connect(this.dry);
    oscillator.start(now);
    oscillator.stop(now + 3.5);
  }

  reseed(seed) {
    this.seed = seed;
    this.random = seededRandom(seed ^ 0x91e1_0da5);
  }

  setLevel(level) {
    this.level = Math.max(0, Math.min(1, level));
    if (this.context && !this.paused) {
      this.master.gain.setTargetAtTime(this.targetLevel(), this.context.currentTime, 0.1);
    }
  }

  setPaused(paused) {
    this.paused = paused;
    if (!this.context) return;
    const target = paused ? 0.0001 : this.targetLevel();
    this.master.gain.setTargetAtTime(target, this.context.currentTime, paused ? 0.1 : 0.38);
    if (!paused) this.nextNoteTime = Math.min(this.nextNoteTime, this.context.currentTime + 0.4);
  }

  targetLevel() {
    return this.level * MASTER_LEVEL;
  }

  state() {
    return this.context?.state ?? "waiting";
  }

  meter() {
    if (!this.analyser || !this.context) {
      return { state: this.state(), rms: 0, peak: 0, level: this.level, paused: this.paused };
    }
    const samples = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    let peak = 0;
    for (const sample of samples) {
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return {
      state: this.state(),
      rms: Math.sqrt(sum / samples.length),
      peak,
      level: this.level,
      paused: this.paused,
    };
  }
}

function claimPlaybackSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch (_) {
    // AudioSession is a best-effort WebKit enhancement.
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
    previous = previous * 0.82 + white * 0.18;
    data[index] = previous * 0.72;
  }
  return buffer;
}

function makeImpulseResponse(context, seed, seconds) {
  const length = Math.floor(context.sampleRate * seconds);
  const response = context.createBuffer(2, length, context.sampleRate);
  const random = seededRandom(seed);
  for (let channel = 0; channel < response.numberOfChannels; channel += 1) {
    const data = response.getChannelData(channel);
    let early = 0;
    for (let index = 0; index < length; index += 1) {
      const progress = index / length;
      const envelope = Math.pow(1 - progress, 2.35);
      early = early * 0.54 + (random() * 2 - 1) * 0.46;
      data[index] = early * envelope * 0.42;
    }
  }
  return response;
}

function seededRandom(seed) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0xffffffff;
  };
}
