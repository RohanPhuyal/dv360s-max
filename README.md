# Darkflash DV240S MAX / DV360S MAX & DH360D Linux Driver & Studio GUI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.8+](https://img.shields.io/badge/Python-3.8+-brightgreen.svg)](https://www.python.org/)
[![Platform: Linux](https://img.shields.io/badge/Platform-Linux-orange.svg)](https://kernel.org/)

Native, lightweight Linux driver and **Darkflash Studio GUI** control panel for **Darkflash AIO Liquid CPU Coolers** with pump LCD screens. Drive your cooler screen natively on Linux with **no Windows, no Wine, and no proprietary background software**.

---

## 🖥️ Supported Hardware

| Cooler Model | Screen Type | Interface | Hardware ID | Driver Protocol |
|---|---|---|---|---|
| **Darkflash DV240S MAX** | 480×480 Circular LCD | USB-HID (`hidraw`) | `1800:3008` (Hotspotek) | JPEG Chunked (`0xDA` wire protocol) |
| **Darkflash DV360S MAX** | 480×480 Circular LCD | USB-HID (`hidraw`) | `1800:3008` (Hotspotek) | JPEG Chunked (`0xDA` wire protocol) |
| **Darkflash DH360D** ("DH Space Station") | Segment/Rectangular LCD | Serial (CH340 UART) | `1a86:7523` (WCH) | Serial Byte Protocol (115200 8N1) |

---

## ✨ Features & Darkflash Studio GUI

Yes! This package includes **Darkflash Studio**, a full graphical control panel matching modern **Serpantinum** styling (Matugen Material Design 3, frosted glassmorphism, responsive layout):

- **🎨 Full Graphical Studio UI**:
  - Launch from your application menu or run `darkflash-studio`.
  - Accessible in any web browser at `http://127.0.0.1:8989` or as a standalone native app window.
- **🛠️ Interactive HUD Drag-and-Drop Editor ("RAW" tab)**:
  - Add, arrange, color, and resize real-time hardware telemetry widgets:
    - **CPU & GPU Temperature Readouts** (`cpu_temp`, `gpu_temp`, `dual_temp`)
    - **CPU Load % & System RAM Usage** (`cpu_load`, `ram_stat`, `ram_gauge`)
    - **Digital Chronometer Clock** with **12-Hour / 24-Hour** modes and optional **AM/PM** badge
    - **Circular Gauges, Progress Bars, and Text Badges**
- **✨ Universal Visual FX & Glow Engine**:
  - Configurable **Neon Bloom Glow**, **Drop Shadows**, and **High-Contrast Outlines** with live blur and color adjustment.
- **🎬 Official Animated Theme Suite ("RENDERED THEMES" tab)**:
  - Includes all official Darkflash 3D animations:
    1. 🚀 **Orbital Space Station** (*Engineered with subpixel seamless looping*)
    2. 🌃 **Tokyo Cyberpunk Rain** (*Engineered with subpixel seamless looping*)
    3. ⚡ **Cyber Reactor Core**
    4. 🏎️ **Turbo Mach Tachometer**
    5. 🌌 **Neon Cyber Vitals**
    6. 🌀 **Quantum Ring Accelerator**
    7. 🔮 **Quantum Particle Vortex**
- **⚡ 0.0% FFmpeg Background CPU Optimization**:
  - Pre-buffers short video loops into RAM in ~60ms on startup and immediately terminates FFmpeg.
  - Streams directly from memory at 20 FPS with **0.0% FFmpeg CPU usage** and <3% total system CPU load.
- **🎮 1-Click Game Mode**:
  - One-click toggle in the header (`GAME MODE: OFF / ON`) pauses rendering and USB transmissions to preserve 100% CPU/GPU resources for gaming.
- **📐 Universal Sizing & Circular Bezel Safe Zone**:
  - Proportional theme scaling (`➖ 10% Smaller` / `➕ 10% Larger`), background zoom slider (30% to 200%), and circular LCD guide to ensure widgets never clip into the round glass bezel.

---

## 📦 Installation

### Step 1: Install System Dependencies

Install Python 3, pip, Pillow, psutil, pyserial, and ffmpeg:

#### Arch Linux / Manjaro:
```bash
sudo pacman -S --needed python python-pip python-pillow python-psutil python-pyserial ffmpeg
```

#### Ubuntu / Debian / Pop!_OS:
```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-pil python3-psutil python3-serial ffmpeg
```

#### Fedora / RHEL:
```bash
sudo dnf install -y python3 python3-pip python3-pillow python3-psutil python3-pyserial ffmpeg
```

---

### Step 2: Clone and Install

```bash
git clone https://github.com/RohanPhuyal/dv360s-max.git
cd dv360s-max

# Run the automated installer (installs package, udev rules, desktop launcher, and systemd service):
sudo ./install.sh
```

*(Alternatively, you can install as a regular user via pip: `pip install -e .`)*

---

### Step 3: Enable Non-Root USB Permissions (udev)

If you ran `sudo ./install.sh`, udev rules are already installed. If installing manually:

```bash
# 1. Copy udev rule for DV240S/DV360S MAX (disables USB autosuspend and grants hidraw access)
sudo cp udev/99-darkflash-display.rules /etc/udev/rules.d/

# 2. Reload udev
sudo udevadm control --reload-rules
sudo udevadm trigger
```

> **Note:** If your user is not already in the `input` or `plugdev` group, log out and log back in, or check `ls -l /dev/hidraw*` to verify read/write access.

---

### Step 4: Enable Background Service (Optional but Recommended)

To have the cooler display start automatically on boot and stream in the background:

```bash
# Enable as a user service (recommended for desktop sessions):
systemctl --user enable --now darkflash-studio.service

# Check status:
systemctl --user status darkflash-studio.service
```

---

## 🚀 Usage

### 1. Launching Darkflash Studio (GUI)

- **From Application Launcher:** Search for **"Darkflash Studio"** in your desktop menu.
- **From Terminal:**
  ```bash
  darkflash-studio
  ```
  *(Opens the GUI in a standalone application window, or point any browser to `http://127.0.0.1:8989`)*

Closing the browser window keeps the background stream running continuously on the cooler. You can re-open the studio anytime with `darkflash-studio`.

---

### 2. Command-Line Tools (CLI)

#### DV240S MAX / DV360S MAX (USB-HID 480×480 LCD):

```bash
# Detect connected display node
dv360s detect

# Send a single test pattern / image
dv360s test

# Stream an MP4 video or GIF directly from terminal
dv360s stream /path/to/video.mp4 --fps 20 --rotation 90

# Adjust screen brightness (0 to 100)
dv360s brightness 80

# Put screen to sleep / wake up
dv360s sleep
dv360s wake
```

#### DH360D (CH340 Serial 360mm Cooler):

```bash
# Detect serial port
dh360d detect

# Push one-off telemetry frame
dh360d push --cpu-temp 55 --pump-rpm 2600 --cpu-usage 30 --ram-usage 45

# Start serial daemon
dh360d daemon -v
```

---

## 🛠️ Architecture & Wire Protocol

For technical details on how the DV240S/DV360S MAX USB-HID JPEG chunking protocol was reverse-engineered from the Windows application, see [`docs/DV360S-PROTOCOL.md`](docs/DV360S-PROTOCOL.md).

For the serial protocol used by the DH360D, see [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

---

## 🤝 Contributing

Contributions, bug reports, and theme creations are warmly welcomed! Please open an issue or pull request on [GitHub](https://github.com/RohanPhuyal/dv360s-max).

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
All brand names and trademarks belong to their respective owners.
