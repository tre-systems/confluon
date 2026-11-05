import { inflateSync } from "node:zlib";

// zlib/zlib-ng versions can emit different valid DEFLATE streams. Check the
// complete native XML (including embedded Lua and defaults), not its encoding.
export function matchesTouchOscLayout(encoded, xml) {
  try {
    return inflateSync(encoded).equals(Buffer.from(xml));
  } catch {
    return false;
  }
}
