import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import {
  MIDI_ACTIONS,
  MIDI_PARAMETERS,
  TOUCH_CC,
  TOUCH_CHANNEL,
} from "../web/midi-mapping.js";

// Native TouchOSC lexml v6, verified with the desktop editor. Keep the editable
// script and generator as sources; the .tosc is a deterministic distributable.
const output = new URL("../public/controllers/confluon.tosc", import.meta.url);
let id = 0;
const color = (r, g, b, a = 1) => ({
  type: "c",
  value: `<r>${r}</r><g>${g}</g><b>${b}</b><a>${a}</a>`,
});
const muted = color(0.49, 0.59, 0.63);
const cyan = color(0.25, 0.9, 0.83);
const paper = color(0.9, 0.92, 0.9);
const children = [];
const luaList = (items) =>
  `{${items.map((item) => JSON.stringify(item)).join(",")}}`;
const constants = `local STATUS = ${0xb0 | TOUCH_CHANNEL}\nlocal PARAMETERS = ${luaList(MIDI_PARAMETERS.map((p) => p.property))}\nlocal ACTIONS = ${luaList(MIDI_ACTIONS)}\nlocal X, Y, X_LOW, Y_LOW = ${TOUCH_CC.x}, ${TOUCH_CC.y}, ${TOUCH_CC.xLow}, ${TOUCH_CC.yLow}\nlocal GATE, HEARTBEAT, SYNC = ${TOUCH_CC.gate}, ${TOUCH_CC.heartbeat}, ${TOUCH_CC.sync}\n`;
const script =
  constants +
  readFileSync(new URL("../controllers/touchosc.lua", import.meta.url), "utf8");

label("title", "CONFLUON", [32, 24, 600, 46], 32, paper);
label("subtitle", "A FIELD TO PLAY", [32, 74, 600, 24], 13, muted);
label("mode", "GATHER", [32, 108, 760, 28], 15, cyan);
children.push(
  node(
    "XY",
    "field",
    [32, 150, 760, 460],
    {
      color: color(0.12, 0.48, 0.52),
      cursor: true,
      lines: true,
      gridX: true,
      gridY: true,
      gridStepsX: 8,
      gridStepsY: 5,
      gridColor: color(0.2, 0.55, 0.57, 0.2),
    },
    { x: 0.5, y: 0.5, touch: false },
  ),
);
label(
  "gesture_help",
  "Touch to sculpt. Lift to release.",
  [32, 615, 760, 24],
  13,
  muted,
);
label("gesture_title", "GESTURE", [824, 108, 338, 28], 13, muted);
for (const [i, name] of ["gather", "orbit", "divide"].entries()) {
  button(
    name,
    name.toUpperCase(),
    [824 + i * 114, 150, 106, 66],
    color(0.26, 0.38, 0.43),
  );
}
button("seed", "SEED COLONY", [824, 250, 160, 78], cyan);
button(
  "settle",
  "HOLD TO SETTLE",
  [1002, 250, 160, 78],
  color(0.65, 0.5, 0.88),
);
button("pause", "PAUSE", [824, 362, 160, 78], color(0.38, 0.6, 0.65));
button("reset", "HOLD TO RESET", [1002, 362, 160, 78], color(0.9, 0.46, 0.3));
label("connection", "WAITING FOR CONFLUON", [824, 494, 338, 30], 15, cyan);
label(
  "connection_help",
  "MIDI connection 1 / TouchOSC Bridge",
  [824, 532, 338, 28],
  12,
  muted,
);
label(
  "reset_help",
  "Reset: hold for 0.75 seconds",
  [824, 568, 338, 28],
  12,
  muted,
);

MIDI_PARAMETERS.forEach((parameter, index) => {
  const x = 32 + index * 164;
  label(
    `${parameter.property}_label`,
    parameter.query.toUpperCase(),
    [x, 652, 146, 24],
    13,
    paper,
  );
  children.push(
    node(
      "FADER",
      parameter.property,
      [x, 688, 146, 114],
      {
        color:
          index < 3
            ? cyan
            : index < 6
              ? color(0.64, 0.53, 0.86)
              : color(0.9, 0.53, 0.34),
        cursor: true,
        bar: true,
        grid: false,
      },
      {
        x:
          (parameter.fallback - parameter.minimum) /
          (parameter.maximum - parameter.minimum),
        touch: false,
      },
    ),
  );
});

const xml = `<?xml version='1.0' encoding='UTF-8'?><lexml version='6'>${node("GROUP", "Confluon", [0, 0, 1194, 834], { color: color(0.025, 0.04, 0.055), interactive: false, outline: false, script }, { touch: false }, children)}</lexml>`;
const bytes = deflateSync(Buffer.from(xml));
if (process.argv.includes("--check")) {
  if (!readFileSync(output).equals(bytes))
    throw new Error("TouchOSC layout is stale. Run npm run controllers.");
  console.log("touchosc: native layout matches its sources");
} else {
  mkdirSync(new URL("../public/controllers/", import.meta.url), {
    recursive: true,
  });
  writeFileSync(output, bytes);
  console.log("touchosc: wrote public/controllers/confluon.tosc");
}

function label(name, text, frame, size, textColor) {
  children.push(
    node(
      "LABEL",
      name,
      frame,
      {
        background: false,
        outline: false,
        interactive: false,
        grabFocus: false,
        textSize: size,
        textColor,
        textAlignH: 0,
        textAlignV: 1,
        textClip: true,
      },
      { text, touch: false },
    ),
  );
}

function button(name, text, frame, tint) {
  children.push(
    node(
      "BUTTON",
      name,
      frame,
      { color: tint, buttonType: 0, press: true, release: true },
      { x: 0, touch: false },
    ),
  );
  label(`${name}_label`, text, frame, 16, paper);
}

function node(type, name, [x, y, w, h], properties, values, nodes = []) {
  const common = {
    name,
    frame: { type: "r", value: `<x>${x}</x><y>${y}</y><w>${w}</w><h>${h}</h>` },
    visible: true,
    interactive: true,
    background: true,
    outline: true,
    outlineStyle: 1,
    locked: false,
    grabFocus: true,
    pointerPriority: 0,
    orientation: 0,
    shape: 1,
    cornerRadius: { type: "f", value: "2" },
    ...properties,
  };
  return (
    `<node ID='c0f10000-0000-4000-8000-${String(++id).padStart(12, "0")}' type='${type}'>` +
    `<properties>${Object.entries(common)
      .map(([key, value]) => property(key, value))
      .join("")}</properties>` +
    `<values>${Object.entries(values)
      .map(
        ([key, value]) =>
          `<value><key>${cdata(key)}</key><locked>0</locked><lockedDefaultCurrent>0</lockedDefaultCurrent><default>${cdata(String(value))}</default><defaultPull>0</defaultPull></value>`,
      )
      .join("")}</values>` +
    (nodes.length ? `<children>${nodes.join("")}</children>` : "") +
    "</node>"
  );
}

function property(key, value) {
  const entry =
    typeof value === "object"
      ? value
      : typeof value === "boolean"
        ? { type: "b", value: value ? "1" : "0" }
        : typeof value === "number"
          ? { type: "i", value: String(value) }
          : { type: "s", value: cdata(value) };
  return `<property type='${entry.type}'><key>${cdata(key)}</key><value>${entry.value}</value></property>`;
}

function cdata(value) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
