#!/usr/bin/env bash
# Source installer for Darkflash AIO Drivers & Darkflash Studio GUI
# Supports Darkflash DV240S MAX / DV360S MAX (USB-HID 480x480 LCD) and DH360D (CH340 Serial)
#
# Usage:
#   sudo ./install.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root:  sudo $0"; exit 1; }

echo "==> 1. Installing System Dependencies (Python, Pillow, psutil, pyserial, ffmpeg)"
if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y python3-serial python3-psutil python3-pil python3-pip ffmpeg
elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3-pyserial python3-psutil python3-pillow python3-pip ffmpeg
elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm python-pyserial python-psutil python-pillow python-pip ffmpeg
else
    pip3 install --break-system-packages pyserial psutil Pillow 2>/dev/null || pip3 install pyserial psutil Pillow
fi

echo "==> 2. Installing Python Package & CLI Binaries (dh360d, dv360s, darkflash-studio)"
pip3 install --break-system-packages -e "$HERE" 2>/dev/null || pip3 install -e "$HERE"

echo "==> 3. Installing udev rules"
[ -f "$HERE/udev/99-dh360d.rules" ] && install -Dm644 "$HERE/udev/99-dh360d.rules" /etc/udev/rules.d/99-dh360d.rules
[ -f "$HERE/udev/99-darkflash-display.rules" ] && install -Dm644 "$HERE/udev/99-darkflash-display.rules" /etc/udev/rules.d/99-darkflash-display.rules
udevadm control --reload-rules && udevadm trigger || true

echo "==> 4. Installing Desktop Launcher"
if [ -d /usr/share/applications ] && [ -f "$HERE/desktop/darkflash-studio.desktop" ]; then
    install -Dm644 "$HERE/desktop/darkflash-studio.desktop" /usr/share/applications/darkflash-studio.desktop
fi

echo "==> 5. Installing systemd services"
[ -f "$HERE/systemd/dh360d.service" ] && install -Dm644 "$HERE/systemd/dh360d.service" /etc/systemd/system/dh360d.service
systemctl daemon-reload

echo
echo "=================================================================="
echo " Installation Complete!"
echo "=================================================================="
echo
echo " For DV240S MAX / DV360S MAX (Circular 480x480 LCD Screen):"
echo "   - Launch GUI Studio: darkflash-studio"
echo "   - CLI test:         dv360s test"
echo "   - Detect display:   dv360s detect"
echo
echo "   To enable Darkflash Studio as a persistent background user service:"
echo "     systemctl --user enable --now darkflash-studio.service"
echo
echo " For DH360D (Serial/CH340 360mm AIO Screen):"
echo "   - Test:             dh360d detect && dh360d push --cpu-temp 50"
echo "   - System Service:   systemctl enable --now dh360d.service"
echo "=================================================================="
