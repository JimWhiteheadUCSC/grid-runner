/*@vfx
id: 2bba4eb5-cd9b-4f2a-bb27-b5929bd67d43
title: Fireflies
created: 2026-07-07
artist: seed exemplar (human + Claude)
lineage: []
influences: []
rationale: |
  Canonical buffer-mode exemplar: persistent particle state steered
  by a noise flow-field, trails via fade(), per-particle blink phase
  for organic shimmer. Warm sparks on darkness — the palette argument
  from the aesthetic guidance, demonstrated.
@vfx*/

// fireflies — buffer mode
// A swarm of warm sparks steered by a drifting noise flow-field,
// leaving trails via fade(). Demonstrates: persistent state in
// top-level variables, setup(), dt-based motion, fade() trails,
// toroidal wrapping, per-particle phase for organic shimmer.

const meta = { name: "fireflies", fps: 30 };

const COUNT = 24;
const SPEED = 11.0;   // pixels per second
const TURN = 3.5;     // steering strength
let flies = [];

function setup() {
  for (let i = 0; i < COUNT; i++) {
    flies.push({
      x: Math.random() * WIDTH,
      y: Math.random() * HEIGHT,
      a: Math.random() * Math.PI * 2,          // heading
      hue: 0.07 + Math.random() * 0.08,        // amber band
      phase: Math.random() * Math.PI * 2,      // blink offset
      rate: 1.5 + Math.random() * 1.5,         // blink speed
    });
  }
}

function render(t, dt) {
  // Trails: previous frame decays instead of being cleared.
  fade(0.88);

  for (const f of flies) {
    // Steer along a slowly evolving noise field.
    const steer = noise3(f.x * 0.045, f.y * 0.045, t * 0.25);
    f.a += steer * TURN * dt;

    f.x += Math.cos(f.a) * SPEED * dt;
    f.y += Math.sin(f.a) * SPEED * dt;

    // Wrap around the panel edges.
    f.x = (f.x + WIDTH) % WIDTH;
    f.y = (f.y + HEIGHT) % HEIGHT;

    // Slow individual blink; squared for perceptual glow.
    const blink = 0.5 + 0.5 * Math.sin(t * f.rate + f.phase);
    const glow = 0.25 + 0.75 * blink * blink;

    const xi = f.x | 0;
    const yi = f.y | 0;
    setPixel(xi, yi, hsv(f.hue, 0.9, glow));

    // Dim halo on the brightest flies for a soft bloom.
    if (glow > 0.7) {
      const halo = hsv(f.hue, 0.95, glow * 0.18);
      setPixel(xi + 1, yi, halo);
      setPixel(xi - 1, yi, halo);
      setPixel(xi, yi + 1, halo);
      setPixel(xi, yi - 1, halo);
    }
  }
}
