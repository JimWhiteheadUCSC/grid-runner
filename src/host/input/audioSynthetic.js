'use strict';

// Fake audio source for the sim (no real mic on a dev machine by
// default). Produces a plausible continuous level/bass/mid/treble
// waveform with periodic beats — enough to develop and eyeball
// audio-reactive effects against. Wall-clock driven (an internal time
// accumulator advanced by dt) rather than frame-indexed, since it runs
// indefinitely across program swaps, unlike validate/inputScenarios.js's
// fixed-length-run synthesizer.

const BEAT_PERIOD_SECONDS = 0.6;

class SyntheticAudioSource {
  constructor() {
    this.t = 0;
    this.lastBeatCycle = -1;
  }

  sample(dt) {
    this.t += dt;
    const t = this.t;

    const level = (Math.sin(t * 3) + 1) / 2;
    const bass = (Math.sin(t * 2 + 0.5) + 1) / 2;
    const mid = (Math.sin(t * 2.7 + 1) + 1) / 2;
    const treble = (Math.sin(t * 4 + 2) + 1) / 2;

    const beatCycle = Math.floor(t / BEAT_PERIOD_SECONDS);
    const beat = beatCycle !== this.lastBeatCycle;
    this.lastBeatCycle = beatCycle;

    return { ok: true, level, bass, mid, treble, beat };
  }
}

module.exports = { SyntheticAudioSource };
