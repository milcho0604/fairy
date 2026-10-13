# 멍멍이: 곰돌이 골격(../bear/gen.py)을 그대로 쓰고
# 귀(늘어진 캐러멜 귀, 얼굴 앞), 한쪽 눈 얼룩, 까만 코, 꼬리, 색만 바꾼다.
import math, os, re, importlib.util
D = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bear_base', os.path.join(D, '../bear/gen.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
OL, W, E, P, union, blob = B.OL, B.W, B.E, B.P, B.union, B.blob

BODY = '#fff1de'    # 크림 몸
PATCH = '#fffbf5'   # 배, 주둥이
FAR = '#f3e1c9'     # 먼 쪽 팔다리
SPOT = '#dd9a5c'    # 캐러멜 (귀, 눈 얼룩, 꼬리 끝)
PAD = '#e9b48c'     # 발바닥
COLORS = {B.BR: BODY, B.BR2: FAR, B.CR: PATCH}


# ---------- 늘어진 귀: 얼굴 위에 얹는다 (face 를 감싸서 그린다) ----------
def flop_ear(cx, cy, sx, flap=0.0):
    """머리 위 양옆에서 시작해 머리 옆으로 늘어진 물방울 귀. flap>0 이면 바깥으로 들린다"""
    x = lambda v: cx + sx * v
    d = (f'M{x(66)},{cy-92} C{x(108)},{cy-112} {x(150)},{cy-86} {x(148)},{cy-30} '
         f'C{x(148)},{cy+14} {x(134)},{cy+42} {x(116)},{cy+36} '
         f'C{x(98)},{cy+30} {x(104)},{cy-8} {x(94)},{cy-42} '
         f'C{x(88)},{cy-62} {x(78)},{cy-78} {x(66)},{cy-92} Z')
    rot = -sx * flap
    return P(d, SPOT, extra=f' transform="rotate({rot:.1f} {x(80)} {cy-88})"' if flap else '')


EAR_FLAP = [0.0]
_face = B.face


def dog_face(cx, cy, eyes='open', mouth_kind='w', dx=0):
    ey = cy + 24
    spot = E(cx - 60 + dx + (B.LOOK[0] if eyes == 'open' else 0), ey - 3, 29, 26, SPOT, None, rot=-12)
    s = spot + _face(cx, cy, eyes, mouth_kind, dx)
    s += flop_ear(cx, cy, -1, EAR_FLAP[0]) + flop_ear(cx, cy, 1, EAR_FLAP[0])
    return s


B.face = dog_face
B.ear = lambda *a, **k: ''
B.tuft = lambda x, y: ''

# 코는 곰보다 조금 크고 둥글게
_nose = B.nose
B.nose = lambda x, y, s=1.0: _nose(x, y + 1, s * 1.12)

# ---------- 꼬리: shadow 바로 뒤(가장 뒤)에 끼운다 ----------
TAIL = ['']
_shadow = B.shadow
B.shadow = lambda cx=256, rx=112: _shadow(cx, rx) + TAIL[0]


def tail(dx=0, dy=0, side=1, wag=0):
    """엉덩이 옆에서 비스듬히 솟은 꼬리 (몸 밖으로 확실히 나오게), 끝만 캐러멜"""
    bx, by = 256 + side * (70 + dx), 428 + dy
    ang = side * (52 + wag)
    # 위로 갈수록 세워지며 가늘어진다 (막대처럼 보이지 않게)
    x, y, out = bx, by, []
    for k, (L, rx, ry) in enumerate(((24, 19, 26), (28, 16, 21), (24, 13, 16))):
        a2 = ang - side * 14 * k
        a = math.radians(a2)
        x, y = x + math.sin(a) * L, y - math.cos(a) * L
        out.append((x, y, rx, ry, a2))
    s = union([E(x_, y_, rx, ry, BODY, rot=r) for x_, y_, rx, ry, r in out])
    x_, y_, _, _, r = out[-1]
    a = math.radians(r)
    s += E(x_ + math.sin(a) * 3, y_ - math.cos(a) * 3, 10, 12, SPOT, None, rot=r)
    return s


def hanging_tail(dy=0):
    """들려서 버둥댈 때: 엉덩이 옆에서 바깥 아래로 뻗은 꼬리 (몸 안쪽에 두면 몸에 가려 안 보였다)"""
    return tail(dx=0, dy=dy, side=1, wag=78)


def recolor(svg):
    for a, b in COLORS.items():
        svg = svg.replace(a, b)
    return svg


def run(fn, t='', flap=0.0):
    TAIL[0] = t
    EAR_FLAP[0] = flap
    out = fn()
    TAIL[0] = ''
    EAR_FLAP[0] = 0.0
    return recolor(out)


def pads(svg):
    svg = re.sub(r'(rx="17" ry="12" fill=")' + PATCH, r'\1' + PAD, svg)
    return re.sub(r'(r="4.6" fill=")' + PATCH, r'\1' + PAD, svg)


def sulky_fix(svg):
    # 토라진 눈꺼풀 사각형: 얼룩 위에 놓인 왼눈 것은 얼룩 색으로
    return re.sub(r'(<rect x="170" y="[0-9.]+" width="40" height="19" fill=")' + BODY, r'\1' + SPOT, svg)


def back():
    cx, hy = 256, 236
    s = B.shadow()
    s += E(cx - 40, 451, 31, 17) + E(cx + 40, 451, 31, 17)
    s += B.capsule(196, 360, -52, 30, 19)[0] + B.capsule(316, 360, 52, 30, 19)[0]
    s += union([P(blob(cx, 386, 80, 86, 70)), P(B.head_front(cx, hy))])
    s += flop_ear(cx, hy, -1) + flop_ear(cx, hy, 1)
    # 등 가운데 솟은 꼬리: 밑동이 굵고 끝으로 가늘어지는 한 획 (타원을 이으면 땅콩처럼 잘록했다)
    s += P(f'M{cx-22},{436} C{cx-30},{396} {cx-8},{362} {cx+16},{344} C{cx+32},{332} {cx+54},{342} {cx+46},{364} '
           f'C{cx+36},{388} {cx+20},{410} {cx+22},{436} Z', BODY)
    s += E(cx + 32, 350, 14, 11, SPOT, None, rot=-35)
    return B.svg(s)


def walk_tail(ph, dy):
    return tail(dy=dy - 4, side=-1, wag=14 * math.sin(2 * ph))


B.WALK_TAIL = walk_tail


def walk(i):
    return recolor(B.walk(i))


POSES = {
    'idle': lambda: run(B.stand, tail()),
    'sit': lambda: pads(run(B.sit, tail(dx=14, dy=6, wag=20))),
    'sleep': lambda: run(B.sleep),
    'happy': lambda: run(B.happy, tail(dy=-22, wag=-14), flap=16),
    'hungry': lambda: run(B.hungry, tail(side=-1, wag=4)),
    'grab': lambda: run(B.grab, hanging_tail(-40), flap=24),
    'sulky': lambda: sulky_fix(run(B.sulky, tail(side=-1, wag=-6))),
    'doze': lambda: pads(run(B.doze, tail(dx=14, dy=6, wag=30))),
    'wave': lambda: run(B.wave, tail(side=-1)),
    'yawn': lambda: run(B.yawn, tail()),
    'talk-0': lambda: run(lambda: B.talk(0), tail()),
    'talk-1': lambda: run(lambda: B.talk(1), tail(wag=-10)),
    'back': lambda: run(back),
}
# 앱이 쓰는 그림 자리 (src/renderer/src/cute2d-art.ts). 다른 곳에 내려면 첫 인자로 폴더
def _save(name, svg):
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, '../../../src/renderer/src/art/cute2d/dog')
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, f'{name}.svg'), 'w').write(B.titled(svg, f'dog {name}'))


if __name__ == '__main__':
    for k, f in POSES.items():
        _save(f'{k}', f())
    for k in B.EYE_VARIANTS:
        _save(k, B.idle_eyes(POSES['idle'], k))
    for i in range(6):
        _save(f'walk-{i}', walk(i))
    print('ok')
