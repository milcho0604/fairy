# 삐약이: 곰돌이 골격(../bear/gen.py)을 그대로 쓰고 귀 대신 머리 위 깃털 세 가닥,
# 주둥이와 코 대신 주황 부리, 팔 대신 날개 손(자리와 흔들기는 곰 팔과 같다), 주황 발, 노랑 색만 바꾼다.
import math, os, re, importlib.util
D = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bear_base', os.path.join(D, '../bear/gen.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
OL, W, E, P, union, blob = B.OL, B.W, B.E, B.P, B.union, B.blob
_capsule, _head_front = B.capsule, B.head_front

BODY = '#ffe27a'    # 노랑
FAR = '#f7d462'     # 먼 쪽
BELLY = '#fff3c4'   # 배
WING = '#ffd24d'    # 날개 손
ORANGE = '#f6a23c'  # 부리, 발
MOUTH_IN = '#c8553d'
COLORS = {B.BR: BODY, B.BR2: FAR, B.CR: BELLY}


def rtri(pts, r, fill, line=True, lw=W):
    poly = ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
    s = ''
    if line:
        s += f'<polygon points="{poly}" fill="{OL}" stroke="{OL}" stroke-width="{2*r+lw}" stroke-linejoin="round"/>'
    return s + f'<polygon points="{poly}" fill="{fill}" stroke="{fill}" stroke-width="{2*r}" stroke-linejoin="round"/>'


# ---------- 머리 깃털: 머리 경로에 하위 경로로 붙여 union 에서 안쪽 이음선이 안 생기게 ----------
def feather(bx, by, ang, ln, w):
    a = math.radians(ang)
    ux, uy = math.sin(a), -math.cos(a)          # 위쪽 방향
    px, py = -uy, ux                             # 옆 방향
    tx, ty = bx + ux * ln, by + uy * ln
    l = (bx - px * w, by - py * w)
    r = (bx + px * w, by + py * w)
    c1 = (bx + ux * ln * 0.55 - px * w * 1.15, by + uy * ln * 0.55 - py * w * 1.15)
    c2 = (bx + ux * ln * 0.55 + px * w * 1.15, by + uy * ln * 0.55 + py * w * 1.15)
    return (f' M{l[0]:.1f},{l[1]:.1f} Q{c1[0]:.1f},{c1[1]:.1f} {tx:.1f},{ty:.1f} '
            f'Q{c2[0]:.1f},{c2[1]:.1f} {r[0]:.1f},{r[1]:.1f} Z')


def head_front(cx, cy, puff=0):
    top = cy - 100
    d = _head_front(cx, cy, puff)
    for ang, ln, dx in ((-38, 46, -16), (0, 58, 0), (38, 46, 16)):
        d += feather(cx + dx, top + 18, ang, ln, 14)
    return d


def wing(x0, y0, ang, length, r, fill=WING):
    """곰 팔 자리, 같은 각도로 뻗는 날개 손: 어깨 쪽이 넓고 끝이 둥근 물방울 + 깃 끝 홈 하나"""
    a = math.radians(ang)
    ux, uy = math.sin(a), math.cos(a)
    px, py = -uy, ux
    L = length + r
    tx, ty = x0 + ux * L, y0 + uy * L
    w0, w1 = r * 1.25, r * 0.95
    bl = (x0 - px * w0, y0 - py * w0)
    br = (x0 + px * w0, y0 + py * w0)
    d = (f'M{bl[0]:.1f},{bl[1]:.1f} C{bl[0]+ux*L*0.7:.1f},{bl[1]+uy*L*0.7:.1f} {tx-px*w1:.1f},{ty-py*w1:.1f} {tx:.1f},{ty:.1f} '
         f'C{tx+px*w1:.1f},{ty+py*w1:.1f} {br[0]+ux*L*0.7:.1f},{br[1]+uy*L*0.7:.1f} {br[0]:.1f},{br[1]:.1f} '
         f'C{x0-ux*r*0.6+px*w0:.1f},{y0-uy*r*0.6+py*w0:.1f} {x0-ux*r*0.6-px*w0:.1f},{y0-uy*r*0.6-py*w0:.1f} {bl[0]:.1f},{bl[1]:.1f} Z')
    s = P(d, fill)
    return s, (tx, ty)


def capsule(x0, y0, ang, length, r, fill=B.BR):
    if abs(x0 - 256) >= 50:                      # 팔 자리 = 날개
        if abs(ang) > 100 and (x0 < 256) == (math.sin(math.radians(ang)) > 0):
            ang = -ang * 0.9                     # 번쩍 든 날개는 바깥 위로 (안쪽이면 머리에 가린다)
        return wing(x0, y0, ang, length, r, WING if fill == B.BR else '#f2c440')
    return _capsule(x0, y0, ang, length, r, ORANGE)   # 버둥 다리는 주황


def mouth(x, y, kind='w'):
    """부리 (곰 코와 입 자리). 닫힘은 둥근 세모 하나, 벌림은 위아래 두 쪽"""
    y0 = y - 20
    if kind in ('w', 'pout'):
        dx = -4 if kind == 'pout' else 0
        return rtri([(x - 13 + dx, y0), (x + 13 + dx, y0), (x + dx, y0 + 13)], 4, ORANGE, lw=9)
    gap = {'small': 4, 'o': 6, 'open': 9, 'yawn': 16}.get(kind, 6)
    s = rtri([(x - 16, y0 + 1), (x, y0 - 6), (x + 16, y0 + 1), (x, y0 + 14 + gap)], 4, ORANGE, lw=9)
    s += rtri([(x - 9, y0 + 4), (x + 9, y0 + 4), (x, y0 + 8 + gap)], 2.5, MOUTH_IN, line=False)
    return s


_P = B.P


def P(d, fill=B.BR, stroke=OL, sw=W, extra=''):
    if stroke == OL and ' M' in d:
        return union([_P(d, fill, stroke, sw, extra)])
    return _P(d, fill, stroke, sw, extra)


B.head_front, B.capsule, B.mouth, B.P = head_front, capsule, mouth, P
B.ear = lambda *a, **k: ''
B.muzzle = lambda *a, **k: ''
B.nose = lambda *a, **k: ''
B.tuft = lambda x, y: ''


def recolor(svg):
    for a, b in COLORS.items():
        svg = svg.replace(a, b)
    # 발 (곰 발 타원 크기) 은 주황, 앉은 발바닥 패드는 지운다
    svg = re.sub(r'(rx="(?:31|30|28|34)" ry="(?:17|18|27)" fill=")' + BODY, r'\1' + ORANGE, svg)
    svg = re.sub(r'<ellipse[^>]*rx="17" ry="12" fill="' + BELLY + '"[^>]*/>', '', svg)
    svg = re.sub(r'<circle[^>]*r="4.6" fill="' + BELLY + '"/>', '', svg)
    return svg


def tail(x, y, s=1.0, flip=1):
    """작은 꽁지깃 세 개 (뒤에서 살짝 보이게)"""
    d = ''
    for ang in (50, 75, 100):
        d += feather(x, y, ang * flip, 34 * s, 10 * s)
    return P(d.strip(), BODY.replace('#', '#'))


def sleep():
    s = B.shadow(rx=170)
    s += P(blob(262, 410, 160, 84, 56, kB=0.72))
    hx, hy = 236, 338
    s += f'<g transform="rotate(-6 {hx} {hy})">' + P(head_front(hx, hy)) + B.face(hx, hy, 'closed', 'w') + '</g>'
    s += wing(372, 404, 70, 24, 17, WING)[0]
    s += E(186, 446, 28, 18) + E(292, 446, 28, 18)
    z = f'font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="bold" fill="{OL}"'
    s += f'<text x="372" y="236" font-size="40" {z}>z</text><text x="408" y="196" font-size="30" {z}>z</text>'
    return B.svg(s)


def back():
    cx, hy = 256, 236
    s = B.shadow()
    s += E(cx - 40, 451, 31, 17) + E(cx + 40, 451, 31, 17)
    s += capsule(196, 360, -52, 30, 19)[0] + capsule(316, 360, 52, 30, 19)[0]
    s += union([P(blob(cx, 386, 80, 86, 70)), P(head_front(cx, hy))])
    # 꽁지깃: 등 아래 가운데
    s += union([E(cx - 15, 418, 15, 14, FAR), E(cx + 15, 418, 15, 14, FAR), E(cx, 405, 16, 15, FAR)])
    return B.svg(s)


def walk(i):
    return recolor(B.walk(i))


POSES = {
    'idle': lambda: B.stand(),
    'sit': B.sit, 'sleep': sleep, 'happy': B.happy, 'hungry': B.hungry, 'grab': B.grab,
    'sulky': B.sulky, 'doze': B.doze, 'wave': B.wave, 'yawn': B.yawn,
    'talk-0': lambda: B.talk(0), 'talk-1': lambda: B.talk(1), 'back': back,
}
# 앱이 쓰는 그림 자리 (src/renderer/src/cute2d-art.ts). 다른 곳에 내려면 첫 인자로 폴더
def _save(name, svg):
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, '../../../src/renderer/src/art/cute2d/chick')
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, f'{name}.svg'), 'w').write(B.titled(svg, f'chick {name}'))


if __name__ == '__main__':
    for k, f in POSES.items():
        _save(f'{k}', recolor(f()))
    for i in range(6):
        _save(f'walk-{i}', walk(i))
    print('ok')
