import {PARTICLE_STRIDE,PARTICLE_FIELD,METRIC_FIELD} from '../web/simulation-contract.js';
export function visualSmoother(){let visualSnapshot,visualMetrics;
function smoothVisualState(snapshot, metrics, elapsed) {
  if (!visualSnapshot || visualSnapshot.length !== snapshot.length) {
    visualSnapshot = new Float32Array(snapshot);
  } else {
    const positionBlend = 1 - Math.exp(-elapsed / 0.052);
    const attributeBlend = 1 - Math.exp(-elapsed / 0.09);
    for (let offset = 0; offset < snapshot.length; offset += PARTICLE_STRIDE) {
      visualSnapshot[offset + PARTICLE_FIELD.X] = smoothWrappedCoordinate(
        visualSnapshot[offset + PARTICLE_FIELD.X],
        snapshot[offset + PARTICLE_FIELD.X],
        positionBlend,
      );
      visualSnapshot[offset + PARTICLE_FIELD.Y] = smoothWrappedCoordinate(
        visualSnapshot[offset + PARTICLE_FIELD.Y],
        snapshot[offset + PARTICLE_FIELD.Y],
        positionBlend,
      );
      visualSnapshot[offset + PARTICLE_FIELD.PACKED_SPECIES_ENERGY] +=
        (snapshot[offset + PARTICLE_FIELD.PACKED_SPECIES_ENERGY] -
          visualSnapshot[offset + PARTICLE_FIELD.PACKED_SPECIES_ENERGY]) *
        attributeBlend;
      visualSnapshot[offset + PARTICLE_FIELD.SPEED] +=
        (snapshot[offset + PARTICLE_FIELD.SPEED] -
          visualSnapshot[offset + PARTICLE_FIELD.SPEED]) *
        attributeBlend;
    }
  }

  if (!visualMetrics || visualMetrics.length !== metrics.length) {
    visualMetrics = Array.from(metrics);
  } else {
    for (let index = 0; index < metrics.length; index += 1) {
      const target = metrics[index];
      const timeConstant =
        index === METRIC_FIELD.TRANSITION
          ? target > visualMetrics[index]
            ? 0.085
            : 0.48
          : 0.22;
      const blend = 1 - Math.exp(-elapsed / timeConstant);
      visualMetrics[index] += (target - visualMetrics[index]) * blend;
    }
  }

  return { snapshot: visualSnapshot, metrics: visualMetrics };
}

function smoothWrappedCoordinate(current, target, blend) {
  let difference = target - current;
  if (difference > 1) difference -= 2;
  if (difference < -1) difference += 2;
  let value = current + difference * blend;
  if (value > 1) value -= 2;
  if (value < -1) value += 2;
  return value;
}


return smoothVisualState;}
