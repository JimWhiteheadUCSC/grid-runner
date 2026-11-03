'use strict';

// Display backend selection. Only the chosen backend's module is
// required, so picking 'sim' never touches rpi-led-matrix.
function createDisplay(config = {}) {
  const kind = config.kind || 'sim';
  if (kind === 'sim') {
    const { SimDisplay } = require('./SimDisplay');
    return new SimDisplay(config);
  }
  if (kind === 'matrix') {
    const { MatrixDisplay } = require('./MatrixDisplay');
    return new MatrixDisplay(config);
  }
  throw new Error(`Unknown display kind: '${kind}' (expected 'sim' or 'matrix')`);
}

module.exports = { createDisplay };
