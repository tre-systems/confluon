use std::f32::consts::TAU;

const DEFAULT_PARTICLES: usize = 2_000;
const MAX_PARTICLES: usize = 4_096;
const MAX_SPEED: f32 = 0.48;
const REPULSION_RADIUS: f32 = 0.018;
const REPULSION_STRENGTH: f32 = 0.56;
const MOTION_SCALE: f32 = 0.0009;
const FORMATION_DISTANCE: f32 = 0.078;
const SPECIES_COUNT: usize = 3;
const COLONY_COUNT: usize = 24;
const SENSE_RADIUS: f32 = 0.24;
const CROSS_MOTION_BOOST: f32 = 2.5;
const POINTER_REACH: f32 = 0.42;
const POINTER_CORE_RADIUS: f32 = 0.075;
const POINTER_RESPONSE: [f32; SPECIES_COUNT] = [1.0, 0.88, 1.12];
const GRID_SIDE: usize = 8;
const MAX_FORMATION_VOICES: usize = 8;

#[derive(Clone, Copy, Debug)]
struct Species {
    kernel_radius: f32,
    kernel_width: f32,
    kernel_weight: f32,
    growth_target: f32,
    growth_width: f32,
    motion: f32,
}

const SPECIES: [Species; SPECIES_COUNT] = [
    Species {
        kernel_radius: 0.063,
        kernel_width: 0.017,
        kernel_weight: 0.035,
        growth_target: 0.46,
        growth_width: 0.12,
        motion: 0.96,
    },
    Species {
        kernel_radius: 0.054,
        kernel_width: 0.014,
        kernel_weight: 0.041,
        growth_target: 0.50,
        growth_width: 0.11,
        motion: 1.04,
    },
    Species {
        kernel_radius: 0.072,
        kernel_width: 0.019,
        kernel_weight: 0.031,
        growth_target: 0.42,
        growth_width: 0.13,
        motion: 0.90,
    },
];

// A cyclic, deliberately non-symmetric ecology. Negative values attract and
// positive values avoid. The forces are weaker and longer-range than each
// population's own formation rule, so cells keep their internal organisation.
const CROSS_SENSE: [[f32; SPECIES_COUNT]; SPECIES_COUNT] =
    [[0.0, -0.18, 0.25], [0.27, 0.0, -0.16], [-0.17, 0.23, 0.0]];

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Particle {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    energy: f32,
    speed: f32,
    species: u8,
}

#[derive(Clone, Copy, Debug)]
struct SmallRng(u64);

impl SmallRng {
    fn new(seed: u32) -> Self {
        let mixed = (u64::from(seed) << 1) | 1;
        Self(mixed ^ 0x9e37_79b9_7f4a_7c15)
    }

    fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        (x >> 16) as u32
    }

    fn unit(&mut self) -> f32 {
        self.next_u32() as f32 / u32::MAX as f32
    }
}

/// One interacting particle pair, recorded once per step. `dx`/`dy` point from
/// particle `b` toward particle `a`, so `b`'s force uses the negated direction.
#[derive(Clone, Copy, Debug)]
struct Pair {
    a: u32,
    b: u32,
    dx: f32,
    dy: f32,
    distance: f32,
}

/// Reusable neighbour machinery: a flat counting-sort grid and the pair list
/// built from it. Buffers keep their capacity between steps so the hot loop
/// performs no allocation.
#[derive(Debug, Default)]
struct NeighbourScratch {
    cell_starts: Vec<u32>,
    cell_cursor: Vec<u32>,
    cell_entries: Vec<u32>,
    pairs: Vec<Pair>,
    fields: Vec<f32>,
    repulsion: Vec<f32>,
    cross: Vec<f32>,
    encounters: Vec<f32>,
    growth_derivatives: Vec<f32>,
    forces: Vec<(f32, f32)>,
    parents: Vec<u32>,
    cluster_sizes: Vec<u32>,
    roots: Vec<usize>,
}

impl NeighbourScratch {
    /// Rebuild the grid and collect every unordered pair within `support`.
    fn collect_pairs(&mut self, particles: &[Particle], support: f32) {
        let count = particles.len();
        let cells = GRID_SIDE * GRID_SIDE;
        self.cell_starts.clear();
        self.cell_starts.resize(cells + 1, 0);
        self.cell_entries.clear();
        self.cell_entries.resize(count, 0);

        for particle in particles {
            self.cell_starts[cell_index(particle.x, particle.y) + 1] += 1;
        }
        for cell in 0..cells {
            self.cell_starts[cell + 1] += self.cell_starts[cell];
        }
        self.cell_cursor.clear();
        self.cell_cursor.extend_from_slice(&self.cell_starts);
        for (index, particle) in particles.iter().enumerate() {
            let cell = cell_index(particle.x, particle.y);
            self.cell_entries[self.cell_cursor[cell] as usize] = index as u32;
            self.cell_cursor[cell] += 1;
        }

        self.pairs.clear();
        let support_sq = support * support;
        let side = GRID_SIDE as isize;
        // Half stencil: each unordered cell pair is visited exactly once on the
        // torus, and pairs inside a cell are taken with the triangular loop.
        const HALF_STENCIL: [(isize, isize); 4] = [(1, 0), (-1, 1), (0, 1), (1, 1)];
        for cell_y in 0..side {
            for cell_x in 0..side {
                let cell = (cell_y * side + cell_x) as usize;
                let start = self.cell_starts[cell] as usize;
                let end = self.cell_starts[cell + 1] as usize;
                for slot_a in start..end {
                    let a = self.cell_entries[slot_a];
                    let pa = particles[a as usize];
                    for slot_b in (slot_a + 1)..end {
                        let b = self.cell_entries[slot_b];
                        let pb = particles[b as usize];
                        push_pair(&mut self.pairs, a, b, pa, pb, support_sq);
                    }
                }
                for (offset_x, offset_y) in HALF_STENCIL {
                    let other_x = (cell_x + offset_x).rem_euclid(side);
                    let other_y = (cell_y + offset_y).rem_euclid(side);
                    let other = (other_y * side + other_x) as usize;
                    let other_start = self.cell_starts[other] as usize;
                    let other_end = self.cell_starts[other + 1] as usize;
                    for slot_a in start..end {
                        let a = self.cell_entries[slot_a];
                        let pa = particles[a as usize];
                        for slot_b in other_start..other_end {
                            let b = self.cell_entries[slot_b];
                            let pb = particles[b as usize];
                            push_pair(&mut self.pairs, a, b, pa, pb, support_sq);
                        }
                    }
                }
            }
        }
    }

    /// Accumulate per-particle fields and interaction energies from the pairs.
    fn accumulate(&mut self, particles: &[Particle]) {
        let count = particles.len();
        reset(&mut self.fields, count);
        reset(&mut self.repulsion, count);
        reset(&mut self.cross, count);
        reset(&mut self.encounters, count);

        for pair in &self.pairs {
            let a = pair.a as usize;
            let b = pair.b as usize;
            let species_a = particles[a].species as usize;
            let species_b = particles[b].species as usize;
            let distance = pair.distance;
            if species_a == species_b {
                let species = SPECIES[species_a];
                if distance <= kernel_support(species) {
                    let value = shell_kernel(distance, species);
                    self.fields[a] += value;
                    self.fields[b] += value;
                }
            } else if distance <= SENSE_RADIUS {
                let sensed = sense_kernel(distance);
                self.cross[a] += CROSS_SENSE[species_a][species_b] * sensed;
                self.cross[b] += CROSS_SENSE[species_b][species_a] * sensed;
                self.encounters[a] += sensed;
                self.encounters[b] += sensed;
            }
            if distance < REPULSION_RADIUS {
                let overlap = 1.0 - distance / REPULSION_RADIUS;
                let value = REPULSION_STRENGTH * 0.5 * overlap * overlap;
                self.repulsion[a] += value;
                self.repulsion[b] += value;
            }
        }
    }
}

fn push_pair(pairs: &mut Vec<Pair>, a: u32, b: u32, pa: Particle, pb: Particle, support_sq: f32) {
    let (dx, dy) = torus_delta(pa.x, pa.y, pb.x, pb.y);
    let distance_sq = dx * dx + dy * dy;
    if distance_sq > support_sq {
        return;
    }
    pairs.push(Pair {
        a,
        b,
        dx,
        dy,
        distance: distance_sq.sqrt().max(0.000_1),
    });
}

fn reset(buffer: &mut Vec<f32>, count: usize) {
    buffer.clear();
    buffer.resize(count, 0.0);
}

#[derive(Debug)]
pub(crate) struct Simulation {
    seed: u32,
    initial_count: usize,
    particles: Vec<Particle>,
    rng: SmallRng,
    metrics: [f32; 7],
    formations: Vec<f32>,
    previous_energy: f32,
    previous_activity: f32,
    ecology: f32,
    scratch: NeighbourScratch,
}

impl Simulation {
    pub(crate) fn new(seed: u32, particle_count: usize) -> Self {
        let initial_count = if particle_count == 0 {
            DEFAULT_PARTICLES
        } else {
            particle_count.clamp(24, MAX_PARTICLES)
        };
        let mut simulation = Self {
            seed,
            initial_count,
            particles: Vec::with_capacity(MAX_PARTICLES),
            rng: SmallRng::new(seed),
            metrics: [0.0; 7],
            formations: Vec::new(),
            previous_energy: 0.5,
            previous_activity: 0.0,
            ecology: 1.0,
            scratch: NeighbourScratch::default(),
        };
        simulation.reset(seed);
        simulation
    }

    pub(crate) fn reset(&mut self, seed: u32) {
        self.seed = seed;
        self.rng = SmallRng::new(seed);
        self.particles.clear();

        let count = if self.initial_count == 0 {
            DEFAULT_PARTICLES
        } else {
            self.initial_count
        };
        let phase = self.rng.unit() * TAU;
        for index in 0..count {
            let colony = index * COLONY_COUNT / count;
            let species = colony % SPECIES_COUNT;
            let (ring_count, ring_index, centre_radius, ring_phase) = if colony < 8 {
                (8.0, colony as f32, 0.30, 0.0)
            } else {
                (16.0, (colony - 8) as f32, 0.72, 0.11)
            };
            let angle =
                phase + ring_phase + ring_index * TAU / ring_count + (self.rng.unit() - 0.5) * 0.10;
            let centre_radius = centre_radius + (self.rng.unit() - 0.5) * 0.05;
            let centre_x = angle.cos() * centre_radius;
            let centre_y = angle.sin() * centre_radius;
            let jitter_angle = self.rng.unit() * TAU;
            let jitter_radius = self.rng.unit().sqrt() * (0.068 + species as f32 * 0.004);
            self.particles.push(Particle {
                x: wrap(centre_x + jitter_angle.cos() * jitter_radius),
                y: wrap(centre_y + jitter_angle.sin() * jitter_radius),
                species: species as u8,
                ..Particle::default()
            });
        }

        self.metrics = [0.0; 7];
        self.previous_energy = 0.5;
        self.previous_activity = 0.0;
        self.measure_and_refresh();
    }

    pub(crate) fn step(
        &mut self,
        dt: f32,
        pointer_x: f32,
        pointer_y: f32,
        pointer_strength: f32,
        pointer_twist: f32,
        settle: bool,
    ) {
        let dt = dt.clamp(0.0, 0.04);
        if dt == 0.0 || self.particles.is_empty() {
            return;
        }

        let count = self.particles.len();
        let support = max_support();
        self.scratch.collect_pairs(&self.particles, support);
        self.scratch.accumulate(&self.particles);

        let scratch = &mut self.scratch;
        reset(&mut scratch.growth_derivatives, count);
        scratch.forces.clear();
        scratch.forces.resize(count, (0.0, 0.0));

        for (index, particle) in self.particles.iter_mut().enumerate() {
            let species = SPECIES[particle.species as usize];
            let field = scratch.fields[index];
            let growth = growth(field, species);
            particle.energy = scratch.repulsion[index] - growth + scratch.cross[index] * 0.045;
            scratch.growth_derivatives[index] =
                growth * -2.0 * (field - species.growth_target) / species.growth_width.powi(2);
        }

        let cross_gain = CROSS_MOTION_BOOST * self.ecology;
        for pair in &scratch.pairs {
            let a = pair.a as usize;
            let b = pair.b as usize;
            let species_a = self.particles[a].species as usize;
            let species_b = self.particles[b].species as usize;
            let distance = pair.distance;

            // Shared symmetric parts of the derivative.
            let repulsion_derivative = if distance < REPULSION_RADIUS {
                -REPULSION_STRENGTH * (1.0 - distance / REPULSION_RADIUS) / REPULSION_RADIUS
            } else {
                0.0
            };

            let mut derivative_a = repulsion_derivative;
            let mut derivative_b = repulsion_derivative;
            if species_a == species_b {
                let species = SPECIES[species_a];
                if distance <= kernel_support(species) {
                    let kernel = shell_kernel(distance, species);
                    let kernel_derivative = kernel * -2.0 * (distance - species.kernel_radius)
                        / species.kernel_width.powi(2);
                    derivative_a += -scratch.growth_derivatives[a] * kernel_derivative;
                    derivative_b += -scratch.growth_derivatives[b] * kernel_derivative;
                }
            } else if distance <= SENSE_RADIUS {
                let sensed = sense_kernel(distance) * -2.0 * distance / SENSE_RADIUS.powi(2);
                derivative_a += CROSS_SENSE[species_a][species_b] * sensed * cross_gain;
                derivative_b += CROSS_SENSE[species_b][species_a] * sensed * cross_gain;
            }

            // The derivative is projected along the vector pointing away from
            // the neighbour; this makes a negative overlap derivative repel.
            let motion_a = SPECIES[species_a].motion;
            let motion_b = SPECIES[species_b].motion;
            let inv_distance = 1.0 / distance;
            let unit_x = pair.dx * inv_distance;
            let unit_y = pair.dy * inv_distance;
            let force_a = -derivative_a * MOTION_SCALE * motion_a;
            let force_b = -derivative_b * MOTION_SCALE * motion_b;
            scratch.forces[a].0 += force_a * unit_x;
            scratch.forces[a].1 += force_a * unit_y;
            scratch.forces[b].0 -= force_b * unit_x;
            scratch.forces[b].1 -= force_b * unit_y;
        }

        if pointer_strength.abs() > f32::EPSILON || pointer_twist.abs() > f32::EPSILON {
            for (index, particle) in self.particles.iter().enumerate() {
                let (dx, dy) = torus_delta(pointer_x, pointer_y, particle.x, particle.y);
                let distance_sq = dx * dx + dy * dy;
                let distance = distance_sq.sqrt().max(0.035);
                let falloff = (-distance_sq / POINTER_REACH.powi(2)).exp();
                let core = (-distance_sq / POINTER_CORE_RADIUS.powi(2)).exp();
                let response = POINTER_RESPONSE[particle.species as usize];
                let radial_profile = pointer_radial_profile(pointer_strength, falloff, core);
                let radial = pointer_strength * radial_profile * response / distance;
                let tangential = pointer_twist * 0.090 * falloff * response / distance;
                scratch.forces[index].0 += dx * radial - dy * tangential;
                scratch.forces[index].1 += dy * radial + dx * tangential;
            }
        }

        if settle {
            let (centre_x, centre_y) = circular_centre(&self.particles);
            for (index, particle) in self.particles.iter().enumerate() {
                let (dx, dy) = torus_delta(centre_x, centre_y, particle.x, particle.y);
                scratch.forces[index].0 = scratch.forces[index].0 * 0.3 + dx * 0.16;
                scratch.forces[index].1 = scratch.forces[index].1 * 0.3 + dy * 0.16;
            }
        }

        for (particle, (force_x, force_y)) in self.particles.iter_mut().zip(&scratch.forces) {
            let magnitude = (force_x * force_x + force_y * force_y).sqrt();
            let scale = if magnitude > MAX_SPEED {
                MAX_SPEED / magnitude
            } else {
                1.0
            };
            particle.vx = force_x * scale;
            particle.vy = force_y * scale;
            particle.speed = (particle.vx * particle.vx + particle.vy * particle.vy).sqrt();
            particle.x = wrap(particle.x + particle.vx * dt);
            particle.y = wrap(particle.y + particle.vy * dt);
        }

        self.refresh_metrics();
    }

    pub(crate) fn spawn_at(&mut self, x: f32, y: f32, count: usize) {
        let available = MAX_PARTICLES.saturating_sub(self.particles.len());
        let species = (self.rng.next_u32() as usize % SPECIES_COUNT) as u8;
        for _ in 0..count.min(available) {
            let angle = self.rng.unit() * TAU;
            let radius = self.rng.unit().sqrt() * 0.05;
            self.particles.push(Particle {
                x: wrap(x + angle.cos() * radius),
                y: wrap(y + angle.sin() * radius),
                species,
                ..Particle::default()
            });
        }
        self.measure_and_refresh();
    }

    pub(crate) fn set_ecology(&mut self, ecology: f32) {
        self.ecology = ecology.clamp(0.25, 1.8);
    }

    pub(crate) fn snapshot(&self) -> Vec<f32> {
        let mut values = Vec::with_capacity(self.particles.len() * 4);
        for particle in &self.particles {
            values.push(particle.x);
            values.push(particle.y);
            let energy = ((particle.energy + 1.0) * 0.5).clamp(0.0, 0.999);
            values.push(particle.species as f32 + energy);
            values.push((particle.speed / MAX_SPEED).clamp(0.0, 1.0));
        }
        values
    }

    pub(crate) fn metrics(&self) -> [f32; 7] {
        self.metrics
    }

    /// Up to eight of the largest connected formations, each reported as
    /// `[x, y, size_share, species]`, ordered from largest to smallest. The
    /// list length is always a multiple of four.
    pub(crate) fn formations(&self) -> Vec<f32> {
        self.formations.clone()
    }

    pub(crate) fn particle_count(&self) -> usize {
        self.particles.len()
    }

    pub(crate) fn seed(&self) -> u32 {
        self.seed
    }

    fn measure_and_refresh(&mut self) {
        self.scratch.collect_pairs(&self.particles, max_support());
        self.scratch.accumulate(&self.particles);
        self.refresh_metrics();
    }

    fn refresh_metrics(&mut self) {
        if self.particles.is_empty() {
            self.metrics = [0.0; 7];
            self.formations.clear();
            return;
        }

        let count = self.particles.len() as f32;
        let mean_energy = self
            .particles
            .iter()
            .map(|particle| particle.energy)
            .sum::<f32>()
            / count;
        let activity = (self
            .particles
            .iter()
            .map(|particle| particle.speed)
            .sum::<f32>()
            / count
            / 0.05)
            .clamp(0.0, 1.0);
        let energy = ((mean_energy + 1.0) * 0.5).clamp(0.0, 1.0);
        let density = (self.scratch.fields.iter().sum::<f32>() / count / 0.46).clamp(0.0, 1.0);
        let encounter_pressure =
            (self.scratch.encounters.iter().sum::<f32>() / count / 64.0).clamp(0.0, 1.0);

        let (centre_x, centre_y) = circular_centre(&self.particles);
        let mut direction_x = 0.0;
        let mut direction_y = 0.0;
        let mut rotation = 0.0;
        let mut moving = 0.0;
        for particle in &self.particles {
            if particle.speed <= 0.000_1 {
                continue;
            }
            let velocity_x = particle.vx / particle.speed;
            let velocity_y = particle.vy / particle.speed;
            direction_x += velocity_x;
            direction_y += velocity_y;
            moving += 1.0;
            let (radial_x, radial_y) = torus_delta(particle.x, particle.y, centre_x, centre_y);
            let radial_length = (radial_x * radial_x + radial_y * radial_y).sqrt();
            if radial_length > 0.000_1 {
                rotation += (radial_x * velocity_y - radial_y * velocity_x) / radial_length;
            }
        }
        let coherence = if moving > 0.0 {
            let directional =
                (direction_x * direction_x + direction_y * direction_y).sqrt() / moving;
            directional.max((rotation / moving).abs()).clamp(0.0, 1.0)
        } else {
            0.0
        };

        let formations = self.measure_formations().clamp(1, 24) as f32;
        let transition = ((energy - self.previous_energy).abs() * 18.0
            + (activity - self.previous_activity).abs() * 2.6)
            .clamp(0.0, 1.0);

        self.metrics = [
            energy,
            coherence,
            activity,
            density,
            formations,
            transition,
            encounter_pressure,
        ];
        self.previous_energy = energy;
        self.previous_activity = activity;
    }

    /// Union-find over the already-collected pair list. Returns the number of
    /// formations of at least four particles and records the largest ones with
    /// their toroidal centroids for the audio layer.
    fn measure_formations(&mut self) -> usize {
        let count = self.particles.len();
        let scratch = &mut self.scratch;
        scratch.parents.clear();
        scratch.parents.extend(0..count as u32);
        for pair in &scratch.pairs {
            if pair.distance > FORMATION_DISTANCE {
                continue;
            }
            let a = pair.a as usize;
            let b = pair.b as usize;
            if self.particles[a].species == self.particles[b].species {
                union(&mut scratch.parents, a, b);
            }
        }

        scratch.cluster_sizes.clear();
        scratch.cluster_sizes.resize(count, 0);
        for index in 0..count {
            let root = find(&mut scratch.parents, index);
            scratch.cluster_sizes[root] += 1;
        }

        scratch.roots.clear();
        scratch
            .roots
            .extend((0..count).filter(|&index| scratch.cluster_sizes[index] >= 4));
        scratch.roots.sort_by(|&a, &b| {
            scratch.cluster_sizes[b]
                .cmp(&scratch.cluster_sizes[a])
                .then(a.cmp(&b))
        });
        let formation_count = scratch.roots.len().max(1);

        scratch.roots.truncate(MAX_FORMATION_VOICES);
        // Toroidal centroids via circular means, accumulated in one pass.
        let mut sums = [[0.0_f32; 4]; MAX_FORMATION_VOICES];
        for index in 0..count {
            let root = find(&mut scratch.parents, index);
            let Some(slot) = scratch
                .roots
                .iter()
                .position(|&candidate| candidate == root)
            else {
                continue;
            };
            let particle = self.particles[index];
            let angle_x = (particle.x + 1.0) * std::f32::consts::PI;
            let angle_y = (particle.y + 1.0) * std::f32::consts::PI;
            sums[slot][0] += angle_x.sin();
            sums[slot][1] += angle_x.cos();
            sums[slot][2] += angle_y.sin();
            sums[slot][3] += angle_y.cos();
        }

        self.formations.clear();
        for (slot, &root) in scratch.roots.iter().enumerate() {
            let [sin_x, cos_x, sin_y, cos_y] = sums[slot];
            let size = scratch.cluster_sizes[root] as f32;
            let x = wrap(sin_x.atan2(cos_x) / std::f32::consts::PI - 1.0);
            let y = wrap(sin_y.atan2(cos_y) / std::f32::consts::PI - 1.0);
            self.formations.push(x);
            self.formations.push(y);
            self.formations.push(size / count as f32);
            self.formations.push(self.particles[root].species as f32);
        }

        formation_count
    }
}

fn shell_kernel(distance: f32, species: Species) -> f32 {
    let normalized = (distance - species.kernel_radius) / species.kernel_width;
    (-normalized * normalized).exp() * species.kernel_weight
}

fn kernel_support(species: Species) -> f32 {
    species.kernel_radius + species.kernel_width * 3.5
}

fn max_support() -> f32 {
    SPECIES.iter().fold(SENSE_RADIUS, |acc, species| {
        acc.max(kernel_support(*species))
    })
}

fn growth(field: f32, species: Species) -> f32 {
    let normalized = (field - species.growth_target) / species.growth_width;
    (-normalized * normalized).exp()
}

fn sense_kernel(distance: f32) -> f32 {
    let normalized = distance / (SENSE_RADIUS * 0.62);
    (-normalized * normalized).exp()
}

fn wrap(value: f32) -> f32 {
    (value + 1.0).rem_euclid(2.0) - 1.0
}

fn torus_delta(to_x: f32, to_y: f32, from_x: f32, from_y: f32) -> (f32, f32) {
    let mut dx = to_x - from_x;
    let mut dy = to_y - from_y;
    if dx > 1.0 {
        dx -= 2.0;
    } else if dx < -1.0 {
        dx += 2.0;
    }
    if dy > 1.0 {
        dy -= 2.0;
    } else if dy < -1.0 {
        dy += 2.0;
    }
    (dx, dy)
}

fn pointer_radial_profile(strength: f32, falloff: f32, core: f32) -> f32 {
    if strength >= 0.0 {
        // Gather and passive hover draw organisms near without collapsing
        // their membranes onto the pointer.
        0.110 * falloff - 0.200 * core
    } else {
        // A poke or Divide gesture is an unambiguous startle.
        0.260 * falloff
    }
}

fn cell_coordinate(value: f32) -> usize {
    (((wrap(value) + 1.0) * 0.5 * GRID_SIDE as f32).floor() as usize).min(GRID_SIDE - 1)
}

fn cell_index(x: f32, y: f32) -> usize {
    cell_coordinate(y) * GRID_SIDE + cell_coordinate(x)
}

fn circular_centre(particles: &[Particle]) -> (f32, f32) {
    let count = particles.len() as f32;
    let (sin_x, cos_x, sin_y, cos_y) = particles.iter().fold(
        (0.0, 0.0, 0.0, 0.0),
        |(sin_x, cos_x, sin_y, cos_y), particle| {
            let angle_x = (particle.x + 1.0) * std::f32::consts::PI;
            let angle_y = (particle.y + 1.0) * std::f32::consts::PI;
            (
                sin_x + angle_x.sin(),
                cos_x + angle_x.cos(),
                sin_y + angle_y.sin(),
                cos_y + angle_y.cos(),
            )
        },
    );
    let x = (sin_x / count).atan2(cos_x / count) / std::f32::consts::PI - 1.0;
    let y = (sin_y / count).atan2(cos_y / count) / std::f32::consts::PI - 1.0;
    (wrap(x), wrap(y))
}

fn find(parents: &mut [u32], mut index: usize) -> usize {
    while parents[index] as usize != index {
        parents[index] = parents[parents[index] as usize];
        index = parents[index] as usize;
    }
    index
}

fn union(parents: &mut [u32], a: usize, b: usize) {
    let root_a = find(parents, a);
    let root_b = find(parents, b);
    if root_a != root_b {
        parents[root_b] = root_a as u32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_reproduces_the_same_motion() {
        let mut left = Simulation::new(41, 96);
        let mut right = Simulation::new(41, 96);
        for _ in 0..40 {
            left.step(1.0 / 90.0, 0.0, 0.0, 0.0, 0.0, false);
            right.step(1.0 / 90.0, 0.0, 0.0, 0.0, 0.0, false);
        }
        assert_eq!(left.snapshot(), right.snapshot());
        assert_eq!(left.metrics(), right.metrics());
        assert_eq!(left.formations(), right.formations());
    }

    #[test]
    fn different_seeds_produce_different_states() {
        let left = Simulation::new(41, 96);
        let right = Simulation::new(42, 96);
        assert_ne!(left.snapshot(), right.snapshot());
    }

    #[test]
    fn zero_particle_count_uses_the_public_default() {
        let simulation = Simulation::new(41, 0);
        assert_eq!(simulation.particle_count(), DEFAULT_PARTICLES);
    }

    #[test]
    fn long_runs_remain_finite_and_bounded() {
        let mut simulation = Simulation::new(7, 240);
        for _ in 0..600 {
            simulation.step(1.0 / 90.0, 0.2, -0.4, 0.0, 0.0, false);
        }
        for record in simulation.snapshot().chunks_exact(4) {
            assert!(record.iter().all(|value| value.is_finite()));
            assert!((-1.0..=1.0).contains(&record[0]));
            assert!((-1.0..=1.0).contains(&record[1]));
            assert!((0.0..3.0).contains(&record[2]));
            assert!(record[2].floor() <= 2.0);
            assert!((0.0..=1.0).contains(&record[3]));
        }
    }

    #[test]
    fn dense_default_field_remains_stable() {
        use std::collections::HashSet;

        let mut simulation = Simulation::new(23, DEFAULT_PARTICLES);
        for _ in 0..180 {
            simulation.step(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false);
        }
        let snapshot = simulation.snapshot();
        let occupied: HashSet<_> = snapshot
            .chunks_exact(4)
            .map(|record| {
                (
                    (record[0] * 100.0).round() as i32,
                    (record[1] * 100.0).round() as i32,
                )
            })
            .collect();
        assert_eq!(simulation.particle_count(), DEFAULT_PARTICLES);
        assert!(snapshot.iter().all(|value| value.is_finite()));
        assert!(occupied.len() >= 1_000);
    }

    #[test]
    fn ordinary_motion_conserves_particle_count() {
        let mut simulation = Simulation::new(12, 80);
        for _ in 0..20 {
            simulation.step(1.0 / 60.0, 0.0, 0.0, 1.0, 0.0, false);
        }
        assert_eq!(simulation.particle_count(), 80);
    }

    #[test]
    fn spawning_is_capped() {
        let mut simulation = Simulation::new(12, MAX_PARTICLES - 4);
        simulation.spawn_at(0.0, 0.0, 50);
        assert_eq!(simulation.particle_count(), MAX_PARTICLES);
    }

    #[test]
    fn spawned_particles_form_one_population() {
        let mut simulation = Simulation::new(12, 72);
        let before = simulation.particle_count();
        simulation.spawn_at(0.0, 0.0, 24);
        let snapshot = simulation.snapshot();
        let species = snapshot[before * 4 + 2].floor();
        assert!(snapshot[before * 4..]
            .chunks_exact(4)
            .all(|record| record[2].floor() == species));
    }

    #[test]
    fn pointer_force_changes_the_trajectory() {
        let mut idle = Simulation::new(99, 64);
        let mut herded = Simulation::new(99, 64);
        for _ in 0..10 {
            idle.step(1.0 / 90.0, 0.6, -0.4, 0.0, 0.0, false);
            herded.step(1.0 / 90.0, 0.6, -0.4, 1.0, 0.0, false);
        }
        assert_ne!(idle.snapshot(), herded.snapshot());
    }

    #[test]
    fn pointer_twist_creates_a_distinct_orbit() {
        let mut idle = Simulation::new(99, 64);
        let mut twisted = Simulation::new(99, 64);
        for _ in 0..10 {
            idle.step(1.0 / 90.0, 0.2, 0.1, 0.0, 0.0, false);
            twisted.step(1.0 / 90.0, 0.2, 0.1, 0.0, 1.0, false);
        }
        assert_ne!(idle.snapshot(), twisted.snapshot());
    }

    #[test]
    fn gather_keeps_a_protected_inner_space() {
        let profile_at = |distance: f32| {
            pointer_radial_profile(
                1.0,
                (-distance * distance / POINTER_REACH.powi(2)).exp(),
                (-distance * distance / POINTER_CORE_RADIUS.powi(2)).exp(),
            )
        };
        let outer = profile_at(0.20);
        let inner = profile_at(0.02);

        assert!(outer > 0.0, "matter outside the core should approach");
        assert!(inner < 0.0, "matter inside the core should withdraw");
    }

    #[test]
    fn ecology_setting_changes_cross_population_motion() {
        let mut calm = Simulation::new(51, 144);
        let mut volatile = Simulation::new(51, 144);
        calm.set_ecology(0.25);
        volatile.set_ecology(1.8);
        for _ in 0..20 {
            calm.step(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false);
            volatile.step(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false);
        }
        assert_ne!(calm.snapshot(), volatile.snapshot());
    }

    #[test]
    fn metrics_have_documented_ranges() {
        let mut simulation = Simulation::new(5, 72);
        simulation.step(1.0 / 90.0, 0.0, 0.0, 0.0, 0.0, false);
        let metrics = simulation.metrics();
        for metric in &metrics[..4] {
            assert!((0.0..=1.0).contains(metric));
        }
        assert!((1.0..=24.0).contains(&metrics[4]));
        assert!((0.0..=1.0).contains(&metrics[5]));
        assert!((0.0..=1.0).contains(&metrics[6]));
    }

    #[test]
    fn initial_field_contains_all_populations() {
        let simulation = Simulation::new(5, 72);
        let mut present = [false; SPECIES_COUNT];
        for record in simulation.snapshot().chunks_exact(4) {
            present[record[2].floor() as usize] = true;
        }
        assert!(present.into_iter().all(|value| value));
    }

    #[test]
    fn formations_report_positions_sizes_and_species() {
        let mut simulation = Simulation::new(23, DEFAULT_PARTICLES);
        for _ in 0..60 {
            simulation.step(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false);
        }
        let formations = simulation.formations();
        assert!(!formations.is_empty());
        assert_eq!(formations.len() % 4, 0);
        assert!(formations.len() <= MAX_FORMATION_VOICES * 4);
        let mut previous_share = f32::INFINITY;
        for record in formations.chunks_exact(4) {
            assert!((-1.0..=1.0).contains(&record[0]));
            assert!((-1.0..=1.0).contains(&record[1]));
            assert!(record[2] > 0.0 && record[2] <= 1.0);
            assert!(record[2] <= previous_share);
            previous_share = record[2];
            assert!((0.0..SPECIES_COUNT as f32).contains(&record[3]));
            assert_eq!(record[3], record[3].floor());
        }
    }

    #[test]
    fn pair_interactions_match_brute_force() {
        // The grid/pair machinery must agree with a direct O(n^2) sweep.
        let simulation = Simulation::new(17, 300);
        let particles = simulation.particles.clone();
        let mut scratch = NeighbourScratch::default();
        scratch.collect_pairs(&particles, max_support());
        scratch.accumulate(&particles);

        let support = max_support();
        for i in 0..particles.len() {
            let mut field = 0.0_f32;
            let mut encounters = 0.0_f32;
            let species_i = particles[i].species as usize;
            let species = SPECIES[species_i];
            for (j, other) in particles.iter().enumerate() {
                if i == j {
                    continue;
                }
                let (dx, dy) = torus_delta(particles[i].x, particles[i].y, other.x, other.y);
                let distance = (dx * dx + dy * dy).sqrt();
                if distance > support {
                    continue;
                }
                if other.species as usize == species_i {
                    if distance <= kernel_support(species) {
                        field += shell_kernel(distance.max(0.000_1), species);
                    }
                } else if distance <= SENSE_RADIUS {
                    encounters += sense_kernel(distance.max(0.000_1));
                }
            }
            assert!(
                (field - scratch.fields[i]).abs() < 0.001,
                "field mismatch at {i}: {field} vs {}",
                scratch.fields[i]
            );
            assert!(
                (encounters - scratch.encounters[i]).abs() < 0.01,
                "encounter mismatch at {i}"
            );
        }
    }
}
