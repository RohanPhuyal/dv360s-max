#!/usr/bin/env python3
"""
dh360d — Linux driver for the Darkflash DH360D ("DH space station") liquid-AIO cooler.

The cooler's pump carries a small LCD that the vendor's *Windows-only* app drives over
a USB-to-UART bridge. This tool speaks the same serial protocol from Linux, so the
screen shows live CPU temperature / usage / RAM (and pump RPM) with no Windows needed.

Protocol (reverse-engineered & verified — see docs/PROTOCOL.md):
    Transport : WCH CH340 USB-UART -> /dev/ttyUSB* , 115200 8N1
    Framing   : [CMD:1][LEN:1][DATA: LEN bytes]            (no checksum)
    Handshake : host 02 01 00            -> device 31
    Status    : host 01 0A <10 bytes>    -> device 21 (ACK), ~1 Hz
                10 bytes = five u16 big-endian fields:
                  [cpu_temp C][pump_rpm][fan_rpm][cpu_usage %][ram_usage %]
"""
from __future__ import annotations
import argparse
import os
import sys
import time

__version__ = "1.0.0"

BAUD = 115200
HANDSHAKE = bytes([0x02, 0x01, 0x00])
ACK = 0x21
STATUS_CMD = 0x01

CH340_VIDS = {0x1A86, 0x4348}
CH340_PIDS = {0x7523, 0x7522, 0x5523, 0xE523}

# 10-byte CMD 0x01 payload = five 16-bit big-endian fields (verified against the screen)
STATUS_FIELDS = ("cpu_temp", "pump_rpm", "fan_rpm", "cpu_usage", "ram_usage")


# --------------------------------------------------------------------------- io
def _serial():
    try:
        import serial
        import serial.tools.list_ports as lp
        return serial, lp
    except ImportError:
        sys.exit("python3-serial (pyserial) is required:  pip install pyserial")


def find_ports():
    _, lp = _serial()
    return [p for p in lp.comports()
            if getattr(p, "vid", None) in CH340_VIDS
            or getattr(p, "pid", None) in CH340_PIDS
            or "CH340" in (p.description or "").upper()]


def pick_port(arg):
    if arg:
        return arg
    env = os.environ.get("DH360D_PORT")
    if env:
        return env
    hits = find_ports()
    if not hits:
        sys.exit("No CH340 cooler found. Plug it in; check `dmesg | grep ch341`.")
    return hits[0].device


def frame(cmd: int, data: bytes) -> bytes:
    return bytes([cmd, len(data)]) + data


def encode_status(vals: dict) -> bytes:
    out = bytearray()
    for name in STATUS_FIELDS:
        out += max(0, min(65535, int(vals.get(name, 0) or 0))).to_bytes(2, "big")
    return frame(STATUS_CMD, bytes(out[:10]).ljust(10, b"\x00"))


def reset_pulse(ser):
    """Toggle DTR/RTS to reset the device MCU into handshake-ready state."""
    for d, r in [(False, False), (True, True), (False, False)]:
        ser.dtr, ser.rts = d, r
        time.sleep(0.4)
    ser.dtr, ser.rts = True, False
    time.sleep(0.5)
    ser.reset_input_buffer()


def open_and_handshake(serial, port, reset=False):
    ser = serial.Serial(port, BAUD, timeout=1.0)
    if reset:
        reset_pulse(ser)
    ser.write(HANDSHAKE)
    time.sleep(0.2)
    reply = ser.read(8)
    return ser, reply


# --------------------------------------------------------------------- sensors
def host_sensors():
    try:
        import psutil
    except ImportError:
        psutil = None

    def cpu_temp():
        if psutil and hasattr(psutil, "sensors_temperatures"):
            temps = psutil.sensors_temperatures() or {}
            for key in ("k10temp", "coretemp", "zenpower", "acpitz"):
                if temps.get(key):
                    return round(temps[key][0].current)
            for arr in temps.values():
                if arr:
                    return round(arr[0].current)
        return 0

    def cpu_usage():
        return round(psutil.cpu_percent(interval=None)) if psutil else 0

    def ram_usage():
        return round(psutil.virtual_memory().percent) if psutil else 0

    return cpu_temp, cpu_usage, ram_usage


# -------------------------------------------------------------------- commands
def cmd_detect(a):
    _, lp = _serial()
    hits = find_ports()
    if hits:
        print("Cooler port(s):")
        for p in hits:
            print(f"  {p.device:14} vid={p.vid:#06x} pid={p.pid:#06x}  {p.description}")
    else:
        print("No CH340 cooler found. All serial ports:")
        for p in lp.comports():
            print(f"  {p.device:14} {p.description}")
        sys.exit(1)


def cmd_handshake(a):
    serial, _ = _serial()
    ser, reply = open_and_handshake(serial, pick_port(a.port), reset=a.reset)
    ser.close()
    print(f"sent {HANDSHAKE.hex(' ')}  ->  reply: {reply.hex(' ') or '(none)'}")
    if reply[:1] != b"\x31":
        sys.exit("unexpected reply — is this the DH360D? try --reset")
    print("OK — DH360D responded.")


def cmd_push(a):
    serial, _ = _serial()
    ser, reply = open_and_handshake(serial, pick_port(a.port), reset=a.reset)
    vals = dict(cpu_temp=a.cpu_temp, pump_rpm=a.pump_rpm, fan_rpm=a.fan_rpm,
                cpu_usage=a.cpu_usage, ram_usage=a.ram_usage)
    f = encode_status(vals)
    ser.write(f)
    time.sleep(0.2)
    ack = ser.read(4)
    ser.close()
    print(f"handshake {reply.hex(' ') or '(none)'}; sent {f.hex(' ')}; ack {ack.hex(' ') or '(none)'}")
    if not (ack and ack[0] == ACK):
        sys.exit("no ACK from device")
    print("ACK ok — check the pump screen.")


def cmd_sniff(a):
    serial, _ = _serial()
    ser = serial.Serial(pick_port(a.port), a.baud or BAUD, timeout=0.2)
    print(f"sniffing {ser.port} @ {a.baud or BAUD} for {a.seconds}s …")
    t0 = time.monotonic()
    n = 0
    while time.monotonic() - t0 < a.seconds:
        d = ser.read(256)
        if d:
            n += len(d)
            print(d.hex(" "), flush=True)
    ser.close()
    print(f"\n{n} bytes total.")


def cmd_daemon(a):
    serial, _ = _serial()
    rt, ru, rr = host_sensors()
    interval = a.interval or float(os.environ.get("DH360D_INTERVAL", "1.0"))
    log = (lambda m: print(m, flush=True)) if a.verbose else (lambda m: None)
    print(f"dh360d daemon: streaming host sensors every {interval}s (Ctrl-C to stop)",
          flush=True)
    while True:                                   # outer reconnect loop
        ser = None
        try:
            port = pick_port(a.port)
            ser, reply = open_and_handshake(serial, port, reset=False)
            log(f"connected {port}; handshake {reply.hex(' ') or '(none)'}")
            while True:
                vals = dict(cpu_temp=rt(), cpu_usage=ru(), ram_usage=rr())
                ser.write(encode_status(vals))
                ser.read(4)                       # consume ACK
                log("  ".join(f"{k}={v}" for k, v in vals.items()))
                time.sleep(interval)
        except KeyboardInterrupt:
            break
        except Exception as e:                    # device unplugged / port error
            print(f"dh360d: {e} — retrying in 5s", file=sys.stderr, flush=True)
            time.sleep(5)
        finally:
            try:
                if ser:
                    ser.close()
            except Exception:
                pass


# ------------------------------------------------------------------------ main
def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="dh360d", description="Darkflash DH360D AIO LCD driver for Linux")
    ap.add_argument("--version", action="version", version=f"dh360d {__version__}")
    ap.add_argument("--port", help="serial device (default: auto-detect CH340 / $DH360D_PORT)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("detect", help="list candidate CH340 ports").set_defaults(fn=cmd_detect)

    h = sub.add_parser("handshake", help="send 02 01 00 and show the reply")
    h.add_argument("--reset", action="store_true", help="pulse DTR/RTS to reset MCU first")
    h.set_defaults(fn=cmd_handshake)

    p = sub.add_parser("push", help="send one status frame to the screen")
    p.add_argument("--cpu-temp", type=int, default=0, dest="cpu_temp")
    p.add_argument("--cpu-usage", type=int, default=0, dest="cpu_usage")
    p.add_argument("--ram-usage", type=int, default=0, dest="ram_usage")
    p.add_argument("--pump-rpm", type=int, default=0, dest="pump_rpm")
    p.add_argument("--fan-rpm", type=int, default=0, dest="fan_rpm")
    p.add_argument("--reset", action="store_true")
    p.set_defaults(fn=cmd_push)

    d = sub.add_parser("daemon", help="stream live host sensors to the screen")
    d.add_argument("--interval", type=float, default=0.0, help="seconds between frames")
    d.add_argument("--verbose", "-v", action="store_true")
    d.set_defaults(fn=cmd_daemon)

    s = sub.add_parser("sniff", help="passively dump raw serial bytes")
    s.add_argument("--baud", type=int)
    s.add_argument("--seconds", type=float, default=10.0)
    s.set_defaults(fn=cmd_sniff)

    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
