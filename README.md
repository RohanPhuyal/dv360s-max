# dh360d — Linux driver for the Darkflash DH360D AIO LCD

The **Darkflash DH360D** ("DH space station") is a 360 mm liquid CPU cooler whose
pump carries a small **LCD screen** that displays live PC stats (CPU temperature,
CPU usage, RAM, pump RPM). The vendor ships **only a Windows application** to drive
that screen — nothing for Linux.

`dh360d` is a small, dependency-light **Linux driver** that speaks the cooler's serial
protocol directly, so the screen shows live stats on Linux with **no Windows, no Wine,
and no proprietary driver** at runtime. A systemd service keeps it updated and brings
it back on every reboot.

> Reverse-engineered from the vendor app and **verified against real hardware** — the
> pump screen updates live from this tool. See [How this was built](#how-this-was-built)
> and [docs/PROTOCOL.md](docs/PROTOCOL.md).

---

## Why this exists

The DH360D's screen is not a generic USB display — it is driven over a serial link by
the vendor's closed-source Windows app. On Linux the cooler still pumps and cools
perfectly (it is a normal AIO), but the screen stays dark/stale because there is no
Linux software. This project fills that gap: it implements the same wire protocol the
Windows app uses, reading your CPU temperature / usage / RAM from the kernel and pushing
them to the pump screen.

## Hardware / specs

| | |
|---|---|
| **Cooler** | Darkflash DH360D ("DH space station"), 360 mm liquid AIO with pump LCD |
| **Bridge chip** | WCH **CH340** USB-to-UART (USB `1a86:7523`; also `:7522/:5523/:e523`) |
| **Linux kernel driver** | in-tree `ch341` (`ch341-uart`) — already present, nothing to install |
| **Appears as** | `/dev/ttyUSB0` (this package also adds a stable `/dev/dh360d` symlink) |
| **Serial params** | **115200 baud, 8N1**, no flow control |
| **Protocol** | `[CMD][LEN][DATA]`, no checksum (see [docs/PROTOCOL.md](docs/PROTOCOL.md)) |

The cooler does **not** present as USB-HID or WinUSB; it is a plain USB-to-serial device.

## Install

### Option A — Debian/Ubuntu package (recommended)

```bash
# build the .deb (only needs dpkg-deb, already on Debian/Ubuntu)
./packaging/build-deb.sh
sudo apt install ./dist/dh360d_1.0.0-1_all.deb
```

The package depends on `python3-serial` and `python3-psutil` (pulled in by apt),
installs the `dh360d` CLI, the udev rule, and a systemd service that is **enabled and
started automatically** — so the screen lights up immediately and on every boot.

### Option B — source install (any systemd distro)

```bash
sudo ./install.sh        # installs deps, CLI, udev rule, systemd service (enabled)
```

### Option C — Python only (no service)

```bash
pip install .            # or: pip install pyserial psutil && python -m dh360d ...
```

After installing, add yourself to the `dialout` group for non-root CLI use
(`sudo usermod -aG dialout "$USER"`, then re-login). The service runs as root and does
not need this.

## Usage

```bash
dh360d detect                       # find the cooler's serial port
dh360d handshake --reset            # send 02 01 00, expect reply 31

# push a one-off frame to the screen:
dh360d push --cpu-temp 55 --pump-rpm 2600 --cpu-usage 30 --ram-usage 45

# stream live host sensors continuously (what the service runs):
dh360d daemon -v
```

### The systemd service

Installed by the `.deb`/`install.sh` and enabled on boot:

```bash
systemctl status dh360d
journalctl -u dh360d -f
```

Configuration lives in **`/etc/default/dh360d`**:

```sh
# DH360D_PORT=/dev/dh360d     # pin a port; unset = auto-detect the CH340
DH360D_INTERVAL=1.0           # seconds between screen updates
```

The daemon auto-detects the port, retries if the cooler is unplugged, and reconnects
when it returns — so it survives suspend/replug without help.

## Protocol summary

Full details and the capture that proves them are in **[docs/PROTOCOL.md](docs/PROTOCOL.md)**.

```
Transport : CH340 USB-UART  ->  /dev/ttyUSB0 , 115200 8N1
Framing   : [CMD:1] [LEN:1] [DATA: LEN bytes]          (no checksum, no escaping)

Handshake : host  02 01 00              ->  device  31        (31 21 on a fresh boot)
Status    : host  01 0A <10 bytes>      ->  device  21  (ACK) , ~1 Hz
            the 10 data bytes are five 16-bit BIG-ENDIAN fields:
              bytes 0-1  CPU temperature (°C)
              bytes 2-3  pump RPM           (shown as "RPM")
              bytes 4-5  fan RPM            (not shown on this screen model)
              bytes 6-7  CPU usage (%)
              bytes 8-9  RAM usage (%)
```

## How this was built

The vendor app is an **Electron** program; the device-facing logic is compiled to V8
bytecode, so the protocol constants could not simply be read out of the binary. The
protocol was recovered dynamically and then verified:

1. **Static unpack.** Unpacked the installer (NSIS → `app-64.7z` → `app.asar`). Found the
   only hardware dependency is `serialport`, and that the bundled Windows driver is WCH
   `CH341SER` → the cooler is a **CH340 serial device**, not HID. The Linux `ch341`
   driver already covers it.
2. **Run the real app under Wine + a serial man-in-the-middle.** The app carries its own
   Electron runtime, so it runs under Wine. A `socat` PTY was inserted between the app
   and the real `/dev/ttyUSB0` to log every byte. `serialport.list()` returns nothing
   under Wine, so a small **PnP "Ports" registry entry** (`USB\VID_1A86&PID_7523`) was
   added to make the app enumerate and open the port. The app then connected, the pump
   screen turned on, and the full exchange was captured.
3. **Decode the framing.** The capture showed simple `[CMD][LEN][DATA]` frames — handshake
   `02 01 00`→`31`, then 12-byte status frames `01 0A …` ACKed with `21`. (The HDLC/flag/
   escape/checksum machinery also present in the app is a *separate* channel used only
   for streaming images to the screen, not for sensor data.)
4. **Map the fields against the screen.** Streaming frames with distinct per-field values
   and reading the on-screen gauges pinned the 10-byte payload to five 16-bit big-endian
   fields (temp / pump RPM / fan RPM / CPU% / RAM%).
5. **Verify from Linux.** This tool then drove the screen directly over `/dev/ttyUSB0` —
   confirming the protocol end-to-end.

A more detailed write-up is in [docs/REVERSE-ENGINEERING.md](docs/REVERSE-ENGINEERING.md).

## Troubleshooting

- **No port found:** `dmesg | grep ch341` should show `ch341-uart converter now attached
  to ttyUSB0`. If `brltty` grabbed the CH340, remove/mask it.
- **`handshake` returns nothing:** try `dh360d handshake --reset` (pulses DTR/RTS to reset
  the pump MCU). If the cooler was just driven by the Windows app, power-cycle it.
- **Screen shows a field wrong:** the byte layout is documented in `docs/PROTOCOL.md`;
  open an issue with what you sent vs. what displayed.

## Disclaimer

Independent, unofficial project. Not affiliated with or endorsed by Darkflash/DarkFlash.
Protocol facts were obtained by observing traffic to a device the author owns, for
interoperability. No vendor code is included in this repository. Use at your own risk.

## License

MIT — see [LICENSE](LICENSE).
