#!/usr/bin/env python3
"""
Generate the PWA app icons for the Countdown app.

Run from the repository root:

    python3 tools/make-icons.py

Requires Pillow (`pip install Pillow`). The committed PNGs in icons/ were
produced by this script; it exists so they can be regenerated or restyled
instead of being unexplainable binaries in the repo.

Output
------
icons/icon-192.png        192x192  purpose "any"      rounded square
icons/icon-512.png        512x512  purpose "any"      rounded square
icons/maskable-512.png    512x512  purpose "maskable" full bleed, safe zone
icons/apple-touch-icon.png 180x180 iOS home screen    full bleed

Why three variants
------------------
A "maskable" icon is cropped by the platform to whatever shape it likes
(circle, squircle, rounded square). It must therefore be full-bleed, with
all meaningful content inside the central 80%-diameter "safe zone" - so its
motif is drawn smaller. An "any" icon is displayed roughly as-is, so it
carries its own rounded-square shape. iOS ignores manifest icons for the
home screen and applies its own mask to apple-touch-icon, which must be
full-bleed and fully opaque or the corners render black.
"""

import math
import os

from PIL import Image, ImageDraw

# Supersampling factor: everything is drawn this many times larger and then
# downsampled with a Lanczos filter. Pillow's draw operations are not
# anti-aliased, so this is what keeps the curves and hands smooth.
SS = 8

BG_TOP = (24, 35, 76)       # #18234c
BG_BOTTOM = (11, 16, 32)    # #0b1020  (matches theme_color / background_color)
RING = (56, 189, 248)       # #38bdf8  accent
HAND = (241, 245, 255)      # #f1f5ff  foreground
ACCENT2 = (167, 139, 250)   # #a78bfa

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")


def vertical_gradient(size, top, bottom):
    """A size x size RGB image shading from `top` down to `bottom`."""
    strip = Image.new("RGB", (1, size))
    pixels = strip.load()
    span = max(1, size - 1)
    for y in range(size):
        t = y / span
        pixels[0, y] = (
            round(top[0] + (bottom[0] - top[0]) * t),
            round(top[1] + (bottom[1] - top[1]) * t),
            round(top[2] + (bottom[2] - top[2]) * t),
        )
    return strip.resize((size, size), Image.NEAREST)


def hand(draw, cx, cy, length, angle_deg, width, color):
    """
    Draw a clock hand from the centre outwards.

    angle_deg is measured clockwise from 12 o'clock, which is how a clock
    face is actually read. Screen y grows downwards, so subtracting 90
    degrees puts 0 at straight up.
    """
    a = math.radians(angle_deg - 90.0)
    x = cx + length * math.cos(a)
    y = cy + length * math.sin(a)
    draw.line([cx, cy, x, y], fill=color, width=int(round(width)))
    # Pillow has no round line caps, so cap the tip with a circle by hand.
    r = width / 2.0
    draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def draw_motif(draw, size, motif_fraction):
    """
    Draw the clock face centred on a size x size canvas, occupying
    `motif_fraction` of the canvas width.
    """
    cx = cy = size / 2.0
    radius = size * motif_fraction / 2.0

    ring_w = size * 0.052
    # Pillow strokes an ellipse outline centred on the path, so insetting by
    # half the stroke keeps the outer edge exactly on `radius`.
    inset = ring_w / 2.0
    draw.ellipse(
        [cx - radius + inset, cy - radius + inset, cx + radius - inset, cy + radius - inset],
        outline=RING,
        width=int(round(ring_w)),
    )

    # Four tick marks at 12/3/6/9 to read as a dial rather than a plain circle.
    tick_len = radius * 0.16
    tick_w = size * 0.028
    for angle in (0, 90, 180, 270):
        a = math.radians(angle - 90.0)
        outer = radius - ring_w * 1.35
        inner = outer - tick_len
        x1, y1 = cx + inner * math.cos(a), cy + inner * math.sin(a)
        x2, y2 = cx + outer * math.cos(a), cy + outer * math.sin(a)
        draw.line([x1, y1, x2, y2], fill=ACCENT2, width=int(round(tick_w)))

    # Hands posed at roughly 10:08 - the conventional "watch photo" angle,
    # which reads as a clock at small sizes better than a vertical pair.
    hand(draw, cx, cy, radius * 0.50, 310.0, size * 0.055, HAND)   # hour
    hand(draw, cx, cy, radius * 0.70, 48.0, size * 0.040, HAND)    # minute

    # Centre pin.
    pin = size * 0.042
    draw.ellipse([cx - pin, cy - pin, cx + pin, cy + pin], fill=HAND)


def build(size, motif_fraction, rounded):
    """
    Render one icon.

    rounded=True gives a rounded-square icon with transparent corners
    (for purpose "any"); rounded=False gives a full-bleed opaque square
    (for maskable and apple-touch-icon).
    """
    big = size * SS

    base = vertical_gradient(big, BG_TOP, BG_BOTTOM).convert("RGBA")
    draw = ImageDraw.Draw(base)
    draw_motif(draw, big, motif_fraction)

    if rounded:
        mask = Image.new("L", (big, big), 0)
        # 22% corner radius approximates the iOS/Android squircle.
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=255
        )
        base.putalpha(mask)

    out = base.resize((size, size), Image.LANCZOS)

    if not rounded:
        # Flatten to remove the alpha channel entirely: iOS renders a
        # transparent apple-touch-icon with black corners.
        flat = Image.new("RGB", (size, size), BG_BOTTOM)
        flat.paste(out, (0, 0), out)
        out = flat

    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    targets = [
        # (filename, size, motif fraction of canvas, rounded corners)
        ("icon-192.png", 192, 0.62, True),
        ("icon-512.png", 512, 0.62, True),
        # Smaller motif: must sit inside the central 80% safe zone that
        # platforms promise not to crop.
        ("maskable-512.png", 512, 0.52, False),
        ("apple-touch-icon.png", 180, 0.62, False),
    ]

    for name, size, motif, rounded in targets:
        path = os.path.join(OUT_DIR, name)
        build(size, motif, rounded).save(path, "PNG", optimize=True)
        print("wrote {} ({}x{})".format(path, size, size))


if __name__ == "__main__":
    main()
