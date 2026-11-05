import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { matchesTouchOscLayout } from "./touchosc-format.mjs";

test("TouchOSC accepts different compression of the exact same native content", () => {
  const xml = "<lexml><script>sendMIDI(191,5,64)</script></lexml>";
  const stored = deflateSync(xml, { level: 0 });
  const compressed = deflateSync(xml, { level: 9 });
  assert.notDeepEqual(stored, compressed);
  assert.equal(matchesTouchOscLayout(stored, xml), true);
  assert.equal(matchesTouchOscLayout(compressed, xml), true);
});

test("TouchOSC rejects changed scripts, layout text, truncation and invalid data", () => {
  const xml = "<lexml><script>sendMIDI(191,5,64)</script></lexml>";
  const encoded = deflateSync(xml);
  assert.equal(matchesTouchOscLayout(encoded, xml.replace("64", "65")), false);
  assert.equal(matchesTouchOscLayout(encoded, xml + " "), false);
  assert.equal(matchesTouchOscLayout(encoded.subarray(0, 8), xml), false);
  assert.equal(matchesTouchOscLayout(Buffer.from("invalid"), xml), false);
});
