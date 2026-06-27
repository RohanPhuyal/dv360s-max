#!/usr/bin/env bash
# Source installer for dh360d (for distros without the .deb). Installs the CLI, the
# udev rule, the systemd service, and enables it to start on boot.
#
#   sudo ./install.sh
#
set -euo pipefail

PREFIX="${PREFIX:-/usr/local}"
BIN="$PREFIX/bin/dh360d"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root:  sudo $0"; exit 1; }

echo "==> Installing Python dependencies (pyserial, psutil)"
if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y python3-serial python3-psutil
elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3-pyserial python3-psutil
elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm python-pyserial python-psutil
else
    pip3 install --break-system-packages pyserial psutil 2>/dev/null || pip3 install pyserial psutil
fi

echo "==> Installing CLI -> $BIN"
install -Dm755 "$HERE/dh360d/cli.py" "$BIN"

echo "==> Installing udev rule"
install -Dm644 "$HERE/udev/99-dh360d.rules" /etc/udev/rules.d/99-dh360d.rules
udevadm control --reload-rules && udevadm trigger || true

echo "==> Installing systemd service + default config"
install -Dm644 "$HERE/systemd/dh360d.service" /etc/systemd/system/dh360d.service
[ -f /etc/default/dh360d ] || install -Dm644 "$HERE/packaging/dh360d.default" /etc/default/dh360d
# The service runs the CLI from /usr/bin; symlink if we installed to /usr/local.
[ -e /usr/bin/dh360d ] || ln -sf "$BIN" /usr/bin/dh360d

systemctl daemon-reload
systemctl enable --now dh360d.service || true

echo
echo "Done. The cooler's screen should now show live host stats, and again on every boot."
echo "  status:  systemctl status dh360d"
echo "  logs:    journalctl -u dh360d -f"
echo "  test:    dh360d detect && dh360d push --cpu-temp 50 --pump-rpm 2500"
