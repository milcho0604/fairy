# 토순이: 곰돌이 골격(../bear/gen.py)을 그대로 쓰고
# 귀(위로 긴 귀, 안쪽 분홍), 코입(작은 분홍 코), 꼬리(솜뭉치), 색만 바꾼다.
# 긴 귀는 캔버스(512) 안에 들어오도록 끝 높이를 재서 벌리거나 줄인다.
import math, os, re, importlib.util
D = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bear_base', os.path.join(D, '../bear/gen.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
OL, W, E, P, union, blob = B.OL, B.W, B.E, B.P, B.union, B.blob

BODY = '#f8efec'    # 흰 몸 (흰 배가 보이게 아주 살짝 분홍빛 크림)
PATCH = '#ffffff'   # 배
FAR = '#ebdfdc'     # 먼 쪽 팔다리
EAR_PK = '#f7b9c3'
NOSE_PK = '#f29aa8'
PAD_PK = '#f8c3c9'
COLORS = {B.BR: BODY, B.BR2: FAR, B.CR: PATCH}

MARGIN = 14          # 캔버스 가장자리 여유 (테두리 포함)
EAR_LEN = 122
EAR_SPLAY = [12.0]   # 기본 벌림 각도 (자세마다 바꾼다)
EAR_DROOP = [0.0]    # 귀 끝 접힘 (토라짐, 배고픔)
EAR_BOTH = [False]   # True 면 두 귀 다 접는다 (걷기, 들림)
HEADX = [256]


def ear_shape(bx, by, sx, ang, L, droop=0.0):
    """밑동 (bx,by)에서 ang 도(0=위, +는 바깥) 로 뻗는 긴 타원 귀. 바깥 테두리 + 칠 + 안쪽 분홍.
    droop>0 이면 위쪽 절반이 바깥으로 꺾인다."""
    rx = 28
    out = []
    a = math.radians(ang)
    if droop == 0:
        cx_, cy_ = bx + math.sin(a) * L / 2, by - math.cos(a) * L / 2
        out.append((cx_, cy_, rx, L / 2 + 6, ang))
    else:
        L1 = L * 0.52
        c1 = (bx + math.sin(a) * L1 / 2, by - math.cos(a) * L1 / 2)
        j = (bx + math.sin(a) * L1 * 0.92, by - math.cos(a) * L1 * 0.92)
        a2 = math.radians(ang + droop)
        L2 = L * 0.5
        c2 = (j[0] + math.sin(a2) * L2 / 2, j[1] - math.cos(a2) * L2 / 2)
        out.append((c1[0], c1[1], rx, L1 / 2 + 8, ang))
        out.append((c2[0], c2[1], rx - 2, L2 / 2 + 6, ang + droop))
    rot = lambda r: sx * r
    s = union([E(x, y, w, h, BODY, rot=r) for x, y, w, h, r in out])
    # 안쪽 분홍: 곧은 귀는 타원 하나, 접힌 귀는 접힌 자리에서 끊기지 않게 굵은 둥근 선 하나로 잇는다
    if len(out) == 1:
        x, y, w, h, r = out[0]
        s += E(x, y, w * 0.5, h * 0.74, EAR_PK, None, rot=r)
    else:
        (x1, y1, w1, h1, r1), (x2, y2, w2, h2, r2) = out
        d1 = (math.sin(math.radians(r1)), -math.cos(math.radians(r1)))
        d2 = (math.sin(math.radians(r2)), -math.cos(math.radians(r2)))
        p0 = (x1 - d1[0] * h1 * 0.55, y1 - d1[1] * h1 * 0.55)
        pj = (x1 + d1[0] * h1 * 0.62, y1 + d1[1] * h1 * 0.62)
        p2 = (x2 + d2[0] * h2 * 0.42, y2 + d2[1] * h2 * 0.42)
        s += (f'<path d="M{p0[0]:.1f},{p0[1]:.1f} L{pj[0]:.1f},{pj[1]:.1f} L{p2[0]:.1f},{p2[1]:.1f}" fill="none" '
              f'stroke="{EAR_PK}" stroke-width="{w1*0.62:.1f}" stroke-linecap="round" stroke-linejoin="round"/>')
    return s, out


def ear_top(out):
    """회전 타원들의 가장 높은 점과 좌우 끝 (테두리 반 포함)"""
    ys, xs = [], []
    for x, y, w, h, r in out:
        t = math.radians(r)
        hy = math.sqrt((h * math.cos(t)) ** 2 + (w * math.sin(t)) ** 2)
        hx = math.sqrt((h * math.sin(t)) ** 2 + (w * math.cos(t)) ** 2)
        ys.append(y - hy - W)
        xs += [x - hx - W, x + hx + W]
    return min(ys), min(xs), max(xs)


def bunny_ear(x, y, r=35, inner=True, fill=None):
    """곰 귀 자리(머리 중심 기준 -96,-76)에서 밑동을 머리 위 안쪽으로 옮겨 긴 귀를 세운다"""
    k = r / 35
    sx = -1 if x < HEADX[0] else 1
    bx, by = x - sx * 52 * k, y - 4 * k
    L = EAR_LEN * k
    ang = EAR_SPLAY[0]
    # 캔버스 안에 들어올 때까지 벌리고, 그래도 넘으면 줄인다
    droop = sx * EAR_DROOP[0] if (sx == 1 or EAR_BOTH[0]) else 0.0
    L0, a0 = L, ang
    for _ in range(80):
        s, out = ear_shape(bx, by, sx, sx * ang, L, droop)
        top, lo, hi = ear_top(out)
        if top >= MARGIN and lo >= MARGIN and hi <= 512 - MARGIN:
            break
        if top < MARGIN and ang < 40:
            ang += 2
        else:
            L -= 4
    if (L, ang) != (L0, a0):
        print(f'  clamp ear y={y:.0f} splay {a0:.0f}->{ang:.0f} len {L0:.0f}->{L:.0f}')
    return s


def bunny_nose(x, y, s=1.0):
    y += 3
    return (f'<path d="M{x-8*s:.1f},{y-4*s:.1f} Q{x},{y-7*s:.1f} {x+8*s:.1f},{y-4*s:.1f} Q{x+4*s:.1f},{y+4*s:.1f} {x},{y+4*s:.1f} '
            f'Q{x-4*s:.1f},{y+4*s:.1f} {x-8*s:.1f},{y-4*s:.1f} Z" fill="{NOSE_PK}" stroke="{OL}" stroke-width="3.5" stroke-linejoin="round"/>')


def bunny_muzzle(cx, cy, s=1.0):
    # 하얀 몸이라 주둥이 패치는 없앤다 (볼만 둥글게)
    return ''


B.ear, B.nose, B.muzzle = bunny_ear, bunny_nose, bunny_muzzle
B.tuft = lambda x, y: ''

# ---------- 꼬리: shadow 바로 뒤(가장 뒤)에 끼운다 ----------
TAIL = ['']
_shadow = B.shadow
B.shadow = lambda cx=256, rx=112: _shadow(cx, rx) + TAIL[0]


def puff(x, y, r=24):
    """솜뭉치 꼬리: 동그라미 셋을 한 덩어리로"""
    return union([E(x, y, r, r, BODY), E(x + r * 0.55, y - r * 0.45, r * 0.7, r * 0.7, BODY),
                  E(x - r * 0.5, y - r * 0.5, r * 0.62, r * 0.62, BODY)])


def side_tail(dx=0, dy=0, side=1):
    return puff(256 + side * (86 + dx), 432 + dy, 22)


def recolor(svg):
    for a, b in COLORS.items():
        svg = svg.replace(a, b)
    return svg


def run(fn, t='', splay=12.0, droop=0.0, both=False):
    TAIL[0] = t
    EAR_SPLAY[0], EAR_DROOP[0], EAR_BOTH[0] = splay, droop, both
    out = fn()
    TAIL[0] = ''
    EAR_SPLAY[0], EAR_DROOP[0], EAR_BOTH[0] = 12.0, 0.0, False
    return recolor(out)


def pads(svg):
    svg = re.sub(r'(rx="17" ry="12" fill=")' + PATCH, r'\1' + PAD_PK, svg)
    return re.sub(r'(r="4.6" fill=")' + PATCH, r'\1' + PAD_PK, svg)


def sleep():
    """엎드려 자기: 긴 귀는 등 위로 눕힌다 (몸 위, 머리 뒤)"""
    s = B.shadow(rx=170)
    s += puff(408, 420, 22)
    s += P(blob(262, 410, 160, 84, 56, kB=0.72))
    hx, hy = 236, 338
    # 등에 누운 귀 두 개 (오른쪽 뒤로)
    for bx, by, ang in ((262, 262, 58), (282, 270, 74)):
        e, _ = ear_shape(bx, by, 1, ang, 118)
        s += e
    s += P(B.head_front(hx, hy), extra=f' transform="rotate(-6 {hx} {hy})"')
    s += f'<g transform="rotate(-6 {hx} {hy})">' + B.face(hx, hy, 'closed', 'w') + '</g>'
    s += E(186, 446, 28, 18) + E(292, 446, 28, 18)
    z = f'font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="bold" fill="{OL}"'
    s += f'<text x="104" y="226" font-size="40" {z}>z</text><text x="70" y="186" font-size="30" {z}>z</text>'
    return B.svg(s)


def back():
    cx, hy = 256, 236
    s = B.shadow()
    s += E(cx - 40, 451, 31, 17) + E(cx + 40, 451, 31, 17)
    s += B.capsule(196, 360, -52, 30, 19)[0] + B.capsule(316, 360, 52, 30, 19)[0]
    # 뒷모습: 귀 뒷면은 분홍 없이
    pk = B.ear
    for sx, x in ((-1, 160), (1, 352)):
        e = bunny_ear(x, 160)
        s += re.sub(r'<ellipse [^>]*fill="' + EAR_PK + '"[^>]*/>', '', e)
    s += union([P(blob(cx, 386, 80, 86, 70)), P(B.head_front(cx, hy))])
    s += puff(cx, 410, 28)
    return B.svg(s)


def walk_tail(ph, dy):
    return puff(256 - 88, 432 + dy, 20)


B.WALK_TAIL = walk_tail


def walk(i):
    # 걸을 때 귀가 박자에 맞춰 살짝 흔들린다
    ph = 2 * math.pi * i / 6
    # 걷기도 머리가 서기 높이라 귀를 서기처럼 세운다 (걷기 시작할 때 귀 모양이 바뀌지 않게). 박자에 맞춰 살짝 벌어졌다 모인다
    EAR_SPLAY[0], EAR_DROOP[0], EAR_BOTH[0] = 12 + 4 * math.sin(ph), 0.0, False
    out = recolor(B.walk(i))
    EAR_SPLAY[0], EAR_DROOP[0], EAR_BOTH[0] = 12.0, 0.0, False
    return out


POSES = {
    'idle': lambda: run(B.stand, side_tail()),
    'sit': lambda: pads(run(B.sit, side_tail(dx=10, dy=8))),
    'sleep': lambda: run(sleep),
    'happy': lambda: run(B.happy, side_tail(dy=-22), splay=24, droop=14, both=True),
    'hungry': lambda: run(B.hungry, side_tail(side=-1), splay=16, droop=50),
    'grab': lambda: run(B.grab, puff(356, 404, 21), splay=30, droop=40, both=True),
    'sulky': lambda: run(B.sulky, side_tail(side=-1), splay=30, droop=60),
    'doze': lambda: pads(run(B.doze, side_tail(dx=10, dy=8))).replace('<text x="396" y="168"', '<text x="440" y="250"'),
    'wave': lambda: run(B.wave, side_tail(side=-1)),
    'yawn': lambda: run(B.yawn, side_tail(), splay=16),
    'talk-0': lambda: run(lambda: B.talk(0), side_tail()),
    'talk-1': lambda: run(lambda: B.talk(1), side_tail(), splay=10),
    'back': lambda: run(back),
}
# 앱이 쓰는 그림 자리 (src/renderer/src/cute2d-art.ts). 다른 곳에 내려면 첫 인자로 폴더
def _save(name, svg):
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, '../../../src/renderer/src/art/cute2d/bunny')
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, f'{name}.svg'), 'w').write(B.titled(svg, f'bunny {name}'))


if __name__ == '__main__':
    for k, f in POSES.items():
        _save(f'{k}', f())
    for k in B.EYE_VARIANTS:
        _save(k, B.idle_eyes(POSES['idle'], k))
    for i in range(6):
        _save(f'walk-{i}', walk(i))
    print('ok')
