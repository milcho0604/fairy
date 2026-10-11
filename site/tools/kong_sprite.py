"""Cut Bean (콩이) out of the real app recording docs/assets/screens/hero.webp into a transparent sprite sheet.

The recording has an opaque wallpaper behind the pet. The wallpaper does not move, so its per-pixel median over
all frames is the background; whatever differs from it is the pet. Holes are filled so the body is solid, the soft
floor shadow is dropped (the page draws its own), and the speech bubble is left out (the page draws a bilingual one).

Run from the repo root:  python3 site/tools/kong_sprite.py      (needs Pillow, numpy, scipy)
Writes site/assets/img/kong-sprite.webp and site/assets/img/kong-sprite.json.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'docs/assets/screens/hero.webp'
OUT = ROOT / 'site/assets/img'

im = Image.open(SRC)
frames, durs = [], []
for i in range(im.n_frames):
    im.seek(i)
    frames.append(np.asarray(im.convert('RGB')).astype(np.float32))
    durs.append(im.info.get('duration') or 60)
bg = np.median(np.stack(frames), axis=0)

W, H, TOP = 200, 150, 110  # cell size and the top row of the crop in the 680x260 recording
cells = []
for f in frames:
    d = np.abs(f - bg).max(axis=2)
    m = d > 10
    m = nd.binary_closing(m, iterations=3)
    m = nd.binary_fill_holes(m)
    m = nd.binary_opening(m, iterations=2)
    r, b = f[..., 0], f[..., 2]
    rows = np.arange(f.shape[0])[:, None]
    m &= ~((rows > 236) & ((r - b) < 68))  # floor shadow: greyer than the peach feet
    m = nd.binary_opening(m, iterations=1)
    lab, n = nd.label(m)
    keep = []
    for k in range(1, n + 1):
        ys, _ = np.nonzero(lab == k)
        if len(ys) >= 60 and ys.max() >= 118:  # drop specks and the speech bubble above the pet
            keep.append(k)
    m = np.isin(lab, keep)
    alpha = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)))
    rgba = Image.fromarray(np.dstack([f, alpha]).astype(np.uint8), 'RGBA')
    _, xs = np.nonzero(m[160:225])  # centre on the body, not the swinging feet
    cx = int(round(xs.mean()))
    x0 = max(0, cx - W // 2)
    cell = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cell.alpha_composite(rgba.crop((x0, TOP, x0 + W, TOP + H)))
    cells.append(cell)

# idle (blinks) 0-3, walk 5-79, cheer 80-89, settle 98. Frames 90-97 carry confetti that does not cut out cleanly.
sel = list(range(0, 4)) + list(range(5, 80)) + list(range(80, 90)) + [98]
cols = 10
rows_n = (len(sel) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * W, rows_n * H), (0, 0, 0, 0))
for k, i in enumerate(sel):
    sheet.alpha_composite(cells[i], ((k % cols) * W, (k // cols) * H))
sheet.save(OUT / 'kong-sprite.webp', quality=86, method=6)
meta = {
    'w': W, 'h': H, 'cols': cols, 'rows': rows_n,
    'durations': [durs[i] for i in sel],
    'idle': [0, 4], 'walk': [4, 79], 'cheer': [79, len(sel)],
    # pixels per second the pet covers in the recording while walking (centre moved ~358px in the walk frames)
    'walkSpeed': round(358 / (sum(durs[5:80]) / 1000)),
}
(OUT / 'kong-sprite.json').write_text(json.dumps(meta))
print(sheet.size, meta['walkSpeed'], 'px/s')
