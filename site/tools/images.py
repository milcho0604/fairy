"""Make the site's web images from the app's real screenshots (docs/assets/screens, resources/pets, build/icon.png).

Run from the repo root:  python3 site/tools/images.py
Needs Pillow. Writes site/assets/img/*.webp and site/assets/icons/*.png. Re-run after re-shooting the screens.

SCREENS=<dir> reads the screens from another folder, e.g. the output of tools/capture.mjs + tools/shots.py compose
(which also leaves ready cut-outs: hero-panel*.png, quick-bar.png, step-pick*.png and tour/*.png for the carousel).
PETS=<dir> reads tools/pets.mjs + tools/shots.py pets output (pets.png, pet-moods.png, styles/*.png, kong-sprite.*).
Pictures missing there come from docs/assets/screens.

Sizes: the fresh screens are 2x, so the widest file of each picture is twice the CSS width it is shown at
(1140px strips -> 2280, 380px chat -> 760). Smaller widths are for phones and 1x screens (srcset picks).
Strips and panels also get an AVIF next to the webp (<picture>), it is about a third smaller at the same look.
"""
import os
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs/assets/screens'
FRESH = Path(os.environ['SCREENS']).resolve() if os.environ.get('SCREENS') else None


def screen(name: str) -> Path:
    if FRESH and (FRESH / name).exists():
        return FRESH / name
    return DOCS / name


def fresh(name: str):
    return FRESH / name if FRESH and (FRESH / name).exists() else None


PETS = Path(os.environ['PETS']).resolve() if os.environ.get('PETS') else None


def pets(name: str):
    return PETS / name if PETS and (PETS / name).exists() else None
OUT = ROOT / 'site/assets/img'
ICONS = ROOT / 'site/assets/icons'
OUT.mkdir(parents=True, exist_ok=True)
ICONS.mkdir(parents=True, exist_ok=True)

# name: (source, crop box or None, widths). Crops drop the Korean captions baked into the bottom of some
# screenshots so the page can caption them in both languages.
# A job's widths: the first is the 2x file. Old docs/ screens (1x) can't fill 2280, they are capped at their own width.
JOBS = {
    'pets': ('pets.png', None, [2280, 1520, 760]),
    'pet-moods': ('pet-moods.png', (0, 0, 1600, 296), [2280, 1520, 760]),
    'panel': ('panel.png', (0, 0, 1600, 588), [2280, 1520, 760]),
    'panel-dark': ('panel-dark.png', (0, 0, 1600, 588), [2280, 1520, 760]),
    'chat-light': ('chat.png', (0, 0, 600, 1016), [760, 400]),
    'chat-dark': ('chat.png', (600, 0, 1200, 1016), [760, 400]),
    'chat-picker': ('chat-picker.png', None, [500, 260]),
}
# maker steps 2 and 3 need the background model (tools/capture.mjs skips them without BG_MODEL): only redo with fresh ones
if fresh('maker-steps.png'):
    JOBS['maker-steps'] = ('maker-steps.png', None, [2280, 1520, 760])
AVIF = {'pets', 'pet-moods', 'panel', 'panel-dark', 'maker-steps'}


WARM = {'pets', 'pet-moods'}  # only the old docs/ strips: the fresh ones are drawn on a warm wall already


def warm(img: Image.Image) -> Image.Image:
    """Warm up the cool (lavender, grey-blue) part of the desktop wallpaper behind the pets.

    A smooth per-pixel shift, not a hue swap, so there is no banding: the cooler a pixel (blue above red), the more red
    goes up and blue goes down. Warm and green pixels (peach bodies, brown fur, pink ears, the sprout) are untouched.
    Keeps the site within the app's warm palette.
    """
    import numpy as np
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bright = np.clip((250 - a.max(axis=2)) / 18, 0, 1)  # leave near-white fur (Milk, Bunny) alone
    d = np.clip(b - r + 18, 0, 46) * bright
    a[..., 0] = r + d * .85
    a[..., 1] = g + d * .12
    a[..., 2] = b - d * .75
    out = Image.fromarray(a.clip(0, 255).astype('uint8'), 'RGB')
    if img.mode == 'RGBA':
        out.putalpha(img.getchannel('A'))
    return out


def save(img: Image.Image, name: str, width: int, quality=82, avif=False):
    if img.width != width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    p = OUT / f'{name}-{width}.webp'
    img.save(p, quality=quality, method=6)
    print(p.relative_to(ROOT), img.size, p.stat().st_size // 1024, 'KB')
    if avif:
        a = OUT / f'{name}-{width}.avif'
        img.save(a, quality=60, speed=4)
        print(a.relative_to(ROOT), a.stat().st_size // 1024, 'KB')


for name, (src, box, widths) in JOBS.items():
    path = (name in ('pets', 'pet-moods') and pets(src)) or screen(src)
    im = Image.open(path)
    im = im.convert('RGBA' if im.mode in ('RGBA', 'P') and 'transparency' in im.info else 'RGB')
    old = path.parent == DOCS
    if box and old:  # docs/ screens have Korean captions baked into the bottom
        im = im.crop(box)
    elif box and name.startswith('chat-'):  # the fresh chat picture is the same layout at 2x
        im = im.crop(tuple(v * im.width // 1200 for v in box))
    if name in WARM and old:
        im = warm(im)
    for w in widths:
        if old and w > im.width:
            continue
        save(im, name, w, avif=name in AVIF)

# The two illustrated pets (transparent)
for pet in ('milk', 'choco'):
    im = Image.open(ROOT / f'resources/pets/{pet}.png').convert('RGBA')
    im = im.crop(im.getbbox())
    for h in (512, 256):
        w = round(im.width * h / im.height)
        r = im.resize((w, h), Image.LANCZOS) if im.height != h else im
        p = OUT / f'{pet}-{h}.webp'
        r.save(p, quality=86, method=6)
        print(p.relative_to(ROOT), r.size)

# App icon -> rounded favicons
icon = Image.open(ROOT / 'build/icon.png').convert('RGBA')


def rounded(size: int) -> Image.Image:
    im = icon.resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * 0.225), fill=255)
    im.putalpha(mask.resize((size, size), Image.LANCZOS))
    return im


for s in (32, 192, 512):
    rounded(s).save(ICONS / f'icon-{s}.png', optimize=True)
# iOS rounds the corners itself: keep apple-touch-icon square
icon.convert('RGB').resize((180, 180), Image.LANCZOS).save(ICONS / 'apple-touch-icon.png', optimize=True)
print('icons done')

# Hero: the "Today" panel cut out of the panel strips, with its rounded corners made transparent
for name, src, box in (('hero-panel', 'panel.png', (35, 36, 388, 572)),
                       ('hero-panel-dark', 'panel-dark.png', (34, 34, 390, 574))):
    cut = fresh(f'{name}.png')
    if cut:  # 2x cut-out: a 2x file and a 1x file (srcset 1x, 2x)
        im = Image.open(cut).convert('RGBA')
        for w in (im.width, im.width // 2):
            r = im if w == im.width else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
            p = OUT / f'{name}-{w}.webp'
            r.save(p, quality=86, method=6)
            print(p.relative_to(ROOT), r.size, p.stat().st_size // 1024, 'KB')
        continue
    im = Image.open(DOCS / src).convert('RGBA').crop(box).resize((353, 536), Image.LANCZOS)
    s = 4
    mask = Image.new('L', (im.width * s, im.height * s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width * s - 1, im.height * s - 1), radius=11 * s, fill=255)
    im.putalpha(mask.resize(im.size, Image.LANCZOS))
    p = OUT / f'{name}.webp'
    im.save(p, quality=88, method=6)
    print(p.relative_to(ROOT), im.size, p.stat().st_size // 1024, 'KB')

# Quick add bar cut out of its window so it can sit on the panel picture like a sticker
if fresh('quick-bar.png'):
    im = Image.open(fresh('quick-bar.png')).convert('RGBA')
    im = im.resize((800, round(im.height * 800 / im.width)), Image.LANCZOS)
else:
    im = Image.open(DOCS / 'quick-add.png').convert('RGBA').crop((42, 42, 758, 128))
    s = 4
    mask = Image.new('L', (im.width * s, im.height * s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width * s - 1, im.height * s - 1), radius=22 * s, fill=255)
    im.putalpha(mask.resize(im.size, Image.LANCZOS))
for w in ((800, 400) if fresh('quick-bar.png') else (716, 358)):
    r = im if w == im.width else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    p = OUT / f'quick-add-{w}.webp'
    r.save(p, quality=88, method=6)
    print(p.relative_to(ROOT), r.size)

# "How it starts" step pictures: the look picker from the first-run guide, and a fairy talking on the desktop
for name, box in (('step-pick', (40, 340, 482, 472)), ('step-pick-dark', (530, 340, 972, 472))):
    cut = fresh(f'{name}.png')
    im = Image.open(cut).convert('RGB') if cut \
        else Image.open(DOCS / 'onboarding.png').convert('RGB').crop(box)
    im.save(OUT / f'{name}.webp', quality=88, method=6)
    print(name, im.size)

# SVG favicon: the app icon (64px) inside a rounded square, so it stays crisp-edged and small
import base64, io
buf = io.BytesIO()
icon.convert('RGB').resize((64, 64), Image.LANCZOS).save(buf, 'PNG', optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode()
(ICONS / 'icon.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">'
    '<clipPath id="r"><rect width="64" height="64" rx="14"/></clipPath>'
    f'<image width="64" height="64" clip-path="url(#r)" href="data:image/png;base64,{b64}"/></svg>\n')
print('icon.svg', (ICONS / 'icon.svg').stat().st_size // 1024, 'KB')

# Fairy looks (the "모습" section): transparent cut-outs from tools/pets.mjs as shot (600x540, cards are up to 272px wide)
if pets('styles'):
    for f in sorted(pets('styles').glob('*.png')):
        im = Image.open(f).convert('RGBA')
        p = OUT / f'look-{f.stem}.webp'
        im.save(p, quality=86, method=6)
        print(p.relative_to(ROOT), im.size, p.stat().st_size // 1024, 'KB')

# Bean walking on the hero floor: 2x sprite sheet (frames are 200x150 CSS px, 400x300 in the file)
if pets('kong-sprite.png'):
    im = Image.open(pets('kong-sprite.png')).convert('RGBA')
    # AVIF for browsers that take it (CSS image-set), a lighter-alpha webp for the rest
    im.save(OUT / 'kong-sprite.avif', quality=50, speed=4)
    im.save(OUT / 'kong-sprite.webp', quality=72, alpha_quality=70, method=6)
    (OUT / 'kong-sprite.json').write_text(pets('kong-sprite.json').read_text())
    for ext in ('avif', 'webp'):
        print(f'kong-sprite.{ext}', im.size, (OUT / f'kong-sprite.{ext}').stat().st_size // 1024, 'KB')

# Real app screens for the carousel (#tour): the 2x capture and a 1x copy
if fresh('tour'):
    for f in sorted(fresh('tour').glob('*.png')):
        if f.stem in ('quick',) or f.stem.endswith('-dark'):  # too thin for a slide; dark ones are on the page already
            continue
        im = Image.open(f).convert('RGBA')
        for k, w in (('2x', im.width), ('1x', im.width // 2)):
            r = im if k == '2x' else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
            p = OUT / f'tour-{f.stem}-{k}.webp'
            r.save(p, quality=84, method=6)
            print(p.relative_to(ROOT), r.size, p.stat().st_size // 1024, 'KB')
