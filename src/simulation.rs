use std::f32::consts::TAU;

const DEFAULT_PARTICLES: usize = 180;
const MAX_PARTICLES: usize = 320;
const MAX_SPEED: f32 = 1.35;
const KERNEL_RADIUS: f32 = 0.46;
const KERNEL_WIDTH: f32 = 0.12;
const KERNEL_WEIGHT: f32 = 0.026;
const GROWTH_TARGET: f32 = 0.60;
const GROWTH_WIDTH: f32 = 0.16;
const REPULSION_RADIUS: f32 = 0.12;
const REPULSION_STRENGTH: f32 = 0.82;
const MOTION_SCALE: f32 = 0.018;
const FORMATION_DISTANCE: f32 = 0.23;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Particle {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    energy: f32,
    speed: f32,
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

#[derive(Debug)]
pub(crate) struct Simulation {
    seed: u32,
    initial_count: usize,
    particles: Vec<Particle>,
    rng: SmallRng,
    metrics: [f32; 6],
    previous_energy: f32,
    previous_activity: f32,
}

impl Simulation {
    pub(crate) fn new(seed: u32, particle_count: usize) -> Self {
        let initial_count = particle_count.clamp(24, MAX_PARTICLES);
        let mut simulation = Self {
            seed,
            initial_count,
            particles: Vec::with_capacity(MAX_PARTICLES),
            rng: SmallRng::new(seed),
            metrics: [0.0; 6],
            previous_energy: 0.5,
            previous_activity: 0.0,
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
        let centre_phase = self.rng.unit() * TAU;
        for index in 0..count {
            let group = (index % 4) as f32;
            let angle = centre_phase + group * TAU / 4.0;
            let centre_x = angle.cos() * 0.42;
            let centre_y = angle.sin() * 0.42;
            let jitter_angle = self.rng.unit() * TAU;
            let jitter_radius = self.rng.unit().sqrt() * 0.30;
            self.particles.push(Particle {
                x: wrap(centre_x + jitter_angle.cos() * jitter_radius),
                y: wrap(centre_y + jitter_angle.sin() * jitter_radius),
                ..Particle::default()
            });
        }

        self.metrics = [0.0; 6];
        self.previous_energy = 0.5;
        self.previous_activity = 0.0;
        self.refresh_metrics();
    }

    pub(crate) fn step(
        &mut self,
        dt: f32,
        pointer_x: f32,
        pointer_y: f32,
        pointer_strength: f32,
        settle: bool,
    ) {
        let dt = dt.clamp(0.0, 0.04);
        if dt == 0.0 || self.particles.is_empty() {
            return;
        }

        let count = self.particles.len();
        let mut fields = vec![0.0_f32; count];
        let mut repulsion_energies = vec![0.0_f32; count];

        for i in 0..count {
            for j in (i + 1)..count {
                let (dx, dy) = torus_delta(
                    self.particles[i].x,
                    self.particles[i].y,
                    self.particles[j].x,
                    self.particles[j].y,
                );
                let distance = (dx * dx + dy * dy).sqrt().max(0.000_1);
                let kernel = shell_kernel(distance);
                fields[i] += kernel;
                fields[j] += kernel;

                if distance < REPULSION_RADIUS {
                    let overlap = 1.0 - distance / REPULSION_RADIUS;
                    let energy = REPULSION_STRENGTH * 0.5 * overlap * overlap;
                    repulsion_energies[i] += energy;
                    repulsion_energies[j] += energy;
                }
            }
        }

        let mut forces = vec![(0.0_f32, 0.0_f32); count];
        for i in 0..count {
            let growth = growth(fields[i]);
            self.particles[i].energy = repulsion_energies[i] - growth;
            let growth_derivative =
                growth * -2.0 * (fields[i] - GROWTH_TARGET) / GROWTH_WIDTH.powi(2);

            for j in 0..count {
                if i == j {
                    continue;
                }
                let (dx, dy) = torus_delta(
                    self.particles[i].x,
                    self.particles[i].y,
                    self.particles[j].x,
                    self.particles[j].y,
                );
                let distance = (dx * dx + dy * dy).sqrt().max(0.000_1);
                let kernel = shell_kernel(distance);
                let kernel_derivative =
                    kernel * -2.0 * (distance - KERNEL_RADIUS) / KERNEL_WIDTH.powi(2);
                let repulsion_derivative = if distance < REPULSION_RADIUS {
                    -REPULSION_STRENGTH * (1.0 - distance / REPULSION_RADIUS) / REPULSION_RADIUS
                } else {
                    0.0
                };
                let energy_derivative =
                    repulsion_derivative - growth_derivative * kernel_derivative;
                let force = -energy_derivative * MOTION_SCALE;
                forces[i].0 += force * dx / distance;
                forces[i].1 += force * dy / distance;
            }
        }

        if pointer_strength.abs() > f32::EPSILON {
            for (index, particle) in self.particles.iter().enumerate() {
                let (dx, dy) = torus_delta(pointer_x, pointer_y, particle.x, particle.y);
                let distance_sq = (dx * dx + dy * dy).max(0.008);
                let magnitude = pointer_strength * 0.024 / distance_sq.sqrt();
                forces[index].0 += dx * magnitude;
                forces[index].1 += dy * magnitude;
            }
        }

        if settle {
            let (centre_x, centre_y) = circular_centre(&self.particles);
            for (index, particle) in self.particles.iter().enumerate() {
                let (dx, dy) = torus_delta(centre_x, centre_y, particle.x, particle.y);
                forces[index].0 = forces[index].0 * 0.22 + dx * 0.32;
                forces[index].1 = forces[index].1 * 0.22 + dy * 0.32;
            }
        }

        for (particle, (force_x, force_y)) in self.particles.iter_mut().zip(forces) {
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
        for _ in 0..count.min(available) {
            let angle = self.rng.unit() * TAU;
            let radius = self.rng.unit().sqrt() * 0.12;
            self.particles.push(Particle {
                x: wrap(x + angle.cos() * radius),
                y: wrap(y + angle.sin() * radius),
                ..Particle::default()
            });
        }
        self.refresh_metrics();
    }

    pub(crate) fn snapshot(&self) -> Vec<f32> {
        let mut values = Vec::with_capacity(self.particles.len() * 4);
        for particle in &self.particles {
            values.push(particle.x);
            values.push(particle.y);
            values.push(((particle.energy + 1.0) * 0.5).clamp(0.0, 1.0));
            values.push((particle.speed / MAX_SPEED).clamp(0.0, 1.0));
        }
        values
    }

    pub(crate) fn metrics(&self) -> [f32; 6] {
        self.metrics
    }

    pub(crate) fn particle_count(&self) -> usize {
        self.particles.len()
    }

    pub(crate) fn seed(&self) -> u32 {
        self.seed
    }

    fn refresh_metrics(&mut self) {
        if self.particles.is_empty() {
            self.metrics = [0.0; 6];
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
            / 0.55)
            .clamp(0.0, 1.0);
        let energy = ((mean_energy + 1.0) * 0.5).clamp(0.0, 1.0);

        let mut mean_field = 0.0;
        for i in 0..self.particles.len() {
            for j in (i + 1)..self.particles.len() {
                let (dx, dy) = torus_delta(
                    self.particles[i].x,
                    self.particles[i].y,
                    self.particles[j].x,
                    self.particles[j].y,
                );
                let contribution = shell_kernel((dx * dx + dy * dy).sqrt());
                mean_field += contribution * 2.0;
            }
        }
        let density = (mean_field / count / 1.05).clamp(0.0, 1.0);

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

        let formations = formation_count(&self.particles).min(12) as f32;
        let transition = ((energy - self.previous_energy).abs() * 18.0
            + (activity - self.previous_activity).abs() * 2.6)
            .clamp(0.0, 1.0);

        self.metrics = [energy, coherence, activity, density, formations, transition];
        self.previous_energy = energy;
        self.previous_activity = activity;
    }
}

fn shell_kernel(distance: f32) -> f32 {
    let normalized = (distance - KERNEL_RADIUS) / KERNEL_WIDTH;
    (-normalized * normalized).exp() * KERNEL_WEIGHT
}

fn growth(field: f32) -> f32 {
    let normalized = (field - GROWTH_TARGET) / GROWTH_WIDTH;
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

fn formation_count(particles: &[Particle]) -> usize {
    let mut parents: Vec<usize> = (0..particles.len()).collect();
    for i in 0..particles.len() {
        for j in (i + 1)..particles.len() {
            let (dx, dy) = torus_delta(
                particles[i].x,
                particles[i].y,
                particles[j].x,
                particles[j].y,
            );
            if dx * dx + dy * dy <= FORMATION_DISTANCE * FORMATION_DISTANCE {
                union(&mut parents, i, j);
            }
        }
    }

    let mut roots = Vec::new();
    for index in 0..particles.len() {
        let root = find(&mut parents, index);
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    roots.len()
}

fn find(parents: &mut [usize], mut index: usize) -> usize {
    while parents[index] != index {
        parents[index] = parents[parents[index]];
        index = parents[index];
    }
    index
}

fn union(parents: &mut [usize], a: usize, b: usize) {
    let root_a = find(parents, a);
    let root_b = find(parents, b);
    if root_a != root_b {
        parents[root_b] = root_a;
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
            left.step(1.0 / 90.0, 0.0, 0.0, 0.0, false);
            right.step(1.0 / 90.0, 0.0, 0.0, 0.0, false);
        }
        assert_eq!(left.snapshot(), right.snapshot());
        assert_eq!(left.metrics(), right.metrics());
    }

    #[test]
    fn different_seeds_produce_different_states() {
        let left = Simulation::new(41, 96);
        let right = Simulation::new(42, 96);
        assert_ne!(left.snapshot(), right.snapshot());
    }

    #[test]
    fn long_runs_remain_finite_and_bounded() {
        let mut simulation = Simulation::new(7, 120);
        for _ in 0..600 {
            simulation.step(1.0 / 90.0, 0.2, -0.4, 0.0, false);
        }
        for record in simulation.snapshot().chunks_exact(4) {
            assert!(record.iter().all(|value| value.is_finite()));
            assert!((-1.0..=1.0).contains(&record[0]));
            assert!((-1.0..=1.0).contains(&record[1]));
            assert!((0.0..=1.0).contains(&record[2]));
            assert!((0.0..=1.0).contains(&record[3]));
        }
    }

    #[test]
    fn ordinary_motion_conserves_particle_count() {
        let mut simulation = Simulation::new(12, 80);
        for _ in 0..20 {
            simulation.step(1.0 / 60.0, 0.0, 0.0, 1.0, false);
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
    fn pointer_force_changes_the_trajectory() {
        let mut idle = Simulation::new(99, 64);
        let mut herded = Simulation::new(99, 64);
        for _ in 0..10 {
            idle.step(1.0 / 90.0, 0.6, -0.4, 0.0, false);
            herded.step(1.0 / 90.0, 0.6, -0.4, 1.0, false);
        }
        assert_ne!(idle.snapshot(), herded.snapshot());
    }

    #[test]
    fn metrics_have_documented_ranges() {
        let mut simulation = Simulation::new(5, 72);
        simulation.step(1.0 / 90.0, 0.0, 0.0, 0.0, false);
        let metrics = simulation.metrics();
        for metric in &metrics[..4] {
            assert!((0.0..=1.0).contains(metric));
        }
        assert!((1.0..=12.0).contains(&metrics[4]));
        assert!((0.0..=1.0).contains(&metrics[5]));
    }
}
