const MAX_PARTICLES = 2048;
const FIELD_FORMAT = "rgba16float";

const fieldShader = /* wgsl */ `
struct Particle {
  position: vec2<f32>,
  energy: f32,
  speed: f32,
}

struct Uniforms {
  aspect: f32,
  time: f32,
  coherence: f32,
  density: f32,
  encounter: f32,
  activity: f32,
  padding0: f32,
  padding1: f32,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct FieldVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) species: u32,
}

struct ParticleVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) energy: f32,
  @location(2) speed: f32,
  @location(3) breath: f32,
  @location(4) @interpolate(flat) species: u32,
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
  // The simulation's torus occupies clip space directly. Its neighbourhood
  // metric therefore stretches with the viewport too; keep the field aligned
  // with the particles instead of drawing aesthetically round but false rings.
  let offset = local * support;

  var output: FieldVertexOutput;
  output.position = vec4<f32>(particle.position + offset, 0.0, 1.0);
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

@vertex
fn particle_vs(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> ParticleVertexOutput {
  let particle = particles[instance_index];
  let local = corner(vertex_index);
  let breath = 0.5 + 0.5 * sin(uniforms.time * 0.57 + f32(instance_index) * 0.37);
  let radius = 0.010 + particle.speed * 0.003 + breath * uniforms.coherence * 0.0015;
  let offset = vec2<f32>(local.x / max(uniforms.aspect, 0.01), local.y) * radius;

  var output: ParticleVertexOutput;
  output.position = vec4<f32>(particle.position + offset, 0.0, 1.0);
  output.local = local;
  output.species = u32(floor(particle.energy));
  output.energy = fract(particle.energy);
  output.speed = particle.speed;
  output.breath = breath;
  return output;
}

fn species_colour(species: u32) -> vec3<f32> {
  if (species == 1u) { return vec3<f32>(1.12, 0.24, 0.10); }
  if (species == 2u) { return vec3<f32>(0.76, 0.39, 1.08); }
  return vec3<f32>(0.12, 0.82, 0.87);
}

@fragment
fn particle_fs(input: ParticleVertexOutput) -> @location(0) vec4<f32> {
  let distance = length(input.local);
  if (distance > 1.0) { discard; }
  let core = exp(-distance * distance * 10.0);
  let body = exp(-distance * distance * 4.2);
  let halo = pow(max(0.0, 1.0 - distance), 3.4);
  let base = species_colour(input.species);
  let pearl = vec3<f32>(0.91, 1.0, 0.95);
  let colour = mix(base * (0.9 + input.energy * 0.38), pearl * 1.24, core * 0.82);
  let intensity = core * 1.62 + body * 0.48 + halo * (0.15 + input.speed * 0.1);
  return vec4<f32>(colour * intensity, intensity);
}
`;

const compositeShader = /* wgsl */ `
struct Uniforms {
  aspect: f32,
  time: f32,
  coherence: f32,
  density: f32,
  encounter: f32,
  activity: f32,
  padding0: f32,
  padding1: f32,
}

@group(0) @binding(0) var field_texture: texture_2d<f32>;
@group(0) @binding(1) var field_sampler: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn composite_vs(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  let position = positions[vertex_index];
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
fn composite_fs(input: VertexOutput) -> @location(0) vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(field_texture));
  let texel = 1.0 / dimensions;
  let field = textureSample(field_texture, field_sampler, input.uv);
  var soft = field * 0.28;
  soft += textureSample(field_texture, field_sampler, input.uv + vec2<f32>(texel.x * 2.0, 0.0)) * 0.12;
  soft += textureSample(field_texture, field_sampler, input.uv - vec2<f32>(texel.x * 2.0, 0.0)) * 0.12;
  soft += textureSample(field_texture, field_sampler, input.uv + vec2<f32>(0.0, texel.y * 2.0)) * 0.12;
  soft += textureSample(field_texture, field_sampler, input.uv - vec2<f32>(0.0, texel.y * 2.0)) * 0.12;
  soft += textureSample(field_texture, field_sampler, input.uv + texel * vec2<f32>(4.0, 4.0)) * 0.06;
  soft += textureSample(field_texture, field_sampler, input.uv + texel * vec2<f32>(-4.0, 4.0)) * 0.06;
  soft += textureSample(field_texture, field_sampler, input.uv + texel * vec2<f32>(4.0, -4.0)) * 0.06;
  soft += textureSample(field_texture, field_sampler, input.uv - texel * vec2<f32>(4.0, 4.0)) * 0.06;

  let tide = vec3<f32>(0.10, 0.73, 0.78);
  let ember = vec3<f32>(1.0, 0.22, 0.09);
  let bloom = vec3<f32>(0.67, 0.34, 0.96);
  var colour = vec3<f32>(0.0);
  colour += layer(field.x, soft.x, 0.46, 0.12, tide);
  colour += layer(field.y, soft.y, 0.50, 0.11, ember);
  colour += layer(field.z, soft.z, 0.42, 0.13, bloom);

  let glow = soft.x * tide + soft.y * ember + soft.z * bloom;
  colour += glow * (0.11 + uniforms.encounter * 0.055);
  colour *= 0.98 + uniforms.density * 0.32;
  colour = vec3<f32>(1.0) - exp(-colour * 1.95);
  let vignette = 1.0 - 0.24 * smoothstep(0.48, 1.1, length(input.uv - 0.5) * 1.45);
  colour *= vignette;
  let alpha = clamp(max(max(colour.r, colour.g), colour.b) * 1.35, 0.0, 0.94);
  return vec4<f32>(colour, alpha);
}
`;

class TrailRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: true });
    this.previous = null;
    this.ready = false;
  }

  reset() {
    this.previous = null;
    this.ready = false;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  render(snapshot, metrics, time) {
    const resized = resizeCanvas(this.canvas);
    const { context, canvas } = this;
    if (resized || !this.ready) {
      context.fillStyle = "rgb(4 6 9)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      this.previous = null;
      this.ready = true;
    } else {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = `rgba(4, 6, 9, ${0.095 + metrics[2] * 0.035})`;
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
    glow.addColorStop(0, `rgba(25, 67, 70, ${0.014 + metrics[1] * 0.016})`);
    glow.addColorStop(0.58, `rgba(58, 35, 30, ${0.007 + metrics[0] * 0.009})`);
    glow.addColorStop(1, "rgba(4, 6, 9, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (this.previous?.length === snapshot.length) {
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";
      for (let offset = 0; offset < snapshot.length; offset += 8) {
        const dx = snapshot[offset] - this.previous[offset];
        const dy = snapshot[offset + 1] - this.previous[offset + 1];
        if (Math.abs(dx) > 0.35 || Math.abs(dy) > 0.35) continue;
        const speed = snapshot[offset + 3];
        const packedEnergy = snapshot[offset + 2];
        const [red, green, blue] = speciesColour(speciesOf(packedEnergy), 0.7);
        context.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${0.028 + speed * 0.12})`;
        context.lineWidth = deviceScale() * (0.34 + speed * 0.5);
        context.beginPath();
        context.moveTo(toX(this.previous[offset], canvas.width), toY(this.previous[offset + 1], canvas.height));
        context.lineTo(toX(snapshot[offset], canvas.width), toY(snapshot[offset + 1], canvas.height));
        context.stroke();
      }
    }
    context.globalCompositeOperation = "source-over";
    this.previous = new Float32Array(snapshot);
  }
}

class WebGpuRenderer {
  constructor(canvas, trailCanvas, device, context, format) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;
    this.kind = "WEBGPU";
    this.trails = new TrailRenderer(trailCanvas);
    this.fieldTexture = null;
    this.fieldView = null;
    this.fieldWidth = 0;
    this.fieldHeight = 0;
    device.addEventListener("uncapturederror", (event) => {
      console.error("WebGPU validation error:", event.error.message);
    });

    this.particleBuffer = device.createBuffer({
      label: "particle snapshot",
      size: MAX_PARTICLES * 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.uniformBuffer = device.createBuffer({
      label: "render uniforms",
      size: 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const fieldModule = device.createShaderModule({ label: "kernel field and particles", code: fieldShader });
    const particleLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const particlePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [particleLayout] });
    this.fieldPipeline = device.createRenderPipeline({
      label: "kernel field pipeline",
      layout: particlePipelineLayout,
      vertex: { module: fieldModule, entryPoint: "field_vs" },
      fragment: {
        module: fieldModule,
        entryPoint: "field_fs",
        targets: [
          {
            format: FIELD_FORMAT,
            blend: {
              color: { srcFactor: "one", dstFactor: "one" },
              alpha: { srcFactor: "one", dstFactor: "one" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.particlePipeline = device.createRenderPipeline({
      label: "particle core pipeline",
      layout: particlePipelineLayout,
      vertex: { module: fieldModule, entryPoint: "particle_vs" },
      fragment: {
        module: fieldModule,
        entryPoint: "particle_fs",
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.particleBindGroup = device.createBindGroup({
      layout: particleLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });

    const compositeModule = device.createShaderModule({ label: "field composite", code: compositeShader });
    this.compositeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    this.compositePipeline = device.createRenderPipeline({
      label: "field composite pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.compositeLayout] }),
      vertex: { module: compositeModule, entryPoint: "composite_vs" },
      fragment: { module: compositeModule, entryPoint: "composite_fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.fieldSampler = device.createSampler({
      label: "field sampler",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }

  resetTrails() {
    this.trails.reset();
  }

  ensureFieldTexture() {
    const width = Math.max(1, Math.floor(this.canvas.width / 3));
    const height = Math.max(1, Math.floor(this.canvas.height / 3));
    if (width === this.fieldWidth && height === this.fieldHeight) return;
    this.fieldTexture?.destroy();
    this.fieldWidth = width;
    this.fieldHeight = height;
    this.fieldTexture = this.device.createTexture({
      label: "kernel field texture",
      size: { width, height },
      format: FIELD_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.fieldView = this.fieldTexture.createView();
    this.compositeBindGroup = this.device.createBindGroup({
      layout: this.compositeLayout,
      entries: [
        { binding: 0, resource: this.fieldView },
        { binding: 1, resource: this.fieldSampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  render(snapshot, metrics, time) {
    resizeCanvas(this.canvas);
    this.trails.render(snapshot, metrics, time);
    this.ensureFieldTexture();
    const particleCount = snapshot.length / 4;
    this.device.queue.writeBuffer(this.particleBuffer, 0, snapshot);
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([
        this.canvas.width / this.canvas.height,
        time,
        metrics[1],
        metrics[3],
        metrics[6] ?? 0,
        metrics[2],
        0,
        0,
      ]),
    );

    const encoder = this.device.createCommandEncoder({ label: "living field frame" });
    const fieldPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.fieldView,
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

    const outputView = this.context.getCurrentTexture().createView();
    const compositePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: outputView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, this.compositeBindGroup);
    compositePass.draw(3);
    compositePass.end();

    // Keep the cores in a separate load pass. Apart from making the field/core
    // layering explicit, this avoids backend-specific pipeline state leakage
    // when switching from a sampled full-screen pass to instanced storage data.
    const particlePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: outputView,
          loadOp: "load",
          storeOp: "store",
        },
      ],
    });
    particlePass.setPipeline(this.particlePipeline);
    particlePass.setBindGroup(0, this.particleBindGroup);
    particlePass.draw(6, particleCount);
    particlePass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}

class CanvasRenderer {
  constructor(canvas, trailCanvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: true });
    this.kind = "CANVAS";
    this.trails = new TrailRenderer(trailCanvas);
    this.spriteScale = 0;
    this.sprites = [];
  }

  resetTrails() {
    this.trails.reset();
  }

  render(snapshot, metrics, time) {
    resizeCanvas(this.canvas);
    this.trails.render(snapshot, metrics, time);
    const { context, canvas } = this;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "lighter";

    context.save();
    context.filter = `blur(${Math.round(5 * deviceScale())}px)`;
    for (let species = 0; species < 3; species += 1) {
      const [red, green, blue] = speciesColour(species, 0.72);
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.012)`;
      context.beginPath();
      for (let offset = 0; offset < snapshot.length; offset += 4) {
        if (speciesOf(snapshot[offset + 2]) !== species) continue;
        const x = toX(snapshot[offset], canvas.width);
        const y = toY(snapshot[offset + 1], canvas.height);
        const radius = (11 + species * 2.2) * deviceScale();
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
      context.fill();
    }
    context.restore();

    this.ensureSprites();

    for (let offset = 0; offset < snapshot.length; offset += 4) {
      const x = toX(snapshot[offset], canvas.width);
      const y = toY(snapshot[offset + 1], canvas.height);
      const packedEnergy = snapshot[offset + 2];
      const species = speciesOf(packedEnergy);
      const energy = energyOf(packedEnergy);
      const speed = snapshot[offset + 3];
      const breath = 0.5 + 0.5 * Math.sin(time * 0.57 + offset * 0.0925);
      const radius = (1.8 + speed * 1.2 + breath * metrics[1] * 0.45) * deviceScale();
      const diameter = radius * (5.0 + energy * 0.45 + speed * 0.3);
      context.drawImage(this.sprites[species], x - diameter / 2, y - diameter / 2, diameter, diameter);
    }
    context.globalCompositeOperation = "source-over";
  }

  ensureSprites() {
    const scale = deviceScale();
    if (scale === this.spriteScale) return;
    this.spriteScale = scale;
    this.sprites = [0, 1, 2].map((species) => {
      const sprite = document.createElement("canvas");
      sprite.width = Math.ceil(20 * scale);
      sprite.height = sprite.width;
      const spriteContext = sprite.getContext("2d");
      const centre = sprite.width / 2;
      const [red, green, blue] = speciesColour(species, 0.92);
      const gradient = spriteContext.createRadialGradient(centre, centre, 0, centre, centre, centre);
      gradient.addColorStop(0, "rgba(239, 255, 247, 0.98)");
      gradient.addColorStop(0.28, `rgba(${red}, ${green}, ${blue}, 0.82)`);
      gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
      spriteContext.fillStyle = gradient;
      spriteContext.fillRect(0, 0, sprite.width, sprite.height);
      return sprite;
    });
  }
}

function speciesOf(packedEnergy) {
  return Math.max(0, Math.min(2, Math.floor(packedEnergy)));
}

function energyOf(packedEnergy) {
  return Math.max(0, Math.min(0.999, packedEnergy - speciesOf(packedEnergy)));
}

function speciesColour(species, brightness = 1) {
  const colours = [
    [43, 177, 185],
    [235, 83, 49],
    [177, 116, 221],
  ];
  return colours[species].map((channel) => Math.round(Math.min(255, channel * brightness)));
}

function toX(value, width) {
  return (value * 0.5 + 0.5) * width;
}

function toY(value, height) {
  return (0.5 - value * 0.5) * height;
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

export async function createRenderer(canvas, trailCanvas) {
  const forceCanvas = new URL(window.location.href).searchParams.get("renderer") === "canvas";
  if (forceCanvas || !navigator.gpu) return new CanvasRenderer(canvas, trailCanvas);

  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return new CanvasRenderer(canvas, trailCanvas);
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    return new WebGpuRenderer(canvas, trailCanvas, device, context, format);
  } catch (error) {
    console.warn("WebGPU unavailable; using Canvas fallback", error);
    return new CanvasRenderer(canvas, trailCanvas);
  }
}
