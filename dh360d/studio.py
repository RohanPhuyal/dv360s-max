#!/usr/bin/env python3
"""
Darkflash Studio - Backend Server & Live Display Compositor
Serves the Material Design 3 Web UI and streams real-time composited HUD frames
to the Darkflash DV360S Max IPS LCD over USB HID.
"""

from __future__ import annotations
import datetime
from email import policy
from email.parser import BytesParser
import functools
import glob
import io
import json
import math
import os
import shutil
import signal
import socketserver
import subprocess
import sys
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urlparse

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    Image = None
    ImageFilter = None

try:
    import psutil
except ImportError:
    psutil = None

from dh360d.dv360s import DV360S, SCREEN_WIDTH, SCREEN_HEIGHT, format_frame

PORT = 8989
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
UPLOADS_DIR = os.path.join(WEB_DIR, "uploads")
CONFIG_PATH = os.path.expanduser("~/.config/darkflash/studio_state.json")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)


@functools.lru_cache(maxsize=128)
def get_font(size: int, weight_or_bold: Any = "bold") -> ImageFont.FreeTypeFont:
    """Load cached system TTF font with optimal weights for cyber LCD displays."""
    if ImageFont is None:
        return None

    if isinstance(weight_or_bold, bool):
        weight = "extrabold" if weight_or_bold else "regular"
    else:
        weight = str(weight_or_bold).lower()

    if weight == "extrabold":
        candidates = [
            "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-ExtraBold.ttf",
            "/usr/share/fonts/TTF/JetBrainsMonoNLNerdFont-ExtraBold.ttf",
            "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf",
            "/home/ron/.local/share/fonts/JetBrainsMono/JetBrainsMonoNerdFontMono-SemiBold.ttf",
        ]
    elif weight == "bold":
        candidates = [
            "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf",
            "/usr/share/fonts/TTF/JetBrainsMonoNLNerdFont-Bold.ttf",
            "/home/ron/.local/share/fonts/JetBrainsMono/JetBrainsMonoNerdFontMono-SemiBold.ttf",
            "/usr/share/fonts/liberation/LiberationMono-Bold.ttf",
        ]
    elif weight == "semibold":
        candidates = [
            "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-SemiBold.ttf",
            "/home/ron/.local/share/fonts/JetBrainsMono/JetBrainsMonoNerdFontMono-SemiBold.ttf",
            "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Medium.ttf",
            "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf",
        ]
    else:
        candidates = [
            "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf",
            "/usr/share/fonts/liberation/LiberationMono-Regular.ttf",
            "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
        ]

    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def parse_color_with_alpha(color_val: Any, alpha_override: Optional[float] = None, default: tuple = (255, 255, 255, 255)) -> tuple:
    """Parse hex or rgba color to RGBA tuple, optionally overriding alpha channel."""
    if not color_val or not isinstance(color_val, str):
        col = default
    else:
        s = color_val.strip()
        col = default
        if s.startswith("#"):
            s = s[1:]
            if len(s) == 3:
                s = "".join([c * 2 for c in s])
            if len(s) == 6:
                col = (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)
            elif len(s) == 8:
                col = (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), int(s[6:8], 16))
        elif s.startswith("rgba"):
            try:
                parts = s[s.find("(") + 1 : s.find(")")].split(",")
                r, g, b = int(parts[0].strip()), int(parts[1].strip()), int(parts[2].strip())
                a = int(float(parts[3].strip()) * 255)
                col = (r, g, b, min(255, max(0, a)))
            except Exception:
                pass
        elif s.startswith("rgb"):
            try:
                parts = s[s.find("(") + 1 : s.find(")")].split(",")
                col = (int(parts[0].strip()), int(parts[1].strip()), int(parts[2].strip()), 255)
            except Exception:
                pass

    if alpha_override is not None:
        try:
            a_val = float(alpha_override)
            if a_val <= 1.0:
                a_int = int(round(a_val * 255))
            else:
                a_int = int(round(a_val))
            col = (col[0], col[1], col[2], min(255, max(0, a_int)))
        except Exception:
            pass

    return col


parse_hex_color = parse_color_with_alpha


def draw_text_with_shadow(
    draw: ImageDraw.ImageDraw,
    target_img: Image.Image,
    pos: Tuple[int, int],
    text: str,
    font: ImageFont.ImageFont,
    fill: Tuple[int, int, int, int],
    shadow_fill: Tuple[int, int, int, int] = (0, 0, 0, 190),
    shadow_offset: Tuple[int, int] = (0, 2),
    anchor: str = "mm"
):
    """
    Renders text with an anti-aliased backdrop shadow for high readability and cyber pop
    over complex background images.
    """
    x, y = pos
    if not text:
        return

    fs = getattr(font, "size", 20)
    if fs >= 24 and shadow_fill and shadow_fill[3] > 0 and ImageFilter is not None:
        s_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
        ds = ImageDraw.Draw(s_layer)
        ds.text((x + shadow_offset[0], y + shadow_offset[1]), text, fill=shadow_fill, font=font, anchor=anchor)
        blurred = s_layer.filter(ImageFilter.GaussianBlur(radius=2.0))
        target_img.alpha_composite(blurred)
    elif shadow_fill and shadow_fill[3] > 0:
        for ox, oy in [(-1, 0), (1, 0), (0, -1), (0, 1), (0, 2)]:
            draw.text((x + ox, y + oy), text, fill=shadow_fill, font=font, anchor=anchor)

    draw.text((x, y), text, fill=fill, font=font, anchor=anchor)


def draw_layer_effect_text(
    draw: ImageDraw.ImageDraw,
    target_overlay: Image.Image,
    pos: Tuple[int, int],
    text: str,
    font: ImageFont.ImageFont,
    fill_color: Tuple[int, int, int, int],
    layer_cfg: Dict[str, Any],
    anchor: str = "mm"
):
    """
    Renders text with authentic neon glow bloom, drop shadow, or outline matching web preview 1:1.
    """
    x, y = pos
    if not text:
        return

    eff_type = layer_cfg.get("effectType", "glow")
    eff_col_raw = layer_cfg.get("effectColor") or layer_cfg.get("color") or "#00f0ff"
    eff_col = parse_color_with_alpha(eff_col_raw, default=fill_color)
    eff_blur = int(layer_cfg.get("effectBlur", 14 if eff_type == "glow" else (8 if eff_type == "shadow" else 2)))

    if eff_type == "glow" and eff_blur > 0 and ImageFilter is not None:
        glow_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
        dg = ImageDraw.Draw(glow_layer)
        glow_stroke = max(1, eff_blur // 5)
        glow_rgba = (eff_col[0], eff_col[1], eff_col[2], min(255, max(180, eff_col[3])))
        dg.text((x, y), text, fill=glow_rgba, font=font, anchor=anchor, stroke_width=glow_stroke, stroke_fill=glow_rgba)

        radius = max(1.0, eff_blur / 2.5)
        bloom = glow_layer.filter(ImageFilter.GaussianBlur(radius=radius))
        target_overlay.alpha_composite(bloom)
        if eff_blur >= 10:
            target_overlay.alpha_composite(bloom)

    elif eff_type == "shadow" and eff_blur > 0 and ImageFilter is not None:
        s_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
        ds = ImageDraw.Draw(s_layer)
        s_col = (0, 0, 0, 200)
        ds.text((x + 2, y + 3), text, fill=s_col, font=font, anchor=anchor)
        radius = max(1.0, eff_blur / 3.0)
        blurred = s_layer.filter(ImageFilter.GaussianBlur(radius=radius))
        target_overlay.alpha_composite(blurred)

    elif eff_type == "outline" and eff_blur > 0:
        stroke_w = max(1, min(5, eff_blur))
        draw.text((x, y), text, fill=fill_color, font=font, anchor=anchor, stroke_width=stroke_w, stroke_fill=eff_col)
        return

    # Draw the sharp text glyphs on top
    draw.text((x, y), text, fill=fill_color, font=font, anchor=anchor)


class SensorCollector:
    """Thread-safe host hardware sensor reader with 1.0s caching and selective metric polling."""

    _cached_stats: Dict[str, Any] = {
        "cpu_temp": 40.0,
        "cpu_pct": 0.0,
        "gpu_temp": 38.0,
        "gpu_pct": 0.0,
        "ram_pct": 0.0,
        "ram_used_gb": 0.0,
        "ram_total_gb": 16.0,
    }
    _last_poll_time: float = 0.0
    _lock = threading.Lock()
    _CACHE_INTERVAL: float = 1.0  # Polling throttle: maximum once per 1.0 second

    _cpu_hwmon_path: Optional[str] = None
    _gpu_hwmon_path: Optional[str] = None
    _paths_initialized: bool = False

    @classmethod
    def _init_hwmon_paths(cls):
        if cls._paths_initialized:
            return
        cls._paths_initialized = True
        try:
            for p in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
                name_file = os.path.join(p, "name")
                if not os.path.exists(name_file):
                    continue
                try:
                    with open(name_file, "r") as f:
                        name = f.read().strip().lower()
                    if name in ("k10temp", "coretemp", "zenpower") and not cls._cpu_hwmon_path:
                        t1 = os.path.join(p, "temp1_input")
                        if os.path.exists(t1):
                            cls._cpu_hwmon_path = t1
                    elif name in ("amdgpu",) and not cls._gpu_hwmon_path:
                        t1 = os.path.join(p, "temp1_input")
                        if os.path.exists(t1):
                            cls._gpu_hwmon_path = t1
                except Exception:
                    pass
        except Exception:
            pass

    @staticmethod
    def extract_needed_metrics(layers: List[Dict[str, Any]]) -> Set[str]:
        """Inspects active layers and returns the set of required sensor metrics."""
        needed: Set[str] = set()
        for layer in layers:
            if not layer.get("visible", True):
                continue
            l_type = layer.get("type")
            if l_type in ("cpu_temp", "cpu_gauge"):
                needed.add("cpu_temp")
            elif l_type in ("gpu_temp", "gpu_gauge"):
                needed.add("gpu_temp")
            elif l_type == "dual_temp":
                needed.add("cpu_temp")
                needed.add("gpu_temp")
            elif l_type == "cpu_load":
                needed.add("cpu_pct")
            elif l_type in ("ram_stat", "ram_gauge"):
                needed.add("ram")
        return needed

    @classmethod
    def get_stats(cls, needed: Optional[Set[str]] = None, force: bool = False) -> Dict[str, Any]:
        """
        Returns system stats. Returns cached stats if polled within 1.0s.
        When refreshing, only queries metrics specified in `needed` (or all if needed is None).
        """
        now = time.time()
        if not force and (now - cls._last_poll_time < cls._CACHE_INTERVAL):
            return dict(cls._cached_stats)

        with cls._lock:
            now = time.time()
            if not force and (now - cls._last_poll_time < cls._CACHE_INTERVAL):
                return dict(cls._cached_stats)

            cls._init_hwmon_paths()

            check_cpu_pct = needed is None or "cpu_pct" in needed
            check_ram = needed is None or "ram" in needed
            check_cpu_temp = needed is None or "cpu_temp" in needed
            check_gpu_temp = needed is None or "gpu_temp" in needed

            if check_cpu_pct and psutil is not None:
                try:
                    cls._cached_stats["cpu_pct"] = psutil.cpu_percent(interval=None)
                except Exception:
                    pass

            if check_ram and psutil is not None:
                try:
                    mem = psutil.virtual_memory()
                    cls._cached_stats["ram_pct"] = mem.percent
                    cls._cached_stats["ram_used_gb"] = round(mem.used / (1024 ** 3), 1)
                    cls._cached_stats["ram_total_gb"] = round(mem.total / (1024 ** 3), 1)
                except Exception:
                    pass

            # Fast direct sysfs read for CPU temp, with psutil fallback
            if check_cpu_temp:
                read_success = False
                if cls._cpu_hwmon_path and os.path.exists(cls._cpu_hwmon_path):
                    try:
                        with open(cls._cpu_hwmon_path, "r") as f:
                            cls._cached_stats["cpu_temp"] = float(f.read().strip()) / 1000.0
                            read_success = True
                    except Exception:
                        pass
                if not read_success and psutil is not None:
                    try:
                        temps = psutil.sensors_temperatures()
                        if "k10temp" in temps:
                            cls._cached_stats["cpu_temp"] = temps["k10temp"][0].current
                        elif "coretemp" in temps:
                            cls._cached_stats["cpu_temp"] = temps["coretemp"][0].current
                        elif temps:
                            cls._cached_stats["cpu_temp"] = next(iter(temps.values()))[0].current
                    except Exception:
                        pass

            # Fast direct sysfs read for GPU temp, with psutil fallback
            if check_gpu_temp:
                read_success = False
                if cls._gpu_hwmon_path and os.path.exists(cls._gpu_hwmon_path):
                    try:
                        with open(cls._gpu_hwmon_path, "r") as f:
                            cls._cached_stats["gpu_temp"] = float(f.read().strip()) / 1000.0
                            read_success = True
                    except Exception:
                        pass
                if not read_success and psutil is not None:
                    try:
                        temps = psutil.sensors_temperatures()
                        if "amdgpu" in temps:
                            cls._cached_stats["gpu_temp"] = temps["amdgpu"][0].current
                    except Exception:
                        pass

            cls._last_poll_time = now
            return dict(cls._cached_stats)


class DisplayCompositor:
    """
    Renders background frames and widget layers (gauges, bars, clock, badges),
    handling live composite rendering and video stream decoding.
    """

    def __init__(self):
        self.device: Optional[DV360S] = None
        self.is_streaming = False
        self.config: Dict[str, Any] = {
            "rotation": 90,
            "brightness": 100,
            "background": {"type": "color", "color": "#0a0a0f", "serverPath": None},
            "layers": [],
        }
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.worker_thread: Optional[threading.Thread] = None
        self.current_brightness = 100
        self.is_gamemode = False

    def start(self):
        if self.worker_thread and self.worker_thread.is_alive():
            return
        self.stop_event.clear()
        self.worker_thread = threading.Thread(target=self._streaming_loop, daemon=True)
        self.worker_thread.start()

    def set_gamemode(self, enabled: bool):
        with self.lock:
            self.is_gamemode = bool(enabled)
        print(f"[*] GameMode changed: {self.is_gamemode}")

    def stop(self):
        self.stop_event.set()
        if self.worker_thread and self.worker_thread.is_alive():
            self.worker_thread.join(timeout=2.0)
        self.is_streaming = False
        if self.device:
            self.device.close()
            self.device = None

    def apply_config(self, new_config: Dict[str, Any]):
        with self.lock:
            self.config = new_config
            if "brightness" in new_config:
                self.current_brightness = int(new_config["brightness"])
        self.save_config()

        # Restart worker if streaming
        self.stop_event.set()
        if self.worker_thread and self.worker_thread.is_alive():
            self.worker_thread.join(timeout=1.5)
        self.stop_event.clear()
        self.worker_thread = threading.Thread(target=self._streaming_loop, daemon=True)
        self.worker_thread.start()

    def set_brightness(self, level: int):
        self.current_brightness = max(0, min(100, int(level)))
        if self.device:
            try:
                self.device.set_brightness(self.current_brightness)
            except Exception:
                pass

    def wake(self):
        if self.device:
            try:
                self.device.wake()
            except Exception:
                pass

    def sleep(self):
        self.set_brightness(0)

    def save_config(self):
        try:
            with open(CONFIG_PATH, "w") as f:
                json.dump(self.config, f, indent=2)
        except Exception:
            pass

    def load_config(self):
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r") as f:
                    self.config = json.load(f)
            except Exception:
                pass

    def _ensure_device(self) -> bool:
        if self.device and self.device.fd is not None:
            return True
        try:
            node = DV360S.detect()
            if not node:
                return False
            self.device = DV360S(node)
            self.device.open()
            self.device.wake()
            self.device.set_brightness(self.current_brightness)
            return True
        except Exception as e:
            print(f"[!] Hardware connect error: {e}")
            self.device = None
            return False

    def _streaming_loop(self):
        print("[+] DisplayCompositor streaming thread started.")
        self.is_streaming = True

        while not self.stop_event.is_set():
            if not self._ensure_device():
                time.sleep(1.0)
                continue

            with self.lock:
                cfg = dict(self.config)
            bg = cfg.get("background", {})
            bg_type = bg.get("type", "color")
            bg_path = bg.get("serverPath")
            rotation = cfg.get("rotation", 90)

            # Check if video background and resolve path
            actual_video_path = None
            if bg_type == "video" and bg_path:
                cand = bg_path
                if not os.path.exists(cand):
                    cand = os.path.join(WEB_DIR, bg_path.lstrip("/"))
                if os.path.exists(cand):
                    actual_video_path = cand

            if actual_video_path:
                self._stream_video(actual_video_path, cfg)
            else:
                self._stream_static(cfg)

        self.is_streaming = False
        print("[+] DisplayCompositor streaming thread stopped.")

    def _stream_static(self, cfg: Dict[str, Any]):
        """Render static background + dynamic widget layers."""
        bg = cfg.get("background", {})
        rotation = cfg.get("rotation", 90)
        layers = cfg.get("layers", [])
        bg_scale = float(bg.get("scale", 1.0))
        bg_visible = bg.get("visible", True)
        needed_metrics = SensorCollector.extract_needed_metrics(layers)

        # Preload background image if any
        bg_img = None
        bg_path = bg.get("serverPath")
        if bg_path and bg_visible:
            if not os.path.exists(bg_path):
                cand = os.path.join(WEB_DIR, bg_path.lstrip("/"))
                if os.path.exists(cand):
                    bg_path = cand
            if os.path.exists(bg_path):
                try:
                    raw_bg = Image.open(bg_path).convert("RGBA")
                    w, h = raw_bg.size
                    min_dim = min(w, h)
                    cropped = raw_bg.crop(((w - min_dim) // 2, (h - min_dim) // 2, (w + min_dim) // 2, (h + min_dim) // 2))
                    if bg_scale != 1.0:
                        draw_dim = max(32, int(round(SCREEN_WIDTH * bg_scale)))
                        scaled = cropped.resize((draw_dim, draw_dim), Image.Resampling.LANCZOS)
                        bg_img = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), color=(0, 0, 0, 255))
                        bg_img.paste(scaled, (SCREEN_WIDTH // 2 - draw_dim // 2, SCREEN_HEIGHT // 2 - draw_dim // 2))
                    else:
                        bg_img = cropped.resize((SCREEN_WIDTH, SCREEN_HEIGHT), Image.Resampling.LANCZOS)
                except Exception as e:
                    print(f"[!] Failed to load background image: {e}")

        bg_color = parse_hex_color(bg.get("color", "#0a0a0f"))

        while not self.stop_event.is_set():
            if self.is_gamemode:
                time.sleep(0.5)
                continue

            t0 = time.time()
            stats = SensorCollector.get_stats(needed=needed_metrics)

            # Base frame
            if bg_img:
                frame = bg_img.copy()
            else:
                frame = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), color=bg_color)

            # Overlay widgets
            self._render_widgets(frame, layers, stats)

            # Convert to RGB & apply rotation
            rgb_frame = frame.convert("RGB")
            if rotation:
                rgb_frame = rgb_frame.rotate(-rotation)

            buf = io.BytesIO()
            rgb_frame.save(buf, format="JPEG", quality=98, subsampling=0, optimize=True)
            jpeg_data = buf.getvalue()

            try:
                self.device.send_frame(jpeg_data)
                self.device.heartbeat()
            except Exception as e:
                print(f"[!] Send frame failed: {e}")
                self.device = None
                break

            # Rate limit to ~1.0s or until stop event
            elapsed = time.time() - t0
            wait_time = max(0.05, 1.0 - elapsed)
            self.stop_event.wait(wait_time)

    def _stream_video(self, video_path: str, cfg: Dict[str, Any]):
        """Decode video (pre-buffered in RAM for short loops, pipe for long), composite widgets, and stream."""
        target_fps = 20
        frame_delay = 1.0 / target_fps
        rotation = cfg.get("rotation", 90)
        layers = cfg.get("layers", [])
        bg = cfg.get("background", {})
        bg_scale = float(bg.get("scale", 1.0))
        bg_visible = bg.get("visible", True)
        needed_metrics = SensorCollector.extract_needed_metrics(layers)

        # Pre-decode short video loops (<= 300 frames / 15s) into RAM to eliminate FFmpeg background CPU!
        buffered_frames: List[Image.Image] = []
        try:
            probe_cmd = [
                "ffmpeg", "-i", video_path,
                "-vf", f"crop='min(iw,ih)':'min(iw,ih)',scale={SCREEN_WIDTH}:{SCREEN_HEIGHT}",
                "-r", str(target_fps),
                "-t", "16",
                "-f", "rawvideo",
                "-pix_fmt", "rgba",
                "-"
            ]
            proc = subprocess.Popen(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            frame_bytes_len = SCREEN_WIDTH * SCREEN_HEIGHT * 4

            while len(buffered_frames) < 300 and not self.stop_event.is_set():
                chunk = proc.stdout.read(frame_bytes_len)
                if not chunk or len(chunk) < frame_bytes_len:
                    break
                if bg_visible:
                    f = Image.frombytes("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), chunk)
                    if bg_scale != 1.0:
                        draw_dim = max(32, int(round(SCREEN_WIDTH * bg_scale)))
                        scaled = f.resize((draw_dim, draw_dim), Image.Resampling.BILINEAR)
                        canvas = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 255))
                        canvas.paste(scaled, (SCREEN_WIDTH // 2 - draw_dim // 2, SCREEN_HEIGHT // 2 - draw_dim // 2))
                        f = canvas
                else:
                    f = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), color=(10, 10, 15, 255))
                buffered_frames.append(f)

            proc.terminate()
            proc.wait(timeout=0.5)
        except Exception as e:
            print(f"[!] Video pre-buffer error: {e}")
            buffered_frames = []

        pipe_proc = None
        if not buffered_frames:
            # Fallback for very long videos: stream via pipe
            ffmpeg_cmd = [
                "ffmpeg", "-stream_loop", "-1",
                "-i", video_path,
                "-vf", f"crop='min(iw,ih)':'min(iw,ih)',scale={SCREEN_WIDTH}:{SCREEN_HEIGHT}",
                "-r", str(target_fps),
                "-f", "rawvideo",
                "-pix_fmt", "rgba",
                "-"
            ]
            pipe_proc = subprocess.Popen(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

        frame_idx = 0
        total_buffered = len(buffered_frames)
        cached_overlay: Optional[Image.Image] = None
        last_overlay_sec: int = -1

        try:
            while not self.stop_event.is_set():
                if self.is_gamemode:
                    time.sleep(0.5)
                    continue

                t0 = time.time()
                curr_sec = int(t0)

                if buffered_frames:
                    frame = buffered_frames[frame_idx % total_buffered].copy()
                    frame_idx += 1
                else:
                    raw_bytes = pipe_proc.stdout.read(SCREEN_WIDTH * SCREEN_HEIGHT * 4)
                    if not raw_bytes or len(raw_bytes) < SCREEN_WIDTH * SCREEN_HEIGHT * 4:
                        break
                    f = Image.frombytes("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), raw_bytes)
                    if bg_scale != 1.0:
                        draw_dim = max(32, int(round(SCREEN_WIDTH * bg_scale)))
                        scaled = f.resize((draw_dim, draw_dim), Image.Resampling.BILINEAR)
                        frame = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 255))
                        frame.paste(scaled, (SCREEN_WIDTH // 2 - draw_dim // 2, SCREEN_HEIGHT // 2 - draw_dim // 2))
                    else:
                        frame = f

                # Re-render widget overlay only once per second (when sensor stats or clock seconds update)
                if cached_overlay is None or curr_sec != last_overlay_sec:
                    stats = SensorCollector.get_stats(needed=needed_metrics)
                    cached_overlay = self._create_widgets_overlay(layers, stats)
                    last_overlay_sec = curr_sec

                if cached_overlay:
                    frame.alpha_composite(cached_overlay)

                rgb_frame = frame.convert("RGB")
                if rotation:
                    rgb_frame = rgb_frame.rotate(-rotation)

                buf = io.BytesIO()
                rgb_frame.save(buf, format="JPEG", quality=92, subsampling=0, optimize=True)
                jpeg_data = buf.getvalue()

                self.device.send_frame(jpeg_data)

                elapsed = time.time() - t0
                sleep_dur = frame_delay - elapsed
                if sleep_dur > 0:
                    time.sleep(sleep_dur)

        except Exception as e:
            print(f"[!] Video stream error: {e}")
        finally:
            if pipe_proc:
                try:
                    pipe_proc.terminate()
                    pipe_proc.wait(timeout=0.5)
                except Exception:
                    try:
                        pipe_proc.kill()
                        pipe_proc.wait(timeout=0.5)
                    except Exception:
                        pass

    def _render_widgets(self, img: Image.Image, layers: List[Dict[str, Any]], stats: Dict[str, Any]):
        """Draws each configured widget on top of the RGBA frame using proper alpha compositing."""
        overlay = self._create_widgets_overlay(layers, stats)
        img.alpha_composite(overlay)

    def _create_widgets_overlay(self, layers: List[Dict[str, Any]], stats: Dict[str, Any], dt: Optional[datetime.datetime] = None) -> Image.Image:
        """Renders widget layers onto a transparent 480x480 RGBA canvas."""
        now = dt or datetime.datetime.now()

        # Dedicated transparent layer for alpha compositing
        overlay = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay, "RGBA")

        for layer in layers:
            if not layer.get("visible", True):
                continue
            l_type = layer.get("type")
            x = int(layer.get("x", 240))
            y = int(layer.get("y", 240))
            col = parse_color_with_alpha(layer.get("color", "#00f0ff"))

            if l_type == "cpu_temp":
                fs = int(layer.get("fontSize", 44))
                font = get_font(fs, "extrabold")
                val = f"{int(round(stats.get('cpu_temp', 45)))}{layer.get('unit', '°C')}"
                draw_layer_effect_text(draw, overlay, (x, y), val, font, col, layer, anchor="mm")
                if layer.get("showLabel", True):
                    lbl_fs = max(10, int(fs * 0.26))
                    lbl_font = get_font(lbl_fs, "bold")
                    draw_text_with_shadow(draw, overlay, (x, y - int(fs * 0.65)), str(layer.get("label", "CPU TEMP")), lbl_font, (230, 240, 255, 220), shadow_fill=(0, 0, 0, 200))

            elif l_type == "gpu_temp":
                fs = int(layer.get("fontSize", 38))
                font = get_font(fs, "extrabold")
                val = f"{int(round(stats.get('gpu_temp', 40)))}{layer.get('unit', '°C')}"
                draw_layer_effect_text(draw, overlay, (x, y), val, font, col, layer, anchor="mm")
                if layer.get("showLabel", True):
                    lbl_fs = max(10, int(fs * 0.26))
                    lbl_font = get_font(lbl_fs, "bold")
                    draw_text_with_shadow(draw, overlay, (x, y - int(fs * 0.65)), str(layer.get("label", "GPU TEMP")), lbl_font, (230, 240, 255, 220), shadow_fill=(0, 0, 0, 200))

            elif l_type == "dual_temp":
                fs = int(layer.get("fontSize", 22))
                cpu_col = parse_color_with_alpha(layer.get("cpuColor", "#00f0ff"))
                gpu_col = parse_color_with_alpha(layer.get("gpuColor", "#ff007f"))
                cpu_t = f"{int(round(stats.get('cpu_temp', 45)))}°C"
                gpu_t = f"{int(round(stats.get('gpu_temp', 40)))}°C"
                w, h = 240, fs + 26
                left, top = x - w // 2, y - h // 2

                # Frosted glass backing and high-contrast border
                bg_col = parse_color_with_alpha(layer.get("bgColor", "#0a0e1a"), layer.get("bgAlpha", 0.85))
                border_col = parse_color_with_alpha(layer.get("borderColor", "#00f0ff"), layer.get("borderAlpha", 0.75))
                border_w = max(1, min(4, int(layer.get("borderWidth", 2))))

                # Container glow if glow is active
                eff_type = layer.get("effectType", "glow")
                eff_blur = int(layer.get("effectBlur", 10))
                if eff_type == "glow" and eff_blur > 0 and ImageFilter is not None:
                    g_box = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
                    dg_box = ImageDraw.Draw(g_box)
                    dg_box.rounded_rectangle([left, top, left + w, top + h], radius=10, outline=border_col, width=border_w + 1)
                    bloom_b = g_box.filter(ImageFilter.GaussianBlur(radius=max(1.0, eff_blur / 2.5)))
                    overlay.alpha_composite(bloom_b)

                c_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
                d_c = ImageDraw.Draw(c_layer)
                d_c.rounded_rectangle([left - 1, top - 1, left + w + 1, top + h + 2], radius=11, fill=(0, 0, 0, 120))
                d_c.rounded_rectangle([left, top, left + w, top + h], radius=10, fill=bg_col)
                d_c.rounded_rectangle([left, top, left + w, top + h], radius=10, outline=border_col, width=border_w)
                d_c.line([(x, top + 6), (x, top + h - 6)], fill=(255, 255, 255, 50), width=1)
                overlay.alpha_composite(c_layer)

                sub_font = get_font(10, "bold")
                val_font = get_font(fs, "extrabold")
                draw_text_with_shadow(draw, overlay, (left + int(w * 0.25), top + 11), "CPU", sub_font, (220, 235, 255, 210), shadow_fill=None)
                cpu_layer_cfg = {**layer, "effectColor": layer.get("cpuColor", "#00f0ff"), "effectBlur": min(10, eff_blur)}
                draw_layer_effect_text(draw, overlay, (left + int(w * 0.25), top + int(h * 0.62)), cpu_t, val_font, cpu_col, cpu_layer_cfg, anchor="mm")

                draw_text_with_shadow(draw, overlay, (left + int(w * 0.75), top + 11), "GPU", sub_font, (220, 235, 255, 210), shadow_fill=None)
                gpu_layer_cfg = {**layer, "effectColor": layer.get("gpuColor", "#ff007f"), "effectBlur": min(10, eff_blur)}
                draw_layer_effect_text(draw, overlay, (left + int(w * 0.75), top + int(h * 0.62)), gpu_t, val_font, gpu_col, gpu_layer_cfg, anchor="mm")

            elif l_type == "cpu_load":
                fs = int(layer.get("fontSize", 20))
                font = get_font(fs, "extrabold")
                val = f"{int(round(stats.get('cpu_pct', 0)))}%"
                draw_layer_effect_text(draw, overlay, (x, y), val, font, col, layer, anchor="mm")
                lbl_font = get_font(max(10, int(fs * 0.45)), "bold")
                draw_text_with_shadow(draw, overlay, (x, y + int(fs * 0.65)), str(layer.get("label", "CPU LOAD")), lbl_font, (230, 240, 255, 220), shadow_fill=(0, 0, 0, 180))

            elif l_type == "ram_stat":
                fs = int(layer.get("fontSize", 16))
                font = get_font(fs, "extrabold")
                used = stats.get("ram_used_gb", 0)
                tot = stats.get("ram_total_gb", 16)
                pct = int(round(stats.get("ram_pct", 0)))
                val = f"{used} / {tot} GB"
                val_y = y - int(round(fs * 0.45)) - 2
                lbl_y = y + int(round(fs * 0.45)) + 3
                draw_layer_effect_text(draw, overlay, (x, val_y), val, font, col, layer, anchor="mm")
                lbl_fs = max(9, int(round(fs * 0.6)))
                lbl_font = get_font(lbl_fs, "bold")
                draw_text_with_shadow(draw, overlay, (x, lbl_y), f"RAM USED ({pct}%)", lbl_font, (230, 240, 255, 220), shadow_fill=(0, 0, 0, 180))

            elif l_type == "cpu_gauge":
                r = int(layer.get("radius", 175))
                lw = int(layer.get("lineWidth", 12))
                val = stats.get("cpu_temp", 45)
                pct = min(1.0, max(0.04, val / float(layer.get("maxTemp", 90))))
                track_c = parse_color_with_alpha(layer.get("trackColor", "rgba(255,255,255,0.18)"))
                self._draw_arc_gauge(draw, overlay, layer, x, y, r, lw, pct, col, track_c)

            elif l_type == "gpu_gauge":
                r = int(layer.get("radius", 145))
                lw = int(layer.get("lineWidth", 10))
                val = stats.get("gpu_temp", 40)
                pct = min(1.0, max(0.04, val / float(layer.get("maxTemp", 90))))
                track_c = parse_color_with_alpha(layer.get("trackColor", "rgba(255,255,255,0.18)"))
                self._draw_arc_gauge(draw, overlay, layer, x, y, r, lw, pct, col, track_c)

            elif l_type == "ram_gauge":
                w = int(layer.get("width", 180))
                h = int(layer.get("height", 12))
                pct = min(1.0, max(0.04, stats.get("ram_pct", 30) / 100.0))
                track_c = parse_color_with_alpha(layer.get("trackColor", "rgba(255,255,255,0.2)"))
                self._draw_progress_bar(draw, overlay, layer, x, y, w, h, pct, col, track_c)

            elif l_type == "clock":
                fs = int(layer.get("fontSize", 48))
                font = get_font(fs, "extrabold")
                show_sec = layer.get("showSeconds", False)
                hour12 = layer.get("hour12", False)
                show_ampm = layer.get("showAmPm", False)

                if hour12:
                    raw_h = now.hour
                    ampm = "PM" if raw_h >= 12 else "AM"
                    h12 = raw_h % 12
                    if h12 == 0:
                        h12 = 12
                    h_str = str(h12)
                    time_str = f"{h_str}:{now.minute:02d}:{now.second:02d}" if show_sec else f"{h_str}:{now.minute:02d}"
                    if show_ampm:
                        time_str = f"{time_str} {ampm}"
                else:
                    time_str = now.strftime("%H:%M:%S" if show_sec else "%H:%M")

                draw_layer_effect_text(draw, overlay, (x, y), time_str, font, col, layer, anchor="mm")

                if layer.get("showDate", True):
                    date_fs = max(12, int(fs * 0.28))
                    date_font = get_font(date_fs, "bold")
                    date_str = now.strftime("%a, %b %d").upper()
                    date_y = y + int(fs * 0.52)
                    draw_text_with_shadow(draw, overlay, (x, date_y), date_str, date_font, (240, 245, 255, 230), shadow_fill=(0, 0, 0, 220), shadow_offset=(0, 1))

            elif l_type == "text":
                fs = int(layer.get("fontSize", 14))
                font = get_font(fs, "extrabold")
                draw_layer_effect_text(draw, overlay, (x, y), str(layer.get("text", "")), font, col, layer, anchor="mm")

            elif l_type == "badge":
                text = str(layer.get("text", "AM5 RYZEN"))
                fs = int(layer.get("fontSize", 13))
                font = get_font(fs, "extrabold")
                bbox = draw.textbbox((x, y), text, font=font, anchor="mm")
                px = int(layer.get("paddingX", 14))
                py = int(layer.get("paddingY", 6))
                box = [bbox[0] - px, bbox[1] - py, bbox[2] + px, bbox[3] + py]

                # Real frosted glass background with high contrast
                raw_bg = layer.get("bgColor")
                if not raw_bg or "240, 255, 0.12" in str(raw_bg):
                    raw_bg = "#0a0e1a"
                bg_col = parse_color_with_alpha(raw_bg, layer.get("bgAlpha", 0.85))

                # Vibrant alpha border
                raw_border = layer.get("borderColor") or layer.get("color") or "#00f0ff"
                border_col = parse_color_with_alpha(raw_border, layer.get("borderAlpha", 0.80))
                border_w = max(1, min(4, int(layer.get("borderWidth", 2))))
                radius = max(0, min(16, int(layer.get("borderRadius", 6))))

                eff_type = layer.get("effectType", "glow")
                eff_blur = int(layer.get("effectBlur", 10))

                # Border glow if glow active
                if eff_type == "glow" and eff_blur > 0 and ImageFilter is not None:
                    g_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
                    dg_box = ImageDraw.Draw(g_layer)
                    dg_box.rounded_rectangle(box, radius=radius, outline=border_col, width=border_w + 1)
                    bloom_badge = g_layer.filter(ImageFilter.GaussianBlur(radius=max(1.0, eff_blur / 2.5)))
                    overlay.alpha_composite(bloom_badge)

                # Dedicated sub-layer for true alpha compositing
                b_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
                d_b = ImageDraw.Draw(b_layer)

                # 1. Subtle drop-shadow for elevation
                d_b.rounded_rectangle([box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 2], radius=radius + 1, fill=(0, 0, 0, 110))
                # 2. Dark glass fill
                d_b.rounded_rectangle(box, radius=radius, fill=bg_col)
                # 3. Vibrant alpha border outline
                d_b.rounded_rectangle(box, radius=radius, outline=border_col, width=border_w)

                overlay.alpha_composite(b_layer)

                # 4. Text with effect
                draw_layer_effect_text(draw, overlay, (x, y), text, font, col, layer, anchor="mm")

        return overlay

    def _draw_arc_gauge(self, draw: ImageDraw.ImageDraw, target_overlay: Image.Image, layer: Dict[str, Any], x: int, y: int, r: int, lw: int, pct: float, val_col: tuple, track_col: tuple):
        """Draws a 270-degree round circular gauge arc with optional neon bloom glow."""
        start_angle = 225
        end_angle = 495
        total_deg = end_angle - start_angle
        active_deg = int(total_deg * pct)

        bbox = [x - r, y - r, x + r, y + r]
        # Background track: ensure visible alpha
        if len(track_col) == 4 and track_col[3] < 35:
            track_col = (track_col[0], track_col[1], track_col[2], 50)
        draw.arc(bbox, start=start_angle, end=end_angle, fill=track_col, width=lw)

        # Active arc
        if active_deg > 0:
            eff_type = layer.get("effectType", "glow")
            eff_col_raw = layer.get("effectColor") or layer.get("color") or "#00f0ff"
            eff_col = parse_color_with_alpha(eff_col_raw, default=val_col)
            eff_blur = int(layer.get("effectBlur", 14 if eff_type == "glow" else (8 if eff_type == "shadow" else 2)))

            if eff_type == "glow" and eff_blur > 0 and ImageFilter is not None:
                glow_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
                dg = ImageDraw.Draw(glow_layer)
                glow_w = lw + max(2, eff_blur // 4)
                glow_rgba = (eff_col[0], eff_col[1], eff_col[2], min(255, max(180, eff_col[3])))
                dg.arc(bbox, start=start_angle, end=start_angle + active_deg, fill=glow_rgba, width=glow_w)
                radius = max(1.0, eff_blur / 2.5)
                bloom = glow_layer.filter(ImageFilter.GaussianBlur(radius=radius))
                target_overlay.alpha_composite(bloom)
                if eff_blur >= 10:
                    target_overlay.alpha_composite(bloom)

            elif eff_type == "shadow" and eff_blur > 0 and ImageFilter is not None:
                s_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
                ds = ImageDraw.Draw(s_layer)
                s_bbox = [x - r + 1, y - r + 3, x + r + 1, y + r + 3]
                ds.arc(s_bbox, start=start_angle, end=start_angle + active_deg, fill=(0, 0, 0, 180), width=lw)
                radius = max(1.0, eff_blur / 3.0)
                blurred = s_layer.filter(ImageFilter.GaussianBlur(radius=radius))
                target_overlay.alpha_composite(blurred)

            elif eff_type == "outline" and eff_blur > 0:
                stroke_w = lw + max(2, min(8, eff_blur * 2))
                draw.arc(bbox, start=start_angle, end=start_angle + active_deg, fill=eff_col, width=stroke_w)

            # Draw sharp active arc on top
            draw.arc(bbox, start=start_angle, end=start_angle + active_deg, fill=val_col, width=lw)

    def _draw_progress_bar(self, draw: ImageDraw.ImageDraw, target_overlay: Image.Image, layer: Dict[str, Any], x: int, y: int, w: int, h: int, pct: float, val_col: tuple, track_col: tuple):
        """Draws rounded horizontal progress bar with optional neon bloom glow."""
        left = x - w // 2
        top = y - h // 2
        right = left + w
        bottom = top + h
        radius = h // 2

        # Track
        draw.rounded_rectangle([left, top, right, bottom], radius=radius, fill=track_col)

        # Fill
        fill_w = max(h, int(w * pct))
        eff_type = layer.get("effectType", "glow")
        eff_col_raw = layer.get("effectColor") or layer.get("color") or "#00ff66"
        eff_col = parse_color_with_alpha(eff_col_raw, default=val_col)
        eff_blur = int(layer.get("effectBlur", 14 if eff_type == "glow" else (8 if eff_type == "shadow" else 2)))

        if eff_type == "glow" and eff_blur > 0 and ImageFilter is not None:
            glow_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
            dg = ImageDraw.Draw(glow_layer)
            glow_pad = max(1, eff_blur // 5)
            glow_rgba = (eff_col[0], eff_col[1], eff_col[2], min(255, max(180, eff_col[3])))
            dg.rounded_rectangle([left - glow_pad, top - glow_pad, left + fill_w + glow_pad, bottom + glow_pad], radius=radius + glow_pad, fill=glow_rgba)
            r = max(1.0, eff_blur / 2.5)
            bloom = glow_layer.filter(ImageFilter.GaussianBlur(radius=r))
            target_overlay.alpha_composite(bloom)
            if eff_blur >= 10:
                target_overlay.alpha_composite(bloom)

        elif eff_type == "shadow" and eff_blur > 0 and ImageFilter is not None:
            s_layer = Image.new("RGBA", (SCREEN_WIDTH, SCREEN_HEIGHT), (0, 0, 0, 0))
            ds = ImageDraw.Draw(s_layer)
            ds.rounded_rectangle([left, top + 2, left + fill_w, bottom + 2], radius=radius, fill=(0, 0, 0, 180))
            r = max(1.0, eff_blur / 3.0)
            blurred = s_layer.filter(ImageFilter.GaussianBlur(radius=r))
            target_overlay.alpha_composite(blurred)

        elif eff_type == "outline" and eff_blur > 0:
            stroke_pad = max(1, min(4, eff_blur))
            draw.rounded_rectangle([left - stroke_pad, top - stroke_pad, left + fill_w + stroke_pad, bottom + stroke_pad], radius=radius + stroke_pad, outline=eff_col, width=stroke_pad)

        # Draw crisp active fill
        draw.rounded_rectangle([left, top, left + fill_w, bottom], radius=radius, fill=val_col)

        # Draw label (e.g. RAM 12%)
        label_text = layer.get("label") or f"RAM {int(round(pct * 100))}%"
        lbl_font = get_font(10, "bold")
        draw_text_with_shadow(draw, target_overlay, (x, top - 8), label_text, lbl_font, (220, 235, 255, 220), shadow_fill=(0, 0, 0, 180), anchor="mm")


compositor = DisplayCompositor()


class StudioHandler(SimpleHTTPRequestHandler):
    """HTTP request dispatcher for Darkflash Studio."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/status":
            self._handle_get_status()
        elif path == "/api/sensors":
            self._handle_get_sensors()
        elif path == "/api/state":
            self._handle_get_state()
        elif path == "/api/gamemode":
            self._handle_get_gamemode()
        elif path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        else:
            # Fallback to static web files
            super().do_GET()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        else:
            super().do_HEAD()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/brightness":
            self._handle_post_brightness()
        elif path == "/api/wake":
            self._handle_post_wake()
        elif path == "/api/sleep":
            self._handle_post_sleep()
        elif path == "/api/upload":
            self._handle_post_upload()
        elif path == "/api/apply":
            self._handle_post_apply()
        elif path == "/api/gamemode":
            self._handle_post_gamemode()
        else:
            self.send_error(404, "Unknown API endpoint")

    def _json_response(self, data: Any, code: int = 200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _handle_get_status(self):
        node = DV360S.detect()
        self._json_response({
            "connected": node is not None,
            "node": node,
            "brightness": compositor.current_brightness,
            "streaming": compositor.is_streaming,
            "gamemode": compositor.is_gamemode,
        })

    def _handle_get_gamemode(self):
        self._json_response({"ok": True, "gamemode": compositor.is_gamemode})

    def _handle_post_gamemode(self):
        content_len = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(content_len).decode("utf-8")) if content_len > 0 else {}
        enabled = data.get("enabled")
        if enabled is None:
            enabled = not compositor.is_gamemode
        compositor.set_gamemode(bool(enabled))
        self._json_response({"ok": True, "gamemode": compositor.is_gamemode})

    def _handle_get_sensors(self):
        stats = SensorCollector.get_stats()
        self._json_response(stats)

    def _handle_get_state(self):
        self._json_response(compositor.config)

    def _handle_post_brightness(self):
        content_len = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(content_len).decode("utf-8"))
        level = int(data.get("level", 100))
        compositor.set_brightness(level)
        self._json_response({"ok": True, "level": level})

    def _handle_post_wake(self):
        compositor.wake()
        self._json_response({"ok": True})

    def _handle_post_sleep(self):
        compositor.sleep()
        self._json_response({"ok": True})

    def _handle_post_apply(self):
        content_len = int(self.headers.get("Content-Length", 0))
        new_cfg = json.loads(self.rfile.read(content_len).decode("utf-8"))
        compositor.apply_config(new_cfg)
        self._json_response({"ok": True, "streaming": True})

    def _handle_post_upload(self):
        ctype = self.headers.get("Content-Type", "")
        content_len = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_len)

        if "multipart/form-data" in ctype:
            try:
                msg = BytesParser(policy=policy.default).parsebytes(
                    f"Content-Type: {ctype}\r\n\r\n".encode("latin1") + raw_body
                )
                for part in msg.iter_parts():
                    filename = part.get_filename()
                    if filename:
                        clean_fn = os.path.basename(filename)
                        save_path = os.path.join(UPLOADS_DIR, clean_fn)
                        payload = part.get_payload(decode=True)
                        with open(save_path, "wb") as f:
                            f.write(payload)
                        return self._json_response({
                            "url": f"/uploads/{clean_fn}",
                            "path": save_path,
                            "filename": clean_fn,
                        })
            except Exception as e:
                print(f"[!] Multipart parse error: {e}")

        # Fallback raw binary upload
        fname = os.path.basename(self.headers.get("X-Filename", f"upload_{int(time.time())}.png"))
        save_path = os.path.join(UPLOADS_DIR, fname)
        with open(save_path, "wb") as f:
            f.write(raw_body)
        self._json_response({
            "url": f"/uploads/{fname}",
            "path": save_path,
            "filename": fname,
        })


class ReusableThreadingServer(socketserver.ThreadingMixIn, HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def launch_browser_window(url: str) -> bool:
    chrome_candidates = ["google-chrome-stable", "google-chrome", "chromium", "brave"]
    for ch in chrome_candidates:
        if shutil.which(ch):
            try:
                subprocess.Popen([ch, f"--app={url}", "--class=DarkflashStudio"])
                return True
            except Exception:
                pass
    import webbrowser
    webbrowser.open(url)
    return True


def is_server_alive(port: int = PORT) -> bool:
    import urllib.request
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/status")
        with urllib.request.urlopen(req, timeout=0.8) as r:
            return r.status == 200
    except Exception:
        return False


def start_server(open_browser: bool = True, standalone_window: bool = True):
    url = f"http://127.0.0.1:{PORT}"

    # Single-instance: If already running in background, just open the window and keep streaming!
    if is_server_alive(PORT):
        print(f"[✓] Darkflash Studio daemon is already running in background ({url})")
        if open_browser:
            print("[+] Opening Darkflash Studio window...")
            launch_browser_window(url)
        return

    compositor.load_config()
    server = ReusableThreadingServer(("127.0.0.1", PORT), StudioHandler)

    print(f"\n=======================================================")
    print(f"  Darkflash Studio Daemon active at: {url}")
    print(f"  Background Streaming: Enabled (closing window keeps stream running)")
    print(f"=======================================================\n")

    # Start compositor background stream
    compositor.start()

    if open_browser:
        def launch_ui():
            time.sleep(0.8)
            launch_browser_window(url)
        threading.Thread(target=launch_ui, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Darkflash Studio daemon...")
    finally:
        compositor.stop()
        server.server_close()


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Darkflash Studio Daemon & UI")
    parser.add_argument("--no-browser", action="store_true", help="Do not launch browser window")
    args = parser.parse_args()
    start_server(open_browser=not args.no_browser)


if __name__ == "__main__":
    main()
