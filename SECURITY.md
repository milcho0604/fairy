# 보안 문제 알리기 (Security policy)

## 받는 판 (Supported versions)

가장 최근 릴리스만 고쳐요. 오래된 판에서 찾은 문제도 최신 판에서 다시 되는지 알려 주면 좋아요.
Only the latest release receives fixes.

## 알리는 법 (Reporting a vulnerability)

**공개 이슈, PR, 토론에 올리지 말아 주세요.** 고치기 전에 모두에게 보이면 사용자가 위험해져요.

1. 이 레포의 **Security** 탭 → **Report a vulnerability**(GitHub 비공개 보안 알림)로 보내 주세요.
   `https://github.com/milcho0604/fairy/security/advisories/new`
2. 적어 줄 것: 어떤 판(설정 → 정보의 판 번호)과 운영체제인지, 다시 해 보는 순서, 무엇이 위험한지(어떤 데이터가 새거나 무엇을 할 수 있게 되는지). 가능하면 진단 기록(설정 → 정보 → 내 기록, 가려진 글)도.
3. 진짜 토큰, 개인 데이터는 보내지 말고 가짜 값으로 보여 주세요.

Please **do not** open a public issue. Use GitHub private vulnerability reporting (**Security → Report a vulnerability**) with the version, OS, steps to reproduce and the impact. Do not include real tokens or personal data.

## 그다음 (What happens next)

- 혼자 만드는 앱이라 정해진 기한은 없지만, 보통 일주일 안에 받았다고 답해요.
- 고친 판을 올린 뒤 알림(GitHub Security Advisory)을 공개하고, 원하면 알려 준 분을 적어요.
- 데이터를 망가뜨리거나 크게 위험한 문제면 그 판 아래를 쓰지 못하게 하는 "꼭 필요한 업데이트"(`release/min-version`, [docs/release.md](docs/release.md))를 써요.

## 범위 (Scope)

페어리 앱(이 레포의 코드와 설치 파일)이에요. 페어리가 부르는 AI 프로그램(Claude Code, Codex, Cursor, Gemini CLI), Hugging Face 그림 서버, 구글 캘린더 같은 바깥 서비스의 문제는 그쪽에 알려 주세요.
In scope: this repository's code and release builds. Issues in the AI CLIs, Hugging Face, or Google services belong to those projects.
