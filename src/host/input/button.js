'use strict';

// Tracks input.button state from asynchronous press/release events (the
// sim page's on-screen button, delivered over WebSocket independent of
// the frame loop). handleEvent() just records what happened; sample(dt)
// consumes it into one-frame edge flags the next time the daemon asks,
// so a press between frames is never missed or double-counted.

class ButtonState {
  constructor() {
    this.down = false;
    this.heldSeconds = 0;
    this.pendingPressed = false;
    this.pendingReleased = false;
  }

  handleEvent(down) {
    if (down && !this.down) this.pendingPressed = true;
    if (!down && this.down) this.pendingReleased = true;
    this.down = down;
  }

  sample(dt) {
    const pressed = this.pendingPressed;
    const released = this.pendingReleased;
    this.pendingPressed = false;
    this.pendingReleased = false;

    this.heldSeconds = this.down ? this.heldSeconds + dt : 0;

    return { down: this.down, pressed, released, heldSeconds: this.heldSeconds };
  }
}

module.exports = { ButtonState };
