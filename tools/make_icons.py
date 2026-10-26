"""Draws the Off Script app icons with Pillow: a script page on deep blue, its last line
left unwritten. Run from the repository root: python3 tools/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw

BLUE = (26, 77, 143)
CREAM = (247, 241, 227)
INK = (28, 23, 18)
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw(size, safe=1.0):
    """safe: the share of the square the page may use (maskable icons keep to the middle 80%)."""
    scale = 4  # draw large, then shrink, for smooth edges
    s = size * scale
    img = Image.new("RGB", (s, s), BLUE)
    d = ImageDraw.Draw(img)
    w = s * 0.56 * safe
    hgt = s * 0.68 * safe
    x0 = (s - w) / 2
    y0 = (s - hgt) / 2
    d.rounded_rectangle([x0, y0, x0 + w, y0 + hgt], radius=s * 0.05 * safe, fill=CREAM)
    pad = w * 0.16
    lh = hgt * 0.075
    gap = hgt * 0.125
    widths = [1.0, 0.82, 0.94]
    y = y0 + hgt * 0.2
    for i, frac in enumerate(widths):
        x1 = x0 + pad + (w - 2 * pad) * frac
        d.rounded_rectangle([x0 + pad, y, x1, y + lh], radius=lh / 2, fill=INK)
        y += lh + gap
    # The last line: a gap with a dotted outline, the line he says without the script.
    dots = 7
    step = (w - 2 * pad) / dots
    for j in range(dots):
        cx = x0 + pad + step * (j + 0.5)
        r = lh * 0.38
        d.ellipse([cx - r, y + lh / 2 - r, cx + r, y + lh / 2 + r], fill=BLUE)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    draw(180).save(OUT / "apple-touch-icon.png")
    draw(192).save(OUT / "icon-192.png")
    draw(512).save(OUT / "icon-512.png")
    draw(512, safe=0.8).save(OUT / "icon-maskable-512.png")
    print("Icons written to", OUT)


if __name__ == "__main__":
    main()
