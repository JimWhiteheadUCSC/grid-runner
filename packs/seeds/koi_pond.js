/*@vfx
id: d38d8c81-dc33-47d8-8b39-3b580f5507cb
title: Koi Pond
created: 2026-07-07
artist: seed exemplar (human + Claude)
lineage:
  - id: 2bba4eb5-cd9b-4f2a-bb27-b5929bd67d43
    relation: variation
    note: kept the noise-steered swarm; traded anonymous points for
      sprite characters with flip and frame animation
influences: []
rationale: |
  Sprite-mode exemplar. Proves the deliberate omissions are real
  idioms - separation behavior is eight lines of distance checks,
  animation is a two-element frame array, direction is flipX.
  Characters, not particles: the panel can hold a small world.
@vfx*/

// koi_pond — buffer mode with sprites
// A few koi drift across a dark pond, tail-flap animation via frame
// arrays, flipX on direction change, and gentle separation behavior
// done entirely in program code (no engine collision support needed).
// Bubbles are plain setPixel particles. Demonstrates: sprite(),
// blit() with flipX/brightness, animation frames, user-space
// proximity logic.

const meta = { name: "koi_pond", fps: 30 };

// --- assets ------------------------------------------------------------

const KOI_A = { o: rgb(255, 120, 40), w: rgb(240, 235, 225), d: rgb(150, 60, 20) };

// Two tail positions; fish face right by default.
const KOI_F1 = sprite(KOI_A, `
  ..ww.....
  .woooow..
  wooowooow
  .woooow..
  ..ww.....
  `);
const KOI_F2 = sprite(KOI_A, `
  ....ww...
  .woooow..
  dooowooow
  .woooow..
  ....ww...
  `);
const KOI_FRAMES = [KOI_F1, KOI_F2];

// --- state -------------------------------------------------------------

const FISH_COUNT = 4;
const BUBBLE_COUNT = 10;
let fish = [];
let bubbles = [];

function setup() {
  for (let i = 0; i < FISH_COUNT; i++) {
    fish.push({
      x: Math.random() * WIDTH,
      y: 8 + Math.random() * (HEIGHT - 20),
      vx: (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4),
      vy: 0,
      wob: Math.random() * Math.PI * 2,   // wobble phase
      flap: Math.random() * 10,           // animation phase
      dim: 0.55 + Math.random() * 0.45,   // depth = brightness
    });
  }
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    bubbles.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, s: 3 + Math.random() * 5 });
  }
}

// --- frame -------------------------------------------------------------

function render(t, dt) {
  fill(rgb(2, 6, 14)); // deep water, near-black blue

  // Faint caustic shimmer on the "surface" rows.
  for (let x = 0; x < WIDTH; x++) {
    const c = 0.5 + 0.5 * noise2(x * 0.15, t * 0.6);
    setPixel(x, 0, hsv(0.55, 0.5, 0.10 * c * c));
    setPixel(x, 1, hsv(0.55, 0.6, 0.05 * c));
  }

  // Bubbles rise and respawn at the bottom.
  for (const b of bubbles) {
    b.y -= b.s * dt;
    b.x += noise2(b.y * 0.1, b.x * 0.1) * 3 * dt;
    if (b.y < 2) { b.y = HEIGHT - 1; b.x = Math.random() * WIDTH; }
    setPixel(b.x | 0, b.y | 0, hsv(0.55, 0.25, 0.30));
  }

  // Fish: wander, separate, wrap, draw.
  for (let i = 0; i < fish.length; i++) {
    const f = fish[i];

    // Gentle vertical wander.
    f.wob += dt * (0.6 + Math.abs(f.vx) * 0.05);
    f.vy = Math.sin(f.wob) * 2.5;

    // Separation, in plain program code: nudge apart when too close.
    for (let j = 0; j < fish.length; j++) {
      if (j === i) continue;
      const g = fish[j];
      const dx = f.x - g.x, dy = f.y - g.y;
      if (dx * dx + dy * dy < 64) {           // within 8 px
        f.vy += (dy >= 0 ? 8 : -8) * dt;
        f.vx += (dx >= 0 ? 4 : -4) * dt;
      }
    }

    // Occasional lazy turn.
    if (Math.random() < 0.15 * dt) f.vx = -f.vx;

    f.x += f.vx * dt;
    f.y = clamp(f.y + f.vy * dt, 3, HEIGHT - 8);

    // Wrap horizontally with room to swim fully off-panel.
    if (f.x > WIDTH + 10) f.x = -10;
    if (f.x < -10) f.x = WIDTH + 10;

    // Tail flap speed follows swim speed.
    f.flap += dt * (3 + Math.abs(f.vx) * 0.6);
    const frame = KOI_FRAMES[(f.flap | 0) % KOI_FRAMES.length];

    blit(frame, (f.x | 0) - 4, (f.y | 0) - 2, {
      flipX: f.vx < 0,
      brightness: f.dim,
    });
  }
}
