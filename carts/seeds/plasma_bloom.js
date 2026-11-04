/*@vfx
id: 35feb5ba-985f-4f64-8dfb-13f3bec71b08
title: Plasma Bloom
created: 2026-07-07
artist: seed exemplar (human + Claude)
license: CC BY-SA 4.0, Jim Whitehead
lineage: []
influences: []
rationale: |
  Canonical pixel-mode exemplar: layered sine fields plus noise,
  but pushed off the default rainbow into a narrow teal-violet band
  with a dark floor. Exists to demonstrate normalized coordinates,
  hue restraint, and the v*v perceptual value curve.
@vfx*/

// plasma_bloom — pixel mode
// Classic sum-of-waves plasma, pushed toward a two-hue teal/violet
// palette instead of the default rainbow. Demonstrates: normalized
// coordinates, layered sin fields + noise, hue drift, perceptual
// value curve (v*v).
//
// Performance note (see docs/VFX_API.md's pixel-mode guidance): on Pi 4,
// QuickJS-as-WASM interpretation cost scales with per-pixel operation
// count, not raw math complexity, so the two parts of this effect that
// don't actually need to run 4096x/frame are hoisted to once-per-frame:
// the wave term that only depends on x (not y), and the n -> color
// mapping (hsv/smoothstep/fract), which only has as many distinct
// outputs as PALETTE_STEPS regardless of panel size. Both are rebuilt
// once whenever t advances (top-level state, per the Lifecycle section)
// and read per-pixel as plain array lookups.

const meta = { name: "plasma_bloom", fps: 30 };

const SPEED = 0.6;

// --- once-per-frame caches -------------------------------------------------

const __col1 = new Float64Array(WIDTH); // sin(u*7 + t*SPEED), one value per column
const PALETTE_STEPS = 256;
const __palette = new Int32Array(PALETTE_STEPS); // n (quantized) -> final color

// noise2() is the single most expensive primitive per pixel (see
// docs/VFX_API.md). Its input here only varies slowly across the panel
// (u*3, v*3 spans a ~3-unit range over 64px), so sample it on a coarse
// grid once per frame and bilinearly interpolate per pixel instead of
// calling it 4096x/frame - the standard value-noise-upsampling idiom.
const NOISE_GRID = 17; // samples per axis; grid step = 4px at 64-wide
const __noiseGrid = new Float64Array(NOISE_GRID * NOISE_GRID);

let __cacheT = null;

function __rebuildFrameCache(t) {
  for (let x = 0; x < WIDTH; x++) {
    const u = x / WIDTH - 0.5;
    __col1[x] = Math.sin(u * 7.0 + t * SPEED);
  }
  for (let i = 0; i < PALETTE_STEPS; i++) {
    const n = (i / (PALETTE_STEPS - 1)) * 2 - 1; // reconstruct the ~-1..1 range pixel() quantizes into
    const hue = fract(0.5 + n * 0.22 + t * 0.004);
    const val = 0.12 + 0.88 * smoothstep(-0.35, 0.95, n);
    __palette[i] = hsv(hue, 0.85, val * val);
  }
  for (let gy = 0; gy < NOISE_GRID; gy++) {
    const v = gy / (NOISE_GRID - 1) - 0.5;
    for (let gx = 0; gx < NOISE_GRID; gx++) {
      const u = gx / (NOISE_GRID - 1) - 0.5;
      __noiseGrid[gy * NOISE_GRID + gx] = noise2(u * 3.0 + t * 0.15, v * 3.0 - t * 0.1);
    }
  }
  __cacheT = t;
}

function __sampleNoiseGrid(x, y) {
  const gxf = (x / (WIDTH - 1)) * (NOISE_GRID - 1);
  const gyf = (y / (HEIGHT - 1)) * (NOISE_GRID - 1);
  const gx0 = gxf | 0, gy0 = gyf | 0;
  const gx1 = gx0 + 1 < NOISE_GRID ? gx0 + 1 : gx0;
  const gy1 = gy0 + 1 < NOISE_GRID ? gy0 + 1 : gy0;
  const fx = gxf - gx0, fy = gyf - gy0;
  const n00 = __noiseGrid[gy0 * NOISE_GRID + gx0];
  const n10 = __noiseGrid[gy0 * NOISE_GRID + gx1];
  const n01 = __noiseGrid[gy1 * NOISE_GRID + gx0];
  const n11 = __noiseGrid[gy1 * NOISE_GRID + gx1];
  const nx0 = n00 + (n10 - n00) * fx;
  const nx1 = n01 + (n11 - n01) * fx;
  return nx0 + (nx1 - nx0) * fy;
}

function pixel(x, y, t) {
  if (t !== __cacheT) __rebuildFrameCache(t);

  // Normalize to roughly -0.5..0.5 so the math is resolution-independent.
  const u = x / WIDTH - 0.5;
  const v = y / HEIGHT - 0.5;

  // Three interfering wave fields (first one cached per-column above) plus
  // a slow noise layer (bilinearly upsampled from the per-frame grid above).
  let n =
    __col1[x] +
    Math.sin(v * 6.0 - u * 4.0 + t * 0.7 * SPEED) +
    Math.sin(Math.hypot(u, v + 0.1) * 14.0 - t * 1.3 * SPEED) +
    __sampleNoiseGrid(x, y);

  n = n / 4.0; // roughly -1..1

  const idx = ((clamp(n, -1, 1) + 1) * 0.5 * (PALETTE_STEPS - 1)) | 0;
  return __palette[idx];
}
