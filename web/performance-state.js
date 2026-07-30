import { MAX_PARTICLES } from "./simulation-contract.js";

const URL_BASE = "https://confluon.invalid/";
const DEFAULT_POPULATION = 2000;
const MINIMUM_POPULATION = 600;

export const GESTURE_MODES = Object.freeze(["gather", "orbit", "divide"]);
const DEFAULT_GESTURE_MODE = GESTURE_MODES[0];

export const PERFORMANCE_PARAMETER_SCHEMA = Object.freeze([
  parameter("ecology", "ecology", 1, 0.25, 1.8),
  parameter("flow", "flow", 1, 0.5, 1.8),
  parameter("gesture", "touch", 1, 0.5, 1.8),
  parameter("glow", "halo", 1, 0.45, 1.55),
  parameter("memory", "memory", 0.42, 0, 1),
  parameter("tone", "tone", 0.55, 0, 1),
  parameter("level", "level", 0.74, 0, 1),
]);

const gestureModes = new Set(GESTURE_MODES);

export function parsePerformanceSettings(source) {
  const parameters = asUrl(source).searchParams;
  const settings = {};

  for (const descriptor of PERFORMANCE_PARAMETER_SCHEMA) {
    settings[descriptor.property] = readScaledParameter(parameters, descriptor);
  }

  settings.population = clampPopulation(
    Number(parameters.get("life") ?? DEFAULT_POPULATION),
  );
  const mode = parameters.get("mode");
  settings.mode = isGestureMode(mode) ? mode : DEFAULT_GESTURE_MODE;
  return settings;
}

export function encodePerformanceState(source, seed, settings) {
  const url = asUrl(source);
  url.searchParams.set("seed", String(normalizeSeed(seed)));

  for (const descriptor of PERFORMANCE_PARAMETER_SCHEMA) {
    const value = clamp(
      Number(settings[descriptor.property]),
      descriptor.minimum,
      descriptor.maximum,
      descriptor.fallback,
    );
    url.searchParams.set(descriptor.query, String(Math.round(value * descriptor.scale)));
  }

  url.searchParams.set("life", String(clampPopulation(Number(settings.population))));
  url.searchParams.set(
    "mode",
    isGestureMode(settings.mode) ? settings.mode : DEFAULT_GESTURE_MODE,
  );
  return url;
}

export function parseSeed(source) {
  const value = Number(asUrl(source).searchParams.get("seed"));
  if (!Number.isInteger(value) || value <= 0 || value > 0xffff_ffff) return null;
  return value >>> 0;
}

export function normalizeSeed(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 0xffff_ffff) {
    throw new RangeError("Seed must be an integer from 1 to 4294967295");
  }
  return number >>> 0;
}

export function formatSeed(value) {
  return normalizeSeed(value).toString(16).toUpperCase().padStart(8, "0");
}

export function clampPopulation(value) {
  const population = Number.isFinite(value) ? value : DEFAULT_POPULATION;
  return Math.max(MINIMUM_POPULATION, Math.min(MAX_PARTICLES, Math.round(population)));
}

export function isGestureMode(value) {
  return gestureModes.has(value);
}

function parameter(property, query, fallback, minimum, maximum) {
  return Object.freeze({
    property,
    query,
    fallback,
    minimum,
    maximum,
    scale: 100,
  });
}

function readScaledParameter(parameters, descriptor) {
  if (!parameters.has(descriptor.query)) return descriptor.fallback;
  return clamp(
    Number(parameters.get(descriptor.query)) / descriptor.scale,
    descriptor.minimum,
    descriptor.maximum,
    descriptor.fallback,
  );
}

function clamp(value, minimum, maximum, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function asUrl(source) {
  if (source instanceof URL) return new URL(source);
  return new URL(String(source), browserBase());
}

function browserBase() {
  return typeof window === "undefined" ? URL_BASE : window.location.href;
}
