#!/usr/bin/env python3
"""
Draws the GoalVault app icon at every size Android, iOS and the web manifest
need.

The mark is drawn in code rather than exported from a design tool so the icons
can be regenerated from a clean checkout with nothing but Pillow installed, and
so a colour change is a one-line edit here rather than a pile of new binaries.

    python3 tools/make-icons.py
"""

from __future__ import annotations

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BACKDROP = (11, 16, 32, 255)
RING_OUTER = (109, 139, 255, 255)
RING_INNER = (176, 124, 255, 255)
CENTRE = (51, 214, 192, 255)

# Everything is expressed as a fraction of the canvas, so one drawing routine
# serves a 48px launcher icon and a 1024px App Store icon alike.
SUPERSAMPLE = 4


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def draw_mark(
    size: int, rounded: bool, bleed: float = 0.0, backdrop: bool = True
) -> Image.Image:
    """`bleed` shrinks the artwork so maskable icons survive being cropped."""
    s = size * SUPERSAMPLE
    image = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if backdrop and rounded:
        radius = int(s * 0.22)
        draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BACKDROP)
    elif backdrop:
        draw.rectangle([0, 0, s - 1, s - 1], fill=BACKDROP)

    c = s / 2
    scale = 1.0 - bleed

    def ring(radius_frac: float, width_frac: float, colour):
        r = s * radius_frac * scale
        w = max(1, int(s * width_frac * scale))
        draw.ellipse([c - r, c - r, c + r, c + r], outline=colour, width=w)

    ring(0.293, 0.055, RING_OUTER)
    ring(0.172, 0.047, lerp(RING_OUTER, RING_INNER, 0.6))

    dot = s * 0.059 * scale
    draw.ellipse([c - dot, c - dot, c + dot, c + dot], fill=CENTRE)

    # Four crosshair ticks reaching past the outer ring.
    tick_w = max(1, int(s * 0.043 * scale))
    inner = s * 0.352 * scale
    outer = s * 0.455 * scale
    for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        draw.line(
            [c + dx * inner, c + dy * inner, c + dx * outer, c + dy * outer],
            fill=RING_OUTER,
            width=tick_w,
        )

    return image.resize((size, size), Image.LANCZOS)


def save(image: Image.Image, *parts: str) -> None:
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path, "PNG")
    print(f"  {os.path.relpath(path, ROOT)}")


def main() -> None:
    print("web + pwa icons")
    for size in (192, 512):
        save(draw_mark(size, rounded=True), "public", "icons", f"icon-{size}.png")
    save(draw_mark(512, rounded=False, bleed=0.22), "public", "icons", "icon-maskable-512.png")
    save(draw_mark(180, rounded=True), "public", "icons", "apple-touch-icon.png")
    save(draw_mark(32, rounded=True), "public", "icons", "favicon-32.png")

    android = os.path.join("android", "app", "src", "main", "res")
    if os.path.isdir(os.path.join(ROOT, android)):
        print("android splash")
        # One centred mark; the launch theme paints the background colour behind
        # it and centres this at any screen size, so per-density copies of a
        # full-bleed splash are not needed.
        save(draw_mark(384, rounded=False, backdrop=False), android, "drawable", "splash_logo.png")
        for folder in sorted(os.listdir(os.path.join(ROOT, android))):
            stale = os.path.join(ROOT, android, folder, "splash.png")
            if os.path.exists(stale):
                os.remove(stale)

        print("android launcher icons")
        densities = {
            "mdpi": 48,
            "hdpi": 72,
            "xhdpi": 96,
            "xxhdpi": 144,
            "xxxhdpi": 192,
        }
        for density, size in densities.items():
            save(draw_mark(size, rounded=True), android, f"mipmap-{density}", "ic_launcher.png")
            save(draw_mark(size, rounded=True), android, f"mipmap-{density}", "ic_launcher_round.png")
            # The foreground layer is cropped to a circle on many launchers, so
            # it gets extra bleed and a transparent backdrop is added by the OS.
            save(
                draw_mark(int(size * 1.5), rounded=False, bleed=0.28, backdrop=False),
                android,
                f"mipmap-{density}",
                "ic_launcher_foreground.png",
            )
        save(draw_mark(512, rounded=True), android, "..", "..", "..", "..", "playstore-icon.png")
    else:
        print("android/ not generated yet — run `npx cap add android` first")

    ios = os.path.join("ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset")
    if os.path.isdir(os.path.join(ROOT, ios)):
        print("ios app icon")
        save(draw_mark(1024, rounded=False), ios, "AppIcon-512@2x.png")


if __name__ == "__main__":
    main()
