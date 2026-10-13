# 밀크 고양이 3판 (B안 확정): 곰돌이 골격(../bear/gen.py)을 그대로 쓰고
# 귀, 코입, 꼬리, 수염, 색만 바꾼다. 곰 함수는 그대로 부르고, 얼굴 부품만 고양이 것으로 바꿔 끼운 뒤
# 곰 색을 고양이 색으로 치환한다.
import math, os, re, importlib.util
D = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bear_base', os.path.join(D, '../bear/gen.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
OL, W, E, P, union, blob = B.OL, B.W, B.E, B.P, B.union, B.blob

BODY = '#fdf6ee'    # 크림 몸 (반 단계 따뜻하게)
PATCH = '#ffffff'   # 배, 주둥이
FAR = '#efe5da'     # 먼 쪽 팔다리
EAR_PK = '#f6b3bd'
NOSE_PK = '#f29aa8'
PAD_PK = '#f8c3c9'
AMBER = '#e8a23a'
COLORS = {B.BR: BODY, B.BR2: FAR, B.CR: PATCH}

# ---------- 바꿔 끼울 얼굴 부품 ----------
def rtri(pts, r, fill, line=True):
    poly = ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
    s = ''
    if line:
        s += f'<polygon points="{poly}" fill="{OL}" stroke="{OL}" stroke-width="{2*r+2*W}" stroke-linejoin="round"/>'
    return s + f'<polygon points="{poly}" fill="{fill}" stroke="{fill}" stroke-width="{2*r}" stroke-linejoin="round"/>'

HEADX = [256]

def cat_ear(x, y, r=35, inner=True, fill=B.BR):
    """곰 귀 자리(10시, 2시)에 작고 끝 둥근 세모 귀"""
    k = r / 35
    sx = -1 if x < HEADX[0] else 1
    tip = (x - sx * 6 * k, y - 40 * k)
    b1 = (x + sx * 20 * k, y + 20 * k)
    b2 = (x - sx * 46 * k, y - 16 * k)
    s = rtri([tip, b1, b2], 11 * k, fill)
    if inner:
        m = ((tip[0] + b1[0] + b2[0]) / 3, (tip[1] + b1[1] + b2[1]) / 3)
        ip = [(m[0] + (p[0] - m[0]) * f, m[1] + (p[1] - m[1]) * f + 6 * k) for p, f in ((tip, 0.5), (b1, 0.55), (b2, 0.55))]
        s += rtri(ip, 6 * k, EAR_PK, line=False)
    return s

def cat_eye(x, y, s=1.0):
    return (E(x, y, 14 * s, 18 * s, B.EYE, None) +
            f'<ellipse cx="{x:.1f}" cy="{y+9*s:.1f}" rx="{8.5*s:.1f}" ry="{5*s:.1f}" fill="{AMBER}"/>'
            f'<circle cx="{x-4.5*s:.1f}" cy="{y-7*s:.1f}" r="{6.2*s:.1f}" fill="#fff"/>'
            f'<circle cx="{x+5*s:.1f}" cy="{y+6.5*s:.1f}" r="{2.6*s:.1f}" fill="#fff"/>')

def cat_muzzle(cx, cy, s=1.0):
    """곰 주둥이 자리: 작은 흰 ω 패치 + 짧은 수염 2가닥씩 (실루엣 안쪽)"""
    st = f'fill="none" stroke="{OL}" stroke-width="3.5" stroke-linecap="round"'
    out = E(cx - 13 * s, cy + 4, 17 * s, 13 * s, PATCH, None) + E(cx + 13 * s, cy + 4, 17 * s, 13 * s, PATCH, None)
    for sx in (-1, 1):
        x0 = cx + sx * 74
        out += f'<path d="M{x0},{cy-10} l{sx*16},-4 M{x0},{cy-1} l{sx*16},2" {st}/>'
    return out

def cat_nose(x, y, s=1.0):
    y += 4
    return (f'<path d="M{x-9*s:.1f},{y-4*s:.1f} Q{x},{y-8*s:.1f} {x+9*s:.1f},{y-4*s:.1f} Q{x+4*s:.1f},{y+5*s:.1f} {x},{y+5*s:.1f} '
            f'Q{x-4*s:.1f},{y+5*s:.1f} {x-9*s:.1f},{y-4*s:.1f} Z" fill="{NOSE_PK}" stroke="{OL}" stroke-width="3.5" stroke-linejoin="round"/>')

B.ear, B.eye, B.muzzle, B.nose = cat_ear, cat_eye, cat_muzzle, cat_nose
B.tuft = lambda x, y: ''

# ---------- 꼬리: shadow 바로 뒤(가장 뒤)에 끼운다 ----------
TAIL = ['']
_shadow = B.shadow
B.shadow = lambda cx=256, rx=112: _shadow(cx, rx) + TAIL[0]

def tail_up(dx=0, dy=0, side=1, sway=0):
    """몸 뒤에서 옆으로 나와 위로 말린 큰 복슬 꼬리 (굴곡 3개)"""
    x = lambda v: 256 + side * (v - 256 + dx)
    # 엉덩이 뒤에서 낮게 나와 팔보다 바깥에서 위로 말린다 (팔을 가리지 않게)
    parts = [E(x(326), 446 + dy, 26, 20), E(x(374), 440 + dy, 28, 26),
             E(x(408 + sway * 0.4), 400 + dy, 30, 32), E(x(404 + sway), 352 + dy, 28, 28, rot=-30 * side)]
    return union(parts)

def tail_floor(dy=0):
    """앉거나 졸 때: 몸 뒤에서 옆 바닥으로 늘어져 끝만 살짝 든다 (앞으로 감지 않음)"""
    parts = [E(338, 436 + dy, 30, 24, rot=-10), E(382, 444 + dy, 30, 24), E(420, 430 + dy, 28, 30, rot=20)]
    return union(parts)

def hanging_tail(dy=0):
    parts = [E(318, 410 + dy, 26, 22), E(334, 448 + dy, 26, 28), E(330, 484 + dy, 26, 26)]
    return union(parts)

# ---------- 자세 ----------
def recolor(svg):
    for a, b in COLORS.items():
        svg = svg.replace(a, b)
    return svg

def run(fn, tail=''):
    TAIL[0] = tail
    out = fn()
    TAIL[0] = ''
    return recolor(out)

def pads(svg):
    """앉기, 졸기의 발바닥을 분홍으로"""
    svg = re.sub(r'(rx="17" ry="12" fill=")#ffffff', r'\1' + PAD_PK, svg)
    return re.sub(r'(r="4.6" fill=")#ffffff', r'\1' + PAD_PK, svg)

def sleep():
    s = B.shadow(rx=170)
    s += union([E(400, 400, 26, 24, rot=-20), E(430, 372, 26, 28), E(440, 330, 28, 30), E(420, 296, 24, 22, rot=-30)])
    s += P(blob(262, 410, 160, 84, 56, kB=0.72))
    hx, hy = 236, 338
    HEADX[0] = hx
    s += cat_ear(140, 266, 33) + cat_ear(326, 254, 33)
    HEADX[0] = 256
    s += P(B.head_front(hx, hy), extra=f' transform="rotate(-6 {hx} {hy})"')
    s += f'<g transform="rotate(-6 {hx} {hy})">' + B.face(hx, hy, 'closed', 'w') + '</g>'
    s += E(186, 446, 28, 18) + E(292, 446, 28, 18)
    z = f'font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="bold" fill="{OL}"'
    s += f'<text x="352" y="236" font-size="40" {z}>z</text><text x="388" y="196" font-size="30" {z}>z</text>'
    return B.svg(s)

def back():
    cx, hy = 256, 236
    s = B.shadow()
    s += E(cx - 40, 451, 31, 17) + E(cx + 40, 451, 31, 17)
    s += B.capsule(196, 360, -52, 30, 19)[0] + B.capsule(316, 360, 52, 30, 19)[0]
    s += cat_ear(160, 160, inner=False) + cat_ear(352, 160, inner=False)
    s += union([P(blob(cx, 386, 80, 86, 70)), P(B.head_front(cx, hy))])
    # 등 가운데에서 위로 말려 올라가는 큰 꼬리
    s += union([E(cx + 8, 412, 30, 26), E(cx + 38, 362, 40, 42), E(cx + 24, 302, 36, 34, rot=-25)])
    return B.svg(s)

# ---------- 걷기: 곰과 같은 뒤뚱 걸음(bear_base.walk). 꼬리만 몸 뒤 왼쪽에 끼운다 ----------
def walk_tail(ph, dy):
    sw = 10 * math.sin(ph)
    # 엉덩이 아래 왼쪽으로 나와 끝이 위로 말린다 (팔과 겹치지 않게 낮게)
    return union([E(200, 446 + dy, 22, 18), E(162, 454 + dy, 26, 22), E(122, 444 + dy, 28, 26),
                  E(98 + sw * 0.6, 410 + dy, 26, 28, rot=20)])

B.WALK_TAIL = walk_tail

def walk(i):
    return recolor(B.walk(i))


POSES = {
    'idle': lambda: run(B.stand, tail_up()),
    'sit': lambda: pads(run(B.sit, tail_floor(4))),
    'sleep': lambda: run(sleep),
    'happy': lambda: run(B.happy, tail_up(dy=-22, sway=8)),
    'hungry': lambda: run(B.hungry, tail_up(side=-1)),
    'grab': lambda: run(B.grab, hanging_tail(-40)),
    'sulky': lambda: run(B.sulky, tail_up(side=-1)),
    'doze': lambda: pads(run(B.doze, tail_floor(4))),
    'wave': lambda: run(B.wave, tail_up(side=-1)),
    'yawn': lambda: run(B.yawn, tail_up()),
    'talk-0': lambda: run(lambda: B.talk(0), tail_up()),
    'talk-1': lambda: run(lambda: B.talk(1), tail_up()),
    'back': lambda: run(back),
}
if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, '../../../src/renderer/src/art/cute2d/cat')
    os.makedirs(out, exist_ok=True)
    for k, f in POSES.items():
        open(os.path.join(out, f'{k}.svg'), 'w').write(B.titled(f(), f'cat {k}'))
    for i in range(6):
        open(os.path.join(out, f'walk-{i}.svg'), 'w').write(B.titled(walk(i), f'cat walk-{i}'))
    print('ok')
