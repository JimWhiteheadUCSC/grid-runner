'use strict';

// Display backend interface. Everything the daemon knows about a screen:
// start it up, hand it a finished RGB frame, shut it down. Backends
// (SimDisplay, MatrixDisplay) implement this; the daemon never branches
// on which one it has.
class Display {
  // width, height in pixels — implementations may accept these via
  // constructor options instead, but must expose them as properties.
  async init() {
    throw new Error('Display.init() not implemented');
  }

  // buffer: Uint8Array of width*height*3 bytes, RGB, row-major.
  pushFrame(buffer) {
    throw new Error('Display.pushFrame() not implemented');
  }

  // Registers a handler(down: boolean) for button press/release events.
  // No-op by default — only backends with an actual button source (the
  // sim page's on-screen button) override this; MatrixDisplay doesn't,
  // so input.button stays at its neutral default on real hardware until
  // there's a physical button to wire up.
  onButtonEvent(handler) {}

  async close() {}
}

module.exports = { Display };
