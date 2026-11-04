# Grid Runner

Got an LED panel sitting in a drawer? Grid Runner turns a Raspberry Pi and a
64×64 HUB75 panel into a small generative art player. Flip through pieces from
a keyboard, or leave it to play by itself, and add more by dropping in carts of
artwork.

It comes with four pieces. Each one is a small JavaScript program that runs in
a sandbox, so it can react to the time of day, the weather, and sound.

## What you need

- A Raspberry Pi running 64-bit Raspberry Pi OS. Grid Runner was developed on a
  Pi 4, and other models haven't been tried yet.
- A 64×64 HUB75 RGB LED panel and its power supply.
- An Adafruit RGB Matrix HAT or Bonnet, or another
  [wiring the panel driver supports](https://github.com/hzeller/rpi-rgb-led-matrix#wiring).
- A USB keyboard to choose pieces. A cheap one is fine, and you don't need one
  to let it play by itself.

Two hardware notes:

- A 64×64 panel needs the bonnet's E address line. On Adafruit boards, that
  means soldering the "E" jumper.
- Onboard audio conflicts with the panel driver. Set `dtparam=audio=off` in
  `/boot/firmware/config.txt` and reboot.

## Install

```bash
sudo apt install nodejs npm python3 build-essential   # Node 20 or newer
git clone https://github.com/JimWhiteheadUCSC/grid-runner.git
cd grid-runner
npm install                                           # builds the panel driver
```

The panel driver gives up root after it starts, and a home folder is private on
a stock install. If you installed under your home folder, let it through:

```bash
chmod o+x "$HOME"
```

## Run it

```bash
sudo node src/player.js --display matrix
```

Press `1` to start the first piece.

No panel handy? `npm start` runs a simulator at http://localhost:8080. It takes
its keys from the terminal it's running in.

While it runs on the panel, the keyboard belongs to the player and won't type
anywhere else. **Ctrl+C** quits and gives the keyboard back.

## Let it play by itself

```bash
sudo node src/player.js --display matrix --auto
```

`--auto` starts right away and moves to a new piece every 5 minutes, or as often
as you say: `--auto 10`. It plays every piece in every cart once, in a random
order, then shuffles again. Carts you add join in on the next shuffle.

It doesn't need a keyboard, but one still works if it's plugged in. A key press
holds the current piece for another full interval, and `B` blanks the panel until
you press `B` again. A piece that fails is skipped after a few seconds.

## Keys

The left side of the keyboard makes a 4×4 grid, in the same shape as the map on
the bank card:

```
 1  2  3  4
 Q  W  E  R
 A  S  D  F
 Z  X  C  V
```

| Key | Action |
|---|---|
| Grid keys | Play that piece in the current bank |
| ↑ ↓ or Page Up / Page Down | Previous / next bank |
| ← → | Previous / next piece in the bank |
| Enter | The piece's button, for pieces that have one. Some react to holding it |
| Space | Restart the piece |
| T | Show the piece's title |
| B | Blank the panel / bring it back |
| - and = | Brightness down / up |
| Ctrl+C | Quit |

Keys go by their position, so the grid keeps its shape on any keyboard layout.
In a terminal, keys go by the character typed, so the grid follows your layout,
and Enter can only tap the button. The simulator page has a button you can hold.

Wireless keyboards usually work. If yours isn't found (Bluetooth keyboards often
aren't), name it directly with `--keyboard-device /dev/input/event3`.

### Macro pads

`--keyboard pad` is for a 4×4 pad with three knobs that sends letters:

| Control | Sends | Action |
|---|---|---|
| 16 keys, row by row | a-p | Play that piece |
| Knob 1: left / press / right | q r s | Brightness down / title / brightness up |
| Knob 2: left / press / right | t u v | Previous piece / the piece's button / next piece |
| Knob 3: left / press / right | w x y | Previous bank / blank / next bank |

It looks for a device named `USB Composite Device`. For another pad, use
`--keyboard-device`, with a path from `ls /dev/input/by-id/`.

## Add artwork

Artwork lives in `carts/`. It comes as a cart, which is a folder of pieces, or a
multicart, which is a repo of several carts. Each cart becomes one or more banks
of up to 16 pieces.

```bash
cd carts
git clone <a cart's or multicart's repo>
```

Or unzip a download there. New ones appear the next time you change banks, and
they join whatever is already there.
Pieces run in a sandbox with no access to your files or network, but a cart is
still someone else's code, so get carts from people you trust.

To make your own, see [docs/CARTS.md](docs/CARTS.md).

## Start at boot

```bash
sed -e "s|__DIR__|$PWD|" -e "s|__NODE__|$(command -v node)|" systemd/grid-runner.service \
  | sudo tee /etc/systemd/system/grid-runner.service
sudo systemctl daemon-reload
sudo systemctl enable --now grid-runner
```

This starts it playing by itself with `--auto 5`. Press Ctrl+C on the keyboard,
or run `sudo systemctl stop grid-runner`, to free the panel. Change the options
on the `ExecStart` line of the installed file.

## Options

Run `node src/player.js --help` for the full list. The ones you're most likely
to need:

- `--gpio-mapping adafruit-hat-pwm` gives a much better picture if you've
  soldered the GPIO4-to-GPIO18 jumper. The default, `adafruit-hat`, needs no
  soldering. Other wirings are listed in the panel driver's documentation.
- `--gpio-slowdown 3` can help if the panel flickers or shows noise.
- `--lat 51.5 --lon -0.1` sets your location for daylight and weather. The
  default is Santa Cruz, California. Weather comes from
  [Open-Meteo](https://open-meteo.com), and pieces carry on without it offline.
- `--audio arecord --audio-device plughw:1,0` uses a USB microphone. Without
  one, pieces that listen hear a built-in test signal.
- `--banks my-banks.json` plays a hand-arranged set instead of `carts/`. See
  [docs/CARTS.md](docs/CARTS.md).

## Tests

```bash
npm test
```

## License

The code is MIT licensed: see [LICENSE](LICENSE). The four seed pieces are
[CC BY-SA 4.0](carts/seeds/README.md). Carts and the fonts carry their own
licenses.

The panel driver isn't part of this repo. `npm install` fetches and builds it,
and it is GPL-2 licensed, which matters if you distribute a built copy such as an
SD card image.

## Credits

- [rpi-rgb-led-matrix](https://github.com/hzeller/rpi-rgb-led-matrix) by Henner
  Zeller, through the
  [rpi-led-matrix](https://github.com/alexeden/rpi-led-matrix) Node bindings.
- [QuickJS](https://bellard.org/quickjs/), through
  [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten).
- Fonts in `fonts/`: `5x7.bdf` is public domain, and `tom-thumb.bdf` is MIT
  licensed (Robey Pointer).
