#!/usr/bin/env python3
"""
Generate smooth, seamless 20 FPS 480x480 H.264 MP4 video loops for the 6 Darkflash Rendered Themes.
Creates high-contrast, futuristic tech animations matching the Serpantinum & Cyber aesthetic.
"""

import os
import math
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUTPUT_DIR = "/home/ron/dh360d/dh360d/web/assets/official"
WIDTH = 480
HEIGHT = 480
FPS = 20
SECONDS = 3
TOTAL_FRAMES = FPS * SECONDS  # 60 frames

def encode_frames_to_mp4(frame_generator, output_filename):
    out_path = os.path.join(OUTPUT_DIR, output_filename)
    tmp_out = out_path + ".tmp.mp4"
    
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{WIDTH}x{HEIGHT}",
        "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "18",
        "-movflags", "+faststart",
        tmp_out
    ]
    
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    for frame_idx in range(TOTAL_FRAMES):
        img = frame_generator(frame_idx, TOTAL_FRAMES)
        proc.stdin.write(img.tobytes())
        
    proc.stdin.close()
    proc.wait()
    
    if os.path.exists(tmp_out):
        os.replace(tmp_out, out_path)
        print(f"[✓] Generated {output_filename} ({os.path.getsize(out_path)} bytes)")

# --- Theme 1: Cyber Reactor Core ---
def render_theme_1(frame_idx, total):
    progress = frame_idx / total
    t = progress * 2 * math.pi
    
    img = Image.new("RGB", (WIDTH, HEIGHT), (6, 9, 16))
    draw = ImageDraw.Draw(img)
    cx, cy = 240, 240
    
    # Background radial gradient
    glow_r = int(140 + 20 * math.sin(t))
    glow_img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow_img)
    gd.ellipse([cx - glow_r, cy - glow_r, cx + glow_r, cy + glow_r], fill=(0, 240, 255, 30))
    glow_filtered = glow_img.filter(ImageFilter.GaussianBlur(radius=30))
    img.paste(Image.blend(img.convert("RGBA"), glow_filtered, 0.7).convert("RGB"))
    draw = ImageDraw.Draw(img)
    
    # Grid lines in background
    for r in [60, 110, 160, 210]:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(15, 25, 45), width=1)
    
    # 4 Cardinal tick marks
    for deg in range(0, 360, 45):
        rad = math.radians(deg)
        x1 = cx + int(195 * math.cos(rad))
        y1 = cy + int(195 * math.sin(rad))
        x2 = cx + int(215 * math.cos(rad))
        y2 = cy + int(215 * math.sin(rad))
        draw.line([(x1, y1), (x2, y2)], fill=(0, 240, 255, 120), width=2)
        
    # Inner rotating segmented ring 1 (Cyan, clockwise)
    rot1 = progress * 360
    for seg in range(4):
        s_deg = rot1 + seg * 90 + 10
        e_deg = s_deg + 60
        r1 = 170
        draw.arc([cx - r1, cy - r1, cx + r1, cy + r1], start=s_deg, end=e_deg, fill=(0, 240, 255), width=4)
        
    # Outer counter-rotating ring 2 (Pink/Purple, counter-clockwise)
    rot2 = -progress * 360 * 1.5
    for seg in range(6):
        s_deg = rot2 + seg * 60 + 5
        e_deg = s_deg + 40
        r2 = 195
        draw.arc([cx - r2, cy - r2, cx + r2, cy + r2], start=s_deg, end=e_deg, fill=(255, 0, 127), width=3)
        
    # Core pulsing plasma ring
    r_core = int(45 + 8 * math.sin(t * 2))
    draw.ellipse([cx - r_core, cy - r_core, cx + r_core, cy + r_core], outline=(0, 240, 255), width=3)
    
    # Orbiting sparks
    for i in range(8):
        angle = t + (i * math.pi / 4)
        dist = 110 + 15 * math.sin(angle * 2)
        px = int(cx + dist * math.cos(angle))
        py = int(cy + dist * math.sin(angle))
        size = 3 if i % 2 == 0 else 2
        draw.ellipse([px - size, py - size, px + size, py + size], fill=(220, 255, 255))
        
    return img

# --- Theme 2: Turbo Mach Speed (Automotive Tachometer) ---
def render_theme_2(frame_idx, total):
    progress = frame_idx / total
    t = progress * 2 * math.pi
    
    img = Image.new("RGB", (WIDTH, HEIGHT), (10, 8, 12))
    draw = ImageDraw.Draw(img)
    cx, cy = 240, 240
    
    # Outer bezel track
    r_outer = 210
    draw.arc([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], start=135, end=405, fill=(40, 30, 45), width=16)
    
    # Ticks along the tachometer arc
    for i in range(28):
        frac = i / 27.0
        deg = 135 + frac * 270
        rad = math.radians(deg)
        r_in = 192 if i % 3 == 0 else 198
        r_out = 218
        x1 = cx + int(r_in * math.cos(rad))
        y1 = cy + int(r_in * math.sin(rad))
        x2 = cx + int(r_out * math.cos(rad))
        y2 = cy + int(r_out * math.sin(rad))
        # Redline on last 25%
        col = (255, 51, 102) if frac > 0.75 else (200, 210, 230)
        draw.line([(x1, y1), (x2, y2)], fill=col, width=2 if i % 3 == 0 else 1)
        
    # Dynamic sweeping RPM needle / bar
    rpm_pct = 0.5 + 0.35 * math.sin(t) + 0.1 * math.sin(t * 3)
    rpm_pct = max(0.05, min(0.98, rpm_pct))
    active_end = 135 + rpm_pct * 270
    
    # Active power arc
    arc_col = (255, 51, 102) if rpm_pct > 0.75 else (255, 180, 0)
    draw.arc([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], start=135, end=active_end, fill=arc_col, width=16)
    
    # Shift indicator dots at top
    for i, shift_x in enumerate([-40, -15, 10, 35]):
        active = (rpm_pct > 0.55 + i * 0.1)
        dot_col = (255, 51, 102) if (i >= 2 and active) else ((0, 255, 128) if active else (40, 40, 55))
        draw.ellipse([cx + shift_x - 5, cy - 140 - 5, cx + shift_x + 5, cy - 140 + 5], fill=dot_col)
        
    return img

# --- Theme 3: Neon Cyber Vitals (Perspective Grid) ---
def render_theme_3(frame_idx, total):
    progress = frame_idx / total
    
    img = Image.new("RGB", (WIDTH, HEIGHT), (8, 6, 18))
    draw = ImageDraw.Draw(img)
    cx, cy = 240, 240
    
    # Perspective grid horizon at y=310
    horizon_y = 310
    
    # Distant glow along horizon
    draw.line([(0, horizon_y), (WIDTH, horizon_y)], fill=(0, 240, 255), width=2)
    
    # Vanishing point lines
    for x in range(-200, WIDTH + 201, 40):
        draw.line([(cx, horizon_y), (x, HEIGHT)], fill=(30, 20, 60), width=1)
        
    # Moving horizontal grid rungs (scrolling toward camera)
    for i in range(8):
        rung_p = (progress + (i / 8.0)) % 1.0
        # Exponential perspective curve
        y = horizon_y + int((rung_p ** 1.8) * (HEIGHT - horizon_y))
        alpha_frac = rung_p
        col = (int(0 * alpha_frac), int(240 * alpha_frac), int(255 * alpha_frac))
        draw.line([(0, y), (WIDTH, y)], fill=col, width=1)
        
    # Floating cyber data particles in upper sky
    for i in range(20):
        seed_x = (i * 37) % WIDTH
        speed = 0.5 + (i % 3) * 0.5
        p_y = int(((i * 23 - progress * speed * 120) % horizon_y))
        size = 2 if i % 2 == 0 else 1
        col = (255, 0, 127) if i % 3 == 0 else (0, 240, 255)
        draw.ellipse([seed_x - size, p_y - size, seed_x + size, p_y + size], fill=col)
        
    # Hexagonal central frame
    hex_r = 135
    hex_pts = []
    for deg in range(30, 390, 60):
        rad = math.radians(deg)
        hex_pts.append((cx + int(hex_r * math.cos(rad)), cy - 30 + int(hex_r * math.sin(rad))))
    draw.polygon(hex_pts, outline=(40, 50, 80))
    
    return img

# --- Theme 4: Quantum Ring Accelerator ---
def render_theme_4(frame_idx, total):
    progress = frame_idx / total
    t = progress * 2 * math.pi
    
    img = Image.new("RGB", (WIDTH, HEIGHT), (6, 8, 14))
    draw = ImageDraw.Draw(img)
    cx, cy = 240, 240
    
    # 4 Nested harmonic rings
    # Ring 1: R=110, CW
    deg1 = progress * 360
    for s in range(3):
        a1 = deg1 + s * 120
        draw.arc([cx - 110, cy - 110, cx + 110, cy + 110], start=a1, end=a1 + 80, fill=(0, 240, 255), width=2)
        
    # Ring 2: R=150, CCW
    deg2 = -progress * 360 * 1.5
    for s in range(8):
        a2 = deg2 + s * 45
        draw.arc([cx - 150, cy - 150, cx + 150, cy + 150], start=a2, end=a2 + 25, fill=(168, 85, 247), width=3)
        
    # Ring 3: R=185, CW with tick marks
    deg3 = progress * 360 * 0.75
    draw.ellipse([cx - 185, cy - 185, cx + 185, cy + 185], outline=(25, 35, 55), width=1)
    for i in range(24):
        angle = math.radians(deg3 + i * 15)
        x1 = cx + int(180 * math.cos(angle))
        y1 = cy + int(180 * math.sin(angle))
        x2 = cx + int(190 * math.cos(angle))
        y2 = cy + int(190 * math.sin(angle))
        draw.line([(x1, y1), (x2, y2)], fill=(0, 240, 255), width=1 if i % 2 == 0 else 2)
        
    # Ring 4: Outer technical boundary R=215
    draw.ellipse([cx - 215, cy - 215, cx + 215, cy + 215], outline=(0, 240, 255, 60), width=1)
    
    # Core energy pulse
    core_w = int(12 + 6 * math.sin(t * 3))
    draw.ellipse([cx - core_w, cy - core_w, cx + core_w, cy + core_w], fill=(220, 250, 255))
    
    return img

# --- Theme 5: Quantum Particle Vortex ---
def render_theme_5(frame_idx, total):
    progress = frame_idx / total
    
    img = Image.new("RGB", (WIDTH, HEIGHT), (10, 5, 18))
    draw = ImageDraw.Draw(img)
    cx, cy = 240, 240
    
    # Spiraling particles (100 particles)
    num_particles = 100
    for i in range(num_particles):
        p_base = (i / num_particles)
        spiral_p = (progress + p_base) % 1.0
        
        # Spiral logarithmic radius from outer 220 inward to 30
        r = 30 + (1.0 - spiral_p) * 190
        theta = spiral_p * 6 * math.pi + (i * 2.4)
        
        px = cx + int(r * math.cos(theta))
        py = cy + int(r * math.sin(theta))
        
        # Color shifting along spiral: purple to electric cyan
        frac = 1.0 - spiral_p
        r_col = int(168 * frac + 0 * (1 - frac))
        g_col = int(85 * frac + 240 * (1 - frac))
        b_col = int(247 * frac + 255 * (1 - frac))
        
        size = 3 if spiral_p < 0.4 else (2 if spiral_p < 0.8 else 1)
        draw.ellipse([px - size, py - size, px + size, py + size], fill=(r_col, g_col, b_col))
        
    # Center dark gravity sink with subtle purple ring
    draw.ellipse([cx - 32, cy - 32, cx + 32, cy + 32], fill=(6, 2, 10), outline=(168, 85, 247), width=2)
    
    return img

# --- Theme 6: Tokyo Cyberpunk Rain ---
def render_theme_6(frame_idx, total):
    progress = frame_idx / total
    
    img = Image.new("RGB", (WIDTH, HEIGHT), (7, 8, 14))
    draw = ImageDraw.Draw(img)
    
    # Background neon ambient bokeh lights
    bokeh_lights = [
        (120, 140, 45, (255, 0, 127, 40)),
        (360, 180, 55, (0, 240, 255, 35)),
        (220, 320, 65, (168, 85, 247, 30)),
        (100, 360, 40, (0, 255, 128, 25)),
    ]
    bokeh_layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bokeh_layer)
    for bx, by, br, bcol in bokeh_lights:
        bd.ellipse([bx - br, by - br, bx + br, by + br], fill=bcol)
    bokeh_blurred = bokeh_layer.filter(ImageFilter.GaussianBlur(radius=25))
    img.paste(Image.blend(img.convert("RGBA"), bokeh_blurred, 0.8).convert("RGB"))
    draw = ImageDraw.Draw(img)
    
    # Cyberpunk rain streaks (slanted by 15 degrees)
    angle_rad = math.radians(75) # 15 deg from vertical
    dx = math.cos(angle_rad)
    dy = math.sin(angle_rad)
    
    num_drops = 70
    for i in range(num_drops):
        seed_x = (i * 47) % WIDTH
        speed = 280 + (i % 5) * 80
        length = 18 + (i % 4) * 8
        
        curr_y = ((i * 31) + progress * speed) % (HEIGHT + 60) - 30
        curr_x = seed_x + (curr_y * 0.25) % WIDTH
        
        x2 = curr_x + dx * length
        y2 = curr_y + dy * length
        
        alpha_col = (0, 240, 255) if i % 3 == 0 else ((255, 0, 127) if i % 5 == 0 else (180, 210, 240))
        draw.line([(curr_x, curr_y), (x2, y2)], fill=alpha_col, width=1)
        
    return img

if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print("[*] Generating 20 FPS seamless MP4 video loops...")
    encode_frames_to_mp4(render_theme_1, "theme_1.mp4")
    encode_frames_to_mp4(render_theme_2, "theme_2.mp4")
    encode_frames_to_mp4(render_theme_3, "theme_3.mp4")
    encode_frames_to_mp4(render_theme_4, "theme_4.mp4")
    encode_frames_to_mp4(render_theme_5, "theme_5.mp4")
    encode_frames_to_mp4(render_theme_6, "theme_6.mp4")
    print("[✓] All 6 theme loops generated successfully!")
