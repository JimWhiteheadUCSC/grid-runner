'use strict';

// What's on the panel: the current bank and piece, and anything drawn over it.

const fs = require('fs');
const path = require('path');
const { VfxRuntime } = require('./host/runtime/vfxRuntime');
const { parsePieceInfo } = require('./pieceInfo');
const { loadBdf, drawText, wrapText, textWidth } = require('./bdf');
const { BANK_SIZE } = require('./banks');

const W = 64;
const H = 64;
const CARD_MS = 3000; // the bank card lingers this long after the last bank change
const FLASH_MS = 1500;
const TITLE_MS = 4000;
const LEVEL_MS = 1200;
const ERROR_MS = 3000; // an error stays up this long before unattended play moves on
const IDLE_FPS = 30;

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONT_BIG = loadBdf(path.join(FONT_DIR, '5x7.bdf'));
const FONT_SMALL = loadBdf(path.join(FONT_DIR, 'tom-thumb.bdf'));

const scale = ([r, g, b], k) => [Math.round(r * k), Math.round(g * k), Math.round(b * k)];

function fillRect(frame, x0, y0, w, h, color) {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      const i = (y * W + x) * 3;
      frame[i] = color[0];
      frame[i + 1] = color[1];
      frame[i + 2] = color[2];
    }
  }
}

function dimRect(frame, y0, h, k) {
  for (let i = y0 * W * 3; i < Math.min(H, y0 + h) * W * 3; i++) frame[i] = Math.round(frame[i] * k);
}

// Title or error band along the bottom, dimming the art behind it.
function drawBand(frame, text, color) {
  const lines = wrapText(FONT_SMALL, text.toUpperCase(), W - 2).slice(0, 4);
  const h = lines.length * 6 + 2;
  dimRect(frame, H - h, h, 0.15);
  lines.forEach((line, i) => {
    const x = Math.max(1, Math.floor((W - textWidth(FONT_SMALL, line)) / 2));
    drawText(frame, W, H, FONT_SMALL, line, x, H - h + 1 + i * 6, color);
  });
}

function clampFps(fps) {
  if (!fps || typeof fps !== 'number') return 30;
  return Math.max(15, Math.min(60, fps));
}

function safeDispose(runtime) {
  try {
    runtime.dispose();
  } catch (err) {
    console.error('[player] dispose failed (continuing):', err.message);
  }
}

class Show {
  // loadBanks: () => banks. It runs again on each bank change, so packs added
  // while the player is running appear without a restart.
  // autoMinutes: move to a new piece this often, with nobody at the keyboard.
  constructor({ display, sampler, loadBanks, wallLabelDir = null, titles = false, autoMinutes = null, log = console.log }) {
    this.autoMs = autoMinutes ? autoMinutes * 60000 : 0;
    this.autoAt = 0; // when the next piece is due, so the first tick starts one
    this.deck = []; // files left to play this time round, last one next
    this.display = display;
    this.sampler = sampler;
    this.loadBanks = loadBanks;
    this.wallLabelDir = wallLabelDir;
    this.autoTitles = titles;
    this.log = log;
    this.banks = loadBanks();
    this.bankIdx = 0;
    this.current = null; // { bankIdx, key, file, title, runtime, startedAt, lastFrameAt, interval }
    this.blank = false;
    this.overlay = { kind: 'card', until: Infinity };
    this.brightness = display.brightness || 100;
    this.loadGen = 0;
    this.stopped = false;
    this.timer = null;
  }

  // ---- actions -------------------------------------------------------

  // Returns a promise when the action starts a piece.
  handleAction(action) {
    if (this.stopped) return undefined;
    // Someone's at the keyboard, so don't change the piece under them.
    if (this.autoMs) this.autoAt = Date.now() + this.autoMs;
    const [verb, arg] = action.split(':');
    switch (verb) {
      case 'piece':
        if (arg === 'next') return this.stepPiece(1);
        if (arg === 'prev') return this.stepPiece(-1);
        return this.startKey(this.bankIdx, Number(arg));
      case 'bank':
        return this.stepBank(arg === 'next' ? 1 : -1);
      case 'brightness':
        return this.setBrightness(this.brightness + (arg === 'up' ? 10 : -10));
      case 'restart':
        return this.current ? this.startKey(this.current.bankIdx, this.current.key) : undefined;
      case 'blank':
        return this.toggleBlank();
      case 'title':
        if (this.current) this.showOverlay(this.overlay && this.overlay.kind === 'title' ? null : 'title', TITLE_MS);
        return undefined;
      default:
        return undefined;
    }
  }

  toggleBlank() {
    this.blank = !this.blank;
    if (this.blank) this.loadGen++; // a piece still loading would light the panel again
    this.log(`[player] ${this.blank ? 'blank' : 'unblank'}`);
    this.overlay = !this.blank && !this.current ? { kind: 'card', until: Infinity } : null;
  }

  stepBank(dir) {
    try {
      this.banks = this.loadBanks();
    } catch (err) {
      this.log(`[player] banks unreadable, keeping the previous ones: ${err.message}`);
    }
    const n = this.banks.length;
    this.bankIdx = (((this.bankIdx + dir) % n) + n) % n;
    this.log(`[player] bank ${this.bankIdx + 1}/${n}: ${this.banks[this.bankIdx].name}`);
    this.showOverlay('card', this.current || this.blank ? CARD_MS : Infinity);
  }

  // The next or previous filled key in the current bank, counting from the
  // playing piece when it belongs to this bank.
  stepPiece(dir) {
    const bank = this.banks[this.bankIdx];
    const filled = bank.pieces.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    if (!filled.length) return undefined;
    let next = dir > 0 ? filled[0] : filled[filled.length - 1];
    if (this.current && this.current.bankIdx === this.bankIdx) {
      const pos = filled.indexOf(this.current.key);
      if (pos !== -1) next = filled[(((pos + dir) % filled.length) + filled.length) % filled.length];
    }
    return this.startKey(this.bankIdx, next);
  }

  setBrightness(value) {
    this.brightness = Math.max(10, Math.min(100, value));
    const matrix = this.display.matrix;
    if (matrix && typeof matrix.brightness === 'function') matrix.brightness(this.brightness);
    this.log(`[player] brightness ${this.brightness}`);
    if (!(this.overlay && this.overlay.kind === 'card')) this.showOverlay('level', LEVEL_MS);
  }

  showOverlay(kind, ms, extra = {}) {
    this.overlay = kind ? { kind, until: Date.now() + ms, ...extra } : null;
  }

  // ---- unattended play -----------------------------------------------

  // Starts the next piece. Banks are read again first, so packs added while the
  // player is running join in.
  advance() {
    this.autoAt = Date.now() + this.autoMs;
    try {
      this.banks = this.loadBanks();
    } catch (err) {
      this.log(`[player] banks unreadable, keeping the previous ones: ${err.message}`);
    }
    const slot = this.nextAutoPiece();
    if (!slot) return undefined;
    this.bankIdx = slot.bankIdx;
    return this.startKey(slot.bankIdx, slot.key);
  }

  // Every piece once, in a random order, then a new order. Keeping the place by
  // file means a piece that has since been removed is simply skipped.
  nextAutoPiece() {
    const slots = new Map();
    this.banks.forEach((bank, bankIdx) => {
      bank.pieces.forEach((piece, key) => {
        if (piece && !slots.has(piece.file)) slots.set(piece.file, { bankIdx, key });
      });
    });
    while (this.deck.length) {
      const slot = slots.get(this.deck.pop());
      if (slot) return slot;
    }
    if (!slots.size) return null;
    const deck = [...slots.keys()];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    // A new order shouldn't begin with the piece that's already showing.
    if (this.current && deck[deck.length - 1] === this.current.file) deck.unshift(deck.pop());
    this.deck = deck;
    return slots.get(this.deck.pop());
  }

  // ---- pieces --------------------------------------------------------

  async startKey(bankIdx, key) {
    const bank = this.banks[bankIdx];
    const piece = bank && bank.pieces[key];
    if (!piece) {
      this.log(`[player] key ${key + 1} is empty in '${bank ? bank.name : '?'}'`);
      this.showOverlay('card', this.current ? FLASH_MS : Infinity);
      return;
    }
    const gen = ++this.loadGen;
    this.log(`[player] key ${key + 1} -> ${piece.title} (${piece.file})`);
    let source;
    let runtime;
    try {
      source = fs.readFileSync(piece.file, 'utf8');
      runtime = await VfxRuntime.load(source);
    } catch (err) {
      this.log(`[player] failed to load ${piece.file}: ${err.message}`);
      if (gen === this.loadGen) {
        this.showOverlay('error', ERROR_MS, { text: `LOAD FAILED ${piece.title}` });
        this.autoAt = Date.now() + ERROR_MS; // unattended, nobody would move it on
      }
      return;
    }
    if (gen !== this.loadGen || this.stopped) {
      safeDispose(runtime);
      return;
    }
    this.disposeCurrent();
    const now = Date.now();
    this.current = {
      bankIdx,
      key,
      file: piece.file,
      title: piece.title,
      runtime,
      startedAt: now,
      lastFrameAt: now,
      interval: 1000 / clampFps(runtime.meta && runtime.meta.fps),
    };
    this.blank = false;
    this.autoAt = now + this.autoMs;
    this.overlay = this.autoTitles ? { kind: 'title', until: now + TITLE_MS } : null;
    this.writeWallLabel(source, piece.file);
  }

  disposeCurrent() {
    if (this.current && this.current.runtime) safeDispose(this.current.runtime);
    this.current = null;
  }

  // Optional: leaves the current piece's details in a file for another program
  // to display, such as a label on a second screen.
  writeWallLabel(source, file) {
    if (!this.wallLabelDir) return;
    try {
      const dest = path.join(this.wallLabelDir, 'current-piece.json');
      const tmp = `${dest}.${process.pid}.tmp`;
      const info = { ...parsePieceInfo(source, file), updatedAt: new Date().toISOString() };
      fs.writeFileSync(tmp, JSON.stringify(info, null, 2));
      fs.renameSync(tmp, dest);
    } catch (err) {
      this.log(`[player] wall label not updated: ${err.message}`);
    }
  }

  // ---- rendering -----------------------------------------------------

  start() {
    const loop = () => {
      if (this.stopped) return;
      const began = Date.now();
      this.tick();
      const interval = this.current && this.current.runtime ? this.current.interval : 1000 / IDLE_FPS;
      this.timer = setTimeout(loop, Math.max(1, interval - (Date.now() - began)));
    };
    loop();
  }

  tick() {
    const now = Date.now();
    // A blanked panel stays blank: starting a piece would light it again.
    if (this.autoMs && !this.blank && now >= this.autoAt) this.advance();
    let frame = new Uint8Array(W * H * 3);
    const cur = this.current;
    // The piece keeps running under a card, so its clock doesn't jump.
    if (cur && cur.runtime) {
      const t = (now - cur.startedAt) / 1000;
      const dt = (now - cur.lastFrameAt) / 1000;
      cur.lastFrameAt = now;
      try {
        cur.runtime.setInput(this.sampler.sample(dt));
        frame = cur.runtime.renderFrame(t, dt);
      } catch (err) {
        this.log(`[player] frame error in ${cur.file}: ${err.message}`);
        safeDispose(cur.runtime);
        cur.runtime = null;
        this.showOverlay('error', Infinity, { text: `CRASHED ${cur.title}` });
        this.autoAt = now + ERROR_MS;
      }
    }
    if (this.blank) frame.fill(0);
    if (this.overlay && now > this.overlay.until) this.overlay = null;
    if (this.overlay) this.drawOverlay(frame, this.overlay);
    if (!this.display.matrix && this.brightness < 100) {
      const k = this.brightness / 100;
      for (let i = 0; i < frame.length; i++) frame[i] = Math.round(frame[i] * k);
    }
    this.display.pushFrame(frame);
  }

  drawOverlay(frame, overlay) {
    if (overlay.kind === 'card') return this.drawCard(frame);
    if (overlay.kind === 'title' && this.current) return drawBand(frame, this.current.title, [255, 255, 255]);
    if (overlay.kind === 'error') return drawBand(frame, overlay.text, [255, 80, 60]);
    if (overlay.kind === 'level') {
      dimRect(frame, 52, 12, 0.2);
      drawText(frame, W, H, FONT_SMALL, `BRIGHT ${this.brightness}`, 2, 53, [255, 255, 255]);
      fillRect(frame, 2, 60, Math.round((60 * this.brightness) / 100), 2, [255, 200, 80]);
    }
    return undefined;
  }

  // "BANK n/N", the bank's name, and a 4x4 map of its keys: filled keys in the
  // bank's colour, and the playing piece in white.
  drawCard(frame) {
    frame.fill(0);
    const bank = this.banks[this.bankIdx];
    drawText(frame, W, H, FONT_SMALL, `BANK ${this.bankIdx + 1}/${this.banks.length}`, 1, 1, scale(bank.color, 0.6));
    wrapText(FONT_BIG, bank.name, W - 2)
      .slice(0, 4)
      .forEach((line, i) => drawText(frame, W, H, FONT_BIG, line, 1, 9 + i * 8, bank.color));
    for (let k = 0; k < BANK_SIZE; k++) {
      const x = 1 + (k % 4) * 16;
      const y = 41 + Math.floor(k / 4) * 6;
      const playing = this.current && this.current.bankIdx === this.bankIdx && this.current.key === k;
      const color = playing ? [255, 255, 255] : bank.pieces[k] ? scale(bank.color, 0.45) : [14, 14, 14];
      fillRect(frame, x, y, 14, 4, color);
    }
  }

  // Leaves the panel dark. The driver shows a frame on its next refresh, and
  // exiting before then can leave the old image lit.
  async close() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.disposeCurrent();
    try {
      this.display.pushFrame(new Uint8Array(W * H * 3));
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (err) {
      console.error('[player] could not blank the panel:', err.message);
    }
  }
}

module.exports = { Show };
