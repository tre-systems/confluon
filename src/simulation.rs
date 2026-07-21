use std::f32::consts::TAU;

const DEFAULT_PARTICLES: usize = 1_200;
const MAX_PARTICLES: usize = 1_600;
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
const GRID_SIDE: usize = 20;
const GRID_CELL_SIZE: f32 = 2.0 / GRID_SIDE as f32;

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
// positive values avoid. The forces are weaker and shorter-range than each
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

#[derive(Debug)]
struct SpatialGrid {
    cells: Vec<Vec<usize>>,
}

impl SpatialGrid {
    fn new(particles: &[Particle]) -> Self {
        let mut cells: Vec<Vec<usize>> = (0..GRID_SIDE * GRID_SIDE)
            .map(|_| Vec::with_capacity(8))
            .collect();
        for (index, particle) in particles.iter().enumerate() {
            cells[cell_index(particle.x, particle.y)].push(index);
        }
        Self { cells }
    }

    fn visit_neighbours(&self, x: f32, y: f32, radius: f32, mut visit: impl FnMut(usize)) {
        let centre_x = cell_coordinate(x) as isize;
        let centre_y = cell_coordinate(y) as isize;
        let reach = (radius / GRID_CELL_SIZE).ceil() as isize;
        let side = GRID_SIDE as isize;
        for offset_y in -reach..=reach {
            let grid_y = (centre_y + offset_y).rem_euclid(side) as usize;
            for offset_x in -reach..=reach {
                let grid_x = (centre_x + offset_x).rem_euclid(side) as usize;
                for &index in &self.cells[grid_y * GRID_SIDE + grid_x] {
                    visit(index);
                }
            }
        }
    }
}

#[derive(Debug)]
pub(crate) struct Simulation {
    seed: u32,
    initial_count: usize,
    particles: Vec<Particle>,
    rng: SmallRng,
    metrics: [f32; 7],
    previous_energy: f32,
    previous_activity: f32,
    ecology: f32,
}

impl Simulation {
    pub(crate) fn new(seed: u32, particle_count: usize) -> Self {
        let initial_count = particle_count.clamp(24, MAX_PARTICLES);
        let mut simulation = Self {
            seed,
            initial_count,
            particles: Vec::with_capacity(MAX_PARTICLES),
            rng: SmallRng::new(seed),
            metrics: [0.0; 7],
            previous_energy: 0.5,
            previous_activity: 0.0,
            ecology: 1.0,
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
        let (fields, encounters) = measure_fields(&self.particles);
        self.refresh_metrics(&fields, &encounters);
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
        let grid = SpatialGrid::new(&self.particles);
        let mut fields = vec![0.0_f32; count];
        let mut repulsion_energies = vec![0.0_f32; count];
        let mut cross_energies = vec![0.0_f32; count];
        let mut encounters = vec![0.0_f32; count];

        for i in 0..count {
            let particle = self.particles[i];
            let species_i = particle.species as usize;
            let species = SPECIES[species_i];
            let support = kernel_support(species).max(SENSE_RADIUS);
            grid.visit_neighbours(particle.x, particle.y, support, |j| {
                if i == j {
                    return;
                }
                let other = self.particles[j];
                let (dx, dy) = torus_delta(particle.x, particle.y, other.x, other.y);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq > support * support {
                    return;
                }
                let distance = distance_sq.sqrt().max(0.000_1);
                let species_j = other.species as usize;
                if species_i == species_j {
                    if distance <= kernel_support(species) {
                        fields[i] += shell_kernel(distance, species);
                    }
                } else if distance <= SENSE_RADIUS {
                    let sensed = sense_kernel(distance);
                    cross_energies[i] += CROSS_SENSE[species_i][species_j] * sensed;
                    encounters[i] += sensed;
                }
                if distance < REPULSION_RADIUS {
                    let overlap = 1.0 - distance / REPULSION_RADIUS;
                    repulsion_energies[i] += REPULSION_STRENGTH * 0.5 * overlap * overlap;
                }
            });
        }

        let mut forces = vec![(0.0_f32, 0.0_f32); count];
        for i in 0..count {
            let particle = self.particles[i];
            let species_i = particle.species as usize;
            let species = SPECIES[species_i];
            let growth = growth(fields[i], species);
            self.particles[i].energy = repulsion_energies[i] - growth + cross_energies[i] * 0.045;
            let growth_derivative =
                growth * -2.0 * (fields[i] - species.growth_target) / species.growth_width.powi(2);
            let support = kernel_support(species).max(SENSE_RADIUS);

            grid.visit_neighbours(particle.x, particle.y, support, |j| {
                if i == j {
                    return;
                }
                let other = self.particles[j];
                // The derivative is projected along the vector pointing away from
                // the neighbour; this makes a negative overlap derivative repel.
                let (dx, dy) = torus_delta(particle.x, particle.y, other.x, other.y);
                let distance_sq = dx * dx + dy * dy;
                if distance_sq > support * support {
                    return;
                }
                let distance = distance_sq.sqrt().max(0.000_1);
                let species_j = other.species as usize;
                let same_species_derivative =
                    if species_i == species_j && distance <= kernel_support(species) {
                        let kernel = shell_kernel(distance, species);
                        let kernel_derivative = kernel * -2.0 * (distance - species.kernel_radius)
                            / species.kernel_width.powi(2);
                        -growth_derivative * kernel_derivative
                    } else {
                        0.0
                    };
                let repulsion_derivative = if distance < REPULSION_RADIUS {
                    -REPULSION_STRENGTH * (1.0 - distance / REPULSION_RADIUS) / REPULSION_RADIUS
                } else {
                    0.0
                };
                let cross_derivative = if species_i != species_j && distance <= SENSE_RADIUS {
                    let sensed = sense_kernel(distance);
                    CROSS_SENSE[species_i][species_j] * sensed * -2.0 * distance
                        / SENSE_RADIUS.powi(2)
                } else {
                    0.0
                };
                let energy_derivative = repulsion_derivative
                    + same_species_derivative
                    + cross_derivative * CROSS_MOTION_BOOST * self.ecology;
                let force = -energy_derivative * MOTION_SCALE * species.motion;
                forces[i].0 += force * dx / distance;
                forces[i].1 += force * dy / distance;
            });
        }

        if pointer_strength.abs() > f32::EPSILON || pointer_twist.abs() > f32::EPSILON {
            for (index, particle) in self.particles.iter().enumerate() {
                let (dx, dy) = torus_delta(pointer_x, pointer_y, particle.x, particle.y);
                let distance_sq = dx * dx + dy * dy;
                let distance = distance_sq.sqrt().max(0.035);
                let falloff = (-distance_sq / POINTER_REACH.powi(2)).exp();
                let radial = pointer_strength * 0.030 * falloff / distance;
                let tangential = pointer_twist * 0.025 * falloff / distance;
                forces[index].0 += dx * radial - dy * tangential;
                forces[index].1 += dy * radial + dx * tangential;
            }
        }

        if settle {
            let (centre_x, centre_y) = circular_centre(&self.particles);
            for (index, particle) in self.particles.iter().enumerate() {
                let (dx, dy) = torus_delta(centre_x, centre_y, particle.x, particle.y);
                forces[index].0 = forces[index].0 * 0.3 + dx * 0.16;
                forces[index].1 = forces[index].1 * 0.3 + dy * 0.16;
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

        self.refresh_metrics(&fields, &encounters);
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
        let (fields, encounters) = measure_fields(&self.particles);
        self.refresh_metrics(&fields, &encounters);
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

    pub(crate) fn particle_count(&self) -> usize {
        self.particles.len()
    }

    pub(crate) fn seed(&self) -> u32 {
        self.seed
    }

    fn refresh_metrics(&mut self, fields: &[f32], encounters: &[f32]) {
        if self.particles.is_empty() {
            self.metrics = [0.0; 7];
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
        let density = (fields.iter().sum::<f32>() / count / 0.46).clamp(0.0, 1.0);
        let encounter_pressure = (encounters.iter().sum::<f32>() / count / 64.0).clamp(0.0, 1.0);

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

        let formations = formation_count(&self.particles).clamp(1, 24) as f32;
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
}

fn measure_fields(particles: &[Particle]) -> (Vec<f32>, Vec<f32>) {
    let grid = SpatialGrid::new(particles);
    let mut fields = vec![0.0; particles.len()];
    let mut encounters = vec![0.0; particles.len()];
    for (i, particle) in particles.iter().copied().enumerate() {
        let species_i = particle.species as usize;
        let species = SPECIES[species_i];
        let support = kernel_support(species).max(SENSE_RADIUS);
        grid.visit_neighbours(particle.x, particle.y, support, |j| {
            if i == j {
                return;
            }
            let other = particles[j];
            let (dx, dy) = torus_delta(other.x, other.y, particle.x, particle.y);
            let distance = (dx * dx + dy * dy).sqrt();
            if other.species == particle.species && distance <= kernel_support(species) {
                fields[i] += shell_kernel(distance, species);
            } else if other.species != particle.species && distance <= SENSE_RADIUS {
                encounters[i] += sense_kernel(distance);
            }
        });
    }
    (fields, encounters)
}

fn shell_kernel(distance: f32, species: Species) -> f32 {
    let normalized = (distance - species.kernel_radius) / species.kernel_width;
    (-normalized * normalized).exp() * species.kernel_weight
}

fn kernel_support(species: Species) -> f32 {
    species.kernel_radius + species.kernel_width * 3.5
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

fn formation_count(particles: &[Particle]) -> usize {
    let grid = SpatialGrid::new(particles);
    let mut parents: Vec<usize> = (0..particles.len()).collect();
    for i in 0..particles.len() {
        let particle = particles[i];
        grid.visit_neighbours(particle.x, particle.y, FORMATION_DISTANCE, |j| {
            if j <= i || particles[j].species != particle.species {
                return;
            }
            let (dx, dy) = torus_delta(particles[j].x, particles[j].y, particle.x, particle.y);
            if dx * dx + dy * dy <= FORMATION_DISTANCE * FORMATION_DISTANCE {
                union(&mut parents, i, j);
            }
        });
    }

    let mut sizes = vec![0_usize; particles.len()];
    for index in 0..particles.len() {
        let root = find(&mut parents, index);
        sizes[root] += 1;
    }
    sizes.into_iter().filter(|&size| size >= 4).count().max(1)
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
            left.step(1.0 / 90.0, 0.0, 0.0, 0.0, 0.0, false);
            right.step(1.0 / 90.0, 0.0, 0.0, 0.0, 0.0, false);
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
}
