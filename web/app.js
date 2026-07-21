import init, { Engine } from "/pkg/geno5.js";
import { ConfluenceAudio } from "./audio.js";
import { createRenderer } from "./renderer.js";

const FIXED_STEP = 1 / 60;
const INITIAL_PARTICLES = 180;

const elements = {
  canvas: document.querySelector("#field"),
  welcome: document.querySelector("#welcome"),
  begin: document.querySelector("#begin"),
  helpButton: document.querySelector("#help-button"),
  helpPanel: document.querySelector("#help-panel"),
  helpClose: document.querySelector("#help-close"),
  gestureHint: document.querySelector("#gesture-hint"),
  newSeed: document.querySelector("#new-seed"),
  settle: document.querySelector("#settle"),
  pause: document.querySelector("#pause"),
  volume: document.querySelector("#volume"),
  seed: document.querySelector("#seed-value"),
  energy: document.querySelector("#energy-value"),
  coherence: document.querySelector("#coherence-value"),
  activity: document.querySelector("#activity-value"),
  forms: document.querySelector("#forms-value"),
  renderer: document.querySelector("#renderer-value"),
  particles: document.querySelector("#particle-value"),
};

const state = {
  running: true,
  started: false,
  settle: false,
  pointer: { active: false, x: 0, y: 0, strength: 0, downAt: 0, downX: 0, downY: 0 },
  lastTapAt: -Infinity,
  lastTapX: 0,
  lastTapY: 0,
};

let seed = readSeed();
let engine;
let renderer;
let audio;

try {
  await init();
  engine = new Engine(seed, INITIAL_PARTICLES);
  renderer = await createRenderer(elements.canvas);
  audio = new ConfluenceAudio(seed);
  elements.renderer.textContent = renderer.kind;
  elements.seed.textContent = seed.toString(16).toUpperCase().padStart(8, "0");
  elements.particles.textContent = engine.particle_count();
  installControls();
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  elements.begin.textContent = "INSTRUMENT COULD NOT START";
  elements.begin.disabled = true;
  elements.renderer.textContent = "STARTUP ERROR";
}

function installControls() {
  elements.begin.addEventListener("click", async () => {
    try {
      await audio.start();
      audio.setLevel(Number(elements.volume.value) / 100);
      audio.strike(0.5, 0.5);
      state.started = true;
      elements.welcome.classList.add("dismissed");
      window.setTimeout(() => {
        elements.welcome.hidden = true;
        elements.gestureHint.classList.add("visible");
        window.setTimeout(() => elements.gestureHint.classList.remove("visible"), 5200);
      }, 380);
    } catch (error) {
      console.error(error);
      elements.begin.textContent = "AUDIO UNAVAILABLE";
    }
  });

  elements.canvas.addEventListener("pointerdown", (event) => {
    const point = eventPoint(event);
    state.pointer.active = true;
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    state.pointer.downX = point.x;
    state.pointer.downY = point.y;
    state.pointer.downAt = performance.now();
    state.pointer.strength = event.altKey ? -1.35 : 1.0;
    elements.canvas.setPointerCapture(event.pointerId);
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    if (!state.pointer.active) {
      return;
    }
    const point = eventPoint(event);
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    state.pointer.strength = event.altKey ? -1.35 : 1.0;
  });

  elements.canvas.addEventListener("pointerup", (event) => {
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

  elements.canvas.addEventListener("pointercancel", () => {
    state.pointer.active = false;
  });

  elements.canvas.addEventListener("dblclick", (event) => {
    const point = eventPoint(event);
    spawn(point.x, point.y);
  });

  elements.newSeed.addEventListener("click", () => {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    seed = values[0] || 1;
    engine.reset(seed);
    const url = new URL(window.location.href);
    url.searchParams.set("seed", seed.toString());
    window.history.replaceState({}, "", url);
    elements.seed.textContent = seed.toString(16).toUpperCase().padStart(8, "0");
    audio.strike(0.72, 0.42);
  });

  const settleOn = (event) => {
    event.preventDefault();
    state.settle = true;
    elements.settle.classList.add("active");
  };
  const settleOff = () => {
    if (!state.settle) {
      return;
    }
    state.settle = false;
    elements.settle.classList.remove("active");
    audio.strike(0.64, engine.metrics()[0]);
  };
  elements.settle.addEventListener("pointerdown", settleOn);
  window.addEventListener("pointerup", settleOff);
  elements.settle.addEventListener("pointercancel", settleOff);

  elements.pause.addEventListener("click", togglePause);
  elements.volume.addEventListener("input", () => {
    audio.setLevel(Number(elements.volume.value) / 100);
  });
  elements.helpButton.addEventListener("click", () => setHelpOpen(true));
  elements.helpClose.addEventListener("click", () => setHelpOpen(false));
  elements.helpPanel.addEventListener("click", (event) => {
    if (event.target === elements.helpPanel) {
      setHelpOpen(false);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat && event.code !== "KeyS") {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    } else if (event.code === "KeyR") {
      engine.reset(seed);
      audio.strike(0.5, 0.5);
    } else if (event.code === "KeyS") {
      state.settle = true;
      elements.settle.classList.add("active");
    } else if (event.code === "KeyH") {
      setHelpOpen(elements.helpPanel.hidden);
    } else if (event.code === "Escape") {
      setHelpOpen(false);
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "KeyS") {
      settleOff();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.started) {
      audio.setPaused(true);
    } else if (state.started) {
      audio.setPaused(!state.running);
    }
  });
}

let previousTime = performance.now() / 1000;
let accumulator = 0;
let lastReadout = 0;

function frame(milliseconds) {
  const time = milliseconds / 1000;
  const elapsed = Math.min(0.05, Math.max(0, time - previousTime));
  previousTime = time;
  accumulator += elapsed;

  if (state.running) {
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 3) {
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
  if (metrics[5] > 0.24 && state.running) {
    audio.strike(metrics[5], metrics[0]);
  }

  if (milliseconds - lastReadout > 100) {
    elements.energy.textContent = metrics[0].toFixed(2);
    elements.coherence.textContent = metrics[1].toFixed(2);
    elements.activity.textContent = metrics[2].toFixed(2);
    elements.forms.textContent = Math.round(metrics[4]);
    elements.particles.textContent = engine.particle_count();
    lastReadout = milliseconds;
  }
  requestAnimationFrame(frame);
}

function spawn(x, y) {
  engine.spawn_at(x, y, 18);
  audio.strike(0.82, engine.metrics()[0]);
}

function togglePause() {
  state.running = !state.running;
  elements.pause.textContent = state.running ? "PAUSE" : "RESUME";
  elements.pause.classList.toggle("active", !state.running);
  audio.setPaused(!state.running);
}

function setHelpOpen(open) {
  elements.helpPanel.hidden = !open;
  elements.helpButton.setAttribute("aria-expanded", String(open));
}

function eventPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((event.clientY - rect.top) / rect.height) * 2,
  };
}

function readSeed() {
  const value = Number(new URL(window.location.href).searchParams.get("seed"));
  if (Number.isInteger(value) && value > 0 && value <= 0xffffffff) {
    return value >>> 0;
  }
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const generated = values[0] || 1;
  const url = new URL(window.location.href);
  url.searchParams.set("seed", generated.toString());
  window.history.replaceState({}, "", url);
  return generated;
}
