'use strict';

// Keyboard layouts. Linux key codes become key names, and a layout turns key
// names into player actions. Codes are physical positions, so the 4x4 grid
// keeps its shape on AZERTY, Dvorak and other layouts.

const KEY_NAMES = {
  2: '1', 3: '2', 4: '3', 5: '4', 12: '-', 13: '=',
  16: 'q', 17: 'w', 18: 'e', 19: 'r', 20: 't', 21: 'y', 22: 'u', 23: 'i', 24: 'o', 25: 'p',
  28: 'enter',
  30: 'a', 31: 's', 32: 'd', 33: 'f', 34: 'g', 35: 'h', 36: 'j', 37: 'k', 38: 'l',
  44: 'z', 45: 'x', 46: 'c', 47: 'v', 48: 'b', 49: 'n', 50: 'm',
  57: 'space', 74: '-', 78: '=', 96: 'enter',
  103: 'up', 104: 'pageup', 105: 'left', 106: 'right', 108: 'down', 109: 'pagedown',
};

function gridActions(keys) {
  return Object.fromEntries([...keys].map((key, i) => [key, `piece:${i}`]));
}

const LAYOUTS = {
  // The left side of a keyboard already has a 4x4 block, in the same shape as
  // the grid on the bank card:  1 2 3 4 / q w e r / a s d f / z x c v
  qwerty: {
    ...gridActions('1234qwerasdfzxcv'),
    up: 'bank:prev',
    pageup: 'bank:prev',
    down: 'bank:next',
    pagedown: 'bank:next',
    left: 'piece:prev',
    right: 'piece:next',
    space: 'restart',
    enter: 'restart',
    b: 'blank',
    t: 'title',
    '-': 'brightness:down',
    '=': 'brightness:up',
  },
  // A 4x4 + 3-knob macro pad: keys send a-p row by row, and each knob sends
  // three letters (turn left, press, turn right).
  pad: {
    ...gridActions('abcdefghijklmnop'),
    q: 'brightness:down',
    r: 'title',
    s: 'brightness:up',
    t: 'piece:prev',
    u: 'restart',
    v: 'piece:next',
    w: 'bank:prev',
    x: 'blank',
    y: 'bank:next',
  },
};

const DEFAULT_DEVICES = {
  qwerty: '/dev/input/by-id/*-event-kbd,/dev/input/by-path/*-event-kbd',
  pad: '/dev/input/by-id/*USB_Composite_Device*-event-kbd',
};

const TERMINAL_SEQUENCES = {
  '\x1b[A': 'up',
  '\x1bOA': 'up',
  '\x1b[B': 'down',
  '\x1bOB': 'down',
  '\x1b[C': 'right',
  '\x1bOC': 'right',
  '\x1b[D': 'left',
  '\x1bOD': 'left',
  '\x1b[5~': 'pageup',
  '\x1b[6~': 'pagedown',
};
const TERMINAL_CHARS = { ' ': 'space', '\r': 'enter', '\n': 'enter', '+': '=', _: '-', '\x03': 'quit' };

// Splits a chunk of terminal input into key names.
function parseTerminal(chunk) {
  const names = [];
  for (const match of chunk.matchAll(/\x1b(?:\[[0-9;]*[A-Za-z~]|O[A-Za-z])?|[\s\S]/g)) {
    const token = match[0];
    if (token.startsWith('\x1b')) {
      if (TERMINAL_SEQUENCES[token]) names.push(TERMINAL_SEQUENCES[token]);
    } else {
      names.push(TERMINAL_CHARS[token] || token.toLowerCase());
    }
  }
  return names;
}

module.exports = { KEY_NAMES, LAYOUTS, DEFAULT_DEVICES, parseTerminal };
