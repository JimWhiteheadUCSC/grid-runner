#!/usr/bin/env python3
"""Keyboard reader for player.js.

Reads key presses from Linux input devices and prints one line per press:

    key <code>    a Linux key code
    quit          Ctrl+C was pressed on a grabbed keyboard
    # <message>   a status message

Each keyboard is grabbed exclusively, so presses don't also type into a login
prompt or desktop. Keyboards can come and go while it runs. It exits when
stdin closes, which is how the player stops it: the player gives up root when
the panel starts, and can no longer signal this process.

This is Python because the grab is an ioctl, which Node can't issue without a
native module. The player starts it before giving up root, so it keeps access
to the devices.

usage: keyreader.py <glob>[,<glob>...]
"""
import fcntl
import glob
import os
import select
import struct
import sys

EVIOCGRAB = 0x40044590  # _IOW('E', 0x90, int)
EV_KEY = 1
KEY_DOWN = 1
KEY_C = 46
CTRL_KEYS = {29, 97}
FORMAT = 'llHHi'  # struct input_event on 64-bit Linux
EVENT_SIZE = struct.calcsize(FORMAT)
RESCAN_SECONDS = 1


def say(message):
    sys.stdout.write(message + '\n')
    sys.stdout.flush()


def die_with_parent():
    """A leftover reader would keep its grab and starve the next one."""
    try:
        import ctypes
        import signal
        PR_SET_PDEATHSIG = 1
        ctypes.CDLL('libc.so.6', use_errno=True).prctl(PR_SET_PDEATHSIG, signal.SIGTERM)
    except Exception:
        pass
    if os.getppid() == 1:
        sys.exit(0)


def matching_devices(patterns):
    devices = set()
    for pattern in patterns:
        devices.update(os.path.realpath(path) for path in glob.glob(pattern))
    return devices


def main():
    die_with_parent()
    patterns = sys.argv[1].split(',')
    open_devices = {}  # fd -> device path
    reported = set()   # problems already mentioned, so a retry stays quiet
    ctrl_down = 0

    while True:
        for path in sorted(matching_devices(patterns) - set(open_devices.values())):
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError as err:
                if path not in reported:
                    say('# cannot read %s: %s' % (path, err.strerror))
                    reported.add(path)
                continue
            try:
                fcntl.ioctl(fd, EVIOCGRAB, 1)
                say('# keyboard ready: %s' % path)
            except OSError as err:
                say('# keyboard ready, but keys will also reach other programs (%s): %s' % (err.strerror, path))
            open_devices[fd] = path
            reported.discard(path)
        if not open_devices and 'none' not in reported:
            say('# waiting for a keyboard (%s)' % ','.join(patterns))
            reported.add('none')
        elif open_devices:
            reported.discard('none')

        ready, _, _ = select.select([sys.stdin.fileno(), *open_devices], [], [], RESCAN_SECONDS)
        for fd in ready:
            if fd == sys.stdin.fileno():
                if not os.read(fd, 1024):
                    return
                continue
            try:
                data = os.read(fd, EVENT_SIZE * 64)
                if not data:
                    raise OSError(0, 'closed')
            except BlockingIOError:
                continue
            except OSError:
                say('# keyboard removed: %s' % open_devices.pop(fd))
                os.close(fd)
                ctrl_down = 0
                continue
            for offset in range(0, len(data) - EVENT_SIZE + 1, EVENT_SIZE):
                _, _, kind, code, value = struct.unpack_from(FORMAT, data, offset)
                if kind != EV_KEY:
                    continue
                if code in CTRL_KEYS:
                    ctrl_down += 1 if value == KEY_DOWN else -1 if value == 0 else 0
                    ctrl_down = max(ctrl_down, 0)
                elif value == KEY_DOWN:
                    say('quit' if code == KEY_C and ctrl_down else 'key %d' % code)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, BrokenPipeError):
        pass
