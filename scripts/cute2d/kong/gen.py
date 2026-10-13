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
B.tuft = lambda x, y: ''


def recolor(svg):
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
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, '../../../src/renderer/src/art/cute2d/kong')
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, f'{name}.svg'), 'w').write(B.titled(svg, f'kong {name}'))


if __name__ == '__main__':
    for k, f in POSES.items():
        _save(f'{k}', recolor(f()))
    for i in range(6):
        _save(f'walk-{i}', walk(i))
    print('ok')
