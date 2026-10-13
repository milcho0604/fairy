# 콩이: 곰돌이 골격(../bear/gen.py)을 그대로 쓰되, 곰 머리+몸 대신 살구색 콩 한 덩어리.
# 귀, 주둥이, 코, 정수리 털, 꼬리는 없다. 팔다리는 곰 것을 그대로 쓰고 어깨만 콩 가장자리로 옮긴다.
import math, os, re, importlib.util
D = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bear_base', os.path.join(D, '../bear/gen.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
OL, W, E, P, union = B.OL, B.W, B.E, B.P, B.union
_blob, _capsule, _mouth = B.blob, B.capsule, B.mouth

BODY = '#ffd3a1'    # 살구
FAR = '#f4c18c'     # 먼 쪽 팔다리
BELLY = '#ffe2c0'   # 배 (아주 옅게)
COLORS = {B.BR: BODY, B.BR2: FAR, B.CR: BELLY}
BEAN_TOP = 214      # 몸 중심에서 콩 꼭대기까지
LEAF = '#b4dc78'    # 떡잎 (연두)
STEM = '#8fc562'    # 줄기


# ---------- 머리 위 새싹: 짧은 줄기와 떡잎 두 장. 자세마다 살짝 반응한다 ----------
# 모양마다 (줄기 길이, 줄기 끝 옆으로 휨, 왼 떡잎 각도, 오른 떡잎 각도, 떡잎 길이). 각도 0 은 위, + 는 오른쪽
SPROUT_LOOK = {
    'idle': (32, 3, -64, 60, 39),
    'perky': (38, 0, -38, 36, 42),      # 기쁨: 쫑긋
    'hungry': (30, 4, -92, 88, 37),     # 배고픔: 조금 처짐
    'droop': (24, 10, -128, 122, 35),   # 토라짐: 축 처짐
    'flutter': (34, 12, -24, 70, 39),   # 들림: 바람에 날림
    'wilt': (22, 22, -150, 112, 35),    # 잠, 졸기: 시들 듯 눕는다
}
SPROUT = ['idle']
SWAY = [0.0]        # 걷기 흔들림 (도)


def leaf(x, y, ang, L, w=17):
    """(x,y) 에서 ang 도로 뻗는 통통한 떡잎 한 장"""
    a = math.radians(ang)
    ux, uy = math.sin(a), -math.cos(a)
    px, py = -uy, ux
    tx, ty = x + ux * L, y + uy * L
    pt = lambda k, s_: (f'{x + ux * L * k + px * w * s_:.1f}', f'{y + uy * L * k + py * w * s_:.1f}')
    a1, a2, b1, b2 = pt(0.2, 1.0), pt(0.85, 0.9), pt(0.85, -0.9), pt(0.2, -1.0)
    return (f'<path d="M{x:.1f},{y:.1f} C{a1[0]},{a1[1]} {a2[0]},{a2[1]} {tx:.1f},{ty:.1f} '
            f'C{b1[0]},{b1[1]} {b2[0]},{b2[1]} {x:.1f},{y:.1f} Z" fill="{LEAF}" stroke="{OL}" stroke-width="6" stroke-linejoin="round"/>')


def sprout(x, y, mode=None):
    """콩 꼭대기 (x,y) 에서 돋은 새싹"""
    ln, bend, al, ar, L = SPROUT_LOOK[mode or SPROUT[0]]
    sw = SWAY[0]
    # 흔들림은 줄기 끝을 옆으로 밀고 떡잎을 같이 돌린다
    bend += ln * math.sin(math.radians(sw))
    tx, ty = x + bend, y - ln * math.cos(math.radians(sw))
    st = f'M{x:.1f},{y:.1f} Q{x + bend * 0.1:.1f},{(y + ty) / 2:.1f} {tx:.1f},{ty:.1f}'
    out = (f'<path d="{st}" fill="none" stroke="{OL}" stroke-width="15" stroke-linecap="round"/>'
           f'<path d="{st}" fill="none" stroke="{STEM}" stroke-width="7" stroke-linecap="round"/>')
    tilt = math.degrees(math.atan2(bend, ln)) * 0.6
    return out + leaf(tx, ty, al + tilt + sw, L) + leaf(tx, ty, ar + tilt + sw, L)


def bean(cx, cy, rx, ryB):
    """곰 몸 자리(cx, cy, rx, ryB)에서 머리까지 덮는 콩 한 덩어리. 아래가 살짝 더 넓다"""
    top, bot = cy - BEAN_TOP, cy + ryB
    h = bot - top
    c = top + h * 0.52
    R = 136 + (rx - 80) * 0.6
    return _blob(cx, c, R, c - top, bot - c, kT=0.57, kB=0.66, rxB=R * 1.04)


def blob(cx, cy, rx, ryT, ryB, kT=0.56, kB=0.6, rxB=None):
    if rx in (78, 80, 98):                     # 곰 몸 호출 = 콩
        return bean(cx, cy, rx, ryB)
    return _blob(cx, cy, rx, ryT, ryB, kT, kB, rxB)


def capsule(x0, y0, ang, length, r, fill=B.BR):
    # 팔: 어깨를 콩 가장자리로 옮긴다 (곰 몸보다 콩이 넓어 그대로면 팔이 가려진다)
    if abs(x0 - 256) >= 50:
        x0 += 56 if x0 > 256 else -56
        if length == 54:                       # 팔짱은 그만큼 길게
            length += 40
        elif abs(ang) > 100:                   # 번쩍 든 팔은 콩 바깥 위로 (곰처럼 안쪽으로 들면 콩에 가린다)
            if (x0 < 256) == (math.sin(math.radians(ang)) > 0):
                ang = -ang * 0.9
            length += 14
        else:
            length += 10
    return _capsule(x0, y0, ang, length, r, fill)


def mouth(x, y, kind='w'):
    y -= 6
    st = f'fill="none" stroke="{OL}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"'
    if kind == 'w':
        return f'<path d="M{x-10},{y-2} Q{x},{y+9} {x+10},{y-2}" {st}/>'
    s = _mouth(x, y, kind)
    # 곰 코에서 내려오는 세로선은 뺀다
    return re.sub(r'<path d="M[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+" [^>]*/>', '', s)


_face = B.face
FACE_DY = [12]


def face(cx, cy, *a, **k):
    # 한 덩어리라 얼굴을 콩 가운데 쪽으로 조금 내린다
    return _face(cx, cy + FACE_DY[0], *a, **k)


B.blob, B.capsule, B.mouth, B.face = blob, capsule, mouth, face
B.head_front = lambda cx, cy, puff=0: ''
B.ear = lambda *a, **k: ''
B.muzzle = lambda *a, **k: ''
B.nose = lambda *a, **k: ''
# 곰 정수리 털 자리(머리 가운데 100 위)는 콩 꼭대기보다 36 위다. 새싹은 콩 테두리 바로 안에서 돋는다
B.tuft = lambda x, y: sprout(x + 4, y + 41)


def recolor(svg):
    # 배 패치(곰 크림 큰 타원)는 얼룩처럼 보여 뺀다. 앉은 발바닥 패드(작은 타원, 점)는 남긴다
    svg = re.sub(rf'<ellipse [^>]*rx="(?:50|54|48|46|70)" ry="(?:40|36|38|28|32)" fill="{B.CR}"[^>]*/>', '', svg)
    for a, b in COLORS.items():
        svg = svg.replace(a, b)
    return svg


def sleep():
    """엎드려 납작해진 콩"""
    s = B.shadow(rx=168)
    s += _capsule(120, 424, -70, 22, 18)[0] + _capsule(392, 424, 70, 22, 18)[0]
    s += P(_blob(256, 382, 166, 112, 76, kT=0.62, kB=0.7))
    s += E(256, 418, 70, 32, B.CR, None)
    s += _face(256, 318, 'closed', 'w')
    s += sprout(262, 276, 'wilt')
    s += E(196, 452, 26, 15) + E(316, 452, 26, 15)
    z = f'font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="bold" fill="{OL}"'
    s += f'<text x="372" y="236" font-size="40" {z}>z</text><text x="408" y="196" font-size="30" {z}>z</text>'
    return B.svg(s)


def back():
    cx = 256
    s = B.shadow()
    s += E(cx - 40, 451, 31, 17) + E(cx + 40, 451, 31, 17)
    s += capsule(196, 360, -52, 30, 19)[0] + capsule(316, 360, 52, 30, 19)[0]
    s += P(bean(cx, 386, 80, 70))
    s += sprout(cx, 177)
    return B.svg(s)


def walk(i):
    # 걸음에 맞춰 새싹이 좌우로 흔들린다 (몸 기울기와 반대로 조금 늦게)
    SWAY[0] = -9 * math.sin(2 * math.pi * i / 6 - 0.6)
    try:
        return recolor(B.walk(i))
    finally:
        SWAY[0] = 0.0


def doze():
    """졸기: 곰 졸기는 머리 묶음을 기울이는데 콩은 몸이 곧 머리라 새싹이 콩 옆구리로 간다. 새싹은 콩 꼭대기에 따로"""
    tuft, B.tuft = B.tuft, lambda x, y: ''
    try:
        out = B.doze()
    finally:
        B.tuft = tuft
    return out.replace('</g></svg>', sprout(262, 199, 'wilt') + '</g></svg>')


def mood(fn, mode):
    def run():
        SPROUT[0] = mode
        try:
            return fn()
        finally:
            SPROUT[0] = 'idle'
    return run


POSES = {
    'idle': lambda: B.stand(),
    'sit': B.sit, 'sleep': sleep, 'happy': mood(B.happy, 'perky'), 'hungry': mood(B.hungry, 'hungry'),
    'grab': mood(B.grab, 'flutter'), 'sulky': mood(B.sulky, 'droop'), 'doze': doze,
    'wave': mood(B.wave, 'perky'), 'yawn': B.yawn,
    'talk-0': lambda: B.talk(0), 'talk-1': lambda: B.talk(1), 'back': back,
}
# 앱이 쓰는 그림 자리 (src/renderer/src/cute2d-art.ts). 다른 곳에 내려면 첫 인자로 폴더
def _save(name, svg):
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, '../../../src/renderer/src/art/cute2d/kong')
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, f'{name}.svg'), 'w').write(B.titled(svg, f'kong {name}'))


if __name__ == '__main__':
    for k, f in POSES.items():
        _save(f'{k}', recolor(f()))
    for k in B.EYE_VARIANTS:
        _save(k, recolor(B.idle_eyes(POSES['idle'], k)))
    for i in range(6):
        _save(f'walk-{i}', walk(i))
    print('ok')
