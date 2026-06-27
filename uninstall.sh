#!/usr/bin/env bash
# Remove a source install of dh360d (mirror of install.sh).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root:  sudo $0"; exit 1; }

systemctl disable --now dh360d.service 2>/dev/null || true
rm -f /etc/systemd/system/dh360d.service
systemctl daemon-reload || true

rm -f /etc/udev/rules.d/99-dh360d.rules
udevadm control --reload-rules || true

rm -f /usr/local/bin/dh360d /usr/bin/dh360d
echo "Removed. (/etc/default/dh360d left in place — delete manually if you want.)"
