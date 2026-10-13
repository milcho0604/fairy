# 아기 곰 "곰돌이" 2D: 포즈 7장 + 옆 걷기 6장 SVG 생성 (style.md 공통 화풍)
import math, os, sys

D = os.path.dirname(os.path.abspath(__file__))
# 앱이 쓰는 그림 자리 (src/renderer/src/cute2d-art.ts). 다른 곳에 내려면 첫 인자로 폴더
OUT = os.path.join(D, '../../../src/renderer/src/art/cute2d/bear')


def titled(svg, name):
    """그림 이름표 (<title>): 화면 읽기 프로그램과 린트(biome a11y)"""
    return svg.replace('>', f'><title>{name}</title>', 1)
OL = '#4a3a36'      # 테두리
W = 7               # 테두리 두께
BR = '#b98558'      # 밀크초코
BR2 = '#a0714a'     # 먼 쪽 팔다리(조금 어둡게)
CR = '#f8e8c8'      # 크림
EYE = '#3a2b27'
BL = '#f2a199'      # 볼터치
PINK = '#ec8c8c'


def blob(cx, cy, rx, ryT, ryB, kT=0.56, kB=0.6, rxB=None):
    """위는 둥글고 아래는 살짝 각진 찹쌀떡 모양"""
    rxB = rxB or rx
    t, b = cy - ryT, cy + ryB
    return (f'M{cx},{t} C{cx+rx*kT},{t} {cx+rx},{cy-ryT*kT} {cx+rx},{cy} '
            f'C{cx+rx},{cy+ryB*kB} {cx+rxB*kB},{b} {cx},{b} '
            f'C{cx-rxB*kB},{b} {cx-rx},{cy+ryB*kB} {cx-rx},{cy} '
            f'C{cx-rx},{cy-ryT*kT} {cx-rx*kT},{t} {cx},{t} Z')


def P(d, fill=BR, stroke=OL, sw=W, extra=''):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<path d="{d}" fill="{fill}"{s}{extra}/>'


def E(cx, cy, rx, ry, fill=BR, stroke=OL, sw=W, rot=0, op=None):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    r = f' transform="rotate({rot} {cx} {cy})"' if rot else ''
    o = f' opacity="{op}"' if op is not None else ''
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}"{s}{r}{o}/>'


def union(shapes):
    """겉선만 남기고 안쪽 이음선은 없는 한 덩어리: 굵은 선 층 + 칠 층"""
    out = ['<g>']
    out += [s.replace(f'stroke-width="{W}"', f'stroke-width="{W*2}"') for s in shapes]
    out += [s.replace(f' stroke="{OL}" stroke-width="{W}"', '') for s in shapes]
    out.append('</g>')
    return ''.join(out)


def capsule(x0, y0, ang, length, r, fill=BR):
    """(x0,y0)에서 ang(도, 0=아래, +는 앞쪽=오른쪽) 방향으로 뻗는 뭉툭한 팔다리"""
    a = math.radians(ang)
    x1, y1 = x0 + length * math.sin(a), y0 + length * math.cos(a)
    return (f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke="{OL}" stroke-width="{2*r+W}" stroke-linecap="round"/>'
            f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke="{fill}" stroke-width="{2*r-W}" stroke-linecap="round"/>'), (x1, y1)


def eye(x, y, s=1.0):
    return (E(x, y, 14 * s, 18 * s, EYE, None) +
            f'<circle cx="{x-4.5*s:.1f}" cy="{y-7*s:.1f}" r="{6.2*s:.1f}" fill="#fff"/>'
            f'<circle cx="{x+5*s:.1f}" cy="{y+6.5*s:.1f}" r="{2.6*s:.1f}" fill="#fff"/>')


def closed_eye(x, y, up=False):
    d = f'M{x-14},{y} Q{x},{y-14} {x+14},{y}' if up else f'M{x-14},{y-4} Q{x},{y+10} {x+14},{y-4}'
    return f'<path d="{d}" fill="none" stroke="{OL}" stroke-width="6" stroke-linecap="round"/>'


def blush(x, y):
    return E(x, y, 19, 10, BL, None, op=0.6)


def muzzle(cx, cy, s=1.0):
    """콩 모양 크림 주둥이 (위 가운데가 살짝 오목)"""
    rx, ry = 44 * s, 29 * s
    return (f'<path d="M{cx},{cy-ry+5*s} C{cx+12*s},{cy-ry-2*s} {cx+rx},{cy-ry} {cx+rx},{cy} '
            f'C{cx+rx},{cy+ry} {cx+12*s},{cy+ry} {cx},{cy+ry} C{cx-12*s},{cy+ry} {cx-rx},{cy+ry} {cx-rx},{cy} '
            f'C{cx-rx},{cy-ry} {cx-12*s},{cy-ry-2*s} {cx},{cy-ry+5*s} Z" fill="{CR}"/>')


def nose(x, y, s=1.0):
    return (E(x, y, 14 * s, 9.5 * s, EYE, None) +
            f'<ellipse cx="{x-4*s:.1f}" cy="{y-3.5*s:.1f}" rx="{4.5*s:.1f}" ry="{2.4*s:.1f}" fill="#fff" opacity=".85"/>')


def mouth(x, y, kind='w'):
    st = f'fill="none" stroke="{OL}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"'
    if kind == 'w':
        return f'<path d="M{x},{y-8} L{x},{y} M{x-11},{y-1} Q{x-5.5},{y+7} {x},{y} Q{x+5.5},{y+7} {x+11},{y-1}" {st}/>'
    if kind == 'open':
        return (f'<path d="M{x},{y-8} L{x},{y-2}" {st}/>'
                f'<path d="M{x-14},{y-2} Q{x},{y-4} {x+14},{y-2} Q{x+12},{y+20} {x},{y+20} Q{x-12},{y+20} {x-14},{y-2} Z" fill="#8a3f3f" stroke="{OL}" stroke-width="4.5" stroke-linejoin="round"/>'
                f'<path d="M{x-8},{y+15} Q{x},{y+6} {x+8},{y+15} Q{x},{y+20} {x-8},{y+15} Z" fill="{PINK}"/>')
    if kind == 'o':
        return (f'<path d="M{x},{y-8} L{x},{y-2}" {st}/>' + E(x, y + 7, 6, 7, '#8a3f3f', OL, 4))
    if kind == 'small':
        return (f'<path d="M{x},{y-8} L{x},{y-3}" {st}/>'
                f'<path d="M{x-9},{y-3} Q{x},{y-5} {x+9},{y-3} Q{x+8},{y+9} {x},{y+9} Q{x-8},{y+9} {x-9},{y-3} Z" fill="#8a3f3f" stroke="{OL}" stroke-width="4.5" stroke-linejoin="round"/>')
    if kind == 'yawn':
        return (E(x, y + 10, 17, 22, '#8a3f3f', OL, 4.5) +
                f'<path d="M{x-10},{y+25} Q{x},{y+14} {x+10},{y+25} Q{x},{y+31} {x-10},{y+25} Z" fill="{PINK}"/>')
    if kind == 'pout':
        return f'<path d="M{x-7},{y+4} Q{x-3},{y-3} {x},{y+2} Q{x+3},{y-3} {x+7},{y+4}" {st}/>'
    return ''


def tuft(x, y):
    """정수리 꼬불 털 한 가닥 (개성)"""
    return (f'<path d="M{x-8},{y+6} C{x-14},{y-22} {x+10},{y-36} {x+22},{y-20} C{x+28},{y-9} {x+14},{y-2} {x+8},{y-12}" '
            f'fill="none" stroke="{OL}" stroke-width="6.5" stroke-linecap="round"/>')


def ear(x, y, r=35, inner=True, fill=BR):
    s = E(x, y, r, r, fill)
    if inner:
        s += E(x + (256 - x) * 0.06, y + 4, r * 0.55, r * 0.55, CR, None)
    return s


def shadow(cx=256, rx=112):
    return E(cx, 470, rx, 12, '#000', None, op=0.08)


HAND = ('<filter id="hand" filterUnits="userSpaceOnUse" x="-20" y="-20" width="552" height="552">'
        '<feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="11"/>'
        '<feDisplacementMap in="SourceGraphic" scale="2" xChannelSelector="R" yChannelSelector="G"/></filter>')


def svg(body, extra_under=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
            f'<defs>{HAND}</defs>{extra_under}'
            f'<g filter="url(#hand)" stroke-linecap="round" stroke-linejoin="round">{body}</g></svg>')


# ---------- 정면 얼굴 공통 ----------
def face(cx, cy, eyes='open', mouth_kind='w', dx=0):
    """cx, cy = 머리 중심. 눈은 얼굴 아래쪽, 간격 넓게"""
    ey = cy + 24
    s = ''
    if eyes == 'open':
        s += eye(cx - 58 + dx, ey) + eye(cx + 58 + dx, ey)
    elif eyes == 'big':
        s += eye(cx - 58 + dx, ey, 1.12) + eye(cx + 58 + dx, ey, 1.12)
    elif eyes == 'happy':
        s += closed_eye(cx - 58 + dx, ey + 6, up=True) + closed_eye(cx + 58 + dx, ey + 6, up=True)
    elif eyes == 'tight':
        st = f'fill="none" stroke="{OL}" stroke-width="6" stroke-linecap="round"'
        for x, k in ((cx - 58 + dx, 1), (cx + 58 + dx, -1)):
            s += f'<path d="M{x-14},{ey-2} Q{x},{ey+8} {x+14},{ey-2}" {st}/><path d="M{x+16*k},{ey-8} l{-5*k},{-6}" {st}/>'
    elif eyes == 'closed':
        s += closed_eye(cx - 58 + dx, ey + 4) + closed_eye(cx + 58 + dx, ey + 4)
    elif eyes == 'squeeze':
        st = f'fill="none" stroke="{OL}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"'
        x1, x2 = cx - 58 + dx, cx + 58 + dx
        s += f'<path d="M{x1-12},{ey-11} L{x1+10},{ey} L{x1-12},{ey+11}" {st}/><path d="M{x2+12},{ey-11} L{x2-10},{ey} L{x2+12},{ey+11}" {st}/>'
    elif eyes == 'lid':
        for x in (cx - 58 + dx, cx + 58 + dx):
            s += (E(x, ey + 3, 14, 15, EYE, None) + f'<circle cx="{x+4}" cy="{ey+6}" r="3.6" fill="#fff"/>'
                  + f'<rect x="{x-20}" y="{ey-20}" width="40" height="19" fill="{BR}"/>'
                  + f'<path d="M{x-17},{ey-1} L{x+17},{ey-3}" stroke="{OL}" stroke-width="6" stroke-linecap="round"/>')
    s += blush(cx - 92 + dx, ey + 30) + blush(cx + 92 + dx, ey + 30)
    if mouth_kind == 'yawn':
        return s + muzzle(cx + dx, ey + 32, 1.12) + nose(cx + dx, ey + 12) + mouth(cx + dx, ey + 26, 'yawn')
    s += muzzle(cx + dx, ey + 26)
    s += nose(cx + dx, ey + 13)
    s += mouth(cx + dx, ey + 32, mouth_kind)
    return s


def head_front(cx, cy, puff=0):
    return blob(cx, cy, 126 + puff, 100, 94 + puff * 0.6, kT=0.57, kB=0.66 + puff * 0.004)


def feet_front(y=451, gap=40, cx=256):
    return E(cx - gap, y, 31, 17) + E(cx + gap, y, 31, 17)


# ---------- 포즈 ----------
def idle():
    cx, hy = 256, 236
    s = shadow()
    s += feet_front()
    s += ear(160, 160) + ear(352, 160)
    s += capsule(196, 360, -52, 30, 19)[0] + capsule(316, 360, 52, 30, 19)[0]
    s += union([P(blob(cx, 386, 80, 86, 70)), P(head_front(cx, hy))])
    s += E(cx, 404, 50, 40, CR, None)
    s += tuft(cx - 4, hy - 100)
    s += face(cx, hy)
    return svg(s)


def sit():
    cx, hy = 256, 258
    s = shadow(rx=130)
    s += ear(160, 182) + ear(352, 182)
    s += capsule(184, 386, -58, 30, 19)[0] + capsule(328, 386, 58, 30, 19)[0]
    s += union([P(blob(cx, 408, 98, 80, 56)), P(head_front(cx, hy))])
    s += E(cx, 418, 54, 36, CR, None)
    # 앞으로 뻗은 두 발, 발바닥(큰 패드 + 작은 점 셋)
    for x, r in ((190, -10), (322, 10)):
        s += E(x, 440, 34, 27, BR, rot=r)
        s += E(x, 447, 17, 12, CR, None, rot=r)
        for k in (-13, 0, 13):
            s += f'<circle cx="{x+k + r*0.3:.1f}" cy="{429 + abs(k)*0.35:.1f}" r="4.6" fill="{CR}"/>'
    s += tuft(cx - 4, hy - 100)
    s += face(cx, hy)
    return svg(s)


def sleep():
    s = shadow(rx=170)
    # 엎드린 몸덩이 + 작은 꼬리
    s += E(392, 418, 16, 16)
    s += P(blob(262, 410, 160, 84, 56, kB=0.72))
    hx, hy = 236, 338
    s += ear(140, 266, 33) + ear(326, 254, 33)
    s += P(head_front(hx, hy), extra=f' transform="rotate(-6 {hx} {hy})"')
    s += f'<g transform="rotate(-6 {hx} {hy})">' + tuft(hx - 4, hy - 100) + face(hx, hy, 'closed', 'w') + '</g>'
    s += E(186, 446, 28, 18) + E(292, 446, 28, 18)
    z = f'font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="bold" fill="{OL}"'
    s += f'<text x="372" y="236" font-size="40" {z}>z</text><text x="408" y="196" font-size="30" {z}>z</text>'
    return svg(s)


def happy():
    cx, hy, up = 256, 214, 22
    s = shadow(rx=92)
    s += E(cx - 44, 451 - up, 31, 17, rot=-14) + E(cx + 44, 451 - up, 31, 17, rot=14)
    s += ear(160, 160 - up) + ear(352, 160 - up)
    s += capsule(184, 350 - up, 150, 34, 19)[0] + capsule(328, 350 - up, -150, 34, 19)[0]
    s += union([P(blob(cx, 386 - up, 80, 86, 70)), P(head_front(cx, hy))])
    s += E(cx, 404 - up, 50, 40, CR, None)
    s += tuft(cx - 4, hy - 100)
    s += face(cx, hy, 'happy', 'open')
    # 반짝이
    def star(x, y, r):
        return (f'<path d="M{x},{y-r} Q{x+r*0.18},{y-r*0.18} {x+r},{y} Q{x+r*0.18},{y+r*0.18} {x},{y+r} '
                f'Q{x-r*0.18},{y+r*0.18} {x-r},{y} Q{x-r*0.18},{y-r*0.18} {x},{y-r} Z" fill="#ffd66b" stroke="{OL}" stroke-width="4"/>')
    s += star(78, 150, 20) + star(436, 132, 16) + star(452, 230, 11)
    return svg(s)


def hungry():
    cx, hy = 256, 236
    s = shadow()
    s += feet_front()
    s += ear(160, 166) + ear(352, 166)
    s += union([P(blob(cx, 386, 80, 86, 70)), P(head_front(cx, hy))])
    s += E(cx, 404, 50, 40, CR, None)
    # 배를 감싼 손
    s += capsule(190, 362, 52, 34, 18)[0] + capsule(322, 362, -52, 34, 18)[0]
    s += tuft(cx - 4, hy - 100)
    s += face(cx, hy, 'big', 'o')
    # 걱정 눈썹
    st = f'fill="none" stroke="{OL}" stroke-width="5.5" stroke-linecap="round"'
    s += f'<path d="M{cx-74},{hy-14} Q{cx-60},{hy-24} {cx-44},{hy-26}" {st}/><path d="M{cx+74},{hy-14} Q{cx+60},{hy-24} {cx+44},{hy-26}" {st}/>'
    # 침 한 방울
    s += f'<path d="M{cx+40},{hy+70} Q{cx+32},{hy+86} {cx+40},{hy+94} Q{cx+48},{hy+86} {cx+40},{hy+70} Z" fill="#bfe6f5" stroke="{OL}" stroke-width="3.5"/>'
    # 꼬르륵 선
    s += f'<path d="M{cx+92},{396} q8,-8 16,0 t16,0 M{cx+96},{420} q8,-8 16,0 t16,0" {st}/>'
    return svg(s)


def grab():
    cx, hy, up = 256, 196, 40
    s = shadow(rx=70)
    # 늘어진 다리 버둥
    s += capsule(cx - 34, 430 - up, -14, 30, 20)[0] + capsule(cx + 34, 430 - up, 22, 26, 20)[0]
    s += ear(160, 120) + ear(352, 120)
    s += capsule(184, 336 - up, 128, 40, 18)[0] + capsule(328, 336 - up, -112, 40, 18)[0]
    s += union([P(blob(cx, 384 - up, 78, 88, 66)), P(head_front(cx, hy))])
    s += E(cx, 400 - up, 48, 38, CR, None)
    s += tuft(cx - 4, hy - 100)
    s += face(cx, hy, 'squeeze', 'open')
    st = f'fill="none" stroke="{OL}" stroke-width="5" stroke-linecap="round"'
    s += f'<path d="M98,300 l-22,-6 M100,330 l-24,4 M414,300 l22,-6 M412,330 l24,4" {st}/>'
    s += f'<path d="M392,140 Q384,156 392,164 Q400,156 392,140 Z" fill="#bfe6f5" stroke="{OL}" stroke-width="3.5"/>'
    return svg(s)


def sulky():
    cx, hy = 256, 236
    s = shadow()
    s += feet_front()
    s += ear(160, 160) + ear(352, 160)
    s += union([P(blob(cx, 386, 80, 86, 70)), P(head_front(cx, hy, puff=4)), E(cx - 98, hy + 50, 46, 40), E(cx + 92, hy + 50, 46, 40)])
    s += E(cx, 404, 50, 40, CR, None)
    # 팔짱
    s += capsule(196, 372, 98, 54, 18)[0] + capsule(316, 386, -96, 54, 18)[0]
    s += tuft(cx - 4, hy - 100)
    f = face(cx, hy, 'lid', 'pout', dx=-8)
    s += f
    # 부푼 볼 진하게
    s += blush(cx - 100, hy + 54) + blush(cx + 84, hy + 54)
    # 흥 김
    s += (f'<path d="M398,168 q10,-14 24,-6 q14,-10 22,6 q12,4 2,16 q-8,10 -22,4 q-14,8 -24,-4 q-12,-6 -2,-16 Z" '
          f'fill="#fff" stroke="{OL}" stroke-width="4.5"/>')
    return svg(s)


# ---------- 옆 걷기 (오른쪽) ----------
def stand(eyes='open', mk='w', right_arm=None, extra=''):
    cx, hy = 256, 236
    s = shadow()
    s += feet_front()
    s += ear(160, 160) + ear(352, 160)
    s += capsule(196, 360, -52, 30, 19)[0]
    if right_arm is None:
        s += capsule(316, 360, 52, 30, 19)[0]
    s += union([P(blob(cx, 386, 80, 86, 70)), P(head_front(cx, hy))])
    s += E(cx, 404, 50, 40, CR, None)
    if right_arm is not None:
        s += right_arm
    s += tuft(cx - 4, hy - 100)
    s += face(cx, hy, eyes, mk)
    return svg(s + extra)


def wave():
    st = f'fill="none" stroke="{OL}" stroke-width="5" stroke-linecap="round"'
    arm = capsule(326, 364, 128, 58, 19)[0]
    deco = f'<path d="M412,264 q14,16 4,36 M432,250 q20,24 6,54" {st}/>'
    return stand('open', 'open', arm, deco)


def yawn():
    tear = (f'<path d="M318,258 Q312,270 318,276 Q324,270 318,258 Z" fill="#bfe6f5" stroke="{OL}" stroke-width="3.5"/>'
            f'<path d="M194,258 Q188,270 194,276 Q200,270 194,258 Z" fill="#bfe6f5" stroke="{OL}" stroke-width="3.5"/>')
    return stand('tight', 'yawn', None, tear)


def talk(k):
    return stand('open', 'small' if k == 0 else 'open')


def doze():
    cx, hy, rot = 256, 262, 12
    s = shadow(rx=130)
    s += capsule(184, 386, -58, 30, 19)[0] + capsule(328, 386, 58, 30, 19)[0]
    s += P(blob(cx, 408, 98, 80, 56))
    s += E(cx, 418, 54, 36, CR, None)
    for x, r in ((190, -10), (322, 10)):
        s += E(x, 440, 34, 27, BR, rot=r)
        s += E(x, 447, 17, 12, CR, None, rot=r)
        for k in (-13, 0, 13):
            s += f'<circle cx="{x+k + r*0.3:.1f}" cy="{429 + abs(k)*0.35:.1f}" r="4.6" fill="{CR}"/>'
    g = (ear(160, 182) + ear(352, 182) + P(head_front(cx, hy)) + tuft(cx - 4, hy - 100)
         + face(cx, hy, 'closed', 'w'))
    s += f'<g transform="rotate({rot} {cx} {hy+60}) translate(0 10)">{g}</g>'
    # 코 풍선
    s += f'<circle cx="294" cy="346" r="15" fill="#dff3fb" stroke="{OL}" stroke-width="4" opacity=".95"/><circle cx="289" cy="341" r="4" fill="#fff"/>'
    z = f'font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="bold" fill="{OL}"'
    s += f'<text x="396" y="168" font-size="34" {z}>z</text>'
    return svg(s)


def back():
    cx, hy = 256, 236
    s = shadow()
    s += E(cx - 40, 451, 31, 17) + E(cx + 40, 451, 31, 17)
    s += capsule(196, 360, -52, 30, 19)[0] + capsule(316, 360, 52, 30, 19)[0]
    s += union([P(blob(cx, 386, 80, 86, 70)), P(head_front(cx, hy)), E(160, 160, 35, 35), E(352, 160, 35, 35)])
    # 귀 뒷면 경계만 살짝
    st = f'fill="none" stroke="{OL}" stroke-width="5" stroke-linecap="round"'
    s += f'<path d="M140,186 Q160,196 184,184 M372,186 Q352,196 328,184" {st}/>'
    # 크림 끝 꼬리
    s += E(cx, 416, 24, 22) + E(cx, 410, 13, 11, CR, None)
    s += tuft(cx + 4, hy - 100)
    return svg(s)


# ---------- 걷기: 정면 몸 그대로 뒤뚱 걸음. 굵고 둥근 짧은 다리가 몸 아래 양옆에서 번갈아 들린다 ----------
WALK_TAIL = lambda ph, dy: ''   # 고양이가 꼬리를 끼워 넣는 자리


def walk(i, n=6):
    ph = 2 * math.pi * i / n
    sn = math.sin(ph)
    lift = {-1: 20 * max(0, sn), 1: 20 * max(0, -sn)}     # 왼발, 오른발 번갈아 들기
    bob = -12 * abs(math.cos(ph))                          # 두 발이 다 땅에 있을 때 가장 높다
    rise = 26                                              # 다리가 보이게 몸을 올린다
    tilt = 5 * sn                                          # 딛는 발 쪽으로 기울기
    dy = -rise + bob
    cx, hy = 256, 236 + dy
    s = shadow(rx=104)
    g = WALK_TAIL(ph, dy)
    g += ear(160, 160 + dy) + ear(352, 160 + dy)
    # 팔: 다리와 반대로 흔든다. 앞으로 가는 팔은 더 들린다. 몸 바깥으로 늘 보이게
    for sx in (-1, 1):
        fwd = max(0, sn) if sx == 1 else max(0, -sn)      # 반대쪽 다리가 들릴 때 이 팔이 앞으로
        ang = sx * (50 + 50 * fwd)
        g += capsule(cx + sx * 62, 356 + dy, ang, 38, 19)[0]
    body_bottom = 456 + dy
    legs, feet = [], ''
    for sx in (-1, 1):
        x = cx + sx * 34
        fy = 451 - lift[sx]
        fx = x + (8 if lift[sx] > 1 else 0)
        top = body_bottom - 18
        legs.append(E((x + fx) / 2, (top + fy) / 2, 23, (fy - top) / 2 + 4))
        feet += E(fx, fy, 30, 17)
    g += union([P(blob(cx, 386 + dy, 80, 86, 70)), P(head_front(cx, hy))] + legs)
    g += feet
    g += E(cx, 404 + dy, 50, 40, CR, None)
    g += tuft(cx - 4, hy - 100)
    g += face(cx, hy, 'open', 'w', dx=6)
    s += f'<g transform="rotate({tilt:.2f} {cx} 451)">{g}</g>'
    return svg(s)


if __name__ == '__main__':
    poses = {'idle': lambda: stand(), 'sit': sit, 'sleep': sleep, 'happy': happy, 'hungry': hungry, 'grab': grab,
             'sulky': sulky, 'doze': doze, 'wave': wave, 'yawn': yawn, 'talk-0': lambda: talk(0),
             'talk-1': lambda: talk(1), 'back': back}
    out = sys.argv[1] if len(sys.argv) > 1 else OUT
    os.makedirs(out, exist_ok=True)
    for k, f in poses.items():
        open(os.path.join(out, f'{k}.svg'), 'w').write(titled(f(), f'bear {k}'))
    for i in range(6):
        open(os.path.join(out, f'walk-{i}.svg'), 'w').write(titled(walk(i), f'bear walk-{i}'))
    print('ok')
