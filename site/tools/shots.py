"""Helpers for re-shooting the site's pictures from the app (see tools/capture.mjs).

  python3 site/tools/shots.py photo <OUT>/photo.png   # a sample "photo": Milk (resources/pets/milk.png) on a soft backdrop
  python3 site/tools/shots.py compose <OUT>           # lays the raw window captures out as <OUT>/screens/*.png

Then:  SCREENS=<OUT>/screens python3 site/tools/images.py
The layouts match the old docs/assets/screens pictures (same canvas sizes, cream #f0eae2 / dark #1e1e23 backdrop).
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
CREAM = (240, 234, 226, 255)
DARK = (30, 30, 35, 255)


def photo(out: Path):
    """Milk sitting on a blurred peach-pink backdrop, like a phone photo of a pet on a blanket."""
    w, h = 900, 1200
    bg = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(bg)
    for y in range(h):  # warm vertical gradient
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(236 - 18 * t), int(205 - 30 * t), int(200 - 26 * t)))
    blobs = Image.new('RGB', (w, h), (0, 0, 0))
    bd = ImageDraw.Draw(blobs)
    bd.ellipse((-200, 700, 600, 1500), fill=(40, 20, 18))
    bd.ellipse((520, -200, 1200, 420), fill=(30, 22, 10))
    bg = Image.blend(bg, Image.new('RGB', (w, h), (255, 236, 222)), 0.15)
    bg.paste(Image.new('RGB', (w, h), (214, 170, 160)), (0, 0), blobs.convert('L').filter(ImageFilter.GaussianBlur(120)))
    pet = Image.open(ROOT / 'resources/pets/milk.png').convert('RGBA')
    pet = pet.crop(pet.getbbox())
    ph = 820
    pet = pet.resize((round(pet.width * ph / pet.height), ph), Image.LANCZOS)
    x, y = (w - pet.width) // 2, h - ph - 150
    shadow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(shadow).ellipse((x + 30, y + ph - 40, x + pet.width - 30, y + ph + 40), fill=110)
    bg.paste((120, 80, 70), (0, 0), shadow.filter(ImageFilter.GaussianBlur(26)))
    bg.paste(pet, (x, y), pet)
    out.parent.mkdir(parents=True, exist_ok=True)
    bg.save(out)
    print('wrote', out)


def card(img: Image.Image, width: int) -> Image.Image:
    return img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)


def drop(canvas: Image.Image, img: Image.Image, xy, dark=False, radius=12):
    """Paste a window capture with rounded corners and a soft shadow, like a window on the desktop."""
    x, y = xy
    s = 4
    mask = Image.new('L', (img.width * s, img.height * s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width * s - 1, img.height * s - 1), radius=radius * s, fill=255)
    mask = mask.resize(img.size, Image.LANCZOS)
    alpha = Image.composite(img.getchannel('A'), Image.new('L', img.size, 0), mask) if img.mode == 'RGBA' else mask
    sh = Image.new('L', canvas.size, 0)
    sh.paste(alpha, (x, y + 10))
    sh = sh.filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * (0.55 if dark else 0.28)))
    canvas.paste((0, 0, 0, 255) if dark else (74, 55, 38, 255), (0, 0), sh)
    canvas.paste(img, (x, y), alpha)


def compose(out: Path):
    raw = lambda n: Image.open(out / f'raw-{n}.png').convert('RGBA')  # noqa: E731
    dst = out / 'screens'
    dst.mkdir(parents=True, exist_ok=True)
    rects = json.loads((out / 'rects.json').read_text())
    scale = rects.get('scale', 2)

    # panel strips: four tabs, 1600x588, same spacing as before (one panel every 392px)
    for dark in (False, True):
        c = Image.new('RGBA', (1600, 588), DARK if dark else CREAM)
        for i, tab in enumerate(('today', 'todo', 'note', 'event')):
            p = card(raw(f'panel-{tab}' + ('-dark' if dark else '')), 353)
            if p.height > 536:
                p = p.resize((round(p.width * 536 / p.height), 536), Image.LANCZOS)
            drop(c, p, (35 + 392 * i + (353 - p.width) // 2, 36), dark)
            if i == 0:  # the hero cut-out is the Today panel on its own
                p.save(dst / ('hero-panel-dark.png' if dark else 'hero-panel.png'))
        c.convert('RGB').save(dst / ('panel-dark.png' if dark else 'panel.png'))

    # chat: light and dark side by side, 1200x1016
    c = Image.new('RGBA', (1200, 1016), CREAM)
    for i, name in enumerate(('chat', 'chat-dark')):
        p = card(raw(name), 528)
        drop(c, p, (600 * i + 36, 30), i == 1)
    c.convert('RGB').save(dst / 'chat.png')

    # AI picker, 600x982
    c = Image.new('RGBA', (600, 982), CREAM)
    p = card(raw('chat-picker'), 528)
    drop(c, p, (36, 30))
    c = c.crop((0, 0, 600, min(982, 30 + p.height + 40)))
    c.convert('RGB').save(dst / 'chat-picker.png')

    # maker: three steps side by side
    ps = [card(raw(n), 502) for n in ('maker-pick', 'maker-edit', 'maker-name')]
    c = Image.new('RGBA', (1600, 22 + max(p.height for p in ps) + 36), CREAM)
    for i, p in enumerate(ps):
        drop(c, p, (25 + 524 * i, 22))
    c.convert('RGB').save(dst / 'maker-steps.png')

    # quick add bar on its own (transparent corners)
    q = raw('quick')
    q.save(dst / 'quick-bar.png')

    # first-run look picker, light and dark
    r = rects['onboardingPick']
    pad = 10
    box = tuple(round(v * scale) for v in (r['x'] - pad, r['y'] - pad, r['x'] + r['width'] + pad, r['y'] + r['height'] + pad))
    for dark in (False, True):
        raw('onboarding' + ('-dark' if dark else '')).crop(box).convert('RGB').save(dst / ('step-pick-dark.png' if dark else 'step-pick.png'))
    print('composed into', dst)


if __name__ == '__main__':
    cmd, arg = sys.argv[1], Path(sys.argv[2])
    {'photo': photo, 'compose': compose}[cmd](arg)
