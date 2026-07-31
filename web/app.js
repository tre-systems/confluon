import init, { Engine } from "/pkg/confluon.js";
import { ConfluonAudio } from "./audio.js";
import { createRenderer } from "./renderer.js";
import {
  captureException,
  initializeMonitoring,
  setRuntimeTag,
} from "./monitoring.js";
import {
  clampPopulation,
  encodePerformanceState,
  GESTURE_MODES,
  isGestureMode,
  parsePerformanceSettings,
  parseSeed,
} from "./performance-state.js";
import {
  METRIC_FIELD,
  PARTICLE_FIELD,
  PARTICLE_STRIDE,
  SIMULATION_CONTRACT_VERSION,
} from "./simulation-contract.js";
import { clientPointToWorld } from "./viewport-projection.js";

const FIXED_STEP = 1 / 30;
const MAX_CATCH_UP_STEPS = 2;
const CONFLUON_API_VERSION = 1;
const SOUND_START_EVENTS = [
  "pointerdown",
  "pointerup",
  "touchend",
  "mousedown",
  "click",
  "keydown",
  "wheel",
];
const settings = parsePerformanceSettings(window.location.href);

const elements = {
  instrument: document.querySelector("#instrument"),
  field: document.querySelector("#field"),
  traces: document.querySelector("#traces"),
  controls: document.querySelector("#controls"),
  controlsToggle: document.querySelector("#controls-toggle"),
  fieldScore: document.querySelector("#field-score"),
  volume: document.querySelector("#volume"),
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
  lastPointerSpawnAt: -Infinity,
};

let seed = readSeed();
let engine;
let renderer;
let audio;
let visualSnapshot;
let visualMetrics;

const monitoringReady = initializeMonitoring();

try {
  await init();
  engine = new Engine(seed, settings.population);
  resetVisualSmoothing();
  renderer = await createRenderer(elements.field, elements.traces, {
    onDeviceLost: recoverFromRendererLoss,
  });
  audio = new ConfluonAudio(seed);
  applyPerformanceSettings(false);
  installControls();
  exposeDiagnostics();
  requestAnimationFrame(frame);
  void monitoringReady.then(() => setRuntimeTag("renderer", renderer.kind.toLowerCase()));
} catch (error) {
  console.error(error);
  elements.runtimeStatus.textContent = "This browser could not start the instrument.";
  void monitoringReady.then(() => {
    captureException(error, { stage: "instrument_initialization" });
  });
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
  }
}

function installControls() {
  SOUND_START_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, startExperience, { capture: true, passive: true });
  });
  elements.controlsToggle.addEventListener("click", () => {
    setControlsOpen(elements.controls.classList.contains("collapsed"));
  });
  elements.fieldScore.addEventListener("change", () => {
    if (!elements.fieldScore.value) return;
    loadFieldScore(elements.fieldScore.value);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!elements.controls.classList.contains("collapsed") && !elements.controls.contains(event.target)) {
      setControlsOpen(false);
    }
  });

  ["pointerup", "touchend", "click", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, resumeSound, { capture: true, passive: true });
  });

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
      audio.strike(strikeStrength, engine.metrics()[METRIC_FIELD.ENERGY], point.x);
    }
    if (event.pointerType !== "mouse" && duration < 230 && travel < 0.055) {
      const now = performance.now();
      const closeToLastTap = Math.hypot(point.x - state.lastTapX, point.y - state.lastTapY) < 0.16;
      if (now - state.lastTapAt < 330 && closeToLastTap) {
        spawn(point.x, point.y);
        state.lastTapAt = -Infinity;
        state.lastPointerSpawnAt = now;
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
    // Chromium emits a compatibility dblclick after a native double-tap.
    // The pointer path above has already seeded that gesture.
    if (performance.now() - state.lastPointerSpawnAt < 450) return;
    const point = eventPoint(event);
    spawn(point.x, point.y);
  });
  ["contextmenu", "selectstart", "dragstart"].forEach((eventName) => {
    elements.field.addEventListener(eventName, preventBrowserFieldGesture);
  });

  const settleOff = () => {
    if (!state.settle) return;
    state.settle = false;
    audio.strike(0.58, engine.metrics()[METRIC_FIELD.ENERGY]);
  };
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
    updateRangeProgress(elements.volume);
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

function preventBrowserFieldGesture(event) {
  event.preventDefault();
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
  if (!isGestureMode(mode)) return;
  state.gestureMode = mode;
  settings.mode = mode;
  elements.instrument.dataset.gesture = mode;
  elements.gestureModes.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.gesture === mode));
  });
  if (updateUrl) {
    syncSettingsUrl();
    audio.cueControl(
      `gesture-${mode}`,
      GESTURE_MODES.indexOf(mode) / (GESTURE_MODES.length - 1),
    );
  }
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
  [
    elements.volume,
    elements.ecology,
    elements.flow,
    elements.gesture,
    elements.glow,
    elements.memory,
    elements.tone,
    elements.population,
  ].forEach(updateRangeProgress);
}

function settingWord(value, [low, high], [below, middle, above]) {
  return value < low ? below : value > high ? above : middle;
}

function updateRangeProgress(control) {
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  const progress = ((Number(control.value) - minimum) / (maximum - minimum)) * 100;
  control.style.setProperty("--range-fill", `${progress}%`);
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
    audio.wake();
    state.started = true;
    SOUND_START_EVENTS.forEach((eventName) => {
      window.removeEventListener(eventName, startExperience, { capture: true });
    });
  } catch (error) {
    if (["suspended", "interrupted"].includes(audio.state())) {
      return;
    }
    console.error(error);
    captureException(error, { stage: "audio_start" });
    elements.runtimeStatus.textContent = "Sound did not start. Check this tab’s audio permission and try again.";
  } finally {
    state.starting = false;
  }
}

async function resumeSound() {
  if (!state.started || audio.state() === "running") return;
  try {
    await audio.resume();
  } catch (error) {
    console.warn("Could not resume audio", error);
    captureException(error, { stage: "audio_resume" });
  }
}

function setControlsOpen(open) {
  elements.controls.classList.toggle("collapsed", !open);
  elements.controlsToggle.setAttribute("aria-expanded", String(open));
  elements.controlsToggle.setAttribute("aria-label", open ? "Hide controls" : "Show controls");
}

let previousTime = performance.now() / 1000;
let accumulator = 0;
let fpsWindowStarted = performance.now();
let fpsFrameCount = 0;
let measuredFps = 0;

function frame(milliseconds) {
  fpsFrameCount += 1;
  if (milliseconds - fpsWindowStarted >= 1000) {
    measuredFps = (fpsFrameCount * 1000) / (milliseconds - fpsWindowStarted);
    fpsFrameCount = 0;
    fpsWindowStarted = milliseconds;
  }
  const time = milliseconds / 1000;
  const elapsed = Math.min(0.05, Math.max(0, time - previousTime));
  previousTime = time;
  // Under sustained overload, prefer slowed performance time to an ever-growing
  // catch-up queue that would make input and audio lag behind the image.
  accumulator = Math.min(
    accumulator + elapsed * settings.flow,
    FIXED_STEP * MAX_CATCH_UP_STEPS,
  );

  if (state.running) {
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_CATCH_UP_STEPS) {
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
  if (
    metrics[METRIC_FIELD.TRANSITION] > 0.24 &&
    state.previousTransition <= 0.24 &&
    state.running
  ) {
    audio.strike(metrics[METRIC_FIELD.TRANSITION], metrics[METRIC_FIELD.ENERGY]);
  }
  state.previousTransition = metrics[METRIC_FIELD.TRANSITION];
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
    for (let offset = 0; offset < snapshot.length; offset += PARTICLE_STRIDE) {
      visualSnapshot[offset + PARTICLE_FIELD.X] = smoothWrappedCoordinate(
        visualSnapshot[offset + PARTICLE_FIELD.X],
        snapshot[offset + PARTICLE_FIELD.X],
        positionBlend,
      );
      visualSnapshot[offset + PARTICLE_FIELD.Y] = smoothWrappedCoordinate(
        visualSnapshot[offset + PARTICLE_FIELD.Y],
        snapshot[offset + PARTICLE_FIELD.Y],
        positionBlend,
      );
      visualSnapshot[offset + PARTICLE_FIELD.PACKED_SPECIES_ENERGY] +=
        (snapshot[offset + PARTICLE_FIELD.PACKED_SPECIES_ENERGY] -
          visualSnapshot[offset + PARTICLE_FIELD.PACKED_SPECIES_ENERGY]) *
        attributeBlend;
      visualSnapshot[offset + PARTICLE_FIELD.SPEED] +=
        (snapshot[offset + PARTICLE_FIELD.SPEED] -
          visualSnapshot[offset + PARTICLE_FIELD.SPEED]) *
        attributeBlend;
    }
  }

  if (!visualMetrics || visualMetrics.length !== metrics.length) {
    visualMetrics = Array.from(metrics);
  } else {
    for (let index = 0; index < metrics.length; index += 1) {
      const target = metrics[index];
      const timeConstant =
        index === METRIC_FIELD.TRANSITION
          ? target > visualMetrics[index]
            ? 0.085
            : 0.48
          : 0.22;
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
  audio.strike(0.84, engine.metrics()[METRIC_FIELD.ENERGY], x);
}

function loadFieldScore(source) {
  const featuredUrl = new URL(source, window.location.href);
  const featuredSeed = parseSeed(featuredUrl);
  if (featuredSeed === null) return;

  seed = featuredSeed;
  Object.assign(settings, parsePerformanceSettings(featuredUrl));
  engine = new Engine(seed, settings.population);
  resetVisualSmoothing();
  renderer.resetTrails();
  audio.reseed(seed);
  applyPerformanceSettings(false);
  window.history.replaceState({}, "", `${featuredUrl.pathname}${featuredUrl.search}`);
  setControlsOpen(false);
  if (state.started) audio.strike(0.7, engine.metrics()[METRIC_FIELD.ENERGY]);
}

function togglePause() {
  state.running = !state.running;
  audio.setPaused(!state.running);
}

function exposeDiagnostics() {
  window.confluon = Object.freeze({
    apiVersion: CONFLUON_API_VERSION,
    simulationContractVersion: SIMULATION_CONTRACT_VERSION,
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
      x: state.pointer.x,
      y: state.pointer.y,
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
  state.lastTapAt = -Infinity;
  state.lastPointerSpawnAt = -Infinity;
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
  audio.wake();
}

function eventPoint(event) {
  const rect = elements.field.getBoundingClientRect();
  const point = clientPointToWorld(event.clientX, event.clientY, rect);
  return {
    ...point,
    inside:
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom,
  };
}

function readSeed() {
  const value = parseSeed(window.location.href);
  if (value !== null) return value;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const generated = values[0] || 1;
  const url = new URL(window.location.href);
  url.searchParams.set("seed", generated.toString());
  window.history.replaceState({}, "", url);
  return generated;
}

function syncSettingsUrl() {
  const url = encodePerformanceState(window.location.href, seed, settings);
  window.history.replaceState({}, "", url);
}
