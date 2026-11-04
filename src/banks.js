'use strict';

// Where banks come from: every cart and multicart under a folder, or one hand-written bank
// file. A bank is up to 16 pieces, one per key.

const fs = require('fs');
const path = require('path');
const { parsePieceInfo } = require('./pieceInfo');

const BANK_SIZE = 16;
const FIRST_CART = 'seeds';
const PALETTE = [
  [255, 170, 60],
  [255, 110, 150],
  [190, 120, 255],
  [70, 150, 255],
  [80, 220, 120],
  [255, 90, 30],
  [90, 220, 220],
  [240, 220, 90],
];

function isValidColor(color) {
  return Array.isArray(color) && color.length === 3 && color.every((c) => Number.isInteger(c) && c >= 0 && c <= 255);
}

function pieceFrom(file) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes('/*@vfx')) return null;
  return { file, title: parsePieceInfo(source, file).title };
}

function readManifest(cartDir) {
  const file = path.join(cartDir, 'cart.json');
  if (!fs.existsSync(file)) return {};
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('cart.json must be an object');
  return manifest;
}

// Lists a cart's piece files. A cart comes from someone else, so a piece listed
// in its manifest must resolve to a file inside the cart.
function piecesIn(cartDir, manifest) {
  const realCart = fs.realpathSync(cartDir);
  let names;
  if (Array.isArray(manifest.pieces)) {
    names = manifest.pieces;
  } else {
    names = fs.readdirSync(cartDir).filter((f) => f.endsWith('.js') && !f.startsWith('.')).sort();
  }
  const pieces = [];
  for (const name of names) {
    if (typeof name !== 'string') throw new Error('cart.json pieces must be filenames');
    const real = fs.realpathSync(path.join(cartDir, name));
    if (!real.startsWith(realCart + path.sep)) throw new Error(`${name} is outside the cart`);
    const piece = pieceFrom(real);
    if (piece) pieces.push(piece);
  }
  return pieces;
}

function banksOf(name, color, pieces) {
  if (pieces.length <= BANK_SIZE) return [{ name, color, pieces }];
  const banks = [];
  for (let i = 0; i < pieces.length; i += BANK_SIZE) {
    const chunk = pieces.slice(i, i + BANK_SIZE);
    banks.push({ name: `${name} ${i + 1}-${i + chunk.length}`, color, pieces: chunk });
  }
  return banks;
}

function fillBank(bank) {
  return { ...bank, pieces: Array.from({ length: BANK_SIZE }, (_, i) => bank.pieces[i] || null) };
}

// A multicart is a folder of carts, played in the order its multicart.json lists
// them. Returns the cart folders' names, or null if this folder isn't a
// multicart. Like a cart's pieces, a multicart's carts must be inside it.
function cartsInMulticart(dir) {
  const file = path.join(dir, 'multicart.json');
  if (!fs.existsSync(file)) return null;
  const multicart = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!multicart || !Array.isArray(multicart.carts)) throw new Error('multicart.json must list its carts');
  const realMulticart = fs.realpathSync(dir);
  for (const name of multicart.carts) {
    if (typeof name !== 'string') throw new Error('multicart.json carts must be folder names');
    if (!fs.realpathSync(path.join(dir, name)).startsWith(realMulticart + path.sep)) throw new Error(`${name} is outside the multicart`);
  }
  return multicart.carts;
}

// One broken cart shouldn't take the others down with it, so its problem is
// reported and the scan carries on.
function scanCarts(cartsDir, log = console.log) {
  const dirs = fs
    .readdirSync(cartsDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && fs.statSync(path.join(cartsDir, e.name)).isDirectory())
    .map((e) => e.name)
    .sort((a, b) => (a === FIRST_CART ? -1 : b === FIRST_CART ? 1 : a.localeCompare(b)));
  const carts = [];
  for (const dir of dirs) {
    try {
      const inMulticart = cartsInMulticart(path.join(cartsDir, dir));
      carts.push(...(inMulticart ? inMulticart.map((name) => path.join(dir, name)) : [dir]));
    } catch (err) {
      log(`[player] skipping multicart '${dir}': ${err.message}`);
    }
  }
  const banks = [];
  carts.forEach((dir, i) => {
    const cartDir = path.join(cartsDir, dir);
    try {
      const manifest = readManifest(cartDir);
      const name = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name : path.basename(dir);
      const color = isValidColor(manifest.color) ? manifest.color : PALETTE[i % PALETTE.length];
      const pieces = piecesIn(cartDir, manifest);
      if (pieces.length) banks.push(...banksOf(name, color, pieces));
      else log(`[player] cart '${dir}' has no pieces`);
    } catch (err) {
      log(`[player] skipping cart '${dir}': ${err.message}`);
    }
  });
  if (!banks.length) throw new Error(`no pieces found in ${cartsDir}`);
  return banks.map(fillBank);
}

// A hand-written playlist: { "banks": [ { "name", "color": [r,g,b], "pieces":
// [ { "file", "title" } | "file" | null, ... ] } ] }. Paths are relative to the
// bank file, and an entry's position is its key, so null leaves a key empty.
function loadBankFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const banks = Array.isArray(raw) ? raw : raw.banks;
  if (!Array.isArray(banks) || banks.length === 0) throw new Error(`${file}: no banks`);
  const dir = path.dirname(file);
  return banks.map((b, i) => ({
    name: String(b.name || `Bank ${i + 1}`),
    color: isValidColor(b.color) ? b.color : [255, 255, 255],
    pieces: Array.from({ length: BANK_SIZE }, (_, k) => {
      const p = (b.pieces || [])[k];
      if (!p) return null;
      const pieceFile = path.resolve(dir, typeof p === 'string' ? p : p.file);
      return { file: pieceFile, title: (typeof p === 'object' && p.title) || path.basename(pieceFile, '.js') };
    }),
  }));
}

module.exports = { BANK_SIZE, scanCarts, loadBankFile };
