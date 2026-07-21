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
  let breath = 0.5 + 0.5 * sin(uniforms.time * 0.7 + f32(instance_index) * 0.19);
  let radius = 0.012 + particle.speed * 0.011 + breath * uniforms.coherence * 0.004;
  let offset = vec2<f32>(local.x / max(uniforms.aspect, 0.01), local.y) * radius;

  var output: VertexOutput;
  output.position = vec4<f32>(particle.position + offset, 0.0, 1.0);
  output.local = local;
  output.energy = particle.energy;
  output.speed = particle.speed;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let distance = length(input.local);
  if (distance > 1.0) {
    discard;
  }
  let core = 1.0 - smoothstep(0.06, 0.34, distance);
  let body = 1.0 - smoothstep(0.18, 0.72, distance);
  let halo = 1.0 - smoothstep(0.20, 1.0, distance);
  let cool = vec3<f32>(0.17, 0.42, 0.58);
  let warm = vec3<f32>(0.96, 0.63, 0.34);
  let white = vec3<f32>(0.91, 0.96, 0.90);
  var colour = mix(cool, warm, input.energy);
  colour = mix(colour, white, core * (0.55 + input.speed * 0.4));
  let alpha = core * 0.92 + body * 0.48 + halo * (0.10 + input.speed * 0.16);
  return vec4<f32>(colour, alpha);
}
`;

class WebGpuRenderer {
  constructor(canvas, device, context, format) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;
    this.kind = "WEBGPU";
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
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
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
              color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
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

  resize() {
    resizeCanvas(this.canvas);
  }

  render(snapshot, metrics, time) {
    this.resize();
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
      ]),
    );

    const encoder = this.device.createCommandEncoder({ label: "field frame" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: {
            r: 0.024 + metrics[0] * 0.01,
            g: 0.026 + metrics[3] * 0.012,
            b: 0.038 + metrics[1] * 0.018,
            a: 1,
          },
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
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.kind = "CANVAS FALLBACK";
  }

  render(snapshot, metrics, time) {
    resizeCanvas(this.canvas);
    const { context, canvas } = this;
    const width = canvas.width;
    const height = canvas.height;
    const scale = Math.min(width, height) * 0.5;

    const gradient = context.createRadialGradient(
      width * 0.5,
      height * 0.5,
      0,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.65,
    );
    gradient.addColorStop(0, `rgb(${8 + metrics[0] * 8} ${11 + metrics[3] * 7} ${18 + metrics[1] * 13})`);
    gradient.addColorStop(1, "rgb(5 6 9)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.globalCompositeOperation = "lighter";
    for (let index = 0; index < snapshot.length; index += 4) {
      const x = width * 0.5 + snapshot[index] * scale;
      const y = height * 0.5 - snapshot[index + 1] * scale;
      const energy = snapshot[index + 2];
      const speed = snapshot[index + 3];
      const breath = 0.5 + 0.5 * Math.sin(time * 0.7 + index * 0.05);
      const radius = (3.4 + speed * 5 + breath * metrics[1] * 2) * deviceScale();
      const particle = context.createRadialGradient(x, y, 0, x, y, radius * 2.8);
      const red = Math.round(54 + energy * 190);
      const green = Math.round(116 + energy * 55);
      const blue = Math.round(154 - energy * 58);
      particle.addColorStop(0, `rgba(238, 245, 232, ${0.92 + speed * 0.08})`);
      particle.addColorStop(0.25, `rgba(${red}, ${green}, ${blue}, 0.76)`);
      particle.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
      context.fillStyle = particle;
      context.beginPath();
      context.arc(x, y, radius * 2.8, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";
  }
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
  }
}

export async function createRenderer(canvas) {
  if (!navigator.gpu) {
    return new CanvasRenderer(canvas);
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      return new CanvasRenderer(canvas);
    }
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    return new WebGpuRenderer(canvas, device, context, format);
  } catch (error) {
    console.warn("WebGPU unavailable; using Canvas fallback", error);
    return new CanvasRenderer(canvas);
  }
}
