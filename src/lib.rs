mod simulation;

use simulation::Simulation;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Engine {
    simulation: Simulation,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, particle_count: usize) -> Self {
        console_error_panic_hook::set_once();
        Self {
            simulation: Simulation::new(seed, particle_count),
        }
    }

    pub fn reset(&mut self, seed: u32) {
        self.simulation.reset(seed);
    }

    pub fn step(
        &mut self,
        dt: f32,
        pointer_x: f32,
        pointer_y: f32,
        pointer_strength: f32,
        pointer_twist: f32,
        settle: bool,
    ) {
        self.simulation.step(
            dt,
            pointer_x,
            pointer_y,
            pointer_strength,
            pointer_twist,
            settle,
        );
    }

    pub fn set_ecology(&mut self, ecology: f32) {
        self.simulation.set_ecology(ecology);
    }

    pub fn spawn_at(&mut self, x: f32, y: f32, count: usize) {
        self.simulation.spawn_at(x, y, count);
    }

    pub fn snapshot(&self) -> Vec<f32> {
        self.simulation.snapshot()
    }

    pub fn metrics(&self) -> Vec<f32> {
        self.simulation.metrics().to_vec()
    }

    pub fn particle_count(&self) -> usize {
        self.simulation.particle_count()
    }

    pub fn seed(&self) -> u32 {
        self.simulation.seed()
    }
}
