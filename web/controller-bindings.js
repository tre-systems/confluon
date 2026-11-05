import { parameterUnit, parameterValue } from "./midi-mapping.js";

// The instrument owns musical units. The shared XL3 driver/panel see only
// physical slots, normalized positions and labels; no DSP or preset data.
export const XL3_PARAMETERS = Object.freeze({
  24: ["ecology", "Ecology", "Calm to volatile interactions"],
  25: ["flow", "Flow", "Speed of the field and its musical development"],
  26: ["gesture", "Touch", "Strength of the held gesture"],
  27: ["glow", "Halo", "Light around the particles"],
  28: ["memory", "Memory", "Length of visual trails"],
  29: ["tone", "Tone", "Dark to bright sound"],
  31: [
    "level",
    "Level",
    "Overall output; cross the current position to pick up",
  ],
});

export function controllerBindings({
  settings,
  setParameter,
  point,
  setPoint,
}) {
  function read(slot) {
    if (slot === 11 || slot === 12) {
      const axis = slot === 11 ? "x" : "y";
      return {
        label: `Gesture ${axis.toUpperCase()}`,
        position: point()[axis],
        text: `${Math.round(point()[axis] * 100)}%`,
        hint: "Position for Hold gesture and Seed",
      };
    }
    const item = XL3_PARAMETERS[slot];
    if (!item)
      return { label: "—", position: 0, text: "—", disabled: "Unassigned" };
    const [property, label, hint] = item;
    return {
      label,
      hint,
      position: parameterUnit(property, settings()),
      text: `${Math.round(settings()[property] * 100)}%`,
    };
  }
  function change(slot, position) {
    if (
      !Number.isInteger(slot) ||
      !Number.isFinite(position) ||
      read(slot).disabled
    )
      return false;
    position = Math.max(0, Math.min(1, position));
    if (slot === 11 || slot === 12) setPoint(slot === 11 ? "x" : "y", position);
    else
      setParameter(
        XL3_PARAMETERS[slot][0],
        parameterValue(XL3_PARAMETERS[slot][0], position),
      );
    return true;
  }
  return { read, change };
}

export const CONFLUON_XL3_LAYOUT = {
  initialSlot: 24,
  summary:
    "Faders 1–6: Ecology, Flow, Touch, Halo, Memory, Tone · Fader 8: Level. Middle knobs 4–5: gesture X/Y; Shift for fine adjustment. Move faders through their current values to pick up.",
  momentary: [40, 41],
  buttons: [
    ["pages", 106, "↑", "Previous row"],
    ["pages", 107, "↓", "Next row"],
    ["left", 116, "▶", "Play / fade"],
    ["left", 104, "Hide", "Hide controls"],
    ["grid", 37, "Gather", "Gather gesture"],
    ["grid", 38, "Orbit", "Orbit gesture"],
    ["grid", 39, "Divide", "Divide gesture"],
    ["grid", 40, "Hold", "Hold gesture"],
    ["grid", 41, "Settle", "Hold to settle the field"],
    ["grid", 42, "Seed", "Seed at gesture position"],
    ["grid", 43, "Pause", "Pause / resume"],
    ["grid", 44, "Reset", "Shift + Reset field"],
    ["grid", 45, "Still", "Still Choir field"],
    ["grid", 46, "Tidal", "Tidal Assembly field"],
    ["grid", 47, "Ember", "Ember Rift field"],
    ["grid", 48, "Release", "Release gestures"],
    ["grid", 49, "Sound", "Focus Tone fader"],
    ["grid", 50, "Field", "Focus Ecology fader"],
    ["grid", 51, "Visuals", "Focus Halo fader"],
    ["grid", 52, "Controls", "Standard controls"],
  ],
};
