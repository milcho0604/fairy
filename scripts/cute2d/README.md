# 손그림 2D 기본 페어리

`for k in kong cat chick dog bunny hamster penguin bear; do python3 scripts/cute2d/$k/gen.py; done` 로 `src/renderer/src/art/cute2d/<종>/*.svg` (512x512, 바닥선 y=470) 를 다시 만든다. 모든 종은 곰돌이 골격(`bear/gen.py`)에 귀, 코입, 꼬리, 색만 바꿔 끼운다. 자세 고르기는 `src/renderer/src/cute2d.ts`.

- 서기 그림마다 눈만 바꾼 장 셋(`blink`, `look-l`, `look-r`)도 같이 나온다 (`bear/gen.py` `idle_eyes`). 앱이 깜빡임과 커서 바라보기에 쓴다 (`cute2d.ts` `cuteEyes`).
- 걷기는 머리를 서기와 같은 높이에 두고 몸 아래를 줄여 다리를 보인다 (`bear/gen.py` `WALK_LEG`, `WALK_BOB`). 바꾸면 `cute2d.ts` 의 `WALK_BOB` 과 걷기 꼭대기 값도 같이.

## 메뉴 막대 실루엣

2D 로 보는 기본 펫은 메뉴 막대에서도 이 그림의 실루엣이 달린다 (`src/shared/menu-runner.ts` `RUNNER_ART_SIZES`). 그림을 바꿨으면 다시 굽는다:

```bash
python3 scripts/cute2d/runner.py <임시 폴더>
PLAYWRIGHT=<playwright index.mjs> CHROME=<헤드리스 크롬> node scripts/cute2d/runner.mjs <임시 폴더> [미리보기.png]
```

결과는 `resources/runner/<종>.alpha.gz` (크기 셋 x 24장의 불투명도). playwright 는 레포 의존성이 아니라 따로 가리킨다.
