const MAX_PARTICLES = 320;

const shaderSource = /* wgsl */ `
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
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) energy: f32,
  @location(2) speed: f32,
  @location(3) breath: f32,
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let particle = particles[instance_index];
  let local = corners[vertex_index];
  let breath = 0.5 + 0.5 * sin(uniforms.time * 0.46 + f32(instance_index) * 0.19);
  let radius = 0.018 + particle.speed * 0.018 + breath * uniforms.coherence * 0.006;
  let offset = vec2<f32>(local.x / max(uniforms.aspect, 0.01), local.y) * radius;

  var output: VertexOutput;
  output.position = vec4<f32>(particle.position + offset, 0.0, 1.0);
  output.local = local;
  output.energy = particle.energy;
  output.speed = particle.speed;
  output.breath = breath;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let distance = length(input.local);
  if (distance > 1.0) {
    discard;
  }
  let core = 1.0 - smoothstep(0.035, 0.22, distance);
  let body = 1.0 - smoothstep(0.14, 0.56, distance);
  let halo = 1.0 - smoothstep(0.16, 1.0, distance);
  let cool = vec3<f32>(0.20, 0.57, 0.62);
  let warm = vec3<f32>(0.92, 0.49, 0.27);
  let pearl = vec3<f32>(0.91, 1.0, 0.94);
  var colour = mix(cool, warm, smoothstep(0.24, 0.78, input.energy));
  colour = mix(colour, pearl, core * (0.62 + input.speed * 0.34));
  let alpha = core * 0.96 + body * 0.42 + halo * (0.075 + input.speed * 0.13 + input.breath * 0.035);
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
    const width = canvas.width;
    const height = canvas.height;
    if (resized || !this.ready) {
      context.fillStyle = "rgb(4 6 9)";
      context.fillRect(0, 0, width, height);
      this.previous = null;
      this.ready = true;
    } else {
      const fade = 0.072 + metrics[2] * 0.04;
      context.globalCompositeOperation = "source-over";
      context.fillStyle = `rgba(4, 6, 9, ${fade})`;
      context.fillRect(0, 0, width, height);
    }

    const glow = context.createRadialGradient(
      width * (0.48 + Math.sin(time * 0.031) * 0.04),
      height * (0.48 + Math.cos(time * 0.027) * 0.035),
      0,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.64,
    );
    glow.addColorStop(0, `rgba(28, 71, 72, ${0.018 + metrics[1] * 0.022})`);
    glow.addColorStop(0.55, `rgba(65, 42, 32, ${0.01 + metrics[0] * 0.014})`);
    glow.addColorStop(1, "rgba(4, 6, 9, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    context.globalCompositeOperation = "lighter";
    this.drawConnections(snapshot, metrics);
    this.drawMotion(snapshot, metrics);
    this.drawAuras(snapshot, metrics);
    context.globalCompositeOperation = "source-over";
    context.filter = "none";
    this.previous = new Float32Array(snapshot);
  }

  drawConnections(snapshot, metrics) {
    const { context, canvas } = this;
    const count = snapshot.length / 4;
    const maxDistanceSq = 0.085;
    context.lineCap = "round";
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4;
      let nearest = -1;
      let nearestDistanceSq = maxDistanceSq;
      for (let other = 0; other < count; other += 1) {
        if (other === index) continue;
        const otherOffset = other * 4;
        const dx = snapshot[otherOffset] - snapshot[offset];
        const dy = snapshot[otherOffset + 1] - snapshot[offset + 1];
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) continue;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearest = otherOffset;
        }
      }
      if (nearest < 0 || nearest < offset) continue;
      const closeness = 1 - nearestDistanceSq / maxDistanceSq;
      const energy = (snapshot[offset + 2] + snapshot[nearest + 2]) * 0.5;
      const red = Math.round(68 + energy * 102);
      const green = Math.round(126 + (1 - energy) * 45);
      const blue = Math.round(132 + (1 - energy) * 42);
      context.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${0.035 + closeness * 0.13 + metrics[1] * 0.035})`;
      context.lineWidth = deviceScale() * (0.35 + closeness * 0.45);
      context.beginPath();
      context.moveTo(toX(snapshot[offset], canvas.width), toY(snapshot[offset + 1], canvas.height));
      context.lineTo(toX(snapshot[nearest], canvas.width), toY(snapshot[nearest + 1], canvas.height));
      context.stroke();
    }
  }

  drawMotion(snapshot, metrics) {
    if (!this.previous || this.previous.length !== snapshot.length) return;
    const { context, canvas } = this;
    context.lineCap = "round";
    for (let offset = 0; offset < snapshot.length; offset += 4) {
      const dx = snapshot[offset] - this.previous[offset];
      const dy = snapshot[offset + 1] - this.previous[offset + 1];
      if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) continue;
      const speed = snapshot[offset + 3];
      const energy = snapshot[offset + 2];
      const red = Math.round(62 + energy * 145);
      const green = Math.round(137 + energy * 20);
      const blue = Math.round(151 - energy * 57);
      context.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${0.05 + speed * 0.32 + metrics[2] * 0.04})`;
      context.lineWidth = deviceScale() * (0.45 + speed * 1.25);
      context.beginPath();
      context.moveTo(toX(this.previous[offset], canvas.width), toY(this.previous[offset + 1], canvas.height));
      context.lineTo(toX(snapshot[offset], canvas.width), toY(snapshot[offset + 1], canvas.height));
      context.stroke();
    }
  }

  drawAuras(snapshot, metrics) {
    const { context, canvas } = this;
    context.filter = `blur(${Math.round(8 * deviceScale())}px)`;
    const radius = (3.2 + metrics[3] * 4.2) * deviceScale();
    for (const warm of [false, true]) {
      context.beginPath();
      for (let offset = 0; offset < snapshot.length; offset += 4) {
        const energy = snapshot[offset + 2];
        if ((energy >= 0.54) !== warm) continue;
        const x = toX(snapshot[offset], canvas.width);
        const y = toY(snapshot[offset + 1], canvas.height);
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
      context.fillStyle = warm ? "rgba(203, 103, 57, 0.004)" : "rgba(62, 158, 164, 0.005)";
      context.fill();
    }
    context.filter = "none";
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
    this.particleBuffer = device.createBuffer({
      label: "particle snapshot",
      size: MAX_PARTICLES * 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.uniformBuffer = device.createBuffer({
      label: "render uniforms",
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = device.createShaderModule({ label: "particle field", code: shaderSource });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    this.pipeline = device.createRenderPipeline({
      label: "particle field pipeline",
      layout: pipelineLayout,
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  resetTrails() {
    this.trails.reset();
  }

  render(snapshot, metrics, time) {
    resizeCanvas(this.canvas);
    this.trails.render(snapshot, metrics, time);
    const particleCount = snapshot.length / 4;
    this.device.queue.writeBuffer(this.particleBuffer, 0, snapshot);
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([this.canvas.width / this.canvas.height, time, metrics[1], metrics[3]]),
    );

    const encoder = this.device.createCommandEncoder({ label: "field frame" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, particleCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}

class CanvasRenderer {
  constructor(canvas, trailCanvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: true });
    this.kind = "CANVAS";
    this.trails = new TrailRenderer(trailCanvas);
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
    for (let offset = 0; offset < snapshot.length; offset += 4) {
      const x = toX(snapshot[offset], canvas.width);
      const y = toY(snapshot[offset + 1], canvas.height);
      const energy = snapshot[offset + 2];
      const speed = snapshot[offset + 3];
      const breath = 0.5 + 0.5 * Math.sin(time * 0.46 + offset * 0.0475);
      const radius = (4.2 + speed * 6 + breath * metrics[1] * 2.2) * deviceScale();
      const particle = context.createRadialGradient(x, y, 0, x, y, radius * 2.4);
      const red = Math.round(51 + energy * 184);
      const green = Math.round(145 + energy * 20);
      const blue = Math.round(158 - energy * 89);
      particle.addColorStop(0, `rgba(233, 255, 241, ${0.92 + speed * 0.08})`);
      particle.addColorStop(0.18, `rgba(${red}, ${green}, ${blue}, 0.82)`);
      particle.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
      context.fillStyle = particle;
      context.beginPath();
      context.arc(x, y, radius * 2.4, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";
  }
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
  if (!navigator.gpu) return new CanvasRenderer(canvas, trailCanvas);

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
