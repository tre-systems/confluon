import init, { Engine } from "/pkg/confluon.js";
import { ConfluonAudio } from "./audio.js";
import { createRenderer } from "./renderer.js";
import {
  captureException,
  initializeMonitoring,
  setRuntimeTag,
} from "./monitoring.js";

const FIXED_STEP = 1 / 30;
const IDLE_CONTROLS_MS = 9000;
const GESTURE_MODES = new Set(["gather", "orbit", "divide"]);
const SOUND_START_EVENTS = [
  "pointerdown",
  "pointerup",
  "touchend",
  "mousedown",
  "click",
  "keydown",
  "wheel",
];
const settings = readPerformanceSettings();

const elements = {
  instrument: document.querySelector("#instrument"),
  field: document.querySelector("#field"),
  traces: document.querySelector("#traces"),
  controls: document.querySelector("#controls"),
  controlsToggle: document.querySelector("#controls-toggle"),
  fieldScore: document.querySelector("#field-score"),
  newSeed: document.querySelector("#new-seed"),
  settle: document.querySelector("#settle"),
  pause: document.querySelector("#pause"),
  volume: document.querySelector("#volume"),
  record: document.querySelector("#record"),
  recordTime: document.querySelector("#record-time"),
  shareLink: document.querySelector("#share-link"),
  population: document.querySelector("#population"),
  populationLabel: document.querySelector("#population-label"),
  ecology: document.querySelector("#ecology"),
  flow: document.querySelector("#flow"),
  gesture: document.querySelector("#gesture"),
  glow: document.querySelector("#glow"),
  memory: document.querySelector("#memory"),
  tone: document.querySelector("#tone"),
  ecologyLabel: document.querySelector("#ecology-label"),
  flowLabel: document.querySelector("#flow-label"),
  gestureLabel: document.querySelector("#gesture-label"),
  glowLabel: document.querySelector("#glow-label"),
  memoryLabel: document.querySelector("#memory-label"),
  toneLabel: document.querySelector("#tone-label"),
  gestureModes: Array.from(document.querySelectorAll("[data-gesture]")),
  seed: document.querySelector("#seed-value"),
  audioState: document.querySelector("#audio-state"),
  runtimeStatus: document.querySelector("#runtime-status"),
};

const state = {
  running: true,
  started: false,
  starting: false,
  settle: false,
  gestureMode: settings.mode,
  previousTransition: 0,
  pointer: {
    active: false,
    present: false,
    type: "mouse",
    x: 0,
    y: 0,
    impulse: 0,
    motion: 0,
    lastMoveAt: 0,
    lastX: 0,
    lastY: 0,
    mode: settings.mode,
    downAt: 0,
    downX: 0,
    downY: 0,
  },
  lastTapAt: -Infinity,
  lastTapX: 0,
  lastTapY: 0,
};

let seed = readSeed();
let engine;
let renderer;
let audio;
let idleTimer;
let shareFeedbackTimer;
let visualSnapshot;
let visualMetrics;

await initializeMonitoring();

try {
  await init();
  engine = new Engine(seed, settings.population);
  resetVisualSmoothing();
  renderer = await createRenderer(elements.field, elements.traces, {
    onDeviceLost: recoverFromRendererLoss,
  });
  audio = new ConfluonAudio(seed);
  applyPerformanceSettings(false);
  setRuntimeTag("renderer", renderer.kind.toLowerCase());
  elements.seed.textContent = formatSeed(seed);
  installControls();
  exposeDiagnostics();
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  captureException(error, { stage: "instrument_initialization" });
  elements.runtimeStatus.textContent = "This browser could not start the instrument.";
  elements.runtimeStatus.classList.add("error");
}

async function recoverFromRendererLoss(info) {
  if (renderer?.kind !== "WEBGPU") return;
  elements.runtimeStatus.textContent = "Graphics device changed. Continuing with Canvas.";
  try {
    renderer = await createRenderer(elements.field, elements.traces, { forceCanvas: true });
    setRuntimeTag("renderer", renderer.kind.toLowerCase());
  } catch (error) {
    captureException(error, {
      stage: "renderer_recovery",
      reason: info?.reason || "unknown",
    });
    elements.runtimeStatus.textContent = "The graphics renderer could not recover.";
    elements.runtimeStatus.classList.add("error");
  }
}

function installControls() {
  SOUND_START_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, startExperience, { capture: true, passive: true });
  });
  elements.controlsToggle.addEventListener("click", () => {
    setControlsOpen(elements.controls.classList.contains("collapsed"));
  });
  elements.shareLink.textContent = shareButtonLabel();
  elements.shareLink.addEventListener("click", sharePerformance);
  elements.fieldScore.addEventListener("change", () => {
    if (!elements.fieldScore.value) return;
    const name = elements.fieldScore.selectedOptions[0]?.textContent.trim() || "field";
    loadFieldScore(elements.fieldScore.value, name);
  });

  document.addEventListener("pointerdown", (event) => {
    wakeControls();
    if (!elements.controls.classList.contains("collapsed") && !elements.controls.contains(event.target)) {
      setControlsOpen(false);
    }
  });

  ["pointermove", "keydown", "wheel"].forEach((eventName) => {
    window.addEventListener(eventName, wakeControls, { passive: true });
  });
  ["pointerup", "touchend", "click", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, resumeSound, { capture: true, passive: true });
  });
  wakeControls();

  elements.gestureModes.forEach((button) => {
    button.addEventListener("click", () => setGestureMode(button.dataset.gesture));
  });

  [
    elements.ecology,
    elements.flow,
    elements.gesture,
    elements.glow,
    elements.memory,
    elements.tone,
  ].forEach((control) => {
    control.addEventListener("input", () => {
      readSettingsFromControls();
      applyPerformanceSettings(true);
      audio.cueControl(control.id, Number(control.value) / Number(control.max));
    });
  });

  elements.field.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    updatePointerPosition(event, false);
    state.pointer.present = true;
  });

  elements.field.addEventListener("pointerdown", (event) => {
    const point = updatePointerPosition(event, false);
    state.pointer.active = true;
    state.pointer.present = true;
    state.pointer.impulse = 1;
    state.pointer.downX = point.x;
    state.pointer.downY = point.y;
    state.pointer.downAt = performance.now();
    configurePointerGesture(event);
    elements.field.setPointerCapture(event.pointerId);
  });

  elements.field.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" && !state.pointer.active) return;
    updatePointerPosition(event, true);
    state.pointer.present = true;
    if (state.pointer.active) configurePointerGesture(event);
  });

  elements.field.addEventListener("pointerup", (event) => {
    const point = updatePointerPosition(event, true);
    const duration = performance.now() - state.pointer.downAt;
    const travel = Math.hypot(point.x - state.pointer.downX, point.y - state.pointer.downY);
    state.pointer.active = false;
    state.pointer.present = event.pointerType !== "touch" && point.inside;
    elements.instrument.removeAttribute("data-active-gesture");
    if (duration > 90 || travel > 0.025) {
      const strikeStrength =
        state.pointer.mode === "orbit" ? 0.72 : state.pointer.mode === "divide" ? 0.64 : 0.5;
      audio.strike(strikeStrength, engine.metrics()[0], point.x);
    }
    if (event.pointerType !== "mouse" && duration < 230 && travel < 0.055) {
      const now = performance.now();
      const closeToLastTap = Math.hypot(point.x - state.lastTapX, point.y - state.lastTapY) < 0.16;
      if (now - state.lastTapAt < 330 && closeToLastTap) {
        spawn(point.x, point.y);
        state.lastTapAt = -Infinity;
      } else {
        state.lastTapAt = now;
        state.lastTapX = point.x;
        state.lastTapY = point.y;
      }
    }
  });

  elements.field.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "touch" || !state.pointer.active) {
      state.pointer.present = false;
    }
  });
  elements.field.addEventListener("pointercancel", () => {
    state.pointer.active = false;
    state.pointer.present = false;
    elements.instrument.removeAttribute("data-active-gesture");
  });
  elements.field.addEventListener("dblclick", (event) => {
    const point = eventPoint(event);
    spawn(point.x, point.y);
  });

  elements.newSeed.addEventListener("click", newField);

  const settleOn = (event) => {
    event.preventDefault();
    state.settle = true;
    elements.settle.classList.add("active");
  };
  const settleOff = () => {
    if (!state.settle) return;
    state.settle = false;
    elements.settle.classList.remove("active");
    audio.strike(0.58, engine.metrics()[0]);
  };
  elements.settle.addEventListener("pointerdown", settleOn);
  window.addEventListener("pointerup", settleOff);
  elements.settle.addEventListener("pointercancel", settleOff);

  elements.pause.addEventListener("click", togglePause);
  elements.record.addEventListener("click", toggleRecording);
  elements.population.addEventListener("change", () => {
    settings.population = clampPopulation(Number(elements.population.value));
    engine = new Engine(seed, settings.population);
    engine.set_ecology(settings.ecology);
    audio.setPerformance(settings);
    resetVisualSmoothing();
    renderer.resetTrails();
    updateSettingLabels();
    syncSettingsUrl();
    audio.cueControl("population", settings.population / 4096);
  });
  elements.volume.addEventListener("input", () => {
    settings.level = Number(elements.volume.value) / 100;
    audio.setLevel(settings.level);
    syncSettingsUrl();
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat && event.code !== "KeyS") return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    } else if (event.code === "KeyR") {
      engine.reset(seed);
      audio.reseed(seed);
      resetVisualSmoothing();
      renderer.resetTrails();
      audio.strike(0.62, 0.5);
    } else if (event.code === "KeyS") {
      state.settle = true;
      elements.settle.classList.add("active");
    } else if (event.code === "KeyG") {
      setGestureMode("gather");
    } else if (event.code === "KeyO") {
      setGestureMode("orbit");
    } else if (event.code === "KeyD") {
      setGestureMode("divide");
    } else if (event.code === "Escape") {
      setControlsOpen(false);
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "KeyS") settleOff();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.started) {
      audio.setPaused(true);
    } else if (state.started) {
      audio.setPaused(!state.running);
      resumeSound();
    }
  });
}

function configurePointerGesture(event) {
  const mode = event.altKey ? "divide" : event.shiftKey ? "orbit" : state.gestureMode;
  state.pointer.mode = mode;
  elements.instrument.dataset.activeGesture = mode;
}

function pointerInteraction() {
  const pointer = state.pointer;
  const amount = settings.gesture;
  const hovering = pointer.present && pointer.type !== "touch";
  let strength = hovering ? 0.24 * amount : 0;
  let twist = 0;

  if (pointer.active && pointer.mode === "divide") {
    strength = -1.22 * amount;
    twist = -0.08 * amount;
  } else if (pointer.active && pointer.mode === "orbit") {
    strength = 0.12 * amount;
    twist = 1.18 * amount;
  } else if (pointer.active) {
    strength = 1.0 * amount;
  }

  // Organisms recoil from a sudden poke or fast approach, then become
  // curious about a held finger or still cursor. The impulse persists after
  // release so a short tap cannot vanish between fixed simulation steps.
  const movementAlarm = hovering || pointer.active ? Math.min(0.9, pointer.motion * 0.22) : 0;
  strength -= (pointer.impulse * 2.4 + movementAlarm) * amount;

  return {
    strength,
    twist,
    influencing:
      pointer.active ||
      hovering ||
      pointer.impulse > 0.008 ||
      (pointer.present && pointer.motion > 0.008),
  };
}

function decayPointerInteraction(dt) {
  const pointer = state.pointer;
  pointer.impulse *= Math.exp(-dt / 0.18);
  pointer.motion *= Math.exp(-dt / 0.14);
  if (pointer.impulse < 0.008) pointer.impulse = 0;
  if (pointer.motion < 0.008) pointer.motion = 0;
}

function updatePointerPosition(event, trackMotion) {
  const point = eventPoint(event);
  const pointer = state.pointer;
  const now = event.timeStamp;

  if (trackMotion && pointer.lastMoveAt > 0) {
    const elapsed = Math.max(0.008, Math.min(0.08, (now - pointer.lastMoveAt) / 1000));
    const distance = Math.hypot(point.x - pointer.lastX, point.y - pointer.lastY);
    const speed = Math.min(4, distance / elapsed);
    pointer.motion = pointer.motion * 0.35 + speed * 0.65;
  } else {
    pointer.motion *= 0.5;
  }

  pointer.x = point.x;
  pointer.y = point.y;
  pointer.lastX = point.x;
  pointer.lastY = point.y;
  pointer.lastMoveAt = now;
  pointer.type = event.pointerType || "mouse";
  return point;
}

function setGestureMode(mode, updateUrl = true) {
  if (!GESTURE_MODES.has(mode)) return;
  state.gestureMode = mode;
  settings.mode = mode;
  elements.instrument.dataset.gesture = mode;
  elements.gestureModes.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.gesture === mode));
  });
  if (updateUrl) {
    syncSettingsUrl();
    audio.cueControl(`gesture-${mode}`, ["gather", "orbit", "divide"].indexOf(mode) / 2);
  }
}

function clampPopulation(value) {
  if (!Number.isFinite(value)) return 2000;
  return Math.max(600, Math.min(4096, Math.round(value)));
}

function readSettingsFromControls() {
  settings.ecology = Number(elements.ecology.value) / 100;
  settings.flow = Number(elements.flow.value) / 100;
  settings.gesture = Number(elements.gesture.value) / 100;
  settings.glow = Number(elements.glow.value) / 100;
  settings.memory = Number(elements.memory.value) / 100;
  settings.tone = Number(elements.tone.value) / 100;
}

function applyPerformanceSettings(updateUrl) {
  elements.ecology.value = String(Math.round(settings.ecology * 100));
  elements.flow.value = String(Math.round(settings.flow * 100));
  elements.gesture.value = String(Math.round(settings.gesture * 100));
  elements.glow.value = String(Math.round(settings.glow * 100));
  elements.memory.value = String(Math.round(settings.memory * 100));
  elements.tone.value = String(Math.round(settings.tone * 100));
  elements.volume.value = String(Math.round(settings.level * 100));
  elements.population.value = String(settings.population);
  updateSettingLabels();
  engine.set_ecology(settings.ecology);
  renderer.setStyle({
    glow: settings.glow,
    memory: settings.memory,
    core: 0.86 + settings.glow * 0.14,
  });
  audio.setTone(settings.tone);
  audio.setLevel(settings.level);
  audio.setPerformance(settings);
  setGestureMode(settings.mode, false);
  if (updateUrl) syncSettingsUrl();
}

function updateSettingLabels() {
  elements.ecologyLabel.textContent = settingWord(
    settings.ecology,
    [0.72, 1.28],
    ["CALM", "BALANCED", "VOLATILE"],
  );
  elements.flowLabel.textContent = settingWord(
    settings.flow,
    [0.78, 1.28],
    ["GLACIAL", "NATURAL", "QUICK"],
  );
  elements.gestureLabel.textContent = settingWord(
    settings.gesture,
    [0.78, 1.3],
    ["DELICATE", "FIRM", "FORCEFUL"],
  );
  elements.glowLabel.textContent = settingWord(
    settings.glow,
    [0.76, 1.28],
    ["BARE", "SOFT", "LUMINOUS"],
  );
  elements.memoryLabel.textContent = settingWord(
    settings.memory,
    [0.3, 0.72],
    ["CLEAR", "BRIEF", "LINGERING"],
  );
  elements.toneLabel.textContent = settingWord(
    settings.tone,
    [0.33, 0.72],
    ["DARK", "WARM", "BRIGHT"],
  );
  elements.populationLabel.textContent = settingWord(
    settings.population,
    [1400, 3000],
    ["SPARSE", "FULL", "TEEMING"],
  );
  [
    [elements.ecology, elements.ecologyLabel],
    [elements.flow, elements.flowLabel],
    [elements.gesture, elements.gestureLabel],
    [elements.glow, elements.glowLabel],
    [elements.memory, elements.memoryLabel],
    [elements.tone, elements.toneLabel],
    [elements.population, elements.populationLabel],
  ].forEach(([control, label]) => {
    control.setAttribute("aria-valuetext", label.textContent.toLowerCase());
  });
}

function settingWord(value, [low, high], [below, middle, above]) {
  return value < low ? below : value > high ? above : middle;
}

async function startExperience() {
  if (state.started) {
    await resumeSound();
    return;
  }
  if (state.starting) return;
  state.starting = true;
  try {
    await audio.start();
    audio.setLevel(Number(elements.volume.value) / 100);
    audio.wake(engine.metrics());
    state.started = true;
    setAudioState();
    SOUND_START_EVENTS.forEach((eventName) => {
      window.removeEventListener(eventName, startExperience, { capture: true });
    });
  } catch (error) {
    if (["suspended", "interrupted"].includes(audio.state())) {
      elements.audioState.dataset.state = "waiting";
      elements.audioState.textContent = "sound waiting";
      return;
    }
    console.error(error);
    captureException(error, { stage: "audio_start" });
    elements.audioState.dataset.state = "error";
    elements.audioState.textContent = "sound unavailable";
    elements.runtimeStatus.textContent = "Sound did not start. Check this tab’s audio permission and try again.";
    elements.runtimeStatus.classList.add("error");
  } finally {
    state.starting = false;
  }
}

async function resumeSound() {
  if (!state.started || audio.state() === "running") return;
  try {
    await audio.resume();
    setAudioState();
  } catch (error) {
    console.warn("Could not resume audio", error);
    captureException(error, { stage: "audio_resume" });
  }
}

function setControlsOpen(open) {
  elements.controls.classList.toggle("collapsed", !open);
  elements.controlsToggle.setAttribute("aria-expanded", String(open));
  elements.controlsToggle.setAttribute("aria-label", open ? "Hide controls" : "Show controls");
  wakeControls();
}

function wakeControls() {
  elements.controls.classList.remove("idle-hidden");
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (elements.controls.classList.contains("collapsed")) {
      elements.controls.classList.add("idle-hidden");
    }
  }, IDLE_CONTROLS_MS);
}

let previousTime = performance.now() / 1000;
let accumulator = 0;
let lastReadout = 0;
let fpsWindowStarted = performance.now();
let fpsFrameCount = 0;
let measuredFps = 0;

function frame(milliseconds) {
  fpsFrameCount += 1;
  if (milliseconds - fpsWindowStarted >= 1000) {
    measuredFps = (fpsFrameCount * 1000) / (milliseconds - fpsWindowStarted);
    elements.instrument.dataset.fps = measuredFps.toFixed(1);
    fpsFrameCount = 0;
    fpsWindowStarted = milliseconds;
  }
  const time = milliseconds / 1000;
  const elapsed = Math.min(0.05, Math.max(0, time - previousTime));
  previousTime = time;
  accumulator += elapsed * settings.flow;

  if (state.running) {
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 2) {
      const interaction = pointerInteraction();
      engine.step(
        FIXED_STEP,
        state.pointer.x,
        state.pointer.y,
        interaction.influencing ? interaction.strength : 0,
        interaction.influencing ? interaction.twist : 0,
        state.settle,
      );
      decayPointerInteraction(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
  } else {
    accumulator = 0;
  }

  const snapshot = engine.snapshot();
  const metrics = engine.metrics();
  const visualState = smoothVisualState(snapshot, metrics, elapsed);
  renderer.render(visualState.snapshot, visualState.metrics, time);
  const audibleInteraction = pointerInteraction();
  audio.setInteraction(
    {
      ...audibleInteraction,
      active: state.pointer.active,
      present: state.pointer.present,
      impulse: state.pointer.impulse,
      motion: state.pointer.motion,
    },
    state.pointer.x,
  );
  audio.update(metrics, engine.formations());
  if (metrics[5] > 0.24 && state.previousTransition <= 0.24 && state.running) {
    audio.strike(metrics[5], metrics[0]);
  }
  state.previousTransition = metrics[5];

  if (milliseconds - lastReadout > 160) {
    if (audio.isRecording()) {
      elements.recordTime.textContent = formatRecordTime(audio.recordingSeconds());
    }
    elements.instrument.dataset.particles = String(engine.particle_count());
    setAudioState();
    lastReadout = milliseconds;
  }
  requestAnimationFrame(frame);
}

function resetVisualSmoothing() {
  visualSnapshot = new Float32Array(engine.snapshot());
  visualMetrics = Array.from(engine.metrics());
}

function smoothVisualState(snapshot, metrics, elapsed) {
  if (!visualSnapshot || visualSnapshot.length !== snapshot.length) {
    visualSnapshot = new Float32Array(snapshot);
  } else {
    const positionBlend = 1 - Math.exp(-elapsed / 0.052);
    const attributeBlend = 1 - Math.exp(-elapsed / 0.09);
    for (let offset = 0; offset < snapshot.length; offset += 4) {
      visualSnapshot[offset] = smoothWrappedCoordinate(
        visualSnapshot[offset],
        snapshot[offset],
        positionBlend,
      );
      visualSnapshot[offset + 1] = smoothWrappedCoordinate(
        visualSnapshot[offset + 1],
        snapshot[offset + 1],
        positionBlend,
      );
      visualSnapshot[offset + 2] +=
        (snapshot[offset + 2] - visualSnapshot[offset + 2]) * attributeBlend;
      visualSnapshot[offset + 3] +=
        (snapshot[offset + 3] - visualSnapshot[offset + 3]) * attributeBlend;
    }
  }

  if (!visualMetrics || visualMetrics.length !== metrics.length) {
    visualMetrics = Array.from(metrics);
  } else {
    for (let index = 0; index < metrics.length; index += 1) {
      const target = metrics[index];
      const timeConstant =
        index === 5 ? (target > visualMetrics[index] ? 0.085 : 0.48) : 0.22;
      const blend = 1 - Math.exp(-elapsed / timeConstant);
      visualMetrics[index] += (target - visualMetrics[index]) * blend;
    }
  }

  return { snapshot: visualSnapshot, metrics: visualMetrics };
}

function smoothWrappedCoordinate(current, target, blend) {
  let difference = target - current;
  if (difference > 1) difference -= 2;
  if (difference < -1) difference += 2;
  let value = current + difference * blend;
  if (value > 1) value -= 2;
  if (value < -1) value += 2;
  return value;
}

function spawn(x, y) {
  engine.spawn_at(x, y, 50);
  audio.strike(0.84, engine.metrics()[0], x);
}

function newField() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  seed = values[0] || 1;
  engine.reset(seed);
  resetVisualSmoothing();
  renderer.resetTrails();
  audio.reseed(seed);
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed.toString());
  window.history.replaceState({}, "", url);
  elements.fieldScore.value = "";
  elements.seed.textContent = formatSeed(seed);
  audio.strike(0.72, 0.42);
}

function loadFieldScore(source, name) {
  const featuredUrl = new URL(source, window.location.href);
  const featuredSeed = Number(featuredUrl.searchParams.get("seed"));
  if (!Number.isInteger(featuredSeed) || featuredSeed <= 0 || featuredSeed > 0xffffffff) return;

  seed = featuredSeed >>> 0;
  Object.assign(settings, readPerformanceSettings(featuredUrl));
  engine = new Engine(seed, settings.population);
  resetVisualSmoothing();
  renderer.resetTrails();
  audio.reseed(seed);
  applyPerformanceSettings(false);
  window.history.replaceState({}, "", `${featuredUrl.pathname}${featuredUrl.search}`);
  elements.seed.textContent = formatSeed(seed);
  elements.runtimeStatus.textContent = `Entered ${name}, seed ${formatSeed(seed)}.`;
  setControlsOpen(false);
  if (state.started) audio.strike(0.7, engine.metrics()[0]);
}

async function toggleRecording() {
  if (!state.started) {
    elements.runtimeStatus.textContent = "Touch the field once to start sound before recording.";
    return;
  }
  if (audio.isRecording()) {
    elements.record.disabled = true;
    try {
      const take = await audio.stopRecording();
      if (take) downloadTake(take.blob, take.duration);
    } finally {
      elements.record.disabled = false;
      elements.record.classList.remove("active");
      elements.recordTime.hidden = true;
    }
    return;
  }
  try {
    const started = await audio.startRecording();
    if (started) {
      elements.record.classList.add("active");
      elements.recordTime.hidden = false;
    }
  } catch (error) {
    console.error("Could not start recording", error);
    captureException(error, { stage: "recording_start" });
    elements.runtimeStatus.textContent = "Recording is unavailable in this browser.";
  }
}

function downloadTake(blob, duration) {
  const seconds = Math.round(duration);
  const name = `confluon-${formatSeed(seed)}-${seconds}s.wav`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  elements.runtimeStatus.textContent = `Saved ${name} (32-bit float WAV).`;
}

function formatRecordTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function togglePause() {
  state.running = !state.running;
  elements.pause.textContent = state.running ? "Pause" : "Resume";
  elements.pause.classList.toggle("active", !state.running);
  audio.setPaused(!state.running);
}

function setAudioState() {
  const current = audio?.state() ?? "waiting";
  const meter = audio?.meter() ?? { rms: 0, peak: 0 };
  elements.audioState.dataset.state = current;
  elements.audioState.textContent =
    current === "running" ? "sound running" : current === "waiting" ? "sound waiting" : `sound ${current}`;
  elements.instrument.dataset.audioState = current;
  elements.instrument.dataset.audioRms = meter.rms.toFixed(5);
  elements.instrument.dataset.audioPeak = meter.peak.toFixed(5);
}

function exposeDiagnostics() {
  window.confluon = Object.freeze({
    prepareCapture,
    beginCapture,
    captureAudioStream: () => audio.captureStream(),
    audioState: () => audio.state(),
    audioMeter: () => audio.meter(),
    audioResponse: () => audio.diagnostics(),
    renderer: () => renderer.kind,
    metrics: () => Array.from(engine.metrics()),
    particleCount: () => engine.particle_count(),
    fps: () => measuredFps,
    gestureMode: () => state.gestureMode,
    interaction: () => ({
      active: state.pointer.active,
      present: state.pointer.present,
      type: state.pointer.type,
      impulse: state.pointer.impulse,
      motion: state.pointer.motion,
      ...pointerInteraction(),
    }),
    seed: () => seed,
    settings: () => ({ ...settings }),
  });
}

async function prepareCapture() {
  await audio.start();
  audio.setLevel(settings.level);
  audio.setPaused(true);
  state.started = true;
  state.running = false;
  state.settle = false;
  state.pointer.active = false;
  state.pointer.present = false;
  state.pointer.impulse = 0;
  state.pointer.motion = 0;
  state.previousTransition = 0;
  accumulator = 0;
  engine.reset(seed);
  resetVisualSmoothing();
  renderer.resetTrails();
  audio.reseed(seed);
  setControlsOpen(false);
  // Let the master reach silence before MediaRecorder starts. beginCapture()
  // then opens it with the normal slow attack on the first recorded frame.
  await new Promise((resolve) => window.setTimeout(resolve, 180));
  return {
    seed,
    renderer: renderer.kind,
    particles: engine.particle_count(),
    settings: { ...settings },
  };
}

function beginCapture() {
  previousTime = performance.now() / 1000;
  fpsWindowStarted = performance.now();
  fpsFrameCount = 0;
  measuredFps = 0;
  accumulator = 0;
  state.running = true;
  audio.setPaused(false);
  audio.wake(engine.metrics());
}

function eventPoint(event) {
  const rect = elements.field.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((event.clientY - rect.top) / rect.height) * 2,
    inside:
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom,
  };
}

function formatSeed(value) {
  return value.toString(16).toUpperCase().padStart(8, "0");
}

function readSeed() {
  const value = Number(new URL(window.location.href).searchParams.get("seed"));
  if (Number.isInteger(value) && value > 0 && value <= 0xffffffff) return value >>> 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const generated = values[0] || 1;
  const url = new URL(window.location.href);
  url.searchParams.set("seed", generated.toString());
  window.history.replaceState({}, "", url);
  return generated;
}

function readPerformanceSettings(source = window.location.href) {
  const parameters = new URL(source, window.location.href).searchParams;
  const mode = parameters.get("mode");
  return {
    ecology: readScaledParameter(parameters, "ecology", 1, 0.25, 1.8),
    flow: readScaledParameter(parameters, "flow", 1, 0.5, 1.8),
    gesture: readScaledParameter(parameters, "touch", 1, 0.5, 1.8),
    glow: readScaledParameter(parameters, "halo", 1, 0.45, 1.55),
    memory: readScaledParameter(parameters, "memory", 0.42, 0, 1),
    tone: readScaledParameter(parameters, "tone", 0.55, 0, 1),
    level: readScaledParameter(parameters, "level", 0.74, 0, 1),
    population: clampPopulation(Number(parameters.get("life") ?? 2000)),
    mode: GESTURE_MODES.has(mode) ? mode : "gather",
  };
}

function readScaledParameter(parameters, key, fallback, minimum, maximum) {
  if (!parameters.has(key)) return fallback;
  const value = Number(parameters.get(key)) / 100;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function syncSettingsUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("ecology", String(Math.round(settings.ecology * 100)));
  url.searchParams.set("flow", String(Math.round(settings.flow * 100)));
  url.searchParams.set("touch", String(Math.round(settings.gesture * 100)));
  url.searchParams.set("halo", String(Math.round(settings.glow * 100)));
  url.searchParams.set("memory", String(Math.round(settings.memory * 100)));
  url.searchParams.set("tone", String(Math.round(settings.tone * 100)));
  url.searchParams.set("level", String(Math.round(settings.level * 100)));
  url.searchParams.set("life", String(settings.population));
  url.searchParams.set("mode", settings.mode);
  window.history.replaceState({}, "", url);
}

function shareButtonLabel() {
  return supportsNativeShare() ? "Share" : "Copy link";
}

function supportsNativeShare() {
  return window.matchMedia("(pointer: coarse)").matches && typeof navigator.share === "function";
}

async function sharePerformance() {
  syncSettingsUrl();
  const shareUrl = window.location.href;
  const shareData = {
    title: "Confluon",
    text: `Enter Confluon at seed ${formatSeed(seed)}.`,
    url: shareUrl,
  };

  if (supportsNativeShare()) {
    try {
      if (typeof navigator.canShare !== "function" || navigator.canShare(shareData)) {
        await navigator.share(shareData);
        showShareFeedback("Shared", "Shared this seeded performance.");
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        elements.runtimeStatus.textContent = "Sharing cancelled.";
        return;
      }
      captureException(error, { stage: "native_share" });
    }
  }

  await copyPerformanceLink(shareUrl);
}

async function copyPerformanceLink(shareUrl) {
  let copied = false;

  try {
    await navigator.clipboard.writeText(shareUrl);
    copied = true;
  } catch {
    const temporaryInput = document.createElement("textarea");
    try {
      temporaryInput.value = shareUrl;
      temporaryInput.setAttribute("readonly", "");
      temporaryInput.style.position = "fixed";
      temporaryInput.style.opacity = "0";
      document.body.append(temporaryInput);
      temporaryInput.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      temporaryInput.remove();
    }
  }

  showShareFeedback(
    copied ? "Copied" : "Copy failed",
    copied
      ? "Copied this seeded performance link."
      : "The link could not be copied. Copy it from the address bar instead.",
  );
}

function showShareFeedback(label, status) {
  window.clearTimeout(shareFeedbackTimer);
  elements.shareLink.textContent = label;
  elements.runtimeStatus.textContent = status;
  shareFeedbackTimer = window.setTimeout(() => {
    elements.shareLink.textContent = shareButtonLabel();
  }, 2400);
}
