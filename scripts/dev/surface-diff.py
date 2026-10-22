#!/usr/bin/env python3
"""surface-base.mjs 가 찍은 두 폴더(고치기 전, 고친 뒤)를 견준다. 그림은 픽셀, metrics-*.json 은 숫자.

  python3 scripts/dev/surface-diff.py <전 폴더> <후 폴더> [--save <차이 그림 폴더>]

그림마다 "다른 픽셀 수, 차이가 있는 자리(상자)"를 한 줄로 적는다. 0 이면 같다.
시계, 배부름처럼 시간에 따라 흐르는 값은 같은 트리를 두 번 찍어 먼저 바탕 흔들림을 재 두고(전-전), 전-후와 견준다.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops


def diff_images(a: Path, b: Path):
    ia, ib = Image.open(a).convert("RGBA"), Image.open(b).convert("RGBA")
    if ia.size != ib.size:
        return None, f"크기가 다르다 {ia.size} / {ib.size}", None
    d = ImageChops.difference(ia, ib)
    box = d.getbbox()
    if box is None:
        return 0, "", None
    n = sum(1 for px in d.getdata() if px != (0, 0, 0, 0))
    return n, f"상자 {box}", d


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    save = None
    if "--save" in sys.argv:
        save = Path(sys.argv[sys.argv.index("--save") + 1])
        args = [x for x in args if x != str(save)]
        save.mkdir(parents=True, exist_ok=True)
    before, after = Path(args[0]), Path(args[1])
    total, same, bad = 0, 0, 0
    for pa in sorted(before.glob("*.png")):
        pb = after / pa.name
        total += 1
        if not pb.exists():
            print(f"없음  {pa.name}")
            bad += 1
            continue
        n, where, d = diff_images(pa, pb)
        if n == 0:
            same += 1
            print(f"같음  {pa.name}")
        else:
            bad += 1
            print(f"다름  {pa.name}: {n if n is not None else '?'} 픽셀 {where}")
            if save and d is not None:
                d.point(lambda v: 255 if v else 0).save(save / f"diff-{pa.name}")
    for ma in sorted(before.glob("metrics-*.json")):
        mb = after / ma.name
        if not mb.exists():
            print(f"없음  {ma.name}")
            continue
        ja, jb = json.loads(ma.read_text()), json.loads(mb.read_text())
        keys = sorted(set(ja) | set(jb))
        diffs = [(k, ja.get(k), jb.get(k)) for k in keys if ja.get(k) != jb.get(k)]
        if not diffs:
            print(f"같음  {ma.name} ({len(keys)}개 자리)")
        for k, x, y in diffs:
            bad += 1
            print(f"다름  {ma.name} {k}: {x} -> {y}")
    print(f"그림 {total}장 중 같음 {same}, 그 밖 차이 {bad}")
    sys.exit(1 if bad else 0)


main()
