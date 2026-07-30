use confluon::Engine;
use std::hint::black_box;
use std::time::Instant;

const FIXED_STEP: f32 = 1.0 / 30.0;
const WARMUP_STEPS: usize = 30;
const MEASURED_STEPS: usize = 300;

fn main() {
    for count in [1200_usize, 2000, 3000, 4096] {
        let mut engine = Engine::new(7, count);
        for _ in 0..WARMUP_STEPS {
            engine.step(FIXED_STEP, 0.0, 0.0, 0.0, 0.0, false);
        }

        let start = Instant::now();
        for _ in 0..MEASURED_STEPS {
            engine.step(FIXED_STEP, 0.1, -0.2, 0.0, 0.0, false);
        }
        black_box(&engine);
        let elapsed = start.elapsed();
        println!(
            "N={count:5}  {:7.3} ms/step   ({MEASURED_STEPS} steps in {elapsed:?})",
            elapsed.as_secs_f64() * 1000.0 / MEASURED_STEPS as f64,
        );
    }
}
