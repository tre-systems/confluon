// Keep this flat-array ABI in lockstep with `Simulation::snapshot`,
// `Simulation::metrics`, and `Simulation::formations`.
export const SIMULATION_CONTRACT_VERSION = 1;
export const MAX_PARTICLES = 4096;
export const MAX_FORMATION_VOICES = 8;

export const PARTICLE_STRIDE = 4;
export const PARTICLE_FIELD = Object.freeze({
  X: 0,
  Y: 1,
  PACKED_SPECIES_ENERGY: 2,
  SPEED: 3,
});

export const METRIC_COUNT = 7;
export const METRIC_FIELD = Object.freeze({
  ENERGY: 0,
  COHERENCE: 1,
  ACTIVITY: 2,
  DENSITY: 3,
  FORMATIONS: 4,
  TRANSITION: 5,
  ENCOUNTERS: 6,
});

export const FORMATION_STRIDE = 4;
export const FORMATION_FIELD = Object.freeze({
  X: 0,
  Y: 1,
  SIZE_SHARE: 2,
  SPECIES: 3,
});
