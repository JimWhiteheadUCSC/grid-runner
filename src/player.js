#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { createDisplay } = require('./host/display');
const { createInputSampler } = require('./host/input');
const { Show } = require('./show');
const { scanPacks, loadBankFile } = require('./banks');
const { KEY_NAMES, LAYOUTS, DEFAULT_DEVICES, parseTerminal } = require('./keys');

const PACKS_DIR = path.join(__dirname, '..', 'packs');
const DEFAULT_AUTO_MINUTES = 5;

const USAGE = `Plays generative art on a 64x64 LED panel, chosen from the keyboard.

  node src/player.js                     simulator, at http://localhost:8080
  sudo node src/player.js --display matrix    the real panel

Options:
  --auto [minutes]             play by itself, moving to a new piece this often
                               (default ${DEFAULT_AUTO_MINUTES}); keys still work
  --keyboard qwerty|pad|none   key layout (default qwerty; see README)
  --keyboard-device <globs>    input devices to read, comma-separated
  --packs <dir>                folder of packs (default: packs/)
  --banks <file>               play a hand-written bank file instead of packs
  --titles                     show each piece's title when it starts
  --brightness 10-100          starting brightness (default 100)
  --gpio-mapping <name>        panel wiring (default adafruit-hat; use
                               adafruit-hat-pwm with the GPIO4-GPIO18 jumper)
  --gpio-slowdown <n>          raise if the panel flickers (default 2)
  --port <n>                   simulator port (default 8080)
  --lat <deg> --lon <deg>      location for daylight and weather inputs
  --audio synthetic|arecord    audio input for pieces (default synthetic)
  --audio-device <name>        ALSA device for arecord, such as plughw:3,0
  --wall-label <dir>           write the current piece's details to this folder`;

function parseArgs(argv) {
  const opts = {
    keyboard: 'qwerty',
    keyboardDevice: null,
    packs: PACKS_DIR,
    banks: null,
    display: 'sim',
    port: 8080,
    lat: 36.97,
    lon: -122.03,
    audio: 'synthetic',
    audioDevice: undefined,
    gpioMapping: 'adafruit-hat',
    gpioSlowdown: 2,
    brightness: 100,
    wallLabel: null,
    titles: false,
    auto: null,
    help: false,
  };
  const numeric = new Set(['port', 'lat', 'lon', 'gpioSlowdown', 'brightness', 'auto']);
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--auto' && (argv[i + 1] === undefined || argv[i + 1].startsWith('--'))) {
      opts.auto = DEFAULT_AUTO_MINUTES;
      continue;
    }
    if (flag === '--titles') {
      opts.titles = true;
      continue;
    }
    if (flag === '--help' || flag === '-h') {
      opts.help = true;
      continue;
    }
    const key = flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!flag.startsWith('--') || !(key in opts) || argv[i + 1] === undefined) {
      throw new Error(`bad argument ${flag} (see --help)`);
    }
    const value = argv[++i];
    opts[key] = numeric.has(key) ? Number(value) : value;
    if (numeric.has(key) && !Number.isFinite(opts[key])) throw new Error(`${flag} needs a number`);
  }
  if (opts.keyboard !== 'none' && !LAYOUTS[opts.keyboard]) {
    throw new Error(`--keyboard must be one of: ${[...Object.keys(LAYOUTS), 'none'].join(', ')}`);
  }
  if (opts.auto !== null && opts.auto <= 0) throw new Error('--auto needs a number of minutes above 0');
  return opts;
}

function startKeyReader(devices, onKeyName, onQuit) {
  let child = null;
  let closing = false;
  const launch = () => {
    child = spawn('python3', [path.join(__dirname, 'keyreader.py'), devices], { stdio: ['pipe', 'pipe', 'inherit'] });
    child.on('error', (err) => console.error(`[keyboard] could not start the reader: ${err.message}`));
    child.stdin.on('error', () => {}); // the reader may already have gone
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.startsWith('#')) console.log(`[keyboard] ${line.slice(1).trim()}`);
      else if (line === 'quit') onQuit();
      else if (line.startsWith('key ')) {
        const name = KEY_NAMES[line.slice(4)];
        if (name) onKeyName(name);
      }
    });
    child.on('exit', (code) => {
      if (closing) return;
      console.error(`[keyboard] reader exited (${code}); restarting`);
      setTimeout(launch, 1000);
    });
  };
  launch();
  // Closing the pipe stops the reader. A signal can't: it runs as root, and the
  // player no longer does once the panel has started.
  return () => {
    closing = true;
    if (child) child.stdin.end();
  };
}

function startTerminal(onKeyName, onQuit) {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    for (const name of parseTerminal(chunk)) {
      if (name === 'quit') onQuit();
      else onKeyName(name);
    }
  });
}

// The panel driver gives up root once the panel starts, and pieces, fonts and
// the sandbox are read after that. A home folder is private on a stock install,
// which would otherwise surface as every piece failing to load.
function checkStillReadable(paths) {
  for (const p of paths) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
    } catch (err) {
      if (err.code !== 'EACCES') continue; // a wrong path gets its own error later
      throw new Error(
        `can't read ${p} after the panel driver gave up root. Let other users into this folder ` +
          `(on a stock install: chmod o+x "$HOME"), or install under /opt.`
      );
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  let show = null;
  let shutdown = () => {};
  const queued = [];
  const layout = LAYOUTS[opts.keyboard] || {};
  const onKeyName = (name) => {
    const action = layout[name];
    if (!action) return;
    if (show) show.handleAction(action);
    else queued.push(action);
  };
  const onQuit = () => shutdown();

  // The keyboard reader and audio sampler start first: the panel driver gives
  // up root as it starts, and child processes started before then keep it.
  // The simulator uses the terminal unless told otherwise. Reading devices
  // would grab the keyboard away from the desktop it's being run on.
  const readDevices = opts.keyboard !== 'none' && (opts.display === 'matrix' || opts.keyboardDevice);
  const stopKeys = readDevices
    ? startKeyReader(opts.keyboardDevice || DEFAULT_DEVICES[opts.keyboard], onKeyName, onQuit)
    : () => {};
  const sampler = createInputSampler({ lat: opts.lat, lon: opts.lon, audioSource: opts.audio, audioDevice: opts.audioDevice });
  // The first weather fetch must not hold the panel dark on an offline Pi. The
  // sampler keeps neutral values and tries again on its own schedule.
  await Promise.race([sampler.init(), new Promise((resolve) => setTimeout(resolve, 5000))]);

  const display = createDisplay({
    kind: opts.display,
    width: 64,
    height: 64,
    port: opts.port,
    gpioMapping: opts.gpioMapping,
    gpioSlowdown: opts.gpioSlowdown,
    brightness: opts.brightness,
  });
  await display.init();
  display.onButtonEvent((down) => sampler.handleButtonEvent(down));

  checkStillReadable([
    opts.banks || opts.packs,
    require.resolve('quickjs-emscripten'),
  ]);

  const loadBanks = opts.banks ? () => loadBankFile(path.resolve(opts.banks)) : () => scanPacks(opts.packs);
  show = new Show({ display, sampler, loadBanks, wallLabelDir: opts.wallLabel, titles: opts.titles, autoMinutes: opts.auto });
  const auto = opts.auto ? `; new piece every ${opts.auto} min` : '';
  console.log(`[player] ${show.banks.length} bank(s); display ${opts.display}; keyboard ${opts.keyboard}${auto}`);
  startTerminal(onKeyName, onQuit);
  show.start();
  queued.forEach((action) => show.handleAction(action));

  let closing = false;
  shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log('\n[player] shutting down');
    await show.close();
    stopKeys();
    sampler.close();
    await display.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[player] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs };
