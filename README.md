# 짝꿍 (Jjakkung)

옆자리 짝꿍처럼 화면 위를 돌아다니는 펫이 할 일, 일정, 메모를 같이 챙기고, 내 컴퓨터에 설치된 AI(Claude, Codex)와 연결돼 "같이 보기"로 화면을 보며 대화하는 데스크톱 앱. 맥과 윈도우를 동시에 지원한다.

지금은 기획 단계다. 앱 코드는 아직 없다.

## 문서

| 파일 | 내용 |
| --- | --- |
| [docs/plan.md](docs/plan.md) | 기획서 원본 |
| [docs/plan.html](docs/plan.html) | 기획서 html 판. 목차, 테마 전환, 기능 표 필터 포함 |
| [docs/tests/ai-cli.md](docs/tests/ai-cli.md) | claude, codex 연동 검증 시나리오와 실행 기록 |
| [docs/assets/](docs/assets/) | 시스템 구조도, 화면 설계 그림 (svg) |
| [CHANGELOG.md](CHANGELOG.md) | 변경 이력 |

## 기획서 고치는 법

`docs/plan.md`만 고치고 html 은 스크립트로 다시 만든다. html 을 손으로 고치지 않는다.

```bash
python3 -m pip install markdown   # 처음 한 번
python3 scripts/build_plan_html.py
```

고친 내용은 `CHANGELOG.md`의 `[Unreleased]`에 적는다.
