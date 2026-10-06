# 짝꿍 (Jjakkung)

옆자리 짝꿍처럼 화면 위를 돌아다니는 펫이 할 일, 일정, 메모를 같이 챙기고, 내 컴퓨터에 설치된 AI(Claude, Codex)와 연결돼 "같이 보기"로 화면을 보며 대화하는 데스크톱 앱. 맥과 윈도우를 동시에 지원한다.

지금 되는 것: 화면 위 펫(드래그, 크기 조절, 위치 기억, 바쁨 모드, 말풍선, 걷기), 할 일과 코인과 밥(펫을 누르면 패널), 펫과 대화(claude, codex, cursor, gemini, 직접 추가), 설정 창(이름, 크기, 말풍선, AI 격리), 사진으로 펫 만들기, 같이 보기(화면 일부를 찍어 대화에 붙이기), AI 사용량 보기. MVP 기능은 맥에서 다 돌고 맥 설치 파일이 나온다. 윈도우는 확인 전이다([체크리스트](docs/tests/windows.md)). 앱 코드는 `src/`, `spike/` 는 0단계 실험 코드라 0단계가 끝나면 지운다. 진행 상황은 [docs/roadmap.md](docs/roadmap.md)에 있다.

## 개발

Node 22.18 이상이 필요하다 (테스트가 TypeScript 파일을 그대로 돌린다).

```bash
npm install
npm run dev     # 앱을 띄우고 화면 코드를 고치면 바로 반영
npm run check   # 타입 검사, 린트, 테스트
npm run build   # out/ 에 빌드
npm run dist:mac  # dist/ 에 맥 설치 파일(dmg). 윈도우는 GitHub Actions 의 release
```

| 폴더 | 내용 |
| --- | --- |
| `src/main/` | Electron 메인 프로세스 (창, OS 기능) |
| `src/preload/` | 화면에 열어 줄 기능만 모아 둔 다리 |
| `src/renderer/` | 화면. 펫 창은 가볍게 두려고 React 없이, 패널과 채팅 창은 React 로 (2단계부터) |
| `src/shared/` | 화면과 메인이 같이 쓰는 순수 로직과 테스트 |

## 문서

| 파일 | 내용 |
| --- | --- |
| [docs/plan.md](docs/plan.md) | 기획서 원본 |
| [docs/plan.html](docs/plan.html) | 기획서 html 판. 목차, 테마 전환, 기능 표 필터 포함 |
| [docs/tests/ai-cli.md](docs/tests/ai-cli.md) | claude, codex 연동 검증 시나리오와 실행 기록 |
| [docs/tests/windows.md](docs/tests/windows.md) | 윈도우 확인 체크리스트 (설치, 펫 창, 방해 금지, AI, 자원) |
| [docs/assets/](docs/assets/) | 시스템 구조도, 화면 설계 그림 (svg) |
| [docs/roadmap.md](docs/roadmap.md) | 진행표. 단계별 체크리스트, 다음에 이어서 할 일 |
| [spike/](spike/) | 0단계 실험 앱 (Electron 44.5.1) |
| [CHANGELOG.md](CHANGELOG.md) | 변경 이력 |

## 기획서 고치는 법

`docs/plan.md`만 고치고 html 은 스크립트로 다시 만든다. html 을 손으로 고치지 않는다.

```bash
python3 -m pip install markdown   # 처음 한 번
python3 scripts/build_plan_html.py
```

고친 내용은 `CHANGELOG.md`의 `[Unreleased]`에 적는다.
