'use strict';

// Real-time clock sampling for input.clock (docs/VFX_API.md: "Always
// available"). Daylight comes from suncalc's solar altitude rather than
// sunrise/sunset times directly, so it varies smoothly through twilight
// instead of stepping.

const SunCalc = require('suncalc');

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(lo, hi, v) {
  const x = clamp((v - lo) / (hi - lo), 0, 1);
  return x * x * (3 - 2 * x);
}

function dayOfYear(date) {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const now = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((now - start) / 86400000) + 1;
}

// Twilight band (degrees of solar altitude) over which daylight ramps
// 0..1: below -6 (civil twilight end) is night, above 10 is full day.
const TWILIGHT_LOW = -6;
const TWILIGHT_HIGH = 10;

function sampleClock(lat, lon, date = new Date()) {
  const { altitude } = SunCalc.getPosition(date, lat, lon); // degrees (this suncalc build)
  const daylight = smoothstep(TWILIGHT_LOW, TWILIGHT_HIGH, altitude);

  return {
    hour: date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600,
    minute: date.getMinutes(),
    weekday: (date.getDay() + 6) % 7, // JS: Sunday=0..Saturday=6 -> Monday=0..Sunday=6
    dayOfYear: dayOfYear(date),
    daylight,
  };
}

module.exports = { sampleClock };
