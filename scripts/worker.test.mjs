import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker.js";

test("redirect hosts preserve path and query on the canonical domain", async () => {
  const response = await worker.fetch(
    new Request("http://www.confluon.com/field?seed=77"),
    {},
  );

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://confluon.com/field?seed=77");
});

test("canonical requests pass through to the static asset binding", async () => {
  let received;
  const request = new Request("https://confluon.com/sound?seed=88");
  const response = await worker.fetch(request, {
    ASSETS: {
      fetch(assetRequest) {
        received = assetRequest;
        return new Response("asset");
      },
    },
  });

  assert.equal(received, request);
  assert.equal(await response.text(), "asset");
});
