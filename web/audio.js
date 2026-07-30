const PARTIALS = [1, 1.25, 1.5, 2, 2.5, 3];
const SCALE = [0, 2, 5, 7, 9, 12, 14, 17];
const ROOT_STEPS = [0, 2, 5, 7, 9, 12];
const MASTER_LEVEL = 0.52;
const FORMATION_VOICES = 8;
const CONTROL_STEPS = {
  ecology: 2,
  flow: 5,
  gesture: 7,
  glow: 9,
  memory: 12,
  tone: 14,
  population: 17,
  "gesture-gather": 5,
  "gesture-orbit": 9,
  "gesture-divide": 2,
};

/**
 * The Confluon audio engine. Everything is synthesized from native Web Audio
 * nodes — no samples, no worklets in the signal path — so the graph stays
 * self-contained and portable. The mix reads the same simulation state as the
 * image: sustained formation voices sit at the screen positions of the visible
 * cell clusters, continuous metrics steer the texture, and discrete events
 * (formations appearing, transitions, gestures) strike sparse tones.
 */
export class ConfluonAudio {
  constructor(seed) {
    this.seed = seed;
    this.random = seededRandom(seed ^ 0x91e1_0da5);
    this.context = null;
    this.voices = [];
    this.formationVoices = [];
    this.tracked = [];
    this.level = 0.74;
    this.tone = 0.55;
    this.paused = false;
    this.lastStrike = -Infinity;
    this.lastEmergence = -Infinity;
    this.nextNoteTime = Infinity;
    this.currentRoot = 48;
    this.latestMetrics = [0.5, 0, 0, 0.5, 1, 0, 0];
    this.performance = {
      ecology: 1,
      flow: 1,
      gesture: 1,
      glow: 1,
      memory: 0.42,
    };
    this.interaction = {
      influencing: false,
      active: false,
      present: false,
      strength: 0,
      twist: 0,
      impulse: 0,
      motion: 0,
      pan: 0,
    };
    this.lastControlCue = null;
    this.recorder = null;
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

    // Master chain: gain -> subsonic highpass -> tape saturator -> tone
    // lowpass -> glue compressor -> safety limiter -> analyser -> out.
    this.master = context.createGain();
    this.master.gain.value = 0.0001;
    this.highpass = context.createBiquadFilter();
    this.highpass.type = "highpass";
    this.highpass.frequency.value = 30;
    this.highpass.Q.value = 0.55;
    this.saturator = context.createWaveShaper();
    this.saturator.curve = makeSaturationCurve(2.2);
    this.saturator.oversample = "4x";
    this.masterFilter = context.createBiquadFilter();
    this.masterFilter.type = "lowpass";
    this.masterFilter.frequency.value = 3400;
    this.masterFilter.Q.value = 0.4;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.008;
    this.compressor.release.value = 0.32;
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    this.master
      .connect(this.highpass)
      .connect(this.saturator)
      .connect(this.masterFilter)
      .connect(this.compressor)
      .connect(this.limiter)
      .connect(this.analyser)
      .connect(context.destination);
    // The production capture pipeline records this second pull from the same
    // mastered signal that reaches the speakers. Keeping the tap after the
    // limiter makes browser video exports and interactive WAV takes agree.
    this.captureDestination = context.createMediaStreamDestination();
    this.limiter.connect(this.captureDestination);

    this.dry = context.createGain();
    this.dry.gain.value = 0.88;
    this.dry.connect(this.master);

    // Shared pad bus for the sustained choir.
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
      // Slow audio-rate drift on the detune keeps the pad from freezing into
      // a static organ chord, with no JS timers involved.
      const drift = context.createOscillator();
      drift.frequency.value = 0.027 + index * 0.017;
      const driftDepth = context.createGain();
      driftDepth.gain.value = 3.2 + index * 0.7;
      drift.connect(driftDepth).connect(oscillator.detune);
      drift.start();
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

    // One restrained confirmation voice makes controls feel connected to the
    // instrument without turning every slider movement into a melody.
    this.controlOscillator = context.createOscillator();
    this.controlOscillator.type = "sine";
    this.controlOscillator.frequency.value = 180;
    this.controlFilter = context.createBiquadFilter();
    this.controlFilter.type = "bandpass";
    this.controlFilter.frequency.value = 720;
    this.controlFilter.Q.value = 2.2;
    this.controlGain = context.createGain();
    this.controlGain.gain.value = 0.0001;
    this.controlPan = context.createStereoPanner();
    this.controlOscillator
      .connect(this.controlFilter)
      .connect(this.controlGain)
      .connect(this.controlPan)
      .connect(this.dry);
    this.controlOscillator.start();

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

    // Convolution hall: procedurally generated early reflections plus a tail
    // whose spectrum darkens as it decays.
    this.reverb = context.createConvolver();
    this.reverb.buffer = makeImpulseResponse(context, 0x17c9_ef31, 7.5);
    this.reverbSend = context.createGain();
    this.reverbSend.gain.value = 0.4;
    this.reverbGain = context.createGain();
    this.reverbGain.gain.value = 0.44;
    this.dry.connect(this.reverbSend).connect(this.reverb).connect(this.reverbGain).connect(this.master);

    // Shimmer: an octave-doubling waveshaper fed only into the reverb, so
    // bright harmonics appear as diffuse air rather than direct tone.
    this.shimmerShaper = context.createWaveShaper();
    this.shimmerShaper.curve = makeOctaveCurve();
    this.shimmerShaper.oversample = "4x";
    this.shimmerFilter = context.createBiquadFilter();
    this.shimmerFilter.type = "bandpass";
    this.shimmerFilter.frequency.value = 1700;
    this.shimmerFilter.Q.value = 0.5;
    this.shimmerGain = context.createGain();
    this.shimmerGain.gain.value = 0.0001;
    this.padFilter.connect(this.shimmerShaper).connect(this.shimmerFilter).connect(this.shimmerGain).connect(this.reverb);

    // Formation choir: one sustained voice per visible cell cluster, panned to
    // where the cluster actually sits on screen.
    this.formationBus = context.createGain();
    this.formationBus.gain.value = 0.9;
    this.formationBus.connect(this.dry);
    this.formationReverbSend = context.createGain();
    this.formationReverbSend.gain.value = 0.5;
    this.formationBus.connect(this.formationReverbSend).connect(this.reverb);
    for (let index = 0; index < FORMATION_VOICES; index += 1) {
      const primary = context.createOscillator();
      primary.type = "sine";
      primary.frequency.value = 220;
      const partner = context.createOscillator();
      partner.type = "triangle";
      partner.frequency.value = 440;
      const partnerGain = context.createGain();
      partnerGain.gain.value = 0.22;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1200;
      filter.Q.value = 0.8;
      const gain = context.createGain();
      gain.gain.value = 0.0001;
      const panner = context.createStereoPanner();
      primary.connect(filter);
      partner.connect(partnerGain).connect(filter);
      filter.connect(gain).connect(panner).connect(this.formationBus);
      primary.start();
      partner.start();
      this.formationVoices.push({ primary, partner, filter, gain, panner, busy: false });
    }

    // One coherent breath across the whole mix (about six breaths per minute):
    // pad level, sub level, and master brightness move together.
    this.breath = context.createOscillator();
    this.breath.frequency.value = 0.1;
    const breathPad = context.createGain();
    breathPad.gain.value = 55;
    this.breath.connect(breathPad).connect(this.padFilter.frequency);
    const breathSub = context.createGain();
    breathSub.gain.value = 0.006;
    this.breath.connect(breathSub).connect(this.subGain.gain);
    const breathTone = context.createGain();
    breathTone.gain.value = 160;
    this.breath.connect(breathTone).connect(this.masterFilter.frequency);
    this.breath.start();

    await context.resume();
    if (context.state !== "running") throw new Error(`Audio context remained ${context.state}`);
    this.master.gain.setTargetAtTime(
      this.paused ? 0.0001 : this.targetLevel(),
      context.currentTime,
      0.36,
    );
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
      this.playTone(root * Math.pow(2, semitones / 12), 0.09 - index * 0.012, now + index * 0.12, 5.2, -0.5 + index * 0.5);
    });
    this.nextNoteTime = now + 1.1;
  }

  update(metrics, formations = []) {
    if (!this.context) return;
    this.latestMetrics = Array.from(metrics);
    const [energy, coherence, activity, density, formationCount, , encounters = 0] = metrics;
    const now = this.context.currentTime;
    const contact = this.interaction;
    const contactPressure = Math.min(
      1,
      Math.abs(contact.strength) / 2.4 + Math.abs(contact.twist) / 1.18,
    );
    const contactMotion = Math.min(1, contact.motion / 4);
    const contactPresence = contact.influencing ? Math.min(1, 0.25 + contactPressure) : 0;
    const halo = Math.max(0, Math.min(1, (this.performance.glow - 0.45) / 1.1));
    const memory = Math.max(0, Math.min(1, this.performance.memory));
    const formation = Math.max(0, Math.round(formationCount) - 1);
    const rootStep = ROOT_STEPS[formation % ROOT_STEPS.length];
    const targetRoot = 45 * Math.pow(2, rootStep / 12) * (0.985 + energy * 0.03);
    this.currentRoot += (targetRoot - this.currentRoot) * 0.012;

    this.voices.forEach((voice, index) => {
      voice.oscillator.frequency.setTargetAtTime(this.currentRoot * PARTIALS[index], now, 0.65 + index * 0.1);
      voice.oscillator.detune.setTargetAtTime(
        (index - 2.5) * (2.1 + encounters * 0.85 + contactPressure * 0.18),
        now,
        0.8,
      );
      const hierarchy = 1 / Math.pow(index + 1, 0.62);
      const spectralTilt = 0.78 + this.tone * (0.3 + index * 0.055);
      const voiceLevel =
        (0.012 + hierarchy * (0.04 + coherence * 0.038) * (0.72 + density * 0.38)) *
        (1 - activity * 0.12) *
        spectralTilt;
      voice.gain.gain.setTargetAtTime(voiceLevel, now, 0.34 + index * 0.05);
      const movingPan = Math.sin(now * (0.037 + index * 0.006) + index * 1.7) * (0.22 + activity * 0.42);
      voice.panner.pan.setTargetAtTime(movingPan, now, 0.75);
    });

    this.sub.frequency.setTargetAtTime(Math.max(36, Math.min(120, this.currentRoot * 0.5)), now, 0.8);
    this.subGain.gain.setTargetAtTime(0.026 + density * 0.032 + coherence * 0.018, now, 0.6);
    const toneScale = 0.62 + this.tone * 0.86;
    this.padFilter.frequency.setTargetAtTime(
      (520 +
        density * 1650 +
        activity * 1100 +
        encounters * 620 +
        contactPressure * 720 +
        contactMotion * 280) *
        toneScale,
      now,
      0.32,
    );
    this.padFilter.Q.setTargetAtTime(0.8 + energy * 2.4, now, 0.4);
    const ambientPan = Math.sin(now * 0.043) * (0.14 + coherence * 0.24);
    this.fieldPan.pan.setTargetAtTime(
      ambientPan * (1 - contactPresence * 0.28) + contact.pan * contactPresence * 0.28,
      now,
      0.32,
    );
    this.masterFilter.frequency.setTargetAtTime(1400 + this.tone * 3600 + activity * 900, now, 0.5);
    this.noiseFilter.frequency.setTargetAtTime(
      (260 + density * 1250 + energy * 760) * (0.58 + this.tone * 0.92),
      now,
      0.38,
    );
    this.noiseGain.gain.setTargetAtTime(
      0.006 +
        activity * 0.026 * (1 - coherence * 0.42) +
        encounters * 0.012 +
        contactPressure * 0.008 +
        contactMotion * 0.007,
      now,
      0.28,
    );
    this.shimmerGain.gain.setTargetAtTime(
      0.05 + coherence * 0.16 + this.tone * 0.08 + halo * 0.035 + contactPressure * 0.018,
      now,
      0.9,
    );
    this.delay.delayTime.setTargetAtTime(0.43 + (1 - coherence) * 0.42 + memory * 0.08, now, 0.7);
    this.feedback.gain.setTargetAtTime(
      0.23 + activity * 0.2 + encounters * 0.07 + memory * 0.09 + contactMotion * 0.025,
      now,
      0.6,
    );
    this.reverbGain.gain.setTargetAtTime(
      0.36 + coherence * 0.2 + halo * 0.07 + memory * 0.04,
      now,
      0.8,
    );

    this.updateFormations(formations, now, metrics);

    if (!this.paused && now >= this.nextNoteTime) {
      this.playFieldNote(metrics, formations, now);
      const space =
        1.55 - activity * 0.46 - density * 0.24 - encounters * 0.3 + this.random() * 0.55;
      const flow = 0.88 + this.performance.flow * 0.12;
      this.nextNoteTime = now + Math.max(0.72, space / flow);
    }
  }

  /**
   * Match the reported formations to tracked voices by proximity, so each
   * visible cluster keeps one sustained tone that follows it across the
   * stereo image. A newly-born formation rings a soft emergence bell at its
   * own screen position.
   */
  updateFormations(formations, now, metrics) {
    const incoming = [];
    for (let offset = 0; offset + 3 < formations.length; offset += 4) {
      incoming.push({
        x: formations[offset],
        y: formations[offset + 1],
        share: formations[offset + 2],
        species: Math.max(0, Math.min(2, Math.round(formations[offset + 3]))),
      });
    }

    const matched = new Set();
    for (const track of this.tracked) {
      let best = -1;
      let bestDistance = 0.34;
      for (let index = 0; index < incoming.length; index += 1) {
        if (matched.has(index)) continue;
        const candidate = incoming[index];
        if (candidate.species !== track.species) continue;
        const distance = torusDistance(track.x, track.y, candidate.x, candidate.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      if (best >= 0) {
        const candidate = incoming[best];
        matched.add(best);
        track.x = candidate.x;
        track.y = candidate.y;
        track.share = candidate.share;
        track.lastSeen = now;
      }
    }

    // Release voices for formations that dissolved.
    this.tracked = this.tracked.filter((track) => {
      if (now - track.lastSeen < 0.7) return true;
      const voice = this.formationVoices[track.voice];
      voice.gain.gain.setTargetAtTime(0.0001, now, 1.4);
      voice.busy = false;
      return false;
    });

    // Adopt newly visible formations.
    for (let index = 0; index < incoming.length; index += 1) {
      if (matched.has(index)) continue;
      const candidate = incoming[index];
      const slot = this.formationVoices.findIndex((voice) => !voice.busy);
      if (slot < 0) break;
      const voice = this.formationVoices[slot];
      voice.busy = true;
      const track = {
        ...candidate,
        voice: slot,
        degree: (slot * 2 + candidate.species * 3) % SCALE.length,
        lastSeen: now,
        born: now,
      };
      this.tracked.push(track);
      if (!this.paused && now - this.lastEmergence > 0.5 && now - (track.born ?? 0) >= 0) {
        // The emergence bell speaks from where the new cell appeared.
        const frequency = this.formationFrequency(track);
        this.playTone(frequency * 2, 0.028 + candidate.share * 0.1, now + 0.02, 6.5, clampPan(candidate.x));
        this.lastEmergence = now;
      }
    }

    // Steer every active voice toward its formation's position and weight.
    for (const track of this.tracked) {
      const voice = this.formationVoices[track.voice];
      const frequency = this.formationFrequency(track);
      const level = Math.pow(track.share, 0.72) * (0.045 + (metrics?.[1] ?? 0) * 0.02);
      voice.primary.frequency.setTargetAtTime(frequency, now, 0.7);
      voice.partner.frequency.setTargetAtTime(frequency * 2.003, now, 0.7);
      voice.filter.frequency.setTargetAtTime(
        frequency * (2.2 + this.tone * 2.6) * (0.8 + (track.y + 1) * 0.35),
        now,
        0.6,
      );
      voice.gain.gain.setTargetAtTime(this.paused ? 0.0001 : level, now, 1.1);
      voice.panner.pan.setTargetAtTime(clampPan(track.x), now, 0.8);
    }
  }

  formationFrequency(track) {
    const semitones = SCALE[track.degree] + (track.species === 2 ? 12 : track.species === 1 ? 7 : 0);
    return this.currentRoot * 2 * Math.pow(2, semitones / 12);
  }

  playFieldNote(metrics, formations, when) {
    const [energy, coherence, activity, density, formationCount, , encounters = 0] = metrics;
    const walk = Math.floor(this.random() * Math.min(SCALE.length, 4 + Math.round(density * 4)));
    const octave = formationCount > 4 && this.random() > 0.62 ? 12 : 0;
    const semitones = SCALE[walk] + octave;
    const frequency = this.currentRoot * 2 * Math.pow(2, semitones / 12);
    const peak =
      0.045 + coherence * 0.038 + activity * 0.024 + encounters * 0.016 + this.random() * 0.018;
    const duration = 3.4 + (1 - activity) * 3.2 + this.random() * 1.8;
    // Sparse tones speak from a visible formation when one exists, so the ear
    // is drawn to the same places as the eye.
    let pan = (this.random() * 2 - 1) * (0.46 + activity * 0.35);
    if (formations.length >= 4) {
      const which = Math.floor(this.random() * (formations.length / 4)) * 4;
      pan = clampPan(formations[which] + (this.random() - 0.5) * 0.2);
    }
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
    filter.frequency.value = Math.min(4200, frequency * (3.1 + this.tone * 3.0));
    filter.Q.value = 0.7;
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    panner.pan.value = clampPan(pan);
    const attack = Math.min(duration * 0.4, 0.9);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(Math.max(0.0002, peak), when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(filter).connect(gain).connect(panner).connect(this.dry);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.1);
  }

  strike(intensity, energy = 0.5, pan = null) {
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
    panner.pan.value = pan === null ? this.random() * 1.6 - 0.8 : clampPan(pan);
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

  async startRecording() {
    if (!this.context || this.recorder) return false;
    await this.context.audioWorklet.addModule("/recorder.js");
    const node = new AudioWorkletNode(this.context, "confluon-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    const chunks = [];
    node.port.onmessage = (event) => {
      chunks.push(event.data);
    };
    // A silent tap: the worklet must reach the destination to be pulled by the
    // rendering graph, but contributes no sound.
    const silent = this.context.createGain();
    silent.gain.value = 0;
    this.limiter.connect(node);
    node.connect(silent).connect(this.context.destination);
    this.recorder = { node, silent, chunks, startedAt: this.context.currentTime };
    node.port.postMessage("start");
    return true;
  }

  stopRecording() {
    if (!this.context || !this.recorder) return null;
    const { node, silent, chunks, startedAt } = this.recorder;
    node.port.postMessage("stop");
    this.recorder = null;
    const duration = this.context.currentTime - startedAt;
    const finish = () => {
      this.limiter.disconnect(node);
      node.disconnect();
      silent.disconnect();
      return encodeWav(chunks, this.context.sampleRate);
    };
    // Give the final worklet chunk a moment to arrive before assembly.
    return new Promise((resolve) => {
      window.setTimeout(() => resolve({ blob: finish(), duration }), 120);
    });
  }

  recordingSeconds() {
    if (!this.context || !this.recorder) return 0;
    return this.context.currentTime - this.recorder.startedAt;
  }

  isRecording() {
    return Boolean(this.recorder);
  }

  captureStream() {
    return this.captureDestination?.stream ?? null;
  }

  reseed(seed) {
    this.seed = seed;
    this.random = seededRandom(seed ^ 0x91e1_0da5);
    this.currentRoot = 48;
    this.latestMetrics = [0.5, 0, 0, 0.5, 1, 0, 0];
    this.lastStrike = -Infinity;
    this.lastEmergence = -Infinity;
    this.nextNoteTime = this.context ? this.context.currentTime + 0.35 : Infinity;
    this.tracked = [];
    if (this.context) {
      const now = this.context.currentTime;
      for (const voice of this.formationVoices) {
        voice.busy = false;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.08);
      }
    }
  }

  setPerformance(settings) {
    this.performance = {
      ecology: Number(settings.ecology) || 1,
      flow: Number(settings.flow) || 1,
      gesture: Number(settings.gesture) || 1,
      glow: Number(settings.glow) || 1,
      memory: Number(settings.memory) || 0,
    };
  }

  setInteraction(interaction, pan = 0) {
    this.interaction = {
      influencing: Boolean(interaction.influencing),
      active: Boolean(interaction.active),
      present: Boolean(interaction.present),
      strength: Number(interaction.strength) || 0,
      twist: Number(interaction.twist) || 0,
      impulse: Number(interaction.impulse) || 0,
      motion: Number(interaction.motion) || 0,
      pan: clampPan(pan),
    };
  }

  cueControl(kind, value = 0.5) {
    if (!this.context || this.paused || !this.controlOscillator) return;
    const now = this.context.currentTime;
    const position = Math.max(0, Math.min(1, Number(value) || 0));
    const semitones = (CONTROL_STEPS[kind] ?? 7) + (position - 0.5) * 2;
    const frequency = this.currentRoot * 2 * Math.pow(2, semitones / 12);
    this.lastControlCue = { kind, position, frequency };
    this.controlOscillator.frequency.setTargetAtTime(frequency, now, 0.035);
    this.controlFilter.frequency.setTargetAtTime(frequency * (3.2 + this.tone * 1.8), now, 0.04);
    this.controlPan.pan.setTargetAtTime((position - 0.5) * 0.5, now, 0.04);
    this.controlGain.gain.cancelScheduledValues(now);
    this.controlGain.gain.setValueAtTime(Math.max(0.0001, this.controlGain.gain.value), now);
    this.controlGain.gain.linearRampToValueAtTime(0.014, now + 0.018);
    this.controlGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  }

  setLevel(level) {
    this.level = Math.max(0, Math.min(1, level));
    if (this.context && !this.paused) {
      this.master.gain.setTargetAtTime(this.targetLevel(), this.context.currentTime, 0.1);
    }
  }

  setTone(tone) {
    this.tone = Math.max(0, Math.min(1, Number(tone)));
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

  diagnostics() {
    return {
      state: this.state(),
      performance: { ...this.performance },
      interaction: { ...this.interaction },
      lastControlCue: this.lastControlCue ? { ...this.lastControlCue } : null,
    };
  }
}

function clampPan(pan) {
  return Math.max(-0.92, Math.min(0.92, pan * 0.92));
}

function torusDistance(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > 1) dx = 2 - dx;
  if (dy > 1) dy = 2 - dy;
  return Math.hypot(dx, dy);
}

function claimPlaybackSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch (_) {
    // AudioSession is a best-effort WebKit enhancement.
  }
}

function makeSaturationCurve(drive) {
  const length = 1024;
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
}

function makeOctaveCurve() {
  const length = 1024;
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = 2 * x * x - 1;
  }
  return curve;
}

function makeNoiseBuffer(context, seed) {
  const length = context.sampleRate * 4;
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const random = seededRandom(seed ^ (channel * 0x9e37));
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = random() * 2 - 1;
      previous = previous * 0.82 + white * 0.18;
      data[index] = previous * 0.72;
    }
  }
  return buffer;
}

/**
 * Procedural hall: sparse early reflections inside the first 180 ms, then a
 * noise tail whose lowpass closes as it decays so the room darkens naturally.
 */
function makeImpulseResponse(context, seed, seconds) {
  const rate = context.sampleRate;
  const length = Math.floor(rate * seconds);
  const response = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < response.numberOfChannels; channel += 1) {
    const data = response.getChannelData(channel);
    const random = seededRandom(seed ^ (channel * 0x51ed));
    for (let reflection = 0; reflection < 12; reflection += 1) {
      const at = Math.floor((0.008 + reflection * 0.014 + channel * 0.0017 * reflection) * rate);
      if (at >= length) continue;
      const sign = reflection % 2 === 0 ? 1 : -1;
      data[at] += sign * (0.5 - reflection * 0.035) * (0.7 + random() * 0.3);
    }
    let lowpass = 0;
    for (let index = 0; index < length; index += 1) {
      const t = index / rate;
      const cutoff = 0.04 + 0.5 * Math.exp(-t / 1.1);
      lowpass += cutoff * ((random() * 2 - 1) - lowpass);
      const decay = Math.exp(-t / (seconds * 0.42));
      const onset = 1 - Math.exp(-t / 0.015);
      data[index] += lowpass * decay * onset * 0.5;
    }
  }
  return response;
}

function encodeWav(chunks, sampleRate) {
  let frames = 0;
  for (const chunk of chunks) frames += chunk.left.length;
  const bytesPerSample = 4;
  const blockAlign = bytesPerSample * 2;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 32, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (const chunk of chunks) {
    const { left, right } = chunk;
    for (let index = 0; index < left.length; index += 1) {
      view.setFloat32(offset, left[index], true);
      view.setFloat32(offset + 4, right[index] ?? left[index], true);
      offset += 8;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
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
