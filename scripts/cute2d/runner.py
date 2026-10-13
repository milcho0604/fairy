# 메뉴 막대에서 달리는 작은 펫 (src/shared/menu-runner.ts) 의 손그림 판 장면 SVG 를 만든다.
# 장 순서는 RUNNER_STATES 그대로: 쉬기 4장(앉기, 앉아 깜빡, 졸기 둘), 걷기 8장(정면 뒤뚱 걷기를 8등분),
# 달리기 6장(뒤뚱 걷기에 폴짝), 질주 6장(달리기에 땀방울). 바닥 그림자는 뺀다 (실루엣에 옅게 남는다).
# 사용: python3 scripts/cute2d/runner.py <출력 폴더>  (그다음 runner.mjs 가 실루엣으로 굽는다)
import importlib.util, json, math, os, re, sys

D = os.path.dirname(os.path.abspath(__file__))
KINDS = ['kong', 'cat', 'chick', 'dog', 'bunny', 'hamster', 'penguin', 'bear']
OL = '#4a3a36'
EYE = '#3a2b27'
HOP = 30            # 달리기 폴짝 높이 (그림 좌표)


def load(kind):
    spec = importlib.util.spec_from_file_location(f'cute_{kind}', os.path.join(D, kind, 'gen.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def no_shadow(svg):
    return re.sub(r'<ellipse [^>]*fill="#000"[^>]*/>', '', svg)


def lift(svg, dy, extra=''):
    """그림 전체를 dy 만큼 올리고 extra 를 얹는다"""
    head, rest = svg.split('<g filter=', 1)
    return f'{head}<g transform="translate(0 {-dy:.1f})"><g filter={rest[:-6]}{extra}</g></svg>'


def sweat():
    drop = lambda x, y, r: (f'<path d="M{x},{y - r * 1.9} Q{x + r * 1.1},{y - r * 0.2} {x},{y + r} '
                            f'Q{x - r * 1.1},{y - r * 0.2} {x},{y - r * 1.9} Z" fill="#bfe6f5" stroke="{OL}" stroke-width="5"/>')
    return drop(86, 176, 20) + drop(432, 150, 17)


def frames(kind):
    mod = load(kind)
    B = getattr(mod, 'B', mod)
    poses = getattr(mod, 'POSES', None) or {'sit': mod.sit, 'doze': mod.doze}
    walk = getattr(mod, 'walk', None) or B.walk
    out = [poses['sit'](), B.idle_eyes(poses['sit'], 'blink'), poses['doze'](), poses['doze']()]
    out += [walk(f * 6 / 8) for f in range(8)]
    for sw in (False, True):
        for i in range(6):
            hop = HOP * abs(math.sin(math.pi * i / 3))
            out.append(lift(walk(i), hop, sweat() if sw else ''))
    return [no_shadow(s) for s in out]


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    made = {}
    for k in KINDS:
        fs = frames(k)
        made[k] = len(fs)
        for i, s in enumerate(fs):
            open(os.path.join(out, f'{k}-{i}.svg'), 'w').write(s)
    json.dump({'kinds': KINDS, 'frames': made, 'eye': EYE}, open(os.path.join(out, 'runner.json'), 'w'))
    print('ok', made)
