# Darkflash DV360S Max AIO LCD Wire Protocol & Implementation

## Hardware Overview

| Component | Specification |
|---|---|
| **Cooler** | Darkflash DV360S Max / DV360S AIO Liquid Cooler |
| **Display** | 3.95-inch IPS LCD, 480 × 480 pixels |
| **Transport** | USB 2.0 High Speed (480 Mbps) via internal 9-pin USB header |
| **USB Hub** | Genesys Logic GL850G/GL852G (VID `0x05E3`, PID `0x0608`) |
| **Controller** | Hotspotek / AKP HID Composite Device (VID `0x1800`, PID `0x3008`) |
| **Fan/Pump Controller** | QinHeng Electronics USBFAN (VID `0x1A86`, PID `0xFE05`) |
| **Linux Node** | `/dev/hidraw*` |

---

## Wire Protocol

Commands are transferred via raw HID Output Reports (1024-byte payload, unnumbered Report ID `0x00`).
All commands start with the 5-byte header: `0x43 0x52 0x54 0x00 0x00` (`CRT\x00\x00`).

### 1. Connect / Keep-Alive
```
43 52 54 00 00 43 4f 4e 4e 45 43 54 ("CRT\0\0CONNECT")
```
Sent during initialization and periodically every 2 seconds. Prevents the microcontroller's ~3-second idle watchdog timer from putting the screen into standby sleep mode.

### 2. Display Wake / Init
```
43 52 54 00 00 44 49 53 ("CRT\0\0DIS")
```
Initializes the display controller and powers up the LCD panel.

### 3. Backlight Brightness
```
43 52 54 00 00 4c 49 47 00 00 [LEVEL: 0x00..0x64] ("CRT\0\0LIG\0\0<level>")
```
Controls backlight level from 0% (`0x00`) to 100% (`0x64`).

### 4. Built-in Screensaver / Logo
```
43 52 54 00 00 43 4c 45 00 00 44 43 ("CRT\0\0CLE\0\0DC")
```
Triggers the cooler's internal onboard firmware screensaver / startup animation.

### 5. Image & Video Frame Upload
```
43 52 54 00 00 42 41 54 00 00 [SIZE_HI] [SIZE_LO] [POS] 00 00 00
```
- Sent before JPEG data.
- Payload is streamed in 1024-byte chunks.
- Followed by buffer flush:
```
43 52 54 00 00 53 54 50 ("CRT\0\0STP")
```

---

## CLI Usage (`dv360s`)

```bash
# Detect cooler on USB
dv360s detect

# Wake display and hold keepalive daemon
dv360s wake

# Set brightness to 100%
dv360s brightness 100

# Display static image (scaled & centered to 480x480)
dv360s image /path/to/image.png

# Stream video or animated GIF in a loop (using ffmpeg)
dv360s play /path/to/animation.mp4 --fps 24 --loop

# Render live PC sensor HUD (CPU Temp, CPU Load %, RAM Used %)
dv360s stats --interval 1.0

# Restore default onboard screensaver
dv360s logo
```
