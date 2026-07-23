use geno_5::Engine;
use std::time::Instant;

fn main() {
    for count in [1200_usize, 2000, 3000, 4096] {
        let mut engine = Engine::new(7, count);
        // warm up
        for _ in 0..30 {
            engine.step(1.0 / 30.0, 0.0, 0.0, 0.0, 0.0, false);
        }
        let steps = 300;
        let start = Instant::now();
        for _ in 0..steps {
            engine.step(1.0 / 30.0, 0.1, -0.2, 0.0, 0.0, false);
        }
        let elapsed = start.elapsed();
        println!(
            "N={:5}  {:7.3} ms/step   ({} steps in {:?})",
            count,
            elapsed.as_secs_f64() * 1000.0 / steps as f64,
            steps,
            elapsed
        );
    }
}
