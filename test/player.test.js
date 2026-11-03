'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const readline = require('readline');
const { scanPacks, loadBankFile } = require('../src/banks');
const { KEY_NAMES, LAYOUTS, parseTerminal } = require('../src/keys');
const { parseArgs } = require('../src/player');
const { Show } = require('../src/show');

const ROOT = path.join(__dirname, '..');
const PACKS = path.join(ROOT, 'packs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'player-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const quiet = () => {};
const piece = (title) => `/*@vfx\nid: 00000000-0000-4000-8000-000000000000\ntitle: ${title}\n@vfx*/\nfunction pixel(x, y, t) { return 0; }\n`;

function makePack(name, files, manifest) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  if (manifest) fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest));
  return dir;
}

function fakeShow(banks = scanPacks(PACKS, quiet)) {
  const frames = [];
  const sampler = { sample: () => ({}) };
  const display = { brightness: 100, pushFrame: (f) => frames.push(Uint8Array.from(f)) };
  return { show: new Show({ display, sampler, loadBanks: () => banks, log: quiet }), frames };
}

test('the player ships with exactly the four seed pieces', () => {
  const banks = scanPacks(PACKS, quiet);
  assert.strictEqual(banks.length, 1);
  assert.deepStrictEqual(banks[0].pieces.filter(Boolean).map((p) => p.title), ['Fireflies', 'Koi Pond', 'Plasma Bloom', 'Tide Pool Lantern']);
  assert.strictEqual(banks[0].pieces.length, 16);
});

test('every piece in a bank plays and draws something', async () => {
  const { show, frames } = fakeShow();
  for (let key = 0; key < 4; key++) {
    await show.handleAction(`piece:${key}`);
    assert.strictEqual(show.current.key, key);
    frames.length = 0;
    for (let i = 0; i < 40; i++) show.tick();
    assert.ok(frames.some((f) => f.some((v) => v > 0)), `key ${key} stayed dark`);
  }
  await show.close();
});

test('a qwerty layout covers the grid, the banks and the controls', () => {
  const { qwerty } = LAYOUTS;
  assert.deepStrictEqual(
    [...'1234qwerasdfzxcv'].map((k) => qwerty[k]),
    Array.from({ length: 16 }, (_, i) => `piece:${i}`)
  );
  for (const [key, action] of Object.entries({ up: 'bank:prev', pageup: 'bank:prev', down: 'bank:next', pagedown: 'bank:next', left: 'piece:prev', right: 'piece:next', space: 'restart', b: 'blank', t: 'title', '-': 'brightness:down', '=': 'brightness:up' })) {
    assert.strictEqual(qwerty[key], action, key);
  }
});

test('the pad layout matches the macro pad', () => {
  const { pad } = LAYOUTS;
  assert.deepStrictEqual([...'abcdefghijklmnop'].map((k) => pad[k]), Array.from({ length: 16 }, (_, i) => `piece:${i}`));
  assert.deepStrictEqual(['w', 'y', 'x', 't', 'v', 'u', 'q', 's', 'r'].map((k) => pad[k]), ['bank:prev', 'bank:next', 'blank', 'piece:prev', 'piece:next', 'restart', 'brightness:down', 'brightness:up', 'title']);
});

test('every key a layout uses has a Linux key code', () => {
  const known = new Set(Object.values(KEY_NAMES));
  for (const layout of Object.values(LAYOUTS)) {
    for (const name of Object.keys(layout)) assert.ok(known.has(name), name);
  }
});

test('terminal input becomes key names', () => {
  assert.deepStrictEqual(parseTerminal('1Q\x1b[A\x1b[B\x1b[C\x1bOD\x1b[5~\x1b[6~ \r+\x03\x1b[Z\x1b'), ['1', 'q', 'up', 'down', 'right', 'left', 'pageup', 'pagedown', 'space', 'enter', '=', 'quit']);
});

test('the default panel mapping works without a hardware jumper', () => {
  assert.strictEqual(parseArgs(['node', 'player']).gpioMapping, 'adafruit-hat');
  assert.throws(() => parseArgs(['node', 'player', '--keyboard', 'dvorak']), /--keyboard/);
  assert.throws(() => parseArgs(['node', 'player', '--nope', '1']), /bad argument/);
});

test('packs: order, colours, bank splitting, and what counts as a piece', () => {
  const dir = path.join(tmp, 'many');
  const files = { 'not-a-piece.js': 'module.exports = 1;\n', '.attempt-1.js': piece('Hidden') };
  for (let i = 0; i < 20; i++) files[`p${String(i).padStart(2, '0')}.js`] = piece(`P${i}`);
  makePack('many/zebra', files, { name: 'Zebra', color: [1, 2, 3] });
  makePack('many/alpha', { 'a.js': piece('A') });
  makePack('many/seeds', { 's.js': piece('S') });
  fs.mkdirSync(path.join(dir, '.git'));

  const banks = scanPacks(dir, quiet);
  assert.deepStrictEqual(banks.map((b) => b.name), ['seeds', 'alpha', 'Zebra 1-16', 'Zebra 17-20']);
  assert.deepStrictEqual(banks[2].color, [1, 2, 3]);
  assert.strictEqual(banks[2].pieces.filter(Boolean).length, 16);
  assert.strictEqual(banks[3].pieces.filter(Boolean).length, 4);
});

test('a pack cannot reach outside itself, and a broken pack spares the others', () => {
  const dir = path.join(tmp, 'hostile');
  fs.writeFileSync(path.join(tmp, 'secret.js'), piece('Secret'));
  makePack('hostile/traversal', { 'ok.js': piece('OK') }, { pieces: ['ok.js', '../../secret.js'] });
  makePack('hostile/link', {});
  fs.symlinkSync(path.join(tmp, 'secret.js'), path.join(dir, 'link', 'link.js'));
  makePack('hostile/broken', { 'pack.json': '{ nope' });
  makePack('hostile/good', { 'good.js': piece('Good') });

  const messages = [];
  const banks = scanPacks(dir, (m) => messages.push(m));
  assert.deepStrictEqual(banks.map((b) => b.name), ['good']);
  assert.strictEqual(messages.filter((m) => m.includes('skipping pack')).length, 3);
});

test('no pieces at all is a clear error', () => {
  fs.mkdirSync(path.join(tmp, 'empty'));
  assert.throws(() => scanPacks(path.join(tmp, 'empty'), quiet), /no pieces found/);
});

test('a bank file keeps its keys in place', () => {
  const dir = makePack('bankfile', { 'x.js': piece('X') });
  const file = path.join(dir, 'banks.json');
  fs.writeFileSync(file, JSON.stringify({ banks: [{ name: 'Mine', pieces: [null, { file: 'x.js', title: 'Ex' }, 'x.js'] }] }));
  const [bank] = loadBankFile(file);
  assert.strictEqual(bank.pieces[0], null);
  assert.strictEqual(bank.pieces[1].title, 'Ex');
  assert.strictEqual(bank.pieces[2].file, path.join(dir, 'x.js'));
});

test('stepping survives banks changing underneath the show', async () => {
  const banks = scanPacks(PACKS, quiet);
  const two = [...banks, { ...banks[0], name: 'Other' }];
  let current = two;
  const display = { brightness: 100, pushFrame: quiet };
  const show = new Show({ display, sampler: { sample: () => ({}) }, loadBanks: () => current, log: quiet });
  show.handleAction('bank:next');
  assert.strictEqual(show.bankIdx, 1);
  current = banks;
  show.handleAction('bank:next');
  assert.strictEqual(show.bankIdx, 0);
  show.handleAction('bank:prev');
  assert.strictEqual(show.bankIdx, 0);
  await show.handleAction('piece:next');
  assert.strictEqual(show.current.key, 0);
  await show.handleAction('piece:prev');
  assert.strictEqual(show.current.key, 3);
  await show.close();
});

function autoShow(banks = scanPacks(PACKS, quiet)) {
  const display = { brightness: 100, pushFrame: quiet };
  return new Show({ display, sampler: { sample: () => ({}) }, loadBanks: () => banks, autoMinutes: 5, log: quiet });
}

const settled = async (done) => {
  const deadline = Date.now() + 10000;
  while (!done()) {
    assert.ok(Date.now() < deadline, 'timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test('--auto takes minutes, or a default', () => {
  const auto = (...args) => parseArgs(['node', 'player', ...args]).auto;
  assert.strictEqual(auto(), null);
  assert.strictEqual(auto('--auto'), 5);
  assert.strictEqual(auto('--auto', '--titles'), 5);
  assert.strictEqual(auto('--auto', '0.5'), 0.5);
  assert.throws(() => auto('--auto', '0'), /--auto/);
  assert.throws(() => auto('--auto', 'soon'), /--auto/);
});

test('unattended play starts by itself and plays everything before repeating', async () => {
  const show = autoShow();
  show.tick();
  await settled(() => show.current);
  const seen = [show.current.title];
  for (let i = 0; i < 3; i++) {
    await show.advance();
    seen.push(show.current.title);
  }
  assert.deepStrictEqual([...seen].sort(), ['Fireflies', 'Koi Pond', 'Plasma Bloom', 'Tide Pool Lantern']);
  assert.ok(show.autoAt > Date.now() + 4 * 60000, 'the next change should be minutes away');
  await show.close();
});

test('a new order never repeats the piece already showing', () => {
  const show = autoShow();
  const bank = show.banks[0];
  for (let round = 0; round < 200; round++) {
    show.deck = [];
    const last = bank.pieces[round % 4];
    show.current = { file: last.file };
    assert.notStrictEqual(bank.pieces[show.nextAutoPiece().key].file, last.file);
  }
  show.current = null;
});

test('unattended play finds new packs and skips removed pieces', () => {
  const seeds = scanPacks(PACKS, quiet);
  let current = seeds;
  const display = { brightness: 100, pushFrame: quiet };
  const show = new Show({ display, sampler: { sample: () => ({}) }, loadBanks: () => current, autoMinutes: 5, log: quiet });

  show.deck = ['/gone/a.js', seeds[0].pieces[2].file, '/gone/b.js'];
  assert.strictEqual(show.nextAutoPiece().key, 2, 'the removed piece was not skipped');

  // Once the deck runs out, the next order includes the pack added meanwhile.
  const added = { file: '/new/piece.js', title: 'New' };
  current = [...seeds, { name: 'New', color: [1, 1, 1], pieces: [added] }];
  show.banks = current;
  show.deck = [];
  const files = [];
  for (let i = 0; i < 5; i++) {
    const slot = show.nextAutoPiece();
    files.push(show.banks[slot.bankIdx].pieces[slot.key].file);
  }
  assert.ok(files.includes(added.file));
  assert.strictEqual(new Set(files).size, 5);
});

test('a blanked panel stays blank, and coming back gives a full interval', async () => {
  const show = autoShow();
  await show.advance();
  const { file } = show.current;
  show.handleAction('blank');
  show.autoAt = 0;
  show.tick();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.strictEqual(show.blank, true);
  assert.strictEqual(show.current.file, file);
  show.handleAction('blank');
  show.tick();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.strictEqual(show.current.file, file);
  await show.close();
});

test('blanking cancels a piece that is still loading', async () => {
  const show = autoShow();
  const loading = show.advance();
  show.handleAction('blank');
  await loading;
  assert.strictEqual(show.blank, true);
  assert.strictEqual(show.current, null);
  await show.close();
});

test('a key press holds the piece for another interval', async () => {
  const show = autoShow();
  await show.advance();
  const { file } = show.current;
  show.autoAt = 0;
  show.handleAction('title');
  show.tick();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.strictEqual(show.current.file, file);
  await show.close();
});

test('unattended play moves on soon after a piece crashes or will not load', async () => {
  const bad = path.join(tmp, 'bad-piece.js');
  fs.writeFileSync(bad, piece('Bad').replace('function pixel', 'this is not javascript; function pixel'));
  const show = autoShow([{ name: 'B', color: [1, 1, 1], pieces: [{ file: bad, title: 'Bad' }] }]);
  await show.advance();
  assert.strictEqual(show.current, null);
  assert.ok(show.autoAt < Date.now() + 10000, 'a failed load should retry within seconds');
  await show.close();

  const running = autoShow();
  await running.advance();
  const { file } = running.current;
  running.current.runtime.dispose();
  running.current.runtime = { setInput() { throw new Error('boom'); }, dispose() {} };
  running.tick();
  assert.strictEqual(running.overlay.kind, 'error');
  assert.ok(running.autoAt < Date.now() + 10000, 'a crash should move on within seconds');
  running.autoAt = 0;
  running.tick();
  await settled(() => running.current.file !== file);
  await running.close();
});

test('the whole player plays by itself with no keyboard', async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'src/player.js'), '--port', '18098', '--keyboard', 'none', '--auto', '0.01'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  await settled(() => (output.match(/ -> /g) || []).length >= 3);
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  assert.deepStrictEqual(await exited, { code: 0, signal: null }, output);
  assert.match(output, /new piece every 0\.01 min/);
});

test('closing leaves the panel dark', async () => {
  const { show, frames } = fakeShow();
  await show.handleAction('piece:0');
  show.tick();
  await show.close();
  assert.ok(frames[frames.length - 1].every((v) => v === 0));
});

test('the whole player runs in the simulator and shuts down cleanly', async () => {
  const fifo = path.join(tmp, 'player-kbd');
  execFileSync('mkfifo', [fifo]);
  const child = spawn(process.execPath, [path.join(ROOT, 'src/player.js'), '--port', '18097', '--keyboard-device', fifo], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const until = async (text) => {
    const deadline = Date.now() + 30000;
    while (!output.includes(text)) {
      assert.ok(Date.now() < deadline, `no "${text}" in:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const press = (fd, code) => {
    const b = Buffer.alloc(24);
    b.writeUInt16LE(1, 16);
    b.writeUInt16LE(code, 18);
    b.writeInt32LE(1, 20);
    fs.writeSync(fd, b);
  };

  await until('keyboard ready');
  await until('1 bank(s)');
  const fd = fs.openSync(fifo, 'r+');
  press(fd, 3); // the '2' key
  await until('Koi Pond');
  press(fd, 106); // right arrow
  await until('Plasma Bloom');
  press(fd, 108); // down arrow, which wraps round the one bank
  await until('bank 1/1');

  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  assert.deepStrictEqual(await exited, { code: 0, signal: null }, output);
  assert.doesNotMatch(output, /Error|EPERM/);
  assert.match(output, /shutting down/);
  fs.closeSync(fd);
  const reader = spawnSync('pgrep', ['-f', `keyreader.py ${fifo}`]);
  assert.strictEqual(reader.status, 1, 'the key reader outlived the player');
});

// The real reader against a FIFO that stands in for a keyboard.
test('the key reader reports presses and quits when its pipe closes', async () => {
  const fifo = path.join(tmp, 'fake-kbd');
  execFileSync('mkfifo', [fifo]);
  const child = spawn('python3', [path.join(ROOT, 'src/keyreader.py'), fifo], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  const waiters = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    lines.push(line);
    waiters.splice(0).forEach((w) => w());
  });
  const until = async (done) => {
    const deadline = Date.now() + 10000;
    while (!done()) {
      assert.ok(Date.now() < deadline, `timed out; saw ${JSON.stringify(lines)}`);
      await new Promise((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  };

  const event = (type, code, value) => {
    const b = Buffer.alloc(24);
    b.writeUInt16LE(type, 16);
    b.writeUInt16LE(code, 18);
    b.writeInt32LE(value, 20);
    return b;
  };
  await until(() => lines.some((l) => l.includes('keyboard ready')));
  const fd = fs.openSync(fifo, 'r+');
  fs.writeSync(
    fd,
    Buffer.concat([
      event(1, 2, 1), // '1' down
      event(1, 2, 2), // auto-repeat, ignored
      event(1, 2, 0), // up, ignored
      event(0, 0, 0), // not a key, ignored
      event(1, 103, 1), // up arrow
      event(1, 46, 1), // plain c
      event(1, 29, 1), // ctrl down
      event(1, 46, 1), // ctrl+c
      event(1, 29, 0),
    ])
  );
  await until(() => lines.includes('quit'));
  assert.deepStrictEqual(lines.filter((l) => !l.startsWith('#')), ['key 2', 'key 103', 'key 46', 'quit']);

  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.stdin.end();
  assert.strictEqual(await exited, 0);
  fs.closeSync(fd);
});
