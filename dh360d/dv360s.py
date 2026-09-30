#!/usr/bin/env python3
"""
Darkflash DV360S Max (and DV240S Max) AIO LCD Linux Driver & CLI

Hardware Specs:
- Cooler: Darkflash Radiant / Nebula DV360S Max
- Screen: 3.95-inch IPS LCD, 480x480 square resolution
- Transport: USB 2.0 High Speed (480Mbps), Hotspotek HID interface (1800:3008)
- Protocol: Hotspotek SDDevice wire protocol over /dev/hidraw

Features:
- Power wake / Keepalive heartbeat loop (prevents 2-3s firmware sleep timeout)
- Backlight brightness control (0-100%)
- Static image display with automatic centered 1:1 square crop to 480x480
- Real-time video (MP4/WebM/AVI) and animated GIF streaming via FFmpeg
- Live dynamic system monitor HUD (CPU / GPU temperatures, load, RAM usage)
"""

from __future__ import annotations
import argparse
import glob
import io
import os
import signal
import subprocess
import sys
import time
from typing import Optional

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = None

try:
    import psutil
except ImportError:
    psutil = None

TARGET_VID = "1800"
TARGET_PID = "3008"
HUB_VID = "05e3"
HUB_PID = "0608"

SCREEN_WIDTH = 480
SCREEN_HEIGHT = 480
CHUNK_SIZE = 1024
REPORT_SIZE = 1025  # 1 byte 0x00 Report ID + 1024 bytes payload

_running = True

def _handle_signal(sig, frame):
    global _running
    _running = False

signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


def pad_packet(payload: bytes, size: int = REPORT_SIZE) -> bytes:
    """Pad payload to exactly `size` bytes with 0x00, ensuring Report ID 0x00 is at index 0."""
    if not payload.startswith(b"\x00"):
        payload = b"\x00" + payload
    if len(payload) < size:
        payload = payload + b"\x00" * (size - len(payload))
    return payload[:size]


class DV360S:
    def __init__(self, node: Optional[str] = None):
        self.node = node or self.detect()
        self.fd: Optional[int] = None

    @staticmethod
    def detect(retries: int = 5, delay: float = 0.4) -> Optional[str]:
        """Find the /dev/hidraw node corresponding to 1800:3008."""
        target = f"0000{TARGET_VID.upper()}:0000{TARGET_PID.upper()}"
        for _ in range(retries):
            for path in glob.glob("/sys/class/hidraw/hidraw*"):
                uevent = os.path.join(path, "device", "uevent")
                if os.path.exists(uevent):
                    try:
                        with open(uevent, "r") as f:
                            if target in f.read():
                                dev = f"/dev/{os.path.basename(path)}"
                                if os.path.exists(dev):
                                    return dev
                    except Exception:
                        continue
            time.sleep(delay)
        return None

    @staticmethod
    def ensure_power():
        """Disable USB autosuspend on the cooler controller and its internal hub."""
        for dev in glob.glob("/sys/bus/usb/devices/*"):
            try:
                vid_f = os.path.join(dev, "idVendor")
                pid_f = os.path.join(dev, "idProduct")
                pwr_f = os.path.join(dev, "power", "control")
                if os.path.exists(vid_f) and os.path.exists(pid_f) and os.path.exists(pwr_f):
                    with open(vid_f) as vf, open(pid_f) as pf:
                        v, p = vf.read().strip(), pf.read().strip()
                    if (v == TARGET_VID and p == TARGET_PID) or (v == HUB_VID and p == HUB_PID):
                        try:
                            with open(pwr_f, "w") as pw:
                                pw.write("on")
                        except PermissionError:
                            pass
            except Exception:
                pass

    def open(self):
        if self.fd is not None:
            return
        if not self.node:
            self.node = self.detect()
            if not self.node:
                raise RuntimeError("Darkflash DV360S Max (1800:3008) not detected on USB bus.")
        self.ensure_power()
        self.fd = os.open(self.node, os.O_RDWR)

    def close(self):
        if self.fd is not None:
            try:
                os.close(self.fd)
            except Exception:
                pass
            self.fd = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def send_cmd(self, payload: bytes):
        """Sends a 1025-byte padded HID command report."""
        if self.fd is None:
            self.open()
        os.write(self.fd, pad_packet(payload))

    def wake(self):
        """Sends display wake sequence: DIS, LIG (100%), CONNECT."""
        self.send_cmd(b"\x00CRT\x00\x00DIS")
        time.sleep(0.05)
        self.set_brightness(100)
        time.sleep(0.05)
        self.heartbeat()
        time.sleep(0.05)

    def set_brightness(self, level: int):
        """Set backlight brightness (0-100%)."""
        clamped = max(0, min(100, int(level)))
        self.send_cmd(b"\x00CRT\x00\x00LIG\x00\x00" + bytes([clamped]))

    def heartbeat(self):
        """Send CONNECT heartbeat packet (required every ~1-2s to keep screen awake)."""
        self.send_cmd(b"\x00CRT\x00\x00CONNECT")

    def send_frame(self, jpeg_data: bytes, key: int = 0xB1, x: int = 0, y: int = 0, w: int = 0, h: int = 0):
        """
        Streams a JPEG frame using the reverse-engineered Hotspotek 32-byte DRA prepended protocol.
        
        Header Layout (32 bytes):
        - [0:3]   = 'CRT'
        - [3:5]   = 0x00, 0x00
        - [5:8]   = 'DRA'
        - [8:12]  = total_size (len(jpeg) + 32) as 32-bit big-endian uint
        - [12]    = key (0xB1 for 3.95" secondary LCD)
        - [13:15] = x (16-bit big-endian)
        - [15:17] = y (16-bit big-endian)
        - [17:19] = width (16-bit big-endian, vendor leaves 0 for full screen)
        - [19:21] = height (16-bit big-endian, vendor leaves 0 for full screen)
        - [21:32] = 0x00 padding
        """
        if self.fd is None:
            self.open()

        jpeg_size = len(jpeg_data)
        total_size = jpeg_size + 32

        header = bytearray(32)
        header[0:3] = b"CRT"
        header[3:5] = b"\x00\x00"
        header[5:8] = b"DRA"
        header[8] = (total_size >> 24) & 0xFF
        header[9] = (total_size >> 16) & 0xFF
        header[10] = (total_size >> 8) & 0xFF
        header[11] = total_size & 0xFF
        header[12] = key & 0xFF
        header[13] = (x >> 8) & 0xFF
        header[14] = x & 0xFF
        header[15] = (y >> 8) & 0xFF
        header[16] = y & 0xFF
        header[17] = (w >> 8) & 0xFF
        header[18] = w & 0xFF
        header[19] = (h >> 8) & 0xFF
        header[20] = h & 0xFF

        stream = bytes(header) + jpeg_data

        for off in range(0, len(stream), CHUNK_SIZE):
            chunk = stream[off : off + CHUNK_SIZE]
            pkt = (b"\x00" + chunk).ljust(REPORT_SIZE, b"\x00")
            os.write(self.fd, pkt)
            time.sleep(0.0005)


def format_frame(img: Image.Image, quality: int = 70, rotate: int = 90) -> bytes:
    """Center-crop image to 1:1 square aspect ratio, rotate, and resize to 480x480 JPEG."""
    if img.mode != "RGB":
        img = img.convert("RGB")
    
    w, h = img.size
    min_dim = min(w, h)
    left = (w - min_dim) // 2
    top = (h - min_dim) // 2
    cropped = img.crop((left, top, left + min_dim, top + min_dim))
    resized = cropped.resize((SCREEN_WIDTH, SCREEN_HEIGHT), Image.Resampling.LANCZOS)

    if rotate:
        # Clockwise rotation: PIL rotate is counter-clockwise, so use -rotate
        resized = resized.rotate(-rotate)

    buf = io.BytesIO()
    resized.save(buf, format="JPEG", quality=quality, subsampling=0, optimize=True)
    return buf.getvalue()


# --------------------------------------------------------------------------- CLI Actions

def cmd_detect(args):
    dv = DV360S.detect()
    if dv:
        print(f"[✓] Detected Darkflash DV360S Max at: {dv}")
    else:
        print("[-] Darkflash DV360S Max (1800:3008) not found on USB bus.")
        sys.exit(1)


def cmd_wake(args):
    dev = DV360S()
    with dev:
        print(f"[+] Waking Darkflash display on {dev.node}...")
        dev.wake()
        print("[+] Screen awake. Running keepalive loop (Ctrl+C to stop)...")
        while _running:
            time.sleep(1.0)
            dev.heartbeat()


def cmd_brightness(args):
    dev = DV360S()
    with dev:
        dev.set_brightness(args.level)
        print(f"[✓] Backlight brightness set to {args.level}%")


def cmd_image(args):
    if Image is None:
        sys.exit("[-] Pillow is required: pip install Pillow")
    if not os.path.exists(args.file):
        sys.exit(f"[-] File not found: {args.file}")

    print(f"[+] Loading {args.file} and center-cropping to {SCREEN_WIDTH}x{SCREEN_HEIGHT} (rotate={args.rotate}°)...")
    img = Image.open(args.file)
    jpeg_data = format_frame(img, quality=args.quality, rotate=args.rotate)
    print(f"[+] Formatted JPEG payload: {len(jpeg_data)} bytes")

    dev = DV360S()
    with dev:
        print("[+] Waking screen...")
        dev.wake()
        print("[+] Streaming image to display...")
        dev.send_frame(jpeg_data)
        print("[✓] Image displayed! Holding keepalive (Ctrl+C to stop)...")
        while _running:
            time.sleep(1.0)
            dev.heartbeat()


def cmd_play(args):
    """Stream video (MP4/WebM/AVI) or animated GIF in real time."""
    if not os.path.exists(args.file):
        sys.exit(f"[-] File not found: {args.file}")

    target_fps = args.fps
    frame_delay = 1.0 / target_fps
    dev = DV360S()

    with dev:
        dev.wake()
        print(f"[+] Streaming '{args.file}' at {target_fps} FPS (rotate={args.rotate}°, Ctrl+C to stop)...")

        filters = [
            f"crop='min(iw,ih)':'min(iw,ih)'",
            f"scale={SCREEN_WIDTH}:{SCREEN_HEIGHT}"
        ]
        if args.rotate == 90:
            filters.append("transpose=1")
        elif args.rotate == 180:
            filters.append("transpose=1,transpose=1")
        elif args.rotate == 270:
            filters.append("transpose=2")
        vf_filter = ",".join(filters)

        ffmpeg_cmd = [
            "ffmpeg", "-re", "-stream_loop", "-1" if args.loop else "0",
            "-i", args.file,
            "-vf", vf_filter,
            "-r", str(target_fps),
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-q:v", str(args.qscale),
            "-"
        ]

        try:
            proc = subprocess.Popen(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except FileNotFoundError:
            sys.exit("[-] ffmpeg is required to stream video. Please install ffmpeg.")

        jpeg_buffer = bytearray()
        try:
            while _running:
                chunk = proc.stdout.read(4096)
                if not chunk:
                    break
                jpeg_buffer.extend(chunk)

                while True:
                    start = jpeg_buffer.find(b"\xff\xd8")
                    if start == -1:
                        jpeg_buffer.clear()
                        break
                    end = jpeg_buffer.find(b"\xff\xd9", start)
                    if end == -1:
                        if start > 0:
                            del jpeg_buffer[:start]
                        break

                    frame_data = bytes(jpeg_buffer[start : end + 2])
                    del jpeg_buffer[: end + 2]

                    t0 = time.time()
                    dev.send_frame(frame_data)

                    elapsed = time.time() - t0
                    sleep_time = frame_delay - elapsed
                    if sleep_time > 0:
                        time.sleep(sleep_time)

        finally:
            proc.terminate()


def cmd_stats(args):
    """Render a dynamic live system monitor HUD on the display."""
    if Image is None or psutil is None:
        sys.exit("[-] Pillow and psutil are required: pip install Pillow psutil")

    dev = DV360S()
    with dev:
        dev.wake()
        print(f"[+] Streaming live stats dashboard to display (rotate={args.rotate}°, Ctrl+C to stop)...")

        while _running:
            cpu_pct = psutil.cpu_percent(interval=None)
            ram = psutil.virtual_memory()

            cpu_temp = 0.0
            gpu_temp = 0.0
            try:
                temps = psutil.sensors_temperatures()
                if "k10temp" in temps:
                    cpu_temp = temps["k10temp"][0].current
                elif "coretemp" in temps:
                    cpu_temp = temps["coretemp"][0].current
                elif temps:
                    cpu_temp = next(iter(temps.values()))[0].current

                if "amdgpu" in temps:
                    gpu_temp = temps["amdgpu"][0].current
            except Exception:
                pass

            img = Image.new("RGB", (SCREEN_WIDTH, SCREEN_HEIGHT), color=(10, 15, 26))
            draw = ImageDraw.Draw(img)

            # Outer CPU gauge ring
            draw.ellipse([24, 24, 456, 456], outline=(30, 41, 59), width=14)
            cpu_angle = int(360 * (cpu_pct / 100.0))
            draw.arc([24, 24, 456, 456], start=-90, end=-90 + cpu_angle, fill=(56, 189, 248), width=14)

            # Inner RAM gauge ring
            draw.ellipse([54, 54, 426, 426], outline=(30, 41, 59), width=10)
            ram_angle = int(360 * (ram.percent / 100.0))
            draw.arc([54, 54, 426, 426], start=-90, end=-90 + ram_angle, fill=(168, 85, 247), width=10)

            # Center texts
            draw.text((240, 130), "DARKFLASH DV360S", fill=(148, 163, 184), anchor="mm")

            draw.text((240, 180), "CPU TEMP", fill=(148, 163, 184), anchor="mm")
            draw.text((240, 225), f"{cpu_temp:.0f}°C" if cpu_temp else "--°C", fill=(244, 63, 94), anchor="mm")

            draw.text((150, 305), "CPU LOAD", fill=(148, 163, 184), anchor="mm")
            draw.text((150, 345), f"{cpu_pct:.0f}%", fill=(56, 189, 248), anchor="mm")

            draw.text((330, 305), "RAM USED", fill=(148, 163, 184), anchor="mm")
            draw.text((330, 345), f"{ram.percent:.0f}%", fill=(168, 85, 247), anchor="mm")

            if gpu_temp:
                draw.text((240, 395), f"GPU {gpu_temp:.0f}°C", fill=(52, 211, 153), anchor="mm")

            jpeg_data = format_frame(img, quality=args.quality, rotate=args.rotate)
            dev.send_frame(jpeg_data)

            time.sleep(args.interval)


def main():
    default_rotate = int(os.environ.get("DV360S_ROTATE", "90"))

    parser = argparse.ArgumentParser(description="Darkflash DV360S Max AIO LCD Controller")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("detect", help="Check USB detection for DV360S Max")

    sub.add_parser("wake", help="Wake screen and keep backlight alive")

    p_bright = sub.add_parser("brightness", help="Set screen brightness")
    p_bright.add_argument("level", type=int, choices=range(0, 101))

    p_img = sub.add_parser("image", help="Display a static image (PNG/JPG)")
    p_img.add_argument("file", help="Path to image file")
    p_img.add_argument("--quality", type=int, default=70, help="JPEG quality (default: 70)")
    p_img.add_argument("--rotate", type=int, choices=[0, 90, 180, 270], default=default_rotate,
                       help="Display rotation in degrees (default: 90 for AM5)")

    p_play = sub.add_parser("play", help="Play video or animated GIF")
    p_play.add_argument("file", help="Path to video or GIF file")
    p_play.add_argument("--fps", type=int, default=20, help="Target FPS (default: 20)")
    p_play.add_argument("--loop", action="store_true", default=True, help="Loop playback")
    p_play.add_argument("--qscale", type=int, default=5, help="FFmpeg JPEG quality scale 2-10 (default: 5)")
    p_play.add_argument("--rotate", type=int, choices=[0, 90, 180, 270], default=default_rotate,
                        help="Display rotation in degrees (default: 90 for AM5)")

    p_stats = sub.add_parser("stats", help="Render live system sensor HUD on screen")
    p_stats.add_argument("--interval", type=float, default=1.0)
    p_stats.add_argument("--quality", type=int, default=70)
    p_stats.add_argument("--rotate", type=int, choices=[0, 90, 180, 270], default=default_rotate,
                         help="Display rotation in degrees (default: 90 for AM5)")

    p_gui = sub.add_parser("gui", help="Launch Darkflash Studio Web GUI application")
    p_gui.add_argument("--no-browser", action="store_true", help="Don't open browser automatically")

    args = parser.parse_args()

    def cmd_gui(args):
        from dh360d.studio import start_server
        start_server(open_browser=not args.no_browser)

    dispatch = {
        "detect": cmd_detect,
        "wake": cmd_wake,
        "brightness": cmd_brightness,
        "image": cmd_image,
        "play": cmd_play,
        "stats": cmd_stats,
        "gui": cmd_gui,
    }

    dispatch[args.cmd](args)


if __name__ == "__main__":
    main()
