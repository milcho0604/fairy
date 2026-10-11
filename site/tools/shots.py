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
# Everything is laid out at twice the old canvas sizes, so the site can serve true 2x pictures (the captures are 2x).
K = 2
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


# the captures shown one at a time in the carousel (site/index.html #tour)
TOUR = ('panel-today', 'panel-todo', 'panel-note', 'panel-event', 'panel-shop', 'chat', 'chat-picker', 'quick',
        'settings-pet', 'settings-ai', 'onboarding', 'maker-pick', 'maker-illust', 'panel-today-dark', 'chat-dark')


def rounded(img: Image.Image, radius=12 * K) -> Image.Image:
    """Window capture with rounded, transparent corners."""
    img = img.convert('RGBA')
    s = 4
    mask = Image.new('L', (img.width * s, img.height * s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width * s - 1, img.height * s - 1), radius=radius * s, fill=255)
    a = Image.composite(img.getchannel('A'), Image.new('L', img.size, 0), mask.resize(img.size, Image.LANCZOS))
    img.putalpha(a)
    return img


def card(img: Image.Image, width: int) -> Image.Image:
    return img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)


def drop(canvas: Image.Image, img: Image.Image, xy, dark=False, radius=12 * K):
    """Paste a window capture with rounded corners and a soft shadow, like a window on the desktop."""
    x, y = xy
    s = 4
    mask = Image.new('L', (img.width * s, img.height * s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width * s - 1, img.height * s - 1), radius=radius * s, fill=255)
    mask = mask.resize(img.size, Image.LANCZOS)
    alpha = Image.composite(img.getchannel('A'), Image.new('L', img.size, 0), mask) if img.mode == 'RGBA' else mask
    sh = Image.new('L', canvas.size, 0)
    sh.paste(alpha, (x, y + 10 * K))
    sh = sh.filter(ImageFilter.GaussianBlur(18 * K)).point(lambda v: int(v * (0.55 if dark else 0.28)))
    canvas.paste((0, 0, 0, 255) if dark else (74, 55, 38, 255), (0, 0), sh)
    canvas.paste(img, (x, y), alpha)


def compose(out: Path):
    raw = lambda n: Image.open(out / f'raw-{n}.png').convert('RGBA')  # noqa: E731
    dst = out / 'screens'
    dst.mkdir(parents=True, exist_ok=True)
    rects = json.loads((out / 'rects.json').read_text())
    scale = rects.get('scale', 2)

    # panel strips: four tabs, 1600x588 (x K), same spacing as before (one panel every 392px)
    for dark in (False, True):
        c = Image.new('RGBA', (1600 * K, 588 * K), DARK if dark else CREAM)
        for i, tab in enumerate(('today', 'todo', 'note', 'event')):
            p = card(raw(f'panel-{tab}' + ('-dark' if dark else '')), 353 * K)
            if p.height > 536 * K:
                p = p.resize((round(p.width * 536 * K / p.height), 536 * K), Image.LANCZOS)
            drop(c, p, ((35 + 392 * i) * K + (353 * K - p.width) // 2, 36 * K), dark)
            if i == 0:  # the hero cut-out is the Today panel on its own
                rounded(p).save(dst / ('hero-panel-dark.png' if dark else 'hero-panel.png'))
        c.convert('RGB').save(dst / ('panel-dark.png' if dark else 'panel.png'))

    # chat: light and dark side by side, 1200x1016 (x K)
    c = Image.new('RGBA', (1200 * K, 1016 * K), CREAM)
    for i, name in enumerate(('chat', 'chat-dark')):
        p = card(raw(name), 528 * K)
        drop(c, p, ((600 * i + 36) * K, 30 * K), i == 1)
    c.convert('RGB').save(dst / 'chat.png')

    # AI picker, 600x982 (x K)
    c = Image.new('RGBA', (600 * K, 982 * K), CREAM)
    p = card(raw('chat-picker'), 528 * K)
    drop(c, p, (36 * K, 30 * K))
    c = c.crop((0, 0, 600 * K, min(982 * K, 30 * K + p.height + 40 * K)))
    c.convert('RGB').save(dst / 'chat-picker.png')

    # maker: three steps side by side (only when the background model was there for steps 2 and 3)
    if all((out / f'raw-{n}.png').exists() for n in ('maker-pick', 'maker-edit', 'maker-name')):
        ps = [card(raw(n), 502 * K) for n in ('maker-pick', 'maker-edit', 'maker-name')]
        c = Image.new('RGBA', (1600 * K, (22 + 36) * K + max(p.height for p in ps)), CREAM)
        for i, p in enumerate(ps):
            drop(c, p, ((25 + 524 * i) * K, 22 * K))
        c.convert('RGB').save(dst / 'maker-steps.png')

    # app screens on their own for the carousel (rounded corners, transparent outside), at 2x
    tour = dst / 'tour'
    tour.mkdir(exist_ok=True)
    for n in TOUR:
        if (out / f'raw-{n}.png').exists():
            rounded(raw(n)).save(tour / f'{n}.png')

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


def wall(w: int, h: int) -> Image.Image:
    """The warm, softly blotched desktop the pet strips sit on (no lavender: the site keeps the app's warm palette)."""
    import numpy as np
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = x / w, y / h
    base = np.array([243, 226, 210], np.float32) * (1 - u[..., None]) + np.array([236, 207, 196], np.float32) * u[..., None]
    for cx, cy, rx, ry, col, k in ((.18, .55, .6, .8, (239, 211, 179), .55), (.8, .2, .5, .6, (241, 214, 200), .5),
                                   (.65, .95, .7, .7, (241, 198, 190), .45)):
        d = np.clip(1 - np.sqrt(((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2), 0, 1)[..., None] * k
        base = base * (1 - d) + np.array(col, np.float32) * d
    return Image.fromarray(base.clip(0, 255).astype('uint8')).convert('RGBA')


def strip(cells, width, height, cell):
    """Pets standing side by side on the wall, like docs/assets/screens/pets.png (no baked-in captions)."""
    c = wall(width, height)
    gap = (width - cell * len(cells)) / (len(cells) + 1)
    for i, im in enumerate(cells):
        im = im.resize((cell, cell), Image.LANCZOS)
        c.alpha_composite(im, (round(gap + i * (cell + gap)), height - cell - round(height * .02)))
    return c.convert('RGB')


# style cards: every picture cut with the same box from the 640px pet window, so the fairies keep one scale
CARD_BOX = (20, 100, 620, 640)
STYLES = ('figure', 'game', 'real', 'fluffy', 'flat', 'photo3d', 'milk')
SPRITE_BOX = (0, 160, 640, 640)  # 4:3 around Bean, the old 200x150 frame


def pets(src: Path):
    """From tools/pets.mjs captures: pets.png, pet-moods.png strips (2x), style cut-outs and Bean's walking sprite."""
    dst = src / 'screens'
    dst.mkdir(parents=True, exist_ok=True)
    im = lambda n: Image.open(src / f'{n}.png').convert('RGBA')  # noqa: E731
    kinds = [im(f'kind-{k}') for k in ('kong', 'cat', 'chick', 'dog', 'bunny', 'milk', 'choco')]
    strip(kinds, 1600 * K, 303 * K, 190 * K).save(dst / 'pets.png')
    moods = [im(f'mood-{k}') for k in ('love', 'happy', 'dance', 'yawn', 'sleep', 'think')]
    strip(moods, 1600 * K, 296 * K, 230 * K).save(dst / 'pet-moods.png')
    styles = dst / 'styles'
    styles.mkdir(exist_ok=True)
    for k in STYLES:
        im(f'kind-{k}' if k == 'milk' else f'style-{k}').crop(CARD_BOX).save(styles / f'{k}.png')
    # sprite: idle 4, one walk loop (frames 12 to 40 return to the same step), the spin dance
    frames = [f'idle-{i}' for i in range(4)] + [f'walk-{i:02d}' for i in range(12, 41)] + [f'cheer-{i:02d}' for i in range(16)]
    fw, fh, cols = 400, 300, 10
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new('RGBA', (fw * cols, fh * rows), (0, 0, 0, 0))
    for i, n in enumerate(frames):
        # Bean at the same size inside the frame as the old recording (about 63% of the frame width)
        f = im(n).crop(SPRITE_BOX).resize((round(fw * .82), round(fh * .82)), Image.LANCZOS)
        sheet.alpha_composite(f, ((i % cols) * fw + (fw - f.width) // 2, (i // cols) * fh + fh - f.height - 3))
    sheet.save(dst / 'kong-sprite.png')
    meta = {'w': fw // 2, 'h': fh // 2, 'cols': cols, 'rows': rows,
            'durations': [600] * 4 + [80] * 29 + [90] * 16,
            'idle': [0, 4], 'walk': [4, 33], 'cheer': [33, 49], 'walkSpeed': 44}  # the app walked 400px in 8s (50px/s); app.js multiplies by 1.15
    (dst / 'kong-sprite.json').write_text(json.dumps(meta))
    print('pets composed into', dst)


if __name__ == '__main__':
    cmd, arg = sys.argv[1], Path(sys.argv[2])
    {'photo': photo, 'compose': compose, 'pets': pets}[cmd](arg)
