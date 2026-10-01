# Changelog

이 프로젝트의 눈에 띄는 변경을 모두 이 파일에 적는다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르고,
버전은 [유의적 버전](https://semver.org/lang/ko/)을 따른다.
앱 코드가 나오기 전까지는 기획 문서 버전(`docs/plan.md` 머리말)을 함께 적는다.

## [Unreleased]

### Changed

- 앱 이름을 짝꿍 (Jjakkung)으로 정했다. 레포는 `jjakkung`, 기획서 0.1.1

### Added

- 기획서 초안 0.1.0 (`docs/plan.md`, `docs/plan.html`)
  - 개요, 하루 사용 흐름, 기능 리스트 50개(MVP 24개), 게임 규칙, 시스템 구조, 기술 스택, 설치와 배포, 개발 단계, 리스크와 정할 것
  - 기능마다 출처(요청, 제안)와 우선순위(MVP, v1, v2)를 표시
- 시스템 구조도 `docs/assets/architecture.svg` (밝은 테마, 어두운 테마 대응)
- md 에서 html 을 만드는 스크립트 `scripts/build_plan_html.py`
  - 구조도를 html 에 넣어 파일 하나로 열리게 하고, 기능 표에 우선순위 필터를 붙인다

### Decided

- 맥과 윈도우를 동시에 낸다. 어느 한쪽을 먼저 내지 않는다.
- 기술 스택 1순위는 Electron + TypeScript, 2순위는 Tauri v2 (근거는 기획서 "기술 스택")
- 설치 파일은 맥 dmg, 윈도우 exe. npm 배포는 하지 않는다.
