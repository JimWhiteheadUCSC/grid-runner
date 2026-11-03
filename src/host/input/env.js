'use strict';

// Weather sampling for input.env via Open-Meteo (free, no API key). Polls
// on its own interval rather than per-frame — network I/O has no place in
// the render loop — and caches the last result. docs/VFX_API.md: "ok is
// false if the last fetch failed (values then hold neutral defaults)".

const REFRESH_MS = 15 * 60 * 1000;
// Precipitation (mm, over Open-Meteo's ~15-minute current-interval) above
// which we treat rain as maxed out. Not a meteorological standard, just a
// simple linear mapping into 0..1.
const RAIN_MM_FOR_FULL = 2;

const NEUTRAL = { ok: false, tempC: 20, cloud: 0, rain: 0 };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

class EnvSampler {
  constructor({ lat, lon, refreshMs = REFRESH_MS } = {}) {
    this.lat = lat;
    this.lon = lon;
    this.refreshMs = refreshMs;
    this.cached = NEUTRAL;
    this.timer = null;
  }

  async _fetch() {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.lat}&longitude=${this.lon}&current=temperature_2m,cloud_cover,precipitation`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const current = data.current;
      this.cached = {
        ok: true,
        tempC: current.temperature_2m,
        cloud: clamp(current.cloud_cover / 100, 0, 1),
        rain: clamp(current.precipitation / RAIN_MM_FOR_FULL, 0, 1),
      };
    } catch (err) {
      console.warn('[EnvSampler] weather fetch failed:', err.message);
      this.cached = NEUTRAL;
    }
  }

  async init() {
    await this._fetch();
    this.timer = setInterval(() => this._fetch(), this.refreshMs);
    if (this.timer.unref) this.timer.unref();
  }

  sample() {
    return this.cached;
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { EnvSampler };
