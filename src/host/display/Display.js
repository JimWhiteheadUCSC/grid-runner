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

  // Registers a handler(down: boolean) for button press/release events from
  // the display itself. No-op by default — only the sim page has one, its
  // on-screen button. The keyboard's button key works on every display.
  onButtonEvent(handler) {}

  async close() {}
}

module.exports = { Display };
