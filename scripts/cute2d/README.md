# 손그림 2D 냥이, 곰돌이

`python3 scripts/cute2d/bear/gen.py && python3 scripts/cute2d/cat/gen.py` 로 `src/renderer/src/art/cute2d/{bear,cat}/*.svg` (512x512, 바닥선 y=470) 를 다시 만든다. 냥이는 곰돌이 골격(`bear/gen.py`)에 귀, 코입, 꼬리, 색만 바꿔 끼운다. 자세 고르기는 `src/renderer/src/cute2d.ts`.
