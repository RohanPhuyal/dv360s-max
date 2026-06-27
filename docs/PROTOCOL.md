# DH360D serial protocol

Reverse-engineered from the vendor's Windows app and **verified against the physical
device** (the pump screen updates exactly as predicted). The `dh360d` tool implements
exactly what is described here.

## Physical / transport layer

| Property | Value |
|---|---|
| Bridge chip | WCH CH340 USB-to-UART (`lsusb`: `1a86:7523`; variants `7522/5523/e523`, clone VID `4348`) |
| Linux driver | in-tree `ch341` kernel module → `/dev/ttyUSB*` |
| Baud rate | **115200** |
| Frame format | **8 data bits, no parity, 1 stop bit (8N1)** |
| Flow control | none |

## Link layer — framing

Every message is a simple length-prefixed frame. **There is no checksum and no
byte-stuffing** on this (sensor/status) channel.

```
+--------+--------+------------------------+
| CMD    | LEN    | DATA                   |
| 1 byte | 1 byte | LEN bytes              |
+--------+--------+------------------------+
```

| CMD | meaning | LEN | DATA |
|----:|---------|----:|------|
| `0x02` | connect / handshake | `0x01` | `00` |
| `0x01` | status / sensor push | `0x0A` (10) | five 16-bit fields (below) |

### Device replies

The device answers on the same line:

| host sends | device replies | notes |
|---|---|---|
| `02 01 00` (handshake) | `31` | a freshly-powered device replies `31 21`; once it is "live" it replies just `31` |
| `01 0A …` (status) | `21` | `0x21` = ACK ('!'), one per status frame |

## Application layer — the status payload (CMD `0x01`)

The 10 data bytes are **five unsigned 16-bit big-endian integers**:

| bytes | field | units | shown on screen |
|------:|-------|-------|-----------------|
| 0–1 | CPU temperature | °C | yes ("temp") |
| 2–3 | pump RPM | RPM | yes ("RPM") |
| 4–5 | fan RPM | RPM | not on this DH360D screen model |
| 6–7 | CPU usage | % | yes ("CPU") |
| 8–9 | RAM usage | % | yes ("RAM") |

Example — `cpu_temp=42, pump_rpm=2345, fan=0, cpu=55%, ram=66%`:

```
01 0A  00 2A  09 29  00 00  00 37  00 42
└CMD└LEN  └temp └pump  └fan   └cpu%  └ram%
        =42   =2345   =0     =55    =66
```

The cooler wants a status frame roughly **once per second**; the `dh360d daemon` sends
one per second and consumes the `0x21` ACK each time.

## A captured session (host ↔ cooler)

```
host → cooler   02 01 00                              connect
cooler → host   31 21                                 identify
host → cooler   01 0A 00 00 00 00 00 00 00 00 00 00   status (all-zero here)
cooler → host   21                                    ACK
host → cooler   01 0A …                               status …
cooler → host   21                                    ACK
…
```

## Other channels (not implemented here)

The vendor app also contains a second, more elaborate framing layer (start/stop **flag**
byte, **escape**/byte-stuffing, a length field and a 16-bit big-endian checksum — classic
HDLC/PPP-async style). Strings in the app tie this to a `transportFile` command, i.e.
streaming **bitmap images** to the screen (custom wallpapers/themes). `dh360d` does not
implement that channel; it only drives the live sensor gauges via CMD `0x01`.

## Notes for re-implementers

- Open the port at 115200 8N1; assert nothing special on DTR/RTS for normal operation.
- If the device only answers the handshake with `31` (not `31 21`) and won't take status
  frames, pulse DTR/RTS low→high (or power-cycle) to reset the pump MCU.
- Values are clamped to `0..65535`; temperatures/percentages are small integers.
