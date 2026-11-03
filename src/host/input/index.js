'use strict';

// Composes the four input groups into one sampler the daemon calls once
// per frame. Unlike host/display/index.js's Display backends, this isn't
// a single polymorphic interface — audio has a real swappable source,
// clock/env are the same real computation on every platform, and button
// is sim-only and event-driven rather than polled.

const { sampleClock } = require('./clock');
const { EnvSampler } = require('./env');
const { SyntheticAudioSource } = require('./audioSynthetic');
const { ArecordAudioSource } = require('./audioArecord');
const { ButtonState } = require('./button');

class InputSampler {
  constructor({ lat, lon, audioSource = 'synthetic', audioDevice } = {}) {
    this.lat = lat;
    this.lon = lon;
    this.audio = audioSource === 'arecord' ? new ArecordAudioSource(audioDevice) : new SyntheticAudioSource();
    this.env = new EnvSampler({ lat, lon });
    this.button = new ButtonState();
  }

  async init() {
    await Promise.all([this.audio.init ? this.audio.init() : Promise.resolve(), this.env.init()]);
  }

  handleButtonEvent(down) {
    this.button.handleEvent(down);
  }

  sample(dt) {
    return {
      audio: this.audio.sample(dt),
      button: this.button.sample(dt),
      clock: sampleClock(this.lat, this.lon),
      env: this.env.sample(),
    };
  }

  close() {
    if (this.audio.close) this.audio.close();
    this.env.close();
  }
}

function createInputSampler(config) {
  return new InputSampler(config);
}

module.exports = { createInputSampler };
