# 뒤뚱이: 곰돌이 골격(../bear/gen.py)을 그대로 쓰고
# 귀는 없애고, 남색 몸에 하트 모양 흰 얼굴과 큰 흰 배, 주황 부리와 발, 팔 자리에 날개 손.
# 고글이나 모자 같은 소품은 없다.
import math, os, re, importlib.util
D = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bear_base', os.path.join(D, '../bear/gen.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
OL, W, E, P, union, blob = B.OL, B.W, B.E, B.P, B.union, B.blob

BODY = '#566892'    # 남색
FAR = '#4b5c84'
WHITE = '#fffdf8'
ORANGE = '#ffa94d'
ORANGE_D = '#f39a3a'
COLORS = {B.BR: BODY, B.BR2: FAR, B.CR: WHITE}

_face = B.face
_mouth = B.mouth
_capsule = B.capsule
CLIP = [0]


def pen_face(cx, cy, eyes='open', mouth_kind='w', dx=0):
    """눈 둘을 감싼 하트 모양 흰 얼굴. 머리 밖으로 안 나가게 자른다"""
    CLIP[0] += 1
    cid = f'pc{CLIP[0]}'
    ey = cy + 24
    x = cx + dx
    patch = (E(x - 52, ey - 2, 62, 62, WHITE, None) + E(x + 52, ey - 2, 62, 62, WHITE, None)
             + E(x, ey + 44, 100, 52, WHITE, None))
    s = (f'<clipPath id="{cid}"><path d="{B.head_front(cx, cy)}"/></clipPath>'
         f'<g clip-path="url(#{cid})">{patch}</g>')
    return s + _face(cx, cy, eyes, mouth_kind, dx)


def beak(x, y, s=1.0):
    """작고 둥근 세모 주황 부리 (아래를 향한다)"""
    s *= 1.18
    t, b = y - 8 * s, y + 12 * s
    return (f'<path d="M{x-17*s:.1f},{t:.1f} Q{x},{t-6*s:.1f} {x+17*s:.1f},{t:.1f} Q{x+12*s:.1f},{b:.1f} {x},{b:.1f} '
            f'Q{x-12*s:.1f},{b:.1f} {x-17*s:.1f},{t:.1f} Z" fill="{ORANGE}" stroke="{OL}" stroke-width="4.5" stroke-linejoin="round"/>'
            f'<ellipse cx="{x-5*s:.1f}" cy="{t+3*s:.1f}" rx="{4.5*s:.1f}" ry="{2*s:.1f}" fill="#fff" opacity=".7"/>')


def pen_mouth(x, y, kind='w'):
    """부리 아래 입. 웃는 기본은 부리만, 벌린 입은 부리 아래로 작은 입속과 아랫부리"""
    if kind in ('w', 'pout'):
        return ''
    if kind in ('open', 'small', 'o'):
        w = {'open': 13, 'small': 9, 'o': 7}[kind]
        h = {'open': 15, 'small': 10, 'o': 10}[kind]
        top = y - 6
        return (f'<path d="M{x-w},{top} Q{x},{top+h*2} {x+w},{top} Z" fill="#8a3f3f" stroke="{OL}" stroke-width="4" stroke-linejoin="round"/>'
                + (f'<path d="M{x-6},{top+h*0.75} Q{x},{top+h*0.4} {x+6},{top+h*0.75} Q{x},{top+h} {x-6},{top+h*0.75} Z" fill="#ec8c8c"/>' if kind == 'open' else ''))
    if kind == 'yawn':
        return _mouth(x, y + 4, 'yawn')
    return ''


def flipper(x0, y0, ang, length, r, fill=B.BR):
    """곰 팔 자리, 같은 방향으로 뻗는 날개 손: 뿌리는 넓고 끝은 조금 좁고 둥글다"""
    a = math.radians(ang)
    L = length + 8
    x1, y1 = x0 + L * math.sin(a), y0 + L * math.cos(a)
    nx, ny = math.cos(a), -math.sin(a)
    rb, rt = r * 1.12, r * 0.78
    quad = (f'<polygon points="{x0+nx*rb:.1f},{y0+ny*rb:.1f} {x1+nx*rt:.1f},{y1+ny*rt:.1f} '
            f'{x1-nx*rt:.1f},{y1-ny*rt:.1f} {x0-nx*rb:.1f},{y0-ny*rb:.1f}" fill="{fill}" stroke="{OL}" stroke-width="{W}"/>')
    shapes = [E(x0, y0, rb, rb, fill), E(x1, y1, rt, rt, fill), quad]
    return union(shapes), (x1, y1)


def pen_capsule(x0, y0, ang, length, r, fill=B.BR):
    if r >= 20:   # 들렸을 때 늘어진 다리: 짧은 남색 다리 끝에 주황 발
        s, (x1, y1) = _capsule(x0, y0, ang, length, r, fill)
        return s + E(x1, y1 + 6, 24, 14, ORANGE, rot=-ang * 0.5), (x1, y1)
    return flipper(x0, y0, ang, length, r, fill)


B.face, B.mouth, B.nose, B.capsule = pen_face, pen_mouth, beak, pen_capsule
B.ear = lambda *a, **k: ''
B.muzzle = lambda cx, cy, s=1.0: ''
B.tuft = lambda x, y: ''


def orange_feet(svg):
    """곰 발 크기 타원(31x17, 30x17, 28x18, 앉은 발 34x27)만 주황으로, 앉은 발바닥 무늬는 뺀다"""
    svg = re.sub(rf'(rx="(?:31|30)" ry="17" fill="){B.BR}', r'\1' + ORANGE, svg)
    svg = re.sub(rf'(rx="28" ry="18" fill="){B.BR}', r'\1' + ORANGE, svg)
    svg = re.sub(rf'(rx="34" ry="27" fill="){B.BR}', r'\1' + ORANGE, svg)
    svg = re.sub(rf'<ellipse [^>]*rx="17" ry="12" fill="{B.CR}"[^>]*/>', '', svg)
    svg = re.sub(rf'<circle [^>]*r="4.6" fill="{B.CR}"/>', '', svg)
    return svg


def big_belly(svg):
    """배 흰 판을 곰보다 크게"""
    for a, b in (('rx="50" ry="40"', 'rx="60" ry="50"'), ('rx="54" ry="36"', 'rx="70" ry="44"'),
                 ('rx="48" ry="38"', 'rx="58" ry="48"')):
        svg = svg.replace(f'{a} fill="{B.CR}"', f'{b} fill="{B.CR}"')
    return svg


def fix(svg):
    svg = big_belly(orange_feet(svg))
    # 토라진 눈꺼풀 가림판은 흰 얼굴 위라 흰색으로
    svg = re.sub(rf'(<rect [^>]*fill="){B.BR}"', r'\1' + B.CR + '"', svg)
    for a, b in COLORS.items():
        svg = svg.replace(a, b)
    return svg


def back():
    cx, hy = 256, 236
    s = B.shadow()
    s += E(cx - 40, 451, 31, 17) + E(cx + 40, 451, 31, 17)
    s += pen_capsule(196, 360, -52, 30, 19)[0] + pen_capsule(316, 360, 52, 30, 19)[0]
    s += union([P(blob(cx, 386, 80, 86, 70)), P(B.head_front(cx, hy))])
    # 짧은 세모 꽁지
    s += (f'<path d="M{cx-28},{414} Q{cx},{406} {cx+28},{414} L{cx+6},{438} Q{cx},{443} {cx-6},{438} Z" '
          f'fill="{B.BR}" stroke="{OL}" stroke-width="{W}" stroke-linejoin="round"/>')
    return B.svg(s)


POSES = {
    'idle': B.stand, 'sit': B.sit, 'sleep': B.sleep, 'happy': B.happy, 'hungry': B.hungry, 'grab': B.grab,
    'sulky': B.sulky, 'doze': B.doze, 'wave': B.wave, 'yawn': B.yawn,
    'talk-0': lambda: B.talk(0), 'talk-1': lambda: B.talk(1), 'back': back,
}

# 앱이 쓰는 그림 자리 (src/renderer/src/cute2d-art.ts). 다른 곳에 내려면 첫 인자로 폴더
def _save(name, svg):
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, '../../../src/renderer/src/art/cute2d/penguin')
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, f'{name}.svg'), 'w').write(B.titled(svg, f'penguin {name}'))


if __name__ == '__main__':
    for k, f in POSES.items():
        _save(f'{k}', fix(f()))
    for i in range(6):
        _save(f'walk-{i}', fix(B.walk(i)))
    print('ok')
