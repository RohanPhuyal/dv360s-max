# How the DH360D protocol was reverse-engineered

The vendor (Darkflash) ships only a Windows app — "DF DH space station". This is the
story of getting from that closed binary to a working Linux driver. No vendor code is
redistributed here; only the observed protocol facts.

## 1. Unpacking the Windows app

The download is a RAR containing an **NSIS** installer, which contains `app-64.7z`, which
is an **Electron** app:

```
DF DH space station_1.0.7.exe   (NSIS)
└── $PLUGINSDIR/app-64.7z
    ├── DF DH space station.exe          Electron 25 / Chrome 114 runtime
    ├── driver/CH341SER.*                bundled WCH CH340/CH341 Windows driver  ★
    └── resources/app.asar               the app (JS + V8 bytecode)
```

Two facts fell straight out:

- `package.json` lists exactly one hardware dependency: **`serialport`** (no `node-hid`,
  no `usb`, no WinUSB). The cooler is a **serial** device.
- The bundled driver is **`CH341SER`** (WCH CH340/CH341). USB IDs in the `.inf`:
  `1a86:7523` and friends. On Linux the in-tree `ch341` module already handles these.

So: the cooler is a CH340 USB-UART, and "driving the screen" means sending it the right
bytes over `/dev/ttyUSB0`.

## 2. The constants were compiled away

The Electron main process is compiled to **V8 bytecode** (`index.jsc`, via `bytenode`),
so the framing constants, baud rate and command IDs are not present as readable strings.
Static `strings` analysis recovered the *vocabulary* (a `[CMD][LEN][DATA]`-ish data frame,
a separate HDLC-style framed channel with flag/escape/checksum, and the command names
`setCpuTemperature`, `setPumpSpeed`, etc.) but not the numbers.

Attempting to **decompile** the bytecode was a dead end: the file is **V8 11.4.183.29**
(Electron 25), and the public V8 disassembler (View8) only ships binaries up to V8 11.3.
Patching the cache header to fool the 11.3 disassembler got past the magic-number check
but then crashed in deserialization — the 11.4 layout is not compatible. Stock Node 20
(V8 11.3) likewise rejects the cache. Only Electron 25 itself can load it.

## 3. Dynamic capture: run the app under Wine, sniff the wire

Because the app carries its own Electron runtime, it **runs under Wine** — which sidesteps
the V8-version problem entirely (it uses its own matching V8). The plan:

```
 Wine app ──▶ COMxx (Wine) ──▶ socat PTY ──[hex log]──▶ /dev/ttyUSB0 ──▶ cooler
```

`socat` sits in the middle and logs every byte in both directions while bridging to the
real device, so the cooler actually responds.

The one obstacle: under Wine, `serialport.list()` returns **nothing** (Wine doesn't expose
serial ports through the PnP/SetupAPI that `serialport` uses), so the app's device-discovery
timed out and it never opened the port. The fix was to register a fake **PnP "Ports"
device** in the Wine registry so enumeration would find it:

```
[HKLM\System\CurrentControlSet\Enum\USB\VID_1A86&PID_7523\…]
  "Class"="Ports"
  "ClassGUID"="{4D36E978-E325-11CE-BFC1-08002BE10318}"
  "FriendlyName"="USB-SERIAL CH340 (COMxx)"
[…\Device Parameters]
  "PortName"="COMxx"
```

With that in place `device.list()` returned the port, the app's own `findDevice` opened it
(through the socat bridge), handshook with the real cooler, **registered it, and the pump
screen turned on**. socat captured the whole conversation.

(To trigger specific commands without clicking the GUI, the app's renderer was repacked
with a tiny injected script that calls the app's own context-bridge API — `device.conn`,
`service.syncSet*` — directly. This is only needed for exploration; the final driver does
not touch the app at all.)

## 4. Reading the frames

The capture was refreshingly simple:

```
host → cooler   02 01 00                              connect/handshake
cooler → host   31 21                                 identify
host → cooler   01 0A 00 00 00 00 00 00 00 00 00 00   status push (CMD 0x01, 10 bytes)
cooler → host   21                                    ACK ('!')
… 01 0A … every second, each ACKed …
```

i.e. `[CMD][LEN][DATA]`, **no checksum**. The 10-byte payload was all zeros only because
the Windows hardware-monitor DLL (`BYMonitor`) can't read PC sensors under Wine.

## 5. Mapping the 10 payload bytes

With the framing known, the field layout was found by **driving the device directly from
Linux** and reading the screen:

- A probe with each byte distinct (`11,22,33,…`) showed one gauge as `8492 = 0x212C` =
  bytes 2–3 → a 16-bit big-endian RPM field at offset 2; all small-range gauges read `FF`
  (my probe values overflowed them) → everything is 16-bit.
- A probe of five small `u16` values `[40, 2500, 60, 70, 80]` showed **temp 40, RPM 2500,
  CPU 70%, RAM 80%** (the 60 at bytes 4–5 wasn't displayed).
- Confirmed with `[47, 2200, 3300, 65, 85]` → **temp 47, RPM 2200, CPU 65%, RAM 85%**.

That pins the payload to five 16-bit big-endian fields:
`[cpu_temp][pump_rpm][fan_rpm (unshown)][cpu_usage%][ram_usage%]`.

## 6. Result

`dh360d` opens `/dev/ttyUSB0` at 115200 8N1, sends `02 01 00`, then streams
`01 0A <10 bytes>` once a second — and the screen shows live host stats. No Windows, no
Wine, no vendor binary at runtime. See [PROTOCOL.md](PROTOCOL.md) for the byte-level spec.
