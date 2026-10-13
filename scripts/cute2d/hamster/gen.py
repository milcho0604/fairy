# 햄찌: 곰돌이 골격(../bear/gen.py)을 그대로 쓰고
# 귀(작고 동그란 분홍 속귀), 흰 볼과 배, 분홍 코, ω 입과 앞니 둘, 색만 바꾼다.
# 유명 햄스터 캐릭터와 겹치지 않게 머리 가운데 흰 줄은 넣지 않는다(흰 털은 눈 아래 볼과 배뿐).
import math, os, re, importlib.util
D = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bear_base', os.path.join(D, '../bear/gen.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
OL, W, E, P, union, blob = B.OL, B.W, B.E, B.P, B.union, B.blob

BODY = '#f3bd7c'    # 황금빛
FAR = '#e3a865'
WHITE = '#fffaf3'   # 볼, 배
EAR_PK = '#f6b0b4'
NOSE_PK = '#ef8fa0'
PAD_PK = '#f8c3c9'
COLORS = {B.BR: BODY, B.BR2: FAR, B.CR: WHITE}

_face = B.face
_head = B.head_front
_mouth = B.mouth
CLIP = [0]


def ham_ear(x, y, r=35, inner=True, fill=B.BR):
    """곰 귀 자리보다 조금 안쪽 위에 작고 동그란 귀"""
    sx = -1 if x < 256 else 1
    k = r / 35
    ex, ey, rr = x - sx * 14 * k, y - 8 * k, 25 * k
    s = E(ex, ey, rr, rr * 0.92, fill)
    if inner:
        s += E(ex - sx * 1 * k, ey + 3 * k, rr * 0.52, rr * 0.46, EAR_PK, None)
    return s


def ham_head(cx, cy, puff=0):
    """아래가 조금 더 넓은 통통 볼 머리"""
    return blob(cx, cy, 130 + puff, 98, 96 + puff * 0.6, kT=0.55, kB=0.78 + puff * 0.004)


def ham_face(cx, cy, eyes='open', mouth_kind='w', dx=0):
    """눈보다 먼저 흰 볼(눈 아래 양쪽 볼에서 입가로 이어진다)을 깐다. 머리 밖으로 안 나가게 자른다"""
    CLIP[0] += 1
    cid = f'hc{CLIP[0]}'
    ey = cy + 24
    x = cx + dx
    # 양 볼이 동그랗게 솟고 코 밑 가운데는 한 번 오목하게 들어간다
    patch = (E(x - 72, ey + 36, 58, 40, WHITE, None) + E(x + 72, ey + 36, 58, 40, WHITE, None)
             + E(x, ey + 58, 46, 26, WHITE, None))
    s = (f'<clipPath id="{cid}"><path d="{ham_head(cx, cy)}"/></clipPath>'
         f'<g clip-path="url(#{cid})">{patch}</g>')
    return s + _face(cx, cy, eyes, mouth_kind, dx)


def ham_nose(x, y, s=1.0):
    y += 3
    return (E(x, y, 9 * s, 6.5 * s, NOSE_PK, OL, 3.5) +
            f'<ellipse cx="{x-2.5*s:.1f}" cy="{y-2*s:.1f}" rx="{2.6*s:.1f}" ry="{1.5*s:.1f}" fill="#fff" opacity=".8"/>')


def teeth(x, y):
    return (f'<path d="M{x-8},{y} L{x-8},{y+9} Q{x-8},{y+12} {x-4.5},{y+12} Q{x-1},{y+12} {x-1},{y+9} L{x-1},{y} Z '
            f'M{x+1},{y} L{x+1},{y+9} Q{x+1},{y+12} {x+4.5},{y+12} Q{x+8},{y+12} {x+8},{y+9} L{x+8},{y} Z" '
            f'fill="#fff" stroke="{OL}" stroke-width="3" stroke-linejoin="round"/>')


def ham_mouth(x, y, kind='w'):
    st = f'fill="none" stroke="{OL}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"'
    if kind == 'w':
        # 짧은 ω 아래로 앞니 둘이 살짝
        return (teeth(x, y + 1) +
                f'<path d="M{x},{y-6} L{x},{y} M{x-12},{y-2} Q{x-6},{y+6} {x},{y} Q{x+6},{y+6} {x+12},{y-2}" {st}/>')
    if kind in ('open', 'small'):
        return _mouth(x, y, kind) + teeth(x, y - 2 if kind == 'open' else y - 3)
    return _mouth(x, y, kind)


B.ear, B.face, B.nose, B.mouth, B.head_front = ham_ear, ham_face, ham_nose, ham_mouth, ham_head
B.muzzle = lambda cx, cy, s=1.0: ''
B.tuft = lambda x, y: ''


def recolor(svg):
    for a, b in COLORS.items():
        svg = svg.replace(a, b)
    return svg


def pads(svg):
    svg = re.sub(r'(rx="17" ry="12" fill=")#fffaf3', r'\1' + PAD_PK, svg)
    return re.sub(r'(r="4.6" fill=")#fffaf3', r'\1' + PAD_PK, svg)


def back():
    cx, hy = 256, 236
    s = B.shadow()
    s += E(cx - 40, 451, 31, 17) + E(cx + 40, 451, 31, 17)
    s += B.capsule(196, 360, -52, 30, 19)[0] + B.capsule(316, 360, 52, 30, 19)[0]
    s += ham_ear(160, 160, inner=False) + ham_ear(352, 160, inner=False)
    s += union([P(blob(cx, 386, 80, 86, 70)), P(ham_head(cx, hy))])
    # 아주 짧은 동그란 꼬리
    s += E(cx, 424, 14, 12)
    return B.svg(s)


POSES = {
    'idle': lambda: recolor(B.stand()),
    'sit': lambda: pads(recolor(B.sit())),
    'sleep': lambda: recolor(B.sleep()),
    'happy': lambda: recolor(B.happy()),
    'hungry': lambda: recolor(B.hungry()),
    'grab': lambda: recolor(B.grab()),
    'sulky': lambda: recolor(B.sulky()),
    'doze': lambda: pads(recolor(B.doze())),
    'wave': lambda: recolor(B.wave()),
    'yawn': lambda: recolor(B.yawn()),
    'talk-0': lambda: recolor(B.talk(0)),
    'talk-1': lambda: recolor(B.talk(1)),
    'back': lambda: recolor(back()),
}

# 앱이 쓰는 그림 자리 (src/renderer/src/cute2d-art.ts). 다른 곳에 내려면 첫 인자로 폴더
def _save(name, svg):
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, '../../../src/renderer/src/art/cute2d/hamster')
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, f'{name}.svg'), 'w').write(B.titled(svg, f'hamster {name}'))


if __name__ == '__main__':
    for k, f in POSES.items():
        _save(f'{k}', f())
    for k in B.EYE_VARIANTS:
        _save(k, B.idle_eyes(POSES['idle'], k))
    for i in range(6):
        _save(f'walk-{i}', recolor(B.walk(i)))
    print('ok')
