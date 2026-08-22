"""Prepare Red Leaf brand derivatives from the client's opaque-white PNGs."""
from PIL import Image
from scipy import ndimage
import numpy as np, os, sys

SRC = r"C:\Users\amanm\OneDrive\Desktop\Red Leaf"
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(OUT, exist_ok=True)

THRESH = 74  # distance-from-white below which a pixel may be background (kills soft drop shadows)


def knockout(img: Image.Image) -> Image.Image:
    """White -> alpha, but only for background connected to the border, so white
    *inside* the artwork (the sliver in the R) stays opaque."""
    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    d = 255 - rgb.min(axis=2)                      # 0 = pure white
    nearwhite = d < THRESH
    labels, n = ndimage.label(nearwhite)
    border = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    outside = np.unique(border[border > 0])
    exterior = np.isin(labels, outside)
    FLOOR = 12.0
    ramp = np.clip((d.astype(np.float32) - FLOOR) * (255.0 / (THRESH - FLOOR)), 0, 255)
    alpha = np.where(exterior, ramp, 255).astype(np.uint8)
    out = img.convert("RGBA")
    out.putalpha(Image.fromarray(alpha, "L"))
    return out


def trim(img: Image.Image, pad: int = 0) -> Image.Image:
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.where(a > 40)
    box = (max(xs.min() - pad, 0), max(ys.min() - pad, 0),
           min(xs.max() + 1 + pad, img.width), min(ys.max() + 1 + pad, img.height))
    return img.crop(box)


def fit(img: Image.Image, width: int) -> Image.Image:
    if img.width == width:
        return img
    h = round(img.height * width / img.width)
    return img.resize((width, h), Image.LANCZOS)


def to_dark(img: Image.Image) -> Image.Image:
    """Navy ink -> white, for placement on dark surfaces. Red is untouched, and
    enclosed white counters (the holes in R/A/D, the sliver in the mark) are
    dropped to transparent so the dark surface shows through them."""
    a = np.asarray(img).astype(np.int16)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    d = 255 - np.minimum(np.minimum(r, g), b)
    counter = (al > 200) & (d < THRESH)            # interior white kept by knockout()
    navy = (r <= g + 18) & (al > 8) & ~counter     # red-family has r >> g
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    t = np.clip((lum - 10.0) / 110.0, 0, 1)        # darkest navy -> purest white
    grey = (255 - t * 38).astype(np.int16)
    out = a.copy()
    for c in range(3):
        out[..., c] = np.where(navy, grey, out[..., c])
    out[..., 3] = np.where(counter, 0, out[..., 3])
    return Image.fromarray(out.astype(np.uint8), "RGBA")


sheet = Image.open(os.path.join(SRC, "Branding and Logo.png"))
vert = Image.open(os.path.join(SRC, "Branding and Logo 2.png"))
icon = Image.open(os.path.join(SRC, "Branding and Logo 1.png"))

# 1. mark only — top band of the vertical lockup, highest resolution available
mark = trim(knockout(vert.crop((0, 150, vert.width, 700))))
fit(mark, 512).save(f"{OUT}/mark.png")
fit(to_dark(mark), 512).save(f"{OUT}/mark-dark.png")

# 2. horizontal lockup (mark | RED LEAF FINTECH INC.)
lock_h = trim(knockout(sheet.crop((200, 120, 1320, 430))))
fit(lock_h, 1000).save(f"{OUT}/lockup.png")
fit(to_dark(lock_h), 1000).save(f"{OUT}/lockup-dark.png")

# 3. vertical lockup
lock_v = trim(knockout(vert))
fit(lock_v, 720).save(f"{OUT}/lockup-vertical.png")

# 4. app-icon tiles straight from the sheet (client-supplied variants)
for name, box in [("icon-light", (50, 665, 221, 836)),
                  ("icon-dark", (235, 665, 406, 836)),
                  ("icon-red", (420, 665, 591, 836))]:
    sheet.crop(box).convert("RGB").resize((256, 256), Image.LANCZOS).save(f"{OUT}/{name}.png")

# 5. square light app icon at full resolution
icon.convert("RGB").resize((512, 512), Image.LANCZOS).save(f"{OUT}/icon-light-hi.png")

for f in sorted(os.listdir(OUT)):
    im = Image.open(f"{OUT}/{f}")
    print(f"{f:24s} {im.size}  {im.mode}  {os.path.getsize(f'{OUT}/{f}')//1024} KB")
