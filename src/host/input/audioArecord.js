'use strict';

// Real audio input for the Pi: spawns `arecord`, band-splits via `fft.js`.
// If `arecord` is missing, fails to start, or
// exits, this degrades to `ok:false` rather than crashing the daemon —
// graceful degradation applies to the host's own sampling, not just
// program code (docs/VFX_API.md's "Degrade gracefully" rule).
//
// Scale factors in _bandEnergy/sample (level *4, /(WINDOW_SIZE/8), the
// beat threshold multiplier) are heuristic starting points, not measured
// against every mic, so expect to retune for yours.

const { spawn } = require('child_process');
const FFT = require('fft.js');

const SAMPLE_RATE = 44100;
const WINDOW_SIZE = 1024; // must be a power of two for fft.js
const STARTUP_GRACE_MS = 200;
const MAX_SPAWN_ATTEMPTS = 4;
const RETRY_DELAY_MS = 750;

const BASS_HZ = [20, 250];
const MID_HZ = [250, 2000];
const TREBLE_HZ = [2000, 8000];

const BEAT_THRESHOLD_MULTIPLIER = 1.5;
const BEAT_MIN_BASS = 0.02;
const BEAT_COOLDOWN_SECONDS = 0.2;
const BASELINE_EMA_ALPHA = 0.05;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a, b, u) {
  return a + (b - a) * u;
}

class ArecordAudioSource {
  // `device` is an ALSA device string (e.g. "plughw:3,0" or
  // "plughw:CARD=BRIO,DEV=0", from `arecord -l`/`arecord -L`). Omitted,
  // arecord falls back to ALSA's "default" device, which on a Pi with a
  // USB mic added later is often the wrong one (or none at all, once
  // onboard audio is blacklisted per the deploy checklist) - this was
  // silently the case here until it was made explicit.
  constructor(device) {
    this.device = device || null;
    this.available = false;
    this.proc = null;
    this.ring = new Float32Array(WINDOW_SIZE);
    this.ringFilled = 0;
    this.writeIndex = 0;
    this.leftoverByte = null;
    this.fft = new FFT(WINDOW_SIZE);
    this.complexOut = this.fft.createComplexArray();
    this.bassBaseline = 0;
    this.beatCooldown = 0;
  }

  // Retries on a fast (within-grace-window) failure to start: observed
  // for real on a Pi 4 with a USB mic - a device open that fails right
  // at daemon startup (right after the GPIO/PWM matrix display
  // initializes - plausibly a brief shared-hardware disruption, the
  // same category of conflict as onboard audio vs PWM, just transient here instead of permanent) can succeed
  // moments later with the identical device string and no other change.
  // A one-time startup race shouldn't cost the whole session's audio.
  async init() {
    for (let attempt = 1; attempt <= MAX_SPAWN_ATTEMPTS; attempt++) {
      const started = await this._spawnOnce(attempt);
      if (started) return;
      if (attempt < MAX_SPAWN_ATTEMPTS) {
        console.warn(
          `[ArecordAudioSource] retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_SPAWN_ATTEMPTS})...`
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    console.warn(`[ArecordAudioSource] gave up after ${MAX_SPAWN_ATTEMPTS} attempts - audio will read as unavailable`);
    this.available = false;
  }

  // Spawns arecord once and resolves true only if it's still alive after
  // STARTUP_GRACE_MS - an immediate exit (bad device, transient hiccup)
  // resolves false so init() can retry instead of latching "no mic" in
  // permanently from a single fast failure.
  _spawnOnce(attempt) {
    return new Promise((resolve) => {
      const args = ['-f', 'S16_LE', '-r', String(SAMPLE_RATE), '-c', '1', '-t', 'raw'];
      if (this.device) args.unshift('-D', this.device);

      let proc;
      try {
        proc = spawn('arecord', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        console.warn(`[ArecordAudioSource] failed to spawn arecord (attempt ${attempt}):`, err.message);
        resolve(false);
        return;
      }

      let exitedEarly = false;
      proc.on('error', (err) => {
        console.warn(`[ArecordAudioSource] arecord process error (attempt ${attempt}):`, err.message);
        exitedEarly = true;
        this.available = false;
      });
      proc.on('exit', (code, signal) => {
        console.warn(`[ArecordAudioSource] arecord exited (attempt ${attempt}, code=${code} signal=${signal})`);
        exitedEarly = true;
        this.available = false;
      });
      // Surfaced, not swallowed: this is exactly where "wrong/missing
      // device" (e.g. "No such file or directory", "Device or resource
      // busy") shows up - silently discarding it was a real diagnostic
      // dead end for anyone trying to tell "not receiving audio" apart
      // from "arecord never started at all".
      proc.stderr.on('data', (chunk) => {
        console.warn(`[ArecordAudioSource] arecord: ${chunk.toString().trim()}`);
      });
      proc.stdout.on('data', (chunk) => this._ingest(chunk));

      setTimeout(() => {
        if (exitedEarly) {
          resolve(false);
          return;
        }
        this.proc = proc;
        this.available = true;
        resolve(true);
      }, STARTUP_GRACE_MS);
    });
  }

  _ingest(chunk) {
    let buf = chunk;
    if (this.leftoverByte !== null) {
      buf = Buffer.concat([Buffer.from([this.leftoverByte]), chunk]);
      this.leftoverByte = null;
    }
    if (buf.length % 2 === 1) {
      this.leftoverByte = buf[buf.length - 1];
      buf = buf.subarray(0, buf.length - 1);
    }
    const sampleCount = buf.length >> 1;
    for (let i = 0; i < sampleCount; i++) {
      this.ring[this.writeIndex] = buf.readInt16LE(i * 2) / 32768;
      this.writeIndex = (this.writeIndex + 1) % WINDOW_SIZE;
      if (this.ringFilled < WINDOW_SIZE) this.ringFilled++;
    }
  }

  _bandEnergy([loHz, hiHz]) {
    const loBin = Math.max(1, Math.floor((loHz * WINDOW_SIZE) / SAMPLE_RATE));
    const hiBin = Math.min(WINDOW_SIZE / 2 - 1, Math.ceil((hiHz * WINDOW_SIZE) / SAMPLE_RATE));
    let sum = 0;
    let count = 0;
    for (let k = loBin; k <= hiBin; k++) {
      const re = this.complexOut[2 * k];
      const im = this.complexOut[2 * k + 1];
      sum += Math.sqrt(re * re + im * im);
      count++;
    }
    const mean = count > 0 ? sum / count : 0;
    return mean / (WINDOW_SIZE / 8); // heuristic normalization, see file header
  }

  sample(dt) {
    if (this.beatCooldown > 0) this.beatCooldown -= dt;

    if (!this.available || this.ringFilled < WINDOW_SIZE) {
      return { ok: false, level: 0, bass: 0, mid: 0, treble: 0, beat: false };
    }

    const windowed = new Array(WINDOW_SIZE);
    let sumSquares = 0;
    for (let i = 0; i < WINDOW_SIZE; i++) {
      const s = this.ring[(this.writeIndex + i) % WINDOW_SIZE];
      windowed[i] = s;
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / WINDOW_SIZE);

    this.fft.realTransform(this.complexOut, windowed);
    this.fft.completeSpectrum(this.complexOut);

    const bass = clamp01(this._bandEnergy(BASS_HZ));
    const mid = clamp01(this._bandEnergy(MID_HZ));
    const treble = clamp01(this._bandEnergy(TREBLE_HZ));

    this.bassBaseline = this.bassBaseline === 0 ? bass : lerp(this.bassBaseline, bass, BASELINE_EMA_ALPHA);
    let beat = false;
    if (this.beatCooldown <= 0 && bass > BEAT_MIN_BASS && bass > this.bassBaseline * BEAT_THRESHOLD_MULTIPLIER) {
      beat = true;
      this.beatCooldown = BEAT_COOLDOWN_SECONDS;
    }

    return { ok: true, level: clamp01(rms * 4), bass, mid, treble, beat };
  }

  close() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.available = false;
  }
}

module.exports = { ArecordAudioSource };
