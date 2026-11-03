'use strict';

// HUB75 backend for the real panel via the `rpi-led-matrix` npm package
// (N-API bindings to hzeller/rpi-rgb-led-matrix). Only ever imported when
// this backend is actually selected — see host/display/index.js — so
// other machines never touch the native module. `rpi-led-matrix` is an
// optionalDependency (see package.json): its own install has no
// platform guard and hard-fails via node-gyp on non-Pi machines, so a
// plain dependency would break `npm install` elsewhere — marking it
// optional is what makes it "skip gracefully" (npm omits it from
// node_modules on install failure instead of aborting), not anything the
// package does on its own.
//
// Requires root (GPIO access) — run the daemon with `sudo` when using
// this backend, same as the confirmed-working `rpi-rgb-led-matrix` demo
// binary does.
//
// API confirmed against the installed package's dist/index.d.ts and
// native source (src/led-matrix.addon.cc) rather than guessed:
// GpioMapping.AdafruitHat/AdafruitHatPwm are real string enum values,
// and `drawBuffer(buffer, w, h)` takes exactly our Display.pushFrame
// contract (Uint8Array, width*height*3 bytes, RGB, row-major —
// `assert(len == w*h*3)` in the native source) as a single bulk write,
// so there's no need for a per-pixel setPixel loop.

const { Display } = require('./Display');

class MatrixDisplay extends Display {
  constructor({
    width = 64,
    height = 64,
    chainLength = 1,
    parallel = 1,
    // Works on an unmodified Adafruit HAT or Bonnet. `adafruit-hat-pwm`
    // looks far better, but needs a GPIO4->GPIO18 jumper soldered on.
    gpioMapping = 'adafruit-hat',
    // A Pi 4 often needs 2 or higher under continuous full-panel rendering.
    gpioSlowdown = 2,
    brightness = 100,
  } = {}) {
    super();
    this.width = width;
    this.height = height;
    this.chainLength = chainLength;
    this.parallel = parallel;
    this.gpioMapping = gpioMapping;
    this.gpioSlowdown = gpioSlowdown;
    this.brightness = brightness;
    this.matrix = null;
  }

  async init() {
    let rpiLedMatrix;
    try {
      rpiLedMatrix = require('rpi-led-matrix');
    } catch (err) {
      console.warn(
        '[MatrixDisplay] rpi-led-matrix is not available on this machine ' +
          '(expected unless you are on a Raspberry Pi with the native module built — ' +
          "it's an optionalDependency, so a normal `npm install` skips it here)."
      );
      throw err;
    }

    const { LedMatrix, GpioMapping } = rpiLedMatrix;
    // GpioMapping's enum values are already our exact hyphenated strings
    // (e.g. GpioMapping.AdafruitHat === 'adafruit-hat'), so gpioMapping
    // passes straight through as hardwareMapping — just validate it's one
    // of the real values first.
    const validMappings = Object.values(GpioMapping);
    if (!validMappings.includes(this.gpioMapping)) {
      throw new Error(
        `[MatrixDisplay] unknown gpioMapping '${this.gpioMapping}' (expected one of: ` +
          `${validMappings.join(', ')})`
      );
    }

    try {
      this.matrix = new LedMatrix(
        {
          ...LedMatrix.defaultMatrixOptions(),
          rows: this.height,
          cols: this.width,
          chainLength: this.chainLength,
          parallel: this.parallel,
          hardwareMapping: this.gpioMapping,
          brightness: this.brightness,
        },
        {
          ...LedMatrix.defaultRuntimeOptions(),
          gpioSlowdown: this.gpioSlowdown,
        }
      );
    } catch (err) {
      if (process.platform === 'linux') {
        console.error(
          '[MatrixDisplay] failed to initialize the LED matrix. If this looks like a ' +
            'permissions error, GPIO access needs root — run with sudo (same as the ' +
            'rpi-rgb-led-matrix demo binary requires).'
        );
      }
      throw err;
    }
  }

  // buffer: Uint8Array of width*height*3 RGB bytes, row-major — passed
  // straight through as a single bulk write (the native drawBuffer call
  // asserts exactly this layout), then sync() flips it to the panel.
  pushFrame(buffer) {
    if (!this.matrix) throw new Error('MatrixDisplay not initialized');
    this.matrix.drawBuffer(buffer, this.width, this.height);
    this.matrix.sync();
  }

  async close() {
    // No explicit teardown call in this library's API — the GPIO refresh
    // thread it starts internally exits with the process.
    this.matrix = null;
  }
}

module.exports = { MatrixDisplay };
