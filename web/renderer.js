import { captureException, captureMessage } from "./monitoring.js";
import {
  MAX_PARTICLES,
  METRIC_FIELD,
  PARTICLE_FIELD,
  PARTICLE_STRIDE,
} from "./simulation-contract.js";
import {
  coverWorldScale,
  createCoverProjection,
} from "./viewport-projection.js";

const FIELD_FORMAT = "rgba16float";
const HDR_FORMAT = "rgba16float";
const SPECIES_COLOURS = [
  [43, 177, 185],
  [235, 83, 49],
  [177, 116, 221],
];
const TRAIL_COLOURS = SPECIES_COLOURS.map((colour) => scaleColour(colour, 0.7));
const HALO_COLOURS = SPECIES_COLOURS.map((colour) => scaleColour(colour, 0.72));
const PARTICLE_COLOUR_RANGES = [
  [[14, 240, 199], [56, 156, 255]],
  [[255, 46, 14], [255, 163, 26]],
  [[133, 87, 255], [255, 77, 199]],
];

const sharedWgsl = /* wgsl */ `
struct Uniforms {
  projection: vec2<f32>,
  time: f32,
  dt: f32,
  coherence: f32,
  density: f32,
  encounter: f32,
  activity: f32,
  energy: f32,
  visual_glow: f32,
  visual_core: f32,
  memory: f32,
  transition: f32,
}

struct Particle {
  position: vec2<f32>,
  energy: f32,
  speed: f32,
}

fn corner(vertex_index: u32) -> vec2<f32> {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  return corners[vertex_index];
}

fn species_colour(species: u32) -> vec3<f32> {
  if (species == 1u) { return vec3<f32>(1.12, 0.24, 0.10); }
  if (species == 2u) { return vec3<f32>(0.76, 0.39, 1.08); }
  return vec3<f32>(0.12, 0.82, 0.87);
}

fn fullscreen_position(vertex_index: u32) -> vec2<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return positions[vertex_index];
}

fn project_world(position: vec2<f32>) -> vec2<f32> {
  return position * uniforms.projection;
}
`;

const fieldShader = /* wgsl */ `
${sharedWgsl}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct FieldVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) species: u32,
}

fn kernel_radius(species: u32) -> f32 {
  if (species == 1u) { return 0.054; }
  if (species == 2u) { return 0.072; }
  return 0.063;
}

fn kernel_width(species: u32) -> f32 {
  if (species == 1u) { return 0.014; }
  if (species == 2u) { return 0.019; }
  return 0.017;
}

fn kernel_weight(species: u32) -> f32 {
  if (species == 1u) { return 0.041; }
  if (species == 2u) { return 0.031; }
  return 0.035;
}

@vertex
fn field_vs(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> FieldVertexOutput {
  let particle = particles[instance_index];
  let species = u32(floor(particle.energy));
  let local = corner(vertex_index);
  let support = kernel_radius(species) + kernel_width(species) * 3.5;
  let offset = local * support;

  var output: FieldVertexOutput;
  output.position = vec4<f32>(project_world(particle.position + offset), 0.0, 1.0);
  output.local = local;
  output.species = species;
  return output;
}

@fragment
fn field_fs(input: FieldVertexOutput) -> @location(0) vec4<f32> {
  let support = kernel_radius(input.species) + kernel_width(input.species) * 3.5;
  let radius = length(input.local) * support;
  if (radius > support) { discard; }
  let t = (radius - kernel_radius(input.species)) / kernel_width(input.species);
  let value = kernel_weight(input.species) * exp(-t * t);
  var channels = vec4<f32>(0.0);
  if (input.species == 0u) {
    channels.x = value;
  } else if (input.species == 1u) {
    channels.y = value;
  } else {
    channels.z = value;
  }
  return channels;
}
`;

const trailShader = /* wgsl */ `
${sharedWgsl}

@group(0) @binding(0) var previous_trail: texture_2d<f32>;
@group(0) @binding(1) var trail_sampler: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn decay_vs(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  let position = fullscreen_position(vertex_index);
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = vec2<f32>(position.x * 0.5 + 0.5, 1.0 - (position.y * 0.5 + 0.5));
  return output;
}

@fragment
fn decay_fs(input: VertexOutput) -> @location(0) vec4<f32> {
  // Frame-rate independent exponential fade. Memory stretches the half-life
  // from a fraction of a second to many seconds.
  let rate = mix(4.2, 0.28, clamp(uniforms.memory, 0.0, 1.0));
  let keep = exp(-rate * clamp(uniforms.dt, 0.0, 0.1));
  let previous = textureSample(previous_trail, trail_sampler, input.uv).rgb;
  return vec4<f32>(previous * keep, 1.0);
}
`;

const depositShader = /* wgsl */ `
${sharedWgsl}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct DepositOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) tint: vec3<f32>,
  @location(2) strength: f32,
}

@vertex
fn deposit_vs(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> DepositOutput {
  let particle = particles[instance_index];
  let species = u32(floor(particle.energy));
  let local = corner(vertex_index);
  let radius = 0.0045 + particle.speed * 0.0035;
  let offset = local * radius;

  var output: DepositOutput;
  output.position = vec4<f32>(project_world(particle.position + offset), 0.0, 1.0);
  output.local = local;
  output.tint = species_colour(species);
  output.strength = 0.010 + particle.speed * 0.075;
  return output;
}

@fragment
fn deposit_fs(input: DepositOutput) -> @location(0) vec4<f32> {
  let falloff = exp(-dot(input.local, input.local) * 4.5);
  return vec4<f32>(input.tint * input.strength * falloff, 0.0);
}
`;

const sceneShader = /* wgsl */ `
${sharedWgsl}

@group(0) @binding(0) var field_texture: texture_2d<f32>;
@group(0) @binding(1) var trail_texture: texture_2d<f32>;
@group(0) @binding(2) var scene_sampler: sampler;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn scene_vs(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  let position = fullscreen_position(vertex_index);
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = vec2<f32>(position.x * 0.5 + 0.5, 1.0 - (position.y * 0.5 + 0.5));
  return output;
}

fn response(value: f32, centre: f32, width: f32) -> f32 {
  let t = (value - centre) / width;
  return exp(-t * t) * (1.0 - exp(-value * 42.0));
}

fn layer(value: f32, soft: f32, centre: f32, width: f32, colour: vec3<f32>) -> vec3<f32> {
  let matter = 1.0 - exp(-value * 7.5);
  let aura = 1.0 - exp(-soft * 4.0);
  let membrane = response(value, centre, width);
  let inner = response(value, centre * 0.62, width * 1.3);
  let deep = colour * (colour * 0.45 + vec3<f32>(0.08));
  return deep * (matter * 0.16 + aura * 0.05) + colour * (membrane * 0.58 + inner * 0.13);
}

@fragment
fn scene_fs(input: VertexOutput) -> @location(0) vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(field_texture));
  let texel = 1.0 / dimensions;
  let field = textureSample(field_texture, scene_sampler, input.uv);
  var soft = field * 0.28;
  soft += textureSample(field_texture, scene_sampler, input.uv + vec2<f32>(texel.x * 2.0, 0.0)) * 0.12;
  soft += textureSample(field_texture, scene_sampler, input.uv - vec2<f32>(texel.x * 2.0, 0.0)) * 0.12;
  soft += textureSample(field_texture, scene_sampler, input.uv + vec2<f32>(0.0, texel.y * 2.0)) * 0.12;
  soft += textureSample(field_texture, scene_sampler, input.uv - vec2<f32>(0.0, texel.y * 2.0)) * 0.12;
  soft += textureSample(field_texture, scene_sampler, input.uv + texel * vec2<f32>(4.0, 4.0)) * 0.06;
  soft += textureSample(field_texture, scene_sampler, input.uv + texel * vec2<f32>(-4.0, 4.0)) * 0.06;
  soft += textureSample(field_texture, scene_sampler, input.uv + texel * vec2<f32>(4.0, -4.0)) * 0.06;
  soft += textureSample(field_texture, scene_sampler, input.uv - texel * vec2<f32>(4.0, 4.0)) * 0.06;

  let tide = vec3<f32>(0.10, 0.73, 0.78);
  let ember = vec3<f32>(1.0, 0.22, 0.09);
  let bloom = vec3<f32>(0.67, 0.34, 0.96);

  // Deep-water background with a slow travelling tint so stillness never
  // reads as a dead screen.
  let centred = input.uv - vec2<f32>(0.5 + sin(uniforms.time * 0.031) * 0.05,
                                     0.5 + cos(uniforms.time * 0.027) * 0.04);
  let base_fall = exp(-dot(centred, centred) * 2.4);
  var colour = vec3<f32>(0.004, 0.006, 0.010);
  colour += vec3<f32>(0.010, 0.022, 0.024) * base_fall * (0.6 + uniforms.coherence * 0.8);
  colour += vec3<f32>(0.020, 0.011, 0.008) * base_fall * uniforms.energy * 0.5;

  // Motion history painted by the particles themselves.
  let trail = textureSample(trail_texture, scene_sampler, input.uv).rgb;
  colour += trail * (0.30 + uniforms.memory * 0.55);

  colour += layer(field.x, soft.x, 0.46, 0.12, tide);
  colour += layer(field.y, soft.y, 0.50, 0.11, ember);
  colour += layer(field.z, soft.z, 0.42, 0.13, bloom);

  let glow = soft.x * tide + soft.y * ember + soft.z * bloom;
  colour += glow * (0.11 + uniforms.encounter * 0.055);
  colour *= 0.98 + uniforms.density * 0.32;
  colour *= uniforms.visual_glow;
  return vec4<f32>(colour, 1.0);
}
`;

const particleShader = /* wgsl */ `
${sharedWgsl}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct ParticleVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) energy: f32,
  @location(2) speed: f32,
  @location(3) breath: f32,
  @location(4) @interpolate(flat) species: u32,
  @location(5) @interpolate(flat) tint: vec3<f32>,
  @location(6) @interpolate(flat) luminosity: f32,
  @location(7) @interpolate(flat) character: f32,
}

fn particle_variation(index: u32, salt: f32) -> f32 {
  return fract(sin((f32(index) + salt) * 12.9898) * 43758.5453);
}

fn particle_colour(species: u32, variation: f32) -> vec3<f32> {
  if (species == 1u) {
    return mix(vec3<f32>(1.18, 0.18, 0.055), vec3<f32>(1.12, 0.64, 0.10), variation);
  }
  if (species == 2u) {
    return mix(vec3<f32>(0.52, 0.34, 1.20), vec3<f32>(1.08, 0.30, 0.78), variation);
  }
  return mix(vec3<f32>(0.055, 0.94, 0.78), vec3<f32>(0.22, 0.61, 1.16), variation);
}

@vertex
fn particle_vs(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> ParticleVertexOutput {
  let particle = particles[instance_index];
  let species = u32(floor(particle.energy));
  let local = corner(vertex_index);
  let breath = 0.5 + 0.5 * sin(uniforms.time * 0.57 + f32(instance_index) * 0.37);
  let size_seed = particle_variation(instance_index, 3.7);
  let radius_variation = mix(0.62, 1.42, pow(size_seed, 1.35));
  let radius = (0.0098 + particle.speed * 0.0028 + breath * uniforms.coherence * 0.0014)
    * radius_variation;
  let offset = local * radius;
  let hue = particle_variation(instance_index, 11.3);
  let character = particle_variation(instance_index, 47.9);

  var output: ParticleVertexOutput;
  output.position = vec4<f32>(project_world(particle.position + offset), 0.0, 1.0);
  output.local = local;
  output.species = species;
  output.energy = fract(particle.energy);
  output.speed = particle.speed;
  output.breath = breath;
  output.tint = particle_colour(species, hue);
  output.luminosity = mix(0.40, 1.36, pow(particle_variation(instance_index, 29.1), 0.78));
  output.character = character;
  return output;
}

@fragment
fn particle_fs(input: ParticleVertexOutput) -> @location(0) vec4<f32> {
  let distance = length(input.local);
  if (distance > 1.0) { discard; }
  let distance_squared = distance * distance;
  let nucleus = exp(-distance_squared * mix(170.0, 270.0, input.character));
  let body = exp(-distance_squared * mix(18.0, 31.0, input.character));
  let halo = exp(-distance_squared * mix(3.1, 5.4, input.character))
    * (1.0 - smoothstep(0.68, 1.0, distance));
  let pearl = vec3<f32>(0.95, 1.08, 1.02);
  let colour = input.tint * (0.82 + input.energy * 0.30);
  let pulse = 0.91 + input.breath * 0.14;
  let luminosity = input.luminosity * pulse * uniforms.visual_core;
  let coloured_light = colour
    * (body * (0.50 + input.energy * 0.20) + halo * (0.16 + input.speed * 0.09));
  let nucleus_light = pearl * nucleus * 2.15;
  let alpha = (nucleus * 1.2 + body * 0.48 + halo * 0.16) * luminosity;
  return vec4<f32>((coloured_light + nucleus_light) * luminosity, alpha);
}
`;

const bloomShader = /* wgsl */ `
${sharedWgsl}

@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn fullscreen_vs(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  let position = fullscreen_position(vertex_index);
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = vec2<f32>(position.x * 0.5 + 0.5, 1.0 - (position.y * 0.5 + 0.5));
  return output;
}

@fragment
fn extract_fs(input: VertexOutput) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(source_texture));
  // 4-tap box downsample with a soft knee so only luminous matter blooms.
  var colour = textureSample(source_texture, source_sampler, input.uv + texel * vec2<f32>(-0.5, -0.5)).rgb;
  colour += textureSample(source_texture, source_sampler, input.uv + texel * vec2<f32>(0.5, -0.5)).rgb;
  colour += textureSample(source_texture, source_sampler, input.uv + texel * vec2<f32>(-0.5, 0.5)).rgb;
  colour += textureSample(source_texture, source_sampler, input.uv + texel * vec2<f32>(0.5, 0.5)).rgb;
  colour *= 0.25;
  let brightness = max(colour.r, max(colour.g, colour.b));
  let knee = smoothstep(0.16, 0.72, brightness);
  return vec4<f32>(colour * knee, 1.0);
}

fn blur(uv: vec2<f32>, direction: vec2<f32>) -> vec3<f32> {
  let texel = direction / vec2<f32>(textureDimensions(source_texture));
  var colour = textureSample(source_texture, source_sampler, uv).rgb * 0.227027;
  let offsets = array<f32, 4>(1.384615, 3.230769, 5.076923, 6.923077);
  let weights = array<f32, 4>(0.316216, 0.070270, 0.008962, 0.000538);
  for (var index = 0; index < 4; index += 1) {
    let offset = texel * offsets[index];
    colour += textureSample(source_texture, source_sampler, uv + offset).rgb * weights[index] * 0.5;
    colour += textureSample(source_texture, source_sampler, uv - offset).rgb * weights[index] * 0.5;
  }
  return colour;
}

@fragment
fn blur_h_fs(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(blur(input.uv, vec2<f32>(1.0, 0.0)), 1.0);
}

@fragment
fn blur_v_fs(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(blur(input.uv, vec2<f32>(0.0, 1.0)), 1.0);
}
`;

const finalShader = /* wgsl */ `
${sharedWgsl}

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var bloom_texture: texture_2d<f32>;
@group(0) @binding(2) var final_sampler: sampler;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn final_vs(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  let position = fullscreen_position(vertex_index);
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = vec2<f32>(position.x * 0.5 + 0.5, 1.0 - (position.y * 0.5 + 0.5));
  return output;
}

fn aces(colour: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((colour * (a * colour + b)) / (colour * (c * colour + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn hash(uv: vec2<f32>) -> f32 {
  return fract(sin(dot(uv, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn final_fs(input: VertexOutput) -> @location(0) vec4<f32> {
  let scene = textureSample(scene_texture, final_sampler, input.uv).rgb;
  let halo = textureSample(bloom_texture, final_sampler, input.uv).rgb;
  var colour = scene + halo * (0.55 + uniforms.visual_glow * 0.45 + uniforms.transition * 0.6);

  colour = aces(colour * 1.35);
  // Gentle lift keeps the darkest water translucent rather than crushed.
  colour = pow(colour, vec3<f32>(0.92));

  let vignette = 1.0 - 0.26 * smoothstep(0.44, 1.12, length(input.uv - 0.5) * 1.45);
  colour *= vignette;

  // Cross-fade low-rate grain frames so the texture hides banding without
  // producing full-frame temporal sparkle around bright contours.
  let grain_time = uniforms.time * 3.0;
  let grain_frame = floor(grain_time);
  let grain_mix = smoothstep(0.0, 1.0, fract(grain_time));
  let grain_a = hash(input.uv * 1013.0 + vec2<f32>(grain_frame * 17.3, grain_frame * 29.1));
  let grain_b = hash(input.uv * 1013.0 + vec2<f32>((grain_frame + 1.0) * 17.3,
                                                   (grain_frame + 1.0) * 29.1));
  let grain = (mix(grain_a, grain_b, grain_mix) - 0.5) * 0.009;
  colour = max(colour + vec3<f32>(grain), vec3<f32>(0.0));
  return vec4<f32>(colour, 1.0);
}
`;

class TrailRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: true });
    this.previous = null;
    this.ready = false;
    this.memory = 0.42;
  }

  setMemory(memory) {
    this.memory = clamp(memory, 0, 1);
  }

  reset() {
    this.previous = null;
    this.ready = false;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  render(snapshot, metrics, time) {
    const resized = resizeCanvas(this.canvas);
    const { context, canvas } = this;
    const worldScale = coverWorldScale(canvas.width, canvas.height);
    if (resized || !this.ready) {
      context.fillStyle = "rgb(4 6 9)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      this.previous = null;
      this.ready = true;
    } else {
      context.globalCompositeOperation = "source-over";
      const fade =
        0.24 - this.memory * 0.19 + metrics[METRIC_FIELD.ACTIVITY] * 0.025;
      context.fillStyle = `rgba(4, 6, 9, ${fade})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    const glow = context.createRadialGradient(
      canvas.width * (0.48 + Math.sin(time * 0.031) * 0.035),
      canvas.height * (0.5 + Math.cos(time * 0.027) * 0.03),
      0,
      canvas.width * 0.5,
      canvas.height * 0.5,
      Math.max(canvas.width, canvas.height) * 0.62,
    );
    glow.addColorStop(
      0,
      `rgba(25, 67, 70, ${0.014 + metrics[METRIC_FIELD.COHERENCE] * 0.016})`,
    );
    glow.addColorStop(
      0.58,
      `rgba(58, 35, 30, ${0.007 + metrics[METRIC_FIELD.ENERGY] * 0.009})`,
    );
    glow.addColorStop(1, "rgba(4, 6, 9, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (this.previous?.length === snapshot.length) {
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";
      for (
        let offset = 0;
        offset < snapshot.length;
        offset += PARTICLE_STRIDE * 2
      ) {
        const dx =
          snapshot[offset + PARTICLE_FIELD.X] -
          this.previous[offset + PARTICLE_FIELD.X];
        const dy =
          snapshot[offset + PARTICLE_FIELD.Y] -
          this.previous[offset + PARTICLE_FIELD.Y];
        if (Math.abs(dx) > 0.35 || Math.abs(dy) > 0.35) continue;
        const speed = snapshot[offset + PARTICLE_FIELD.SPEED];
        const packedEnergy = snapshot[offset + PARTICLE_FIELD.PACKED_SPECIES_ENERGY];
        const [red, green, blue] = TRAIL_COLOURS[speciesOf(packedEnergy)];
        const traceAlpha = (0.018 + speed * 0.11) * (0.42 + this.memory * 1.08);
        context.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${traceAlpha})`;
        context.lineWidth = deviceScale() * (0.34 + speed * 0.5);
        context.beginPath();
        context.moveTo(
          toX(this.previous[offset + PARTICLE_FIELD.X], canvas.width, worldScale),
          toY(this.previous[offset + PARTICLE_FIELD.Y], canvas.height, worldScale),
        );
        context.lineTo(
          toX(snapshot[offset + PARTICLE_FIELD.X], canvas.width, worldScale),
          toY(snapshot[offset + PARTICLE_FIELD.Y], canvas.height, worldScale),
        );
        context.stroke();
      }
    }
    context.globalCompositeOperation = "source-over";
    if (this.previous?.length !== snapshot.length) {
      this.previous = new Float32Array(snapshot.length);
    }
    this.previous.set(snapshot);
  }
}

class WebGpuRenderer {
  constructor(canvas, device, context, format, onDeviceLost) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.kind = "WEBGPU";
    this.visualGlow = 1;
    this.visualCore = 1;
    this.memory = 0.42;
    this.lastTime = 0;
    this.sizedWidth = 0;
    this.sizedHeight = 0;
    this.trailIndex = 0;
    this.clearTrails = true;
    this.uniformValues = new Float32Array(16);
    device.addEventListener("uncapturederror", (event) => {
      console.error("WebGPU validation error:", event.error.message);
      captureMessage("WebGPU validation error", {
        renderer: "webgpu",
        message: event.error.message,
      });
    });
    device.lost.then((info) => {
      captureMessage("WebGPU device lost", {
        renderer: "webgpu",
        reason: info.reason || "unknown",
        message: info.message || "",
      });
      onDeviceLost?.(info);
    });

    this.particleBuffer = device.createBuffer({
      label: "particle snapshot",
      size: MAX_PARTICLES * PARTICLE_STRIDE * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.uniformBuffer = device.createBuffer({
      label: "render uniforms",
      size: this.uniformValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.linearSampler = device.createSampler({
      label: "linear sampler",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.particleLayout = device.createBindGroupLayout({
      label: "particle layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    this.oneTextureLayout = device.createBindGroupLayout({
      label: "one texture layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    this.twoTextureLayout = device.createBindGroupLayout({
      label: "two texture layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const particlePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.particleLayout] });
    const oneTexturePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.oneTextureLayout] });
    const twoTexturePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.twoTextureLayout] });

    const additive = {
      color: { srcFactor: "one", dstFactor: "one" },
      alpha: { srcFactor: "one", dstFactor: "one" },
    };

    const fieldModule = device.createShaderModule({ label: "kernel field", code: fieldShader });
    this.fieldPipeline = device.createRenderPipeline({
      label: "kernel field pipeline",
      layout: particlePipelineLayout,
      vertex: { module: fieldModule, entryPoint: "field_vs" },
      fragment: {
        module: fieldModule,
        entryPoint: "field_fs",
        targets: [{ format: FIELD_FORMAT, blend: additive }],
      },
      primitive: { topology: "triangle-list" },
    });

    const trailModule = device.createShaderModule({ label: "trail decay", code: trailShader });
    this.trailDecayPipeline = device.createRenderPipeline({
      label: "trail decay pipeline",
      layout: oneTexturePipelineLayout,
      vertex: { module: trailModule, entryPoint: "decay_vs" },
      fragment: { module: trailModule, entryPoint: "decay_fs", targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });

    const depositModule = device.createShaderModule({ label: "trail deposit", code: depositShader });
    this.trailDepositPipeline = device.createRenderPipeline({
      label: "trail deposit pipeline",
      layout: particlePipelineLayout,
      vertex: { module: depositModule, entryPoint: "deposit_vs" },
      fragment: {
        module: depositModule,
        entryPoint: "deposit_fs",
        targets: [{ format: HDR_FORMAT, blend: additive }],
      },
      primitive: { topology: "triangle-list" },
    });

    const sceneModule = device.createShaderModule({ label: "scene compose", code: sceneShader });
    this.scenePipeline = device.createRenderPipeline({
      label: "scene compose pipeline",
      layout: twoTexturePipelineLayout,
      vertex: { module: sceneModule, entryPoint: "scene_vs" },
      fragment: { module: sceneModule, entryPoint: "scene_fs", targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });

    const particleModule = device.createShaderModule({ label: "particle cores", code: particleShader });
    this.particlePipeline = device.createRenderPipeline({
      label: "particle core pipeline",
      layout: particlePipelineLayout,
      vertex: { module: particleModule, entryPoint: "particle_vs" },
      fragment: {
        module: particleModule,
        entryPoint: "particle_fs",
        targets: [{ format: HDR_FORMAT, blend: additive }],
      },
      primitive: { topology: "triangle-list" },
    });

    const bloomModule = device.createShaderModule({ label: "bloom", code: bloomShader });
    this.bloomExtractPipeline = device.createRenderPipeline({
      label: "bloom extract pipeline",
      layout: oneTexturePipelineLayout,
      vertex: { module: bloomModule, entryPoint: "fullscreen_vs" },
      fragment: { module: bloomModule, entryPoint: "extract_fs", targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
    this.bloomBlurHPipeline = device.createRenderPipeline({
      label: "bloom blur h pipeline",
      layout: oneTexturePipelineLayout,
      vertex: { module: bloomModule, entryPoint: "fullscreen_vs" },
      fragment: { module: bloomModule, entryPoint: "blur_h_fs", targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
    this.bloomBlurVPipeline = device.createRenderPipeline({
      label: "bloom blur v pipeline",
      layout: oneTexturePipelineLayout,
      vertex: { module: bloomModule, entryPoint: "fullscreen_vs" },
      fragment: { module: bloomModule, entryPoint: "blur_v_fs", targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });

    const finalModule = device.createShaderModule({ label: "final grade", code: finalShader });
    this.finalPipeline = device.createRenderPipeline({
      label: "final grade pipeline",
      layout: twoTexturePipelineLayout,
      vertex: { module: finalModule, entryPoint: "final_vs" },
      fragment: { module: finalModule, entryPoint: "final_fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    this.particleBindGroup = device.createBindGroup({
      layout: this.particleLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  resetTrails() {
    this.clearTrails = true;
  }

  setStyle({ glow, memory, core }) {
    this.visualGlow = clamp(glow, 0.45, 1.55);
    this.visualCore = clamp(core, 0.65, 1.45);
    this.memory = clamp(memory, 0, 1);
  }

  ensureTargets() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width === this.sizedWidth && height === this.sizedHeight) return;
    this.sizedWidth = width;
    this.sizedHeight = height;
    const projection = createCoverProjection(width, height);
    this.projectionX = projection.x;
    this.projectionY = projection.y;

    const make = (label, w, h) => {
      const texture = this.device.createTexture({
        label,
        size: { width: Math.max(1, w), height: Math.max(1, h) },
        format: HDR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      return { texture, view: texture.createView() };
    };

    for (const key of ["fieldTarget", "sceneTarget", "bloomA", "bloomB"]) {
      this[key]?.texture.destroy();
    }
    this.trailTargets?.forEach((target) => target.texture.destroy());

    this.fieldTarget = make("kernel field texture", Math.floor(width / 3), Math.floor(height / 3));
    this.sceneTarget = make("scene hdr texture", width, height);
    this.trailTargets = [
      make("trail texture a", Math.floor(width / 2), Math.floor(height / 2)),
      make("trail texture b", Math.floor(width / 2), Math.floor(height / 2)),
    ];
    this.bloomA = make("bloom texture a", Math.floor(width / 4), Math.floor(height / 4));
    this.bloomB = make("bloom texture b", Math.floor(width / 4), Math.floor(height / 4));
    this.clearTrails = true;

    const oneTexture = (label, view) =>
      this.device.createBindGroup({
        label,
        layout: this.oneTextureLayout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: this.linearSampler },
          { binding: 2, resource: { buffer: this.uniformBuffer } },
        ],
      });
    const twoTexture = (label, first, second) =>
      this.device.createBindGroup({
        label,
        layout: this.twoTextureLayout,
        entries: [
          { binding: 0, resource: first },
          { binding: 1, resource: second },
          { binding: 2, resource: this.linearSampler },
          { binding: 3, resource: { buffer: this.uniformBuffer } },
        ],
      });

    this.trailDecayBindGroups = [
      oneTexture("decay reads a", this.trailTargets[0].view),
      oneTexture("decay reads b", this.trailTargets[1].view),
    ];
    this.sceneBindGroups = [
      twoTexture("scene with trail a", this.fieldTarget.view, this.trailTargets[0].view),
      twoTexture("scene with trail b", this.fieldTarget.view, this.trailTargets[1].view),
    ];
    this.bloomExtractBindGroup = oneTexture("bloom extract", this.sceneTarget.view);
    this.bloomBlurHBindGroup = oneTexture("bloom blur h", this.bloomA.view);
    this.bloomBlurVBindGroup = oneTexture("bloom blur v", this.bloomB.view);
    this.finalBindGroup = twoTexture("final grade", this.sceneTarget.view, this.bloomA.view);
  }

  render(snapshot, metrics, time) {
    resizeCanvas(this.canvas);
    this.ensureTargets();
    const dt = this.lastTime > 0 ? Math.min(0.1, Math.max(0, time - this.lastTime)) : 1 / 60;
    this.lastTime = time;

    const particleCount = Math.min(MAX_PARTICLES, snapshot.length / PARTICLE_STRIDE);
    this.device.queue.writeBuffer(this.particleBuffer, 0, snapshot);
    const uniforms = this.uniformValues;
    uniforms[0] = this.projectionX;
    uniforms[1] = this.projectionY;
    uniforms[2] = time;
    uniforms[3] = dt;
    uniforms[4] = metrics[METRIC_FIELD.COHERENCE];
    uniforms[5] = metrics[METRIC_FIELD.DENSITY];
    uniforms[6] = metrics[METRIC_FIELD.ENCOUNTERS] ?? 0;
    uniforms[7] = metrics[METRIC_FIELD.ACTIVITY];
    uniforms[8] = metrics[METRIC_FIELD.ENERGY];
    uniforms[9] = this.visualGlow;
    uniforms[10] = this.visualCore;
    uniforms[11] = this.memory;
    uniforms[12] = metrics[METRIC_FIELD.TRANSITION] ?? 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const encoder = this.device.createCommandEncoder({ label: "living field frame" });

    const fieldPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.fieldTarget.view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    fieldPass.setPipeline(this.fieldPipeline);
    fieldPass.setBindGroup(0, this.particleBindGroup);
    fieldPass.draw(6, particleCount);
    fieldPass.end();

    // Trail ping-pong: fade the previous history into the other target, then
    // deposit this frame's particles on top.
    const source = this.trailIndex;
    const destination = 1 - this.trailIndex;
    this.trailIndex = destination;
    const trailPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.trailTargets[destination].view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    if (!this.clearTrails) {
      trailPass.setPipeline(this.trailDecayPipeline);
      trailPass.setBindGroup(0, this.trailDecayBindGroups[source]);
      trailPass.draw(3);
    }
    this.clearTrails = false;
    trailPass.setPipeline(this.trailDepositPipeline);
    trailPass.setBindGroup(0, this.particleBindGroup);
    trailPass.draw(6, particleCount);
    trailPass.end();

    const scenePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.sceneTarget.view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    scenePass.setPipeline(this.scenePipeline);
    scenePass.setBindGroup(0, this.sceneBindGroups[destination]);
    scenePass.draw(3);
    scenePass.setPipeline(this.particlePipeline);
    scenePass.setBindGroup(0, this.particleBindGroup);
    scenePass.draw(6, particleCount);
    scenePass.end();

    const bloomSteps = [
      { pipeline: this.bloomExtractPipeline, bindGroup: this.bloomExtractBindGroup, target: this.bloomA },
      { pipeline: this.bloomBlurHPipeline, bindGroup: this.bloomBlurHBindGroup, target: this.bloomB },
      { pipeline: this.bloomBlurVPipeline, bindGroup: this.bloomBlurVBindGroup, target: this.bloomA },
    ];
    for (const step of bloomSteps) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: step.target.view,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(step.pipeline);
      pass.setBindGroup(0, step.bindGroup);
      pass.draw(3);
      pass.end();
    }

    const finalPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    finalPass.setPipeline(this.finalPipeline);
    finalPass.setBindGroup(0, this.finalBindGroup);
    finalPass.draw(3);
    finalPass.end();

    this.device.queue.submit([encoder.finish()]);
  }
}

class CanvasRenderer {
  constructor(canvas, trailCanvas, context = canvas.getContext("2d", { alpha: true })) {
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.canvas = canvas;
    this.context = context;
    this.kind = "CANVAS";
    this.trails = new TrailRenderer(trailCanvas);
    this.spriteScale = 0;
    this.sprites = [];
    this.visualGlow = 1;
    this.visualCore = 1;
  }

  resetTrails() {
    this.trails.reset();
  }

  setStyle({ glow, memory, core }) {
    this.visualGlow = clamp(glow, 0.45, 1.55);
    this.visualCore = clamp(core, 0.65, 1.45);
    this.trails.setMemory(memory);
  }

  render(snapshot, metrics, time) {
    resizeCanvas(this.canvas);
    this.trails.render(snapshot, metrics, time);
    const { context, canvas } = this;
    const worldScale = coverWorldScale(canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "lighter";

    context.save();
    context.filter = `blur(${Math.round(5 * deviceScale())}px)`;
    for (let species = 0; species < 3; species += 1) {
      const [red, green, blue] = HALO_COLOURS[species];
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${0.012 * this.visualGlow})`;
      context.beginPath();
      for (let offset = 0; offset < snapshot.length; offset += PARTICLE_STRIDE) {
        if (
          speciesOf(snapshot[offset + PARTICLE_FIELD.PACKED_SPECIES_ENERGY]) !==
          species
        ) {
          continue;
        }
        const x = toX(snapshot[offset + PARTICLE_FIELD.X], canvas.width, worldScale);
        const y = toY(snapshot[offset + PARTICLE_FIELD.Y], canvas.height, worldScale);
        const radius = (11 + species * 2.2) * deviceScale();
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
      context.fill();
    }
    context.restore();

    this.ensureSprites();

    for (let offset = 0; offset < snapshot.length; offset += PARTICLE_STRIDE) {
      const x = toX(snapshot[offset + PARTICLE_FIELD.X], canvas.width, worldScale);
      const y = toY(snapshot[offset + PARTICLE_FIELD.Y], canvas.height, worldScale);
      const packedEnergy = snapshot[offset + PARTICLE_FIELD.PACKED_SPECIES_ENERGY];
      const species = speciesOf(packedEnergy);
      const energy = energyOf(packedEnergy);
      const speed = snapshot[offset + PARTICLE_FIELD.SPEED];
      const breath = 0.5 + 0.5 * Math.sin(time * 0.57 + offset * 0.0925);
      const particleIndex = offset / PARTICLE_STRIDE;
      const variant = particleIndex % PARTICLE_SPRITE_VARIANTS;
      const sizeSeed = particleVariation(particleIndex, 3);
      const radiusVariation = 0.62 + Math.pow(sizeSeed, 1.35) * 0.8;
      const pulse = 0.91 + breath * 0.14;
      const radius =
        (1.9 +
          speed * 1.1 +
          breath * metrics[METRIC_FIELD.COHERENCE] * 0.42) *
        deviceScale() *
        radiusVariation;
      const diameter = radius * (5.4 + energy * 0.4 + speed * 0.25) * this.visualCore;
      context.globalAlpha = pulse;
      context.drawImage(
        this.sprites[species][variant],
        x - diameter / 2,
        y - diameter / 2,
        diameter,
        diameter,
      );
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }

  ensureSprites() {
    const scale = deviceScale();
    if (scale === this.spriteScale) return;
    this.spriteScale = scale;
    this.sprites = [0, 1, 2].map((species) =>
      Array.from({ length: PARTICLE_SPRITE_VARIANTS }, (_, variant) => {
        const sprite = document.createElement("canvas");
        sprite.width = Math.ceil(22 * scale);
        sprite.height = sprite.width;
        const spriteContext = sprite.getContext("2d");
        const centre = sprite.width / 2;
        const hue = particleVariation(variant, 11);
        const luminosity = 0.4 + Math.pow(particleVariation(variant, 29), 0.78) * 0.96;
        const character = particleVariation(variant, 47);
        const [red, green, blue] = particleColour(species, hue);
        const gradient = spriteContext.createRadialGradient(centre, centre, 0, centre, centre, centre);
        gradient.addColorStop(0, `rgba(244, 255, 250, ${Math.min(1, 0.82 + luminosity * 0.13)})`);
        gradient.addColorStop(0.055 + character * 0.025, `rgba(244, 255, 250, ${0.72 + luminosity * 0.12})`);
        gradient.addColorStop(0.14 + character * 0.035, `rgba(${red}, ${green}, ${blue}, ${0.46 + luminosity * 0.28})`);
        gradient.addColorStop(0.42 + character * 0.08, `rgba(${red}, ${green}, ${blue}, ${0.12 + luminosity * 0.14})`);
        gradient.addColorStop(0.78, `rgba(${red}, ${green}, ${blue}, ${0.018 + luminosity * 0.03})`);
        gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
        spriteContext.fillStyle = gradient;
        spriteContext.fillRect(0, 0, sprite.width, sprite.height);
        return sprite;
      }),
    );
  }
}

const PARTICLE_SPRITE_VARIANTS = 24;

function speciesOf(packedEnergy) {
  return Math.max(0, Math.min(2, Math.floor(packedEnergy)));
}

function energyOf(packedEnergy) {
  return Math.max(0, Math.min(0.999, packedEnergy - speciesOf(packedEnergy)));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

function scaleColour(colour, brightness) {
  return colour.map((channel) => Math.round(Math.min(255, channel * brightness)));
}

function particleColour(species, variation) {
  const [start, end] = PARTICLE_COLOUR_RANGES[species];
  return start.map((channel, index) =>
    Math.round(Math.min(255, channel + (end[index] - channel) * variation)),
  );
}

function particleVariation(index, salt = 0) {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function toX(value, width, worldScale) {
  return width * 0.5 + value * worldScale;
}

function toY(value, height, worldScale) {
  return height * 0.5 - value * worldScale;
}

function deviceScale() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function resizeCanvas(canvas) {
  const scale = deviceScale();
  const width = Math.max(1, Math.floor(canvas.clientWidth * scale));
  const height = Math.max(1, Math.floor(canvas.clientHeight * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}

export async function createRenderer(canvas, trailCanvas, options = {}) {
  const rendererMode = new URL(window.location.href).searchParams.get("renderer");
  const forceCanvas =
    options.forceCanvas ||
    rendererMode === "canvas" ||
    rendererMode === "canvas-locked";
  // Locking this canvas exercises creation of a separate Canvas fallback.
  if (rendererMode === "canvas-locked") canvas.getContext("webgpu");
  if (forceCanvas || !navigator.gpu) return createCanvasRenderer(canvas, trailCanvas);

  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return createCanvasRenderer(canvas, trailCanvas);
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    trailCanvas.style.display = "none";
    return new WebGpuRenderer(
      canvas,
      device,
      context,
      format,
      options.onDeviceLost,
    );
  } catch (error) {
    console.warn("WebGPU unavailable; using Canvas fallback", error);
    captureException(error, { stage: "renderer_initialization", fallback: "canvas" });
    return createCanvasRenderer(canvas, trailCanvas);
  }
}

function createCanvasRenderer(interactionCanvas, trailCanvas) {
  trailCanvas.style.display = "";
  let displayCanvas = interactionCanvas;
  let context = displayCanvas.getContext("2d", { alpha: true });

  if (!context) {
    displayCanvas = interactionCanvas.parentElement?.querySelector(".fallback-field");
    if (!displayCanvas) {
      displayCanvas = document.createElement("canvas");
      displayCanvas.className = "fallback-field";
      displayCanvas.setAttribute("aria-hidden", "true");
      interactionCanvas.before(displayCanvas);
    }
    interactionCanvas.style.opacity = "0";
    context = displayCanvas.getContext("2d", { alpha: true });
  }

  return new CanvasRenderer(displayCanvas, trailCanvas, context);
}
