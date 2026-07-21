import init, { Engine } from "/pkg/geno5.js";
import { ConfluenceAudio } from "./audio.js";
import { createRenderer } from "./renderer.js";

const FIXED_STEP = 1 / 30;
const INITIAL_PARTICLES = 1_200;
const IDLE_CONTROLS_MS = 9000;

const elements = {
  instrument: document.querySelector("#instrument"),
  field: document.querySelector("#field"),
  traces: document.querySelector("#traces"),
  welcome: document.querySelector("#welcome"),
  begin: document.querySelector("#begin"),
  controls: document.querySelector("#controls"),
  controlsToggle: document.querySelector("#controls-toggle"),
  gestureHint: document.querySelector("#gesture-hint"),
  newSeed: document.querySelector("#new-seed"),
  settle: document.querySelector("#settle"),
  pause: document.querySelector("#pause"),
  volume: document.querySelector("#volume"),
  seed: document.querySelector("#seed-value"),
  energy: document.querySelector("#energy-value"),
  coherence: document.querySelector("#coherence-value"),
  activity: document.querySelector("#activity-value"),
  encounter: document.querySelector("#encounter-value"),
  renderer: document.querySelector("#renderer-value"),
  audioState: document.querySelector("#audio-state"),
  runtimeStatus: document.querySelector("#runtime-status"),
};

const state = {
  running: true,
  started: false,
  starting: false,
  settle: false,
  previousTransition: 0,
  pointer: { active: false, x: 0, y: 0, strength: 0, downAt: 0, downX: 0, downY: 0 },
  lastTapAt: -Infinity,
  lastTapX: 0,
  lastTapY: 0,
};

let seed = readSeed();
let engine;
let renderer;
let audio;
let idleTimer;

try {
  await init();
  engine = new Engine(seed, INITIAL_PARTICLES);
  renderer = await createRenderer(elements.field, elements.traces);
  audio = new ConfluenceAudio(seed);
  elements.renderer.textContent = renderer.kind;
  elements.seed.textContent = formatSeed(seed);
  installControls();
  exposeDiagnostics();
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  elements.begin.querySelector("span").textContent = "UNAVAILABLE";
  elements.begin.disabled = true;
  elements.runtimeStatus.textContent = "This browser could not start the instrument.";
  elements.runtimeStatus.classList.add("error");
}

function installControls() {
  elements.begin.addEventListener("click", startExperience);
  elements.controlsToggle.addEventListener("click", () => {
    setControlsOpen(elements.controls.classList.contains("collapsed"));
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

  elements.field.addEventListener("pointerdown", (event) => {
    const point = eventPoint(event);
    state.pointer.active = true;
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    state.pointer.downX = point.x;
    state.pointer.downY = point.y;
    state.pointer.downAt = performance.now();
    state.pointer.strength = event.altKey ? -1.35 : 1.0;
    elements.field.setPointerCapture(event.pointerId);
  });

  elements.field.addEventListener("pointermove", (event) => {
    if (!state.pointer.active) return;
    const point = eventPoint(event);
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    state.pointer.strength = event.altKey ? -1.35 : 1.0;
  });

  elements.field.addEventListener("pointerup", (event) => {
    const point = eventPoint(event);
    const duration = performance.now() - state.pointer.downAt;
    const travel = Math.hypot(point.x - state.pointer.downX, point.y - state.pointer.downY);
    state.pointer.active = false;
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

  elements.field.addEventListener("pointercancel", () => {
    state.pointer.active = false;
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
  elements.volume.addEventListener("input", () => {
    audio.setLevel(Number(elements.volume.value) / 100);
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat && event.code !== "KeyS") return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    } else if (event.code === "KeyR") {
      engine.reset(seed);
      renderer.resetTrails();
      audio.strike(0.62, 0.5);
    } else if (event.code === "KeyS") {
      state.settle = true;
      elements.settle.classList.add("active");
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

async function startExperience() {
  if (state.starting) return;
  state.starting = true;
  elements.begin.querySelector("span").textContent = "WAKING";
  try {
    await audio.start();
    audio.setLevel(Number(elements.volume.value) / 100);
    audio.wake(engine.metrics());
    state.started = true;
    setAudioState();
    elements.welcome.classList.add("dismissed");
    window.setTimeout(() => {
      elements.welcome.hidden = true;
      elements.gestureHint.classList.add("visible");
      window.setTimeout(() => elements.gestureHint.classList.remove("visible"), 5800);
    }, 1100);
  } catch (error) {
    console.error(error);
    elements.begin.querySelector("span").textContent = "TRY AGAIN";
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
  accumulator += elapsed;

  if (state.running) {
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 2) {
      engine.step(
        FIXED_STEP,
        state.pointer.x,
        state.pointer.y,
        state.pointer.active ? state.pointer.strength : 0,
        state.settle,
      );
      accumulator -= FIXED_STEP;
      steps += 1;
    }
  } else {
    accumulator = 0;
  }

  const snapshot = engine.snapshot();
  const metrics = engine.metrics();
  renderer.render(snapshot, metrics, time);
  audio.update(metrics);
  if (metrics[5] > 0.24 && state.previousTransition <= 0.24 && state.running) {
    audio.strike(metrics[5], metrics[0]);
  }
  state.previousTransition = metrics[5];

  if (milliseconds - lastReadout > 160) {
    elements.energy.textContent = metrics[0].toFixed(2);
    elements.coherence.textContent = metrics[1].toFixed(2);
    elements.activity.textContent = metrics[2].toFixed(2);
    elements.encounter.textContent = metrics[6].toFixed(2);
    setAudioState();
    lastReadout = milliseconds;
  }
  requestAnimationFrame(frame);
}

function spawn(x, y) {
  engine.spawn_at(x, y, 50);
  audio.strike(0.84, engine.metrics()[0]);
}

function newField() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  seed = values[0] || 1;
  engine.reset(seed);
  renderer.resetTrails();
  audio.reseed(seed);
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed.toString());
  window.history.replaceState({}, "", url);
  elements.seed.textContent = formatSeed(seed);
  audio.strike(0.72, 0.42);
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
  window.geno5 = Object.freeze({
    audioState: () => audio.state(),
    audioMeter: () => audio.meter(),
    renderer: () => renderer.kind,
    metrics: () => Array.from(engine.metrics()),
    particleCount: () => engine.particle_count(),
    fps: () => measuredFps,
  });
}

function eventPoint(event) {
  const rect = elements.field.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((event.clientY - rect.top) / rect.height) * 2,
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
