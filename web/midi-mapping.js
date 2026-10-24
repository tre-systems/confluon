import { PERFORMANCE_PARAMETER_SCHEMA } from "./performance-state.js";

export const MIDI_PARAMETERS = PERFORMANCE_PARAMETER_SCHEMA;
export const MIDI_ACTIONS = Object.freeze([
  "gather",
  "orbit",
  "divide",
  "seed",
  "pause",
  "reset",
  "settle",
]);
export const LAUNCH_CHANNEL = 15; // MIDI channel 16, zero-based on the wire.
export const TOUCH_CHANNEL = 14;
export const TOUCH_CC = Object.freeze({
  x: 16,
  y: 17,
  xLow: 48,
  yLow: 49,
  gate: 82,
  heartbeat: 83,
  sync: 84,
});
export const TOUCH_TIMEOUT_MS = 1000;

export function parameterUnit(property, settings) {
  const item = MIDI_PARAMETERS.find((entry) => entry.property === property);
  return clamp(
    (settings[property] - item.minimum) / (item.maximum - item.minimum),
  );
}

export function parameterValue(property, unit) {
  const item = MIDI_PARAMETERS.find((entry) => entry.property === property);
  return item.minimum + clamp(unit) * (item.maximum - item.minimum);
}

// Transport-independent mapping. Every device owns its own pickup and held state.
export class MidiPerformance {
  constructor({
    settings,
    parameter,
    action,
    gesture,
    release,
    feedback,
    status,
    now = () => performance.now(),
  }) {
    Object.assign(this, {
      settings,
      parameter,
      action,
      gesture,
      release,
      feedback,
      status,
      now,
    });
    this.sources = new Map();
    this.encoderMode = "absolute";
  }

  receive(id, profile, data) {
    if (data.length !== 3 || !Array.from(data).every(Number.isInteger)) return;
    const [status, cc, value] = data;
    const channel = profile === "touch" ? TOUCH_CHANNEL : LAUNCH_CHANNEL;
    if (
      status !== (0xb0 | channel) ||
      cc < 0 ||
      cc > 127 ||
      value < 0 ||
      value > 127
    )
      return;
    this.tick();
    let source = this.sources.get(id);
    if (!source) {
      source = {
        profile,
        pickups: new Map(),
        buttons: new Set(),
        x: 8192,
        y: 8192,
        active: false,
        heartbeat: null,
      };
      this.sources.set(id, source);
    }
    if (profile === "touch") {
      if (cc === TOUCH_CC.heartbeat) {
        source.heartbeat = this.now();
        return;
      }
      if (cc === TOUCH_CC.sync) {
        this.feedback();
        return;
      }
      const index = cc - 20;
      if (index >= 0 && index < MIDI_PARAMETERS.length) {
        this.parameter(MIDI_PARAMETERS[index].property, value / 127);
        return;
      }
      if ([TOUCH_CC.x, TOUCH_CC.y, TOUCH_CC.xLow, TOUCH_CC.yLow].includes(cc)) {
        const axis = cc === TOUCH_CC.x || cc === TOUCH_CC.xLow ? "x" : "y";
        const low = cc === TOUCH_CC.xLow || cc === TOUCH_CC.yLow;
        source[axis] = low
          ? (source[axis] & 0x3f80) | value
          : (value << 7) | (source[axis] & 127);
        // The layout sends X MSB/LSB, then Y MSB/LSB. Commit the complete pair.
        if (cc === TOUCH_CC.yLow && source.active) this.emitGesture(id, source);
        return;
      }
      if (cc === TOUCH_CC.gate) {
        const active = value >= 64;
        if (active && source.heartbeat === null) return;
        const pressed = active && !source.active;
        source.active = active;
        this.emitGesture(id, source, pressed);
        return;
      }
    } else {
      const fader = cc - 5;
      const encoder = cc - 13;
      const index =
        fader >= 0 && fader < 7
          ? fader
          : encoder >= 0 && encoder < 7
            ? encoder
            : -1;
      if (index >= 0) {
        const property = MIDI_PARAMETERS[index].property;
        if (encoder >= 0 && encoder < 7 && this.encoderMode === "relative") {
          const delta = value - 64;
          if (delta)
            this.parameter(
              property,
              clamp(parameterUnit(property, this.settings()) + delta / 508),
            );
          this.status(`${MIDI_PARAMETERS[index].query}: fine adjustment`);
        } else {
          this.absolute(source, cc, property, value);
        }
        return;
      }
    }

    const action =
      cc === 116 && profile === "launch" ? "pause" : MIDI_ACTIONS[cc - 37];
    if (!action) return;
    const down = value >= 64;
    if (
      profile === "touch" &&
      action === "settle" &&
      down &&
      source.heartbeat === null
    )
      return;
    const held = source.buttons.has(cc);
    if (down === held) return;
    if (down) source.buttons.add(cc);
    else source.buttons.delete(cc);
    if (down || action === "settle") this.action(action, down, id);
  }

  absolute(source, cc, property, value) {
    const current = parameterUnit(property, this.settings());
    let pickup = source.pickups.get(cc);
    if (!pickup || Math.abs(pickup.target - current) > 1e-7) {
      pickup = { target: current, previous: null, acquired: false };
      source.pickups.set(cc, pickup);
    }
    const unit = value / 127;
    const crossed =
      pickup.previous !== null &&
      (pickup.previous - current) * (unit - current) <= 0;
    if (
      !pickup.acquired &&
      (Math.abs(unit - current) <= 1 / 127 + 1e-10 || crossed)
    )
      pickup.acquired = true;
    pickup.previous = unit;
    if (pickup.acquired) {
      this.parameter(property, unit);
      pickup.target = parameterUnit(property, this.settings());
      this.status(
        `${property === "glow" ? "halo" : property === "gesture" ? "touch" : property}: connected`,
      );
    } else {
      this.status(
        `${property === "glow" ? "halo" : property === "gesture" ? "touch" : property}: move ${unit < current ? "up" : "down"} to pick up ${Math.round(current * 127)}`,
      );
    }
  }

  emitGesture(id, source, pressed = false) {
    this.gesture(id, {
      x: source.x / 16383,
      y: source.y / 16383,
      active: source.active,
      pressed,
    });
  }

  releaseSource(id) {
    if (!this.sources.has(id)) return;
    this.sources.delete(id);
    this.release(id);
  }

  releaseAll() {
    for (const id of this.sources.keys()) this.releaseSource(id);
  }

  releaseHolds() {
    for (const [id, source] of this.sources) {
      source.active = false;
      this.release(id);
    }
  }

  tick() {
    for (const [id, source] of this.sources) {
      if (
        source.profile === "touch" &&
        source.heartbeat !== null &&
        this.now() - source.heartbeat > TOUCH_TIMEOUT_MS
      ) {
        this.releaseSource(id);
        this.status("iPad connection quiet; held gestures released");
      }
    }
  }
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}
