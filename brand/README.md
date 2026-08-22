# Red Leaf Fintech brand assets

## Source

`source/` holds the files the client supplied on 2026-08-18, untouched:

| File | What it is |
| --- | --- |
| `Branding and Logo.png` | Brand sheet — horizontal lockup, plus the light/dark/red app-icon tiles |
| `Branding and Logo 1.png` | Light-background app icon at full resolution |
| `Branding and Logo 2.png` | Vertical lockup with "INC." |
| `Accounting Software Project.docx` | Requirements document and the interface colour scheme |

All four PNGs are **opaque white**, with no alpha and a soft drop shadow behind
the artwork.

## Derivatives

`scripts/brand/prepare-assets.py` produces everything in `public/brand/`. It is a
one-off tool, not part of the build — it needs Pillow and SciPy, which are
deliberately *not* project dependencies:

```bash
python scripts/brand/prepare-assets.py public/brand
```

What it does:

1. **Knockout** — turns white into transparency, but only for background that is
   connected to the image border. White *inside* the artwork (the counters in
   R/A/D, the sliver in the mark) is left opaque, so the shapes survive.
   The threshold is set high enough to remove the source drop shadows, which
   would otherwise show as grey haloes on a dark surface.
2. **Dark variants** — remaps the navy ink to white for placement on the dark
   sidebar and footer, leaves the red untouched (matching the client's own dark
   app-icon tile), and drops the enclosed white counters to transparent so the
   dark surface shows through them.
3. **Crop and resize** to the sizes the product actually uses.

| Output | Where it is used |
| --- | --- |
| `mark.png` / `mark-dark.png` | Compact mark; `mark-dark` is the app sidebar |
| `lockup.png` / `lockup-dark.png` | Marketing header, login panel, footer |
| `lockup-vertical.png` | Reserved for square/portrait placements |
| `icon-light.png` / `icon-dark.png` / `icon-red.png` | The client's app-icon tiles |
| `src/app/icon.png`, `src/app/apple-icon.png` | Next.js file-based favicons |

Do not hand-edit the files in `public/brand/` — re-run the script instead.

## Colour

The palette is defined once, as Tailwind tokens, in `src/app/globals.css`. The
client's hexes are recorded there along with the two places we deliberately use
a slightly darker step so small text clears 4.5:1 contrast.
