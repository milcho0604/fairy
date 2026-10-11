"""Header and footer logo: Choco and Milk from the app icon (build/icon.png) with the backdrop and the basket cut away.

The favicons and the manifest icons keep the full rounded icon (images.py). Only the logo next to the name in the
header and footer is cut out, so it sits on the page colour in light and dark mode.

1. Mask: the app's own background model (IS-Net, the one the maker uses), same pre-processing as the app
   (src/renderer/src/maker/removeBg.ts: 1024x1024, im / max - 0.5). The model already leaves the frosted basket out.
2. Alpha: faint backdrop and basket residue dropped, small holes (eyes, nose) filled, only what touches the two
   animals kept, edges softened a little.
3. Colour: soft fur edges take the colour of the solid fur next to them (and a bounded un-mix with the backdrop),
   so the white cat has no peach or mint fringe on the dark page.
4. Cropped to a square around the animals, scaled down premultiplied.

Run from the repo root:  BG_MODEL=<isnet-general-use.onnx> python3 site/tools/logo.py
(needs Pillow, numpy, scipy, onnxruntime; the model is the app's 178MB download, e.g.
~/Library/Application Support/fairy/models/isnet-general-use.onnx)
Writes site/assets/icons/logo-{32,64,96}.{png,webp}.
"""
import os
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'build/icon.png'
OUT = ROOT / 'site/assets/icons'
MODEL = os.environ.get('BG_MODEL') or str(Path.home() / 'Library/Application Support/fairy/models/isnet-general-use.onnx')
BASKET_TOP = 822  # top rim of the basket in the 1024px icon

src = Image.open(SRC).convert('RGB')
I = np.asarray(src).astype(np.float64)
H, W, _ = I.shape

# 1. mask
x = np.asarray(src.resize((1024, 1024), Image.LANCZOS)).astype(np.float32)
x = (x / max(float(x.max()), 1e-6) - 0.5).transpose(2, 0, 1)[None]
sess = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])
o = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
o = (o - o.min()) / (o.max() - o.min())
a = np.asarray(Image.fromarray((o * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)).astype(np.float64) / 255

# 2. alpha
a = np.clip((a - 0.15) / 0.70, 0, 1)
core = a > 0.5
lab, n = nd.label(core)
sizes = nd.sum(core, lab, range(1, n + 1))
keep = np.isin(lab, 1 + np.nonzero(sizes > 2000)[0])
a[~nd.binary_dilation(keep, iterations=6)] = 0
solid = nd.binary_fill_holes(a > 0.5)
inner = nd.binary_erosion(solid, iterations=3)
a[inner] = 1
a = np.clip(nd.gaussian_filter(a, 1.2), 0, 1)

# 3. colour. Backdrop: smooth cubic fit over the clear backdrop above the basket
yy, xx = np.mgrid[0:H, 0:W] / np.array([H, W], dtype=np.float64)[:, None, None]
T = np.stack([xx**i * yy**j for i in range(4) for j in range(4 - i)], -1)
clear = (a < 0.01) & (np.arange(H)[:, None] < BASKET_TOP - 6) & ~nd.binary_dilation(a > 0.01, iterations=12)
B = np.empty_like(I)
for c in range(3):
    coef, *_ = np.linalg.lstsq(T[clear], I[..., c][clear], rcond=None)
    B[..., c] = (T.reshape(-1, T.shape[-1]) @ coef).reshape(H, W)
# colour of the nearest solid fur, spread outwards
op = (a > 0.95).astype(np.float64)
Fn = np.zeros_like(I)
got = np.zeros((H, W), bool)
for sg in (3, 6, 12, 24, 48):
    w = nd.gaussian_filter(op, sg)
    f = np.stack([nd.gaussian_filter(I[..., c] * op, sg) for c in range(3)], -1) / np.maximum(w, 1e-9)[..., None]
    new = (w > 1e-3) & ~got
    Fn[new] = f[new]
    got |= new
ae = np.maximum(a, 0.6)[..., None]
Fu = np.clip((I - (1 - ae) * B) / ae, 0, 255)
t = np.clip((a - 0.6) / 0.35, 0, 1)[..., None]
F = t * Fu + (1 - t) * Fn
# white fur right at the edge still carries half the backdrop tint: take it out
edge = np.clip(nd.gaussian_filter((a < 0.5).astype(np.float64), 5) * 2, 0, 1)
F = np.clip(F - (0.5 * edge * (a > 0))[..., None] * (B - B.mean(-1, keepdims=True)), 0, 255)

# 4. square crop and sizes
ys, xs = np.nonzero(a > 0.02)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
side = max(y1 - y0, x1 - x0)
out = np.zeros((side, side, 4))
oy, ox = (side - (y1 - y0)) // 2, (side - (x1 - x0)) // 2
out[oy:oy + y1 - y0, ox:ox + x1 - x0, :3] = F[y0:y1, x0:x1]
out[oy:oy + y1 - y0, ox:ox + x1 - x0, 3] = a[y0:y1, x0:x1] * 255
full = Image.fromarray(out.round().astype(np.uint8))
for s in (32, 64, 96):
    im = full.convert('RGBa').resize((s, s), Image.LANCZOS).convert('RGBA')
    im.save(OUT / f'logo-{s}.png', optimize=True)
    im.save(OUT / f'logo-{s}.webp', quality=90, alpha_quality=100, method=6)
    print(f'logo-{s}', (OUT / f'logo-{s}.png').stat().st_size, 'B png,', (OUT / f'logo-{s}.webp').stat().st_size, 'B webp')
