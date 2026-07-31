import assert from "node:assert/strict";
import test from "node:test";
import {
  clientPointToWorld,
  coverWorldScale,
  createCoverProjection,
} from "../web/viewport-projection.js";

test("square view uses an identity projection", () => {
  assert.deepEqual(createCoverProjection(800, 800), {
    x: 1,
    y: 1,
    pixelsPerWorldUnit: 400,
  });
  assert.equal(coverWorldScale(800, 800), 400);
});

test("portrait view fills by cropping the simulation sides", () => {
  const projection = createCoverProjection(390, 844);
  assert.equal(projection.x, 844 / 390);
  assert.equal(projection.y, 1);
  assert.equal(projection.x * 390, projection.y * 844);

  const rect = { left: 0, top: 0, width: 390, height: 844 };
  assert.deepEqual(clientPointToWorld(195, 422, rect), { x: 0, y: 0 });
  assert.deepEqual(clientPointToWorld(0, 0, rect), {
    x: -390 / 844,
    y: 1,
  });
  assert.deepEqual(clientPointToWorld(390, 844, rect), {
    x: 390 / 844,
    y: -1,
  });
});

test("landscape view fills by cropping the simulation top and bottom", () => {
  const projection = createCoverProjection(844, 390);
  assert.equal(projection.x, 1);
  assert.equal(projection.y, 844 / 390);
  assert.equal(projection.x * 844, projection.y * 390);

  const rect = { left: 10, top: 20, width: 844, height: 390 };
  assert.deepEqual(clientPointToWorld(10, 215, rect), { x: -1, y: 0 });
  assert.deepEqual(clientPointToWorld(854, 20, rect), {
    x: 1,
    y: 390 / 844,
  });
});

test("invalid viewport dimensions fail at the boundary", () => {
  assert.throws(() => createCoverProjection(0, 800), RangeError);
  assert.throws(() => createCoverProjection(800, Number.NaN), RangeError);
});
