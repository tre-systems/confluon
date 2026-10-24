import {
  MIDI_ACTIONS,
  MIDI_PARAMETERS,
  MidiPerformance,
  parameterUnit,
  TOUCH_CHANNEL,
} from "./midi-mapping.js";

const PREFERENCES_KEY = "confluon-midi-v1";

export class MidiController {
  constructor({
    root,
    settings,
    transport,
    parameter,
    action,
    gesture,
    release,
    releaseAll,
  }) {
    this.root = root;
    this.settings = settings;
    this.transport = transport;
    this.access = null;
    this.inputs = new Map();
    this.sent = new Map();
    this.dirty = false;
    this.connecting = false;
    this.preferences = readPreferences();
    this.button = root.querySelector("#midi-enable");
    this.message = root.querySelector("#midi-status");
    this.launch = root.querySelector("#midi-launch");
    this.touch = root.querySelector("#midi-touch");
    this.output = root.querySelector("#midi-output");
    this.encoders = root.querySelector("#midi-encoders");
    this.mapping = new MidiPerformance({
      settings,
      parameter,
      action,
      gesture,
      release,
      feedback: () => this.invalidate(true),
      status: (message) => this.status(message),
    });
    this.encoders.value =
      this.preferences.encoders === "relative" ? "relative" : "absolute";
    this.mapping.encoderMode = this.encoders.value;
    this.button.addEventListener("click", () =>
      this.access ? this.disable() : void this.enable(),
    );
    for (const [key, select] of [
      ["launch", this.launch],
      ["touch", this.touch],
      ["output", this.output],
    ]) {
      select.addEventListener("change", () => {
        this.preferences[key] = select.value;
        savePreferences(this.preferences);
        this.bindInputs();
        this.invalidate(true);
      });
    }
    this.encoders.addEventListener("change", () => {
      this.mapping.releaseAll();
      this.mapping.encoderMode = this.encoders.value;
      this.preferences.encoders = this.encoders.value;
      savePreferences(this.preferences);
    });
    root.querySelector("#midi-release").addEventListener("click", () => {
      releaseAll();
      this.status("Held gestures released; pickup armed");
    });
    if (!navigator.requestMIDIAccess || !window.isSecureContext) {
      this.button.disabled = true;
      this.status("MIDI needs Chrome or Edge over HTTPS or localhost.");
    }
  }

  status(message) {
    this.message.textContent = message;
  }

  async enable() {
    if (this.connecting) return;
    this.connecting = true;
    this.button.disabled = true;
    this.status("Waiting for MIDI permission…");
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.refresh();
      this.button.textContent = "Disconnect MIDI";
      this.refresh();
    } catch {
      this.status(
        "MIDI access was not granted. Allow MIDI in this browser’s site settings, then try again.",
      );
    } finally {
      this.connecting = false;
      this.button.disabled = false;
    }
  }

  refresh() {
    const inputs = [...this.access.inputs.values()].filter(
      (port) => port.state === "connected",
    );
    const outputs = [...this.access.outputs.values()].filter(
      (port) => port.state === "connected",
    );
    this.fill(
      this.launch,
      inputs,
      "launch",
      (port) =>
        /launch control|lcxl3/i.test(port.name) &&
        !/daw|din|midi(in|out)?2/i.test(port.name),
    );
    this.fill(this.touch, inputs, "touch", (port) =>
      /touchosc/i.test(port.name),
    );
    this.fill(this.output, outputs, "output", (port) =>
      /touchosc/i.test(port.name),
    );
    this.bindInputs();
    this.invalidate(true);
  }

  fill(select, ports, key, match) {
    const previous =
      this.preferences[key] ?? (select.value || ports.find(match)?.id || "");
    select.replaceChildren(new Option("None", ""));
    for (const port of ports)
      select.add(new Option(port.name || "MIDI device", port.id));
    select.value = ports.some((port) => port.id === previous) ? previous : "";
    select.disabled = false;
  }

  bindInputs() {
    const desired = new Map();
    if (this.launch.value) desired.set(this.launch.value, "launch");
    if (this.touch.value && !desired.has(this.touch.value))
      desired.set(this.touch.value, "touch");
    for (const [id, entry] of this.inputs) {
      if (
        desired.get(id) === entry.profile &&
        entry.port.state === "connected" &&
        this.access.inputs.get(id) === entry.port
      )
        continue;
      entry.port.onmidimessage = null;
      void entry.port.close().catch(() => {});
      this.mapping.releaseSource(id);
      this.inputs.delete(id);
    }
    for (const [id, profile] of desired) {
      if (this.inputs.has(id)) continue;
      const port = this.access.inputs.get(id);
      if (!port || port.state !== "connected") continue;
      port.onmidimessage = (event) => {
        if (!document.hidden) this.mapping.receive(id, profile, event.data);
      };
      this.inputs.set(id, { port, profile });
    }
    this.status(
      this.inputs.size
        ? "MIDI ready. Move each fader through its current value to pick up."
        : "Connect a controller, then select its MIDI input.",
    );
  }

  invalidate(force = false) {
    this.dirty = true;
    if (force) this.sent.clear();
  }

  tick() {
    this.mapping.tick();
    if (!this.dirty || !this.access) return;
    this.dirty = false;
    const output = this.access.outputs.get(this.output.value);
    if (!output || output.state !== "connected") return;
    const settings = this.settings();
    const transport = this.transport();
    const messages = MIDI_PARAMETERS.map((item, index) => [
      20 + index,
      Math.round(parameterUnit(item.property, settings) * 127),
    ]);
    MIDI_ACTIONS.forEach((action, index) => {
      if (["gather", "orbit", "divide"].includes(action))
        messages.push([37 + index, settings.mode === action ? 127 : 0]);
      if (action === "pause")
        messages.push([37 + index, transport.running ? 0 : 127]);
      if (action === "settle")
        messages.push([37 + index, transport.settle ? 127 : 0]);
    });
    try {
      for (const [cc, value] of messages) {
        if (this.sent.get(cc) === value) continue;
        output.send([0xb0 | TOUCH_CHANNEL, cc, value]);
        this.sent.set(cc, value);
      }
    } catch {
      this.sent.clear();
      this.status("iPad feedback unavailable. Check the selected output.");
    }
  }

  disable() {
    if (this.access) this.access.onstatechange = null;
    for (const { port } of this.inputs.values()) {
      port.onmidimessage = null;
      void port.close().catch(() => {});
    }
    this.inputs.clear();
    this.mapping.releaseAll();
    this.access = null;
    this.sent.clear();
    for (const select of [this.launch, this.touch, this.output])
      select.disabled = true;
    this.button.textContent = "Connect MIDI";
    this.status("MIDI disconnected");
  }
}

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

function savePreferences(preferences) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    /* Private browsing may deny storage. */
  }
}
