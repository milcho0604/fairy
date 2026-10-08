# 짝꿍 (Jjakkung)

옆자리 짝꿍처럼 화면 위를 돌아다니는 펫이 할 일, 일정, 메모를 같이 챙기고, 내 컴퓨터에 설치된 AI(Claude, Codex)와 연결돼 "같이 보기"로 화면을 보며 대화하는 데스크톱 앱. 맥과 윈도우를 동시에 지원한다.

지금 되는 것 (2026-10-07):

- 화면 위 펫: 드래그, 던지기, 크기 조절, 위치 기억, 걷기, 창 위에 앉기, 바쁨 모드, 말풍선, 마우스 쳐다보기, 방해 금지(숨기기, 발표), 2D 와 입체(three.js) 캐릭터 5마리, 사진 펫(2.5D 또는 AI 설계도), 친구 펫 3마리, 화면이 죽으면 저절로 다시 불러오기
- 할 일, 일정, 메모: 펫을 누르면 패널. 빠른 입력(한국어와 영어 날짜, 시각, 반복), 반복 할 일, 일정 알림과 오늘 마감 알림, 놓친 알림, 집중 타이머, 하루 회고, 구글 캘린더(.ics) 가져오기
- 펫의 하루: 코인과 밥, 상점과 집, 기분과 삐짐, 친밀도 몸짓, 업적과 연속 기록, 짝꿍 일기, 숨바꼭질, 효과음(기본 끔)
- AI: 채팅(Claude, Codex, Cursor, Gemini, 직접 추가, 무료 AI), 모델 고르기, 같이 보기(화면 일부를 찍어 물어보기), 사용량 보기, 내 할 일 같이 보내기, 짝꿍 규칙, 내 MCP 도구, 다른 AI 에서 짝꿍 쓰기(MCP 서버)
- 설정과 관리: 한국어와 영어, 단축키 바꾸기, 백업과 옮기기, 펫 공유(.jjpet), 저장 공간, 부스트 모드, 베타 기록, 업데이트 알림(꼭 필요한 업데이트), 메뉴 막대(할 일 보기, 펫 새로고침), 진단 기록(`logs/main.log`)

MVP 와 v1, v2 대부분이 맥에서 돌고 맥 설치 파일이 나온다. 윈도우는 확인 전이다([체크리스트](docs/tests/windows.md)). 앱 코드는 `src/`, `spike/` 는 0단계 실험 코드라 0단계가 끝나면 지운다. 진행 상황은 [docs/roadmap.md](docs/roadmap.md)에 있다.

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
| [docs/install.md](docs/install.md) | 베타 사용자용 설치 안내 (맥, 윈도우, AI 연결, 지우기) |
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
