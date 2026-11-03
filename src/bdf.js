'use strict';

// Minimal BDF bitmap-font reader + text drawing into a 64x64 RGB frame
// (Uint8Array, row-major, 3 bytes/pixel - the Display.pushFrame layout).
// Fonts in ./fonts are copied from ../rpi-rgb-led-matrix/fonts:
// 5x7.bdf is public domain, tom-thumb.bdf is MIT (robey).

const fs = require('fs');

function loadBdf(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const font = { ascent: 0, descent: 0, glyphs: new Map() };
  let g = null;
  let bitmap = null;
  for (const raw of lines) {
    const line = raw.trim();
    const [key, ...rest] = line.split(/\s+/);
    if (bitmap) {
      if (key === 'ENDCHAR') {
        g.rows = bitmap;
        if (g.code >= 0) font.glyphs.set(g.code, g);
        g = null;
        bitmap = null;
      } else {
        bitmap.push(parseInt(line, 16));
      }
      continue;
    }
    if (key === 'FONT_ASCENT') font.ascent = +rest[0];
    else if (key === 'FONT_DESCENT') font.descent = +rest[0];
    else if (key === 'STARTCHAR') g = { code: -1, dwidth: 0, w: 0, h: 0, xoff: 0, yoff: 0 };
    else if (key === 'ENCODING' && g) g.code = +rest[0];
    else if (key === 'DWIDTH' && g) g.dwidth = +rest[0];
    else if (key === 'BBX' && g) [g.w, g.h, g.xoff, g.yoff] = rest.map(Number);
    else if (key === 'BITMAP' && g) bitmap = [];
  }
  font.height = font.ascent + font.descent;
  return font;
}

function glyphFor(font, ch) {
  return font.glyphs.get(ch.codePointAt(0)) || font.glyphs.get(63); // '?'
}

function textWidth(font, text) {
  let w = 0;
  for (const ch of text) w += glyphFor(font, ch).dwidth;
  return w;
}

function setPixel(frame, W, H, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  frame[i] = r;
  frame[i + 1] = g;
  frame[i + 2] = b;
}

// Draws `text` with its top-left at (x, y); returns the x after the text.
function drawText(frame, W, H, font, text, x, y, color) {
  const baseline = y + font.ascent;
  for (const ch of text) {
    const g = glyphFor(font, ch);
    // BDF rows are left-aligned in a byte-padded hex word.
    const bits = Math.ceil(g.w / 8) * 8;
    const top = baseline - g.yoff - g.h;
    g.rows.forEach((row, ry) => {
      for (let rx = 0; rx < g.w; rx++) {
        if (row & (1 << (bits - 1 - rx))) setPixel(frame, W, H, x + g.xoff + rx, top + ry, color);
      }
    });
    x += g.dwidth;
  }
  return x;
}

// Greedy word wrap to `maxWidth` pixels; over-long words are hard-split.
function wrapText(font, text, maxWidth) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(font, candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) out.push(line);
    line = word;
    while (textWidth(font, line) > maxWidth) {
      let n = line.length - 1;
      while (n > 1 && textWidth(font, line.slice(0, n)) > maxWidth) n--;
      out.push(line.slice(0, n));
      line = line.slice(n);
    }
  }
  if (line) out.push(line);
  return out;
}

module.exports = { loadBdf, textWidth, drawText, wrapText, setPixel };
