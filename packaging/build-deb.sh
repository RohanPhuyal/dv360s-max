#!/usr/bin/env bash
# Build dh360d_<ver>_all.deb using only dpkg-deb (no debhelper needed).
#   ./packaging/build-deb.sh   ->  dist/dh360d_<ver>_all.deb
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(awk -F'[ ()]' '/^dh360d \(/{print $3; exit}' "$ROOT/debian/changelog")"
PKG="dh360d"
STAGE="$(mktemp -d)"
OUT="$ROOT/dist"
mkdir -p "$OUT"
trap 'rm -rf "$STAGE"' EXIT

# ---- file tree -------------------------------------------------------------
install -Dm755 "$ROOT/dh360d/cli.py"            "$STAGE/usr/bin/dh360d"
install -Dm644 "$ROOT/packaging/dh360d.default" "$STAGE/etc/default/dh360d"
install -Dm644 "$ROOT/systemd/dh360d.service"   "$STAGE/lib/systemd/system/dh360d.service"
install -Dm644 "$ROOT/udev/99-dh360d.rules"     "$STAGE/lib/udev/rules.d/99-dh360d.rules"
install -Dm644 "$ROOT/debian/copyright"         "$STAGE/usr/share/doc/$PKG/copyright"
install -Dm644 "$ROOT/README.md"                "$STAGE/usr/share/doc/$PKG/README.md"
gzip -9 -n -c "$ROOT/debian/changelog" > "$STAGE/usr/share/doc/$PKG/changelog.Debian.gz"
chmod 644 "$STAGE/usr/share/doc/$PKG/changelog.Debian.gz"

# ---- control metadata ------------------------------------------------------
SIZE="$(du -ks "$STAGE" | cut -f1)"
mkdir -p "$STAGE/DEBIAN"
cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG
Version: $VER
Section: utils
Priority: optional
Architecture: all
Depends: python3, python3-serial, python3-psutil
Maintainer: S. Eric Clark <25495882+clarkse@users.noreply.github.com>
Homepage: https://github.com/clarkse/dh360d
Installed-Size: $SIZE
Description: Linux driver for the Darkflash DH360D AIO LCD ("DH space station")
 Drives the LCD on the Darkflash DH360D pump from Linux, showing live CPU
 temperature, usage and RAM. The vendor ships only a Windows app; this speaks
 the same serial protocol over the cooler's CH340 USB-UART bridge and installs a
 systemd service that streams host sensors to the screen on boot.
EOF

echo "/etc/default/dh360d" > "$STAGE/DEBIAN/conffiles"

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = configure ]; then
    udevadm control --reload-rules 2>/dev/null || true
    udevadm trigger --subsystem-match=tty 2>/dev/null || true
    if [ -d /run/systemd/system ]; then
        systemctl daemon-reload 2>/dev/null || true
        systemctl enable dh360d.service 2>/dev/null || true
        systemctl start  dh360d.service 2>/dev/null || true
    fi
fi
exit 0
EOF

cat > "$STAGE/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = remove ] || [ "$1" = deconfigure ]; then
    if [ -d /run/systemd/system ]; then
        systemctl stop    dh360d.service 2>/dev/null || true
        systemctl disable dh360d.service 2>/dev/null || true
    fi
fi
exit 0
EOF

cat > "$STAGE/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
if [ -d /run/systemd/system ]; then systemctl daemon-reload 2>/dev/null || true; fi
exit 0
EOF
chmod 755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm" "$STAGE/DEBIAN/postrm"

# md5sums (everything except DEBIAN/)
( cd "$STAGE" && find . -path ./DEBIAN -prune -o -type f -printf '%P\n' \
    | sort | xargs md5sum > DEBIAN/md5sums )

# ---- build -----------------------------------------------------------------
DEB="$OUT/${PKG}_${VER}_all.deb"
dpkg-deb --root-owner-group --build "$STAGE" "$DEB"
echo
echo "Built: $DEB"
dpkg-deb --info "$DEB" | sed -n '1,20p'
