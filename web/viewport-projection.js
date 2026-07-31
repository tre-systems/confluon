/**
 * Centre-crops the square simulation into a viewport without distorting it.
 * The long viewport edge determines the shared world-to-pixel scale.
 */
export function createCoverProjection(width, height) {
  const viewportWidth = positiveDimension(width, "width");
  const viewportHeight = positiveDimension(height, "height");
  const longEdge = Math.max(viewportWidth, viewportHeight);

  return {
    x: longEdge / viewportWidth,
    y: longEdge / viewportHeight,
    pixelsPerWorldUnit: longEdge * 0.5,
  };
}

export function coverWorldScale(width, height) {
  return (
    Math.max(
      positiveDimension(width, "width"),
      positiveDimension(height, "height"),
    ) * 0.5
  );
}

/**
 * Inverse of the cover projection for pointer and touch input.
 */
export function clientPointToWorld(clientX, clientY, rect) {
  const worldScale = coverWorldScale(rect.width, rect.height);
  return {
    x:
      (Number(clientX) - (Number(rect.left) + rect.width * 0.5)) /
      worldScale,
    y:
      ((Number(rect.top) + rect.height * 0.5) - Number(clientY)) /
      worldScale,
  };
}

function positiveDimension(value, name) {
  const dimension = Number(value);
  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new RangeError(`Viewport ${name} must be a positive finite number`);
  }
  return dimension;
}
