/*@vfx
id: 3a997c07-9327-4c3e-8b5c-db10ca3fcd8d
title: Tide Pool Lantern
created: 2026-07-10
artist: seed exemplar (human + Claude)
lineage: []
influences: []
rationale: |
  Reactive-input exemplar: none of the other seed pieces declare
  meta.inputs, so this is the first worked example of the graceful-
  degradation idiom docs/VFX_API.md asks for — a soft ambient breathing
  glow that looks intentional in total silence, then layers three real
  input groups on top. Clock sets mood (cool blue-violet at night, warm
  gold by day via daylight), audio swells the glow and throws sparks on
  beat, and holding the button charges a brighter core that releases as
  an expanding ring. Uses heldSeconds and the released edge flag
  directly rather than hand-rolled press/release tracking.
@vfx*/

// tide_pool_lantern — buffer mode, reactive
// A lantern-like glow at center. Breathes gently on its own; audio level
// swells it, beats throw sparks outward, and holding the button charges
// a brighter core that releases as an expanding ring. Demonstrates:
// input.clock.daylight for mood, input.audio.ok graceful degradation,
// input.button.heldSeconds/released edges, fade() trails, local
// (bounding-box) pixel loops instead of scanning the whole panel.

const meta = { name: "tide_pool_lantern", fps: 30, inputs: ["audio", "button", "clock"] };

const CX = (WIDTH / 2) | 0;
const CY = (HEIGHT / 2) | 0;
const CHARGE_SECONDS = 1.5;

let sparks = [];
let pulses = [];
let lastHeldSeconds = 0; // heldSeconds reads 0 on the release frame itself

function blendMax(a, b) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return rgb(Math.max(ar, br), Math.max(ag, bg), Math.max(ab, bb));
}

function render(t, dt) {
  fade(0.85);

  const daylight = input.clock.daylight;
  // Blue-violet at night through rose at twilight to warm gold by day —
  // deliberately the "long way" around the hue wheel (0.7 -> 1.12, wraps
  // via hsv()'s internal fract()) so the transition never dips through
  // green, which read as a murky, unintentional-looking color here.
  const hue = lerp(0.7, 1.12, daylight);
  const ambientV = lerp(0.55, 0.75, daylight);

  const breathe = 0.5 + 0.5 * Math.sin(t * 1.3);
  const level = input.audio.ok ? input.audio.level : 0;

  if (input.button.down) lastHeldSeconds = input.button.heldSeconds;
  const charge = input.button.down ? clamp(input.button.heldSeconds / CHARGE_SECONDS, 0, 1) : 0;

  const glowRadius = 9 + breathe * 5 + level * 10 + charge * 6;
  // Candlelight-style per-frame jitter on top of the breathe cycle — a
  // real flame's brightness never holds perfectly still even at rest.
  const flicker = 0.7 + 0.6 * Math.random();
  const glowV = (ambientV * (0.6 + 0.4 * breathe) + level * 0.35 + charge * 0.4) * flicker;

  const r = Math.ceil(glowRadius);
  for (let y = CY - r; y <= CY + r; y++) {
    if (y < 0 || y >= HEIGHT) continue;
    for (let x = CX - r; x <= CX + r; x++) {
      if (x < 0 || x >= WIDTH) continue;
      const dx = x - CX, dy = y - CY;
      const d = Math.hypot(dx, dy);
      const falloff = 1 - d / glowRadius;
      if (falloff <= 0) continue;
      // Water-lantern shimmer: organic per-pixel texture instead of a
      // perfectly smooth radial gradient, always drifting even in
      // total silence (noise2 idiom, same as plasma_bloom.js).
      const shimmer = 0.8 + 0.4 * (0.5 + 0.5 * noise2(x * 0.15 + t * 0.6, y * 0.15 - t * 0.4));
      const value = falloff * glowV * shimmer;
      if (value <= 0.02) continue;
      const c = hsv(hue + 0.02 * Math.sin(d * 0.3 + t), 0.75, value * value); // v*v perceptual curve, applied once
      setPixel(x, y, blendMax(getPixel(x, y), c));
    }
  }

  if (input.button.released) {
    const strength = clamp(lastHeldSeconds / CHARGE_SECONDS, 0.2, 1);
    pulses.push({ r: glowRadius, life: 1, strength });
    lastHeldSeconds = 0;
  }

  if (input.audio.beat) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 10 + Math.random() * 10;
      sparks.push({ x: CX, y: CY, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 1 });
    }
  }

  sparks = sparks.filter((s) => s.life > 0);
  for (const s of sparks) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt * 1.2;
    if (s.life > 0) setPixel(s.x | 0, s.y | 0, hsv(hue + 0.05, 0.5, s.life * s.life));
  }

  pulses = pulses.filter((p) => p.life > 0);
  for (const p of pulses) {
    p.r += dt * 30;
    p.life -= dt * 1.5;
    if (p.life <= 0) continue;
    const ringV = p.life * p.life * (0.3 + p.strength * 0.5);
    const steps = Math.max(8, (p.r * 6) | 0);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = (CX + Math.cos(a) * p.r) | 0;
      const y = (CY + Math.sin(a) * p.r) | 0;
      setPixel(x, y, hsv(hue, 0.6, ringV));
    }
  }
}
