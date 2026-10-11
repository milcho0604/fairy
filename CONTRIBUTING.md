# 기여하기 (Contributing)

짝꿍에 관심 가져 줘서 고마워요. 이 레포는 **코드와 문서 기여**를 받아요. English follows below.

> **펫은 레포로 받지 않아요.** 펫 갤러리는 공식 펫만 올려요. 직접 만든 펫은 설정 → 데이터 → **펫 내보내기**로 `.jjpet` 파일을 만들어 친구에게 바로 보내 주세요. 펫 그림, `.jjpet` 파일, 갤러리 추가 요청 PR 은 닫아요.

## 개발 준비

- Node 24 (`.nvmrc`, 최소 22.18. 시험이 TypeScript 파일을 그대로 돌려요). macOS, Windows, Linux 어디서나 개발할 수 있어요.

```bash
npm ci
npm run dev        # 앱을 띄우고 화면 코드를 고치면 바로 반영
npm run check      # 타입 검사 + biome + 시험 (PR 전에 꼭)
npx biome check --write src scripts   # 서식과 린트 고치기
npm run build      # out/ 에 빌드
```

- **설치 파일 만들기**(`npm run dist`, `dist:mac`, `dist:win`, `dist:linux`)는 진짜 `node_modules` 폴더가 있어야 해요. git worktree 에서 `node_modules` 를 심볼릭 링크로 두면 electron-builder 가 의존성을 못 찾아 망가진 앱을 만들어요. 링크를 지우고 복사하거나 그 폴더에서 `npm ci` 를 돌려요.
- 리눅스 설치판이 켜지는지는 `xvfb-run -a node scripts/dev/smoke-packaged.mjs dist/linux-unpacked/jjakkung` 로 봐요 (CI 도 같은 것을 돌려요).

## 시험 창 규칙 (CLAUDE.md)

시험으로 앱을 띄울 때는 [CLAUDE.md](CLAUDE.md) 규칙을 따라요. 사람이든 AI 에이전트든 같아요.

- 늘 `JJ_NO_FOCUS=1` 과 **빈 폴더** `JJ_USER_DATA=<빈 폴더>` 로 띄워요. 창이 보이지 않고 입력을 뺏지 않으며, 진짜 데이터를 건드리지 않아요.
- 화면은 CDP(`--remote-debugging-port`)로 찍고 입력도 CDP 나 `globalThis.__jj` 손잡이로 넣어요. 진짜 마우스와 키보드는 움직이지 않아요.
- 끝나면 그 폴더와 시험이 만든 Claude 세션 기록을 지워요. 자세한 도구는 [scripts/dev/README.md](scripts/dev/README.md).

```bash
JJ_NO_FOCUS=1 JJ_USER_DATA=$(mktemp -d) npx electron --inspect=9851 . --remote-debugging-port=9852
```

## 지켜 줄 것

- **다른 회사 캐릭터, 남의 그림은 넣지 않아요.** 펫과 그림은 직접 그렸거나 라이선스가 분명한 것만(코드로 그린 기본 펫, 레포에 있는 그림). 팬아트, 유명 캐릭터 닮은 그림도 안 돼요.
- **개인정보**: 시험과 문서의 예시는 지어낸 것만 써요 (진짜 이름, 이메일, 전화번호, 토큰, 홈 경로 금지. 경로는 `/Users/kim` 처럼 가짜로).
- **보안 문제**는 이슈로 올리지 말고 [SECURITY.md](SECURITY.md) 방법으로 알려 주세요.
- 화면 말은 한국어와 영어 둘 다 (`src/shared/i18n/`). 한국어는 친근한 반말이 기본이에요.
- 사용자에게 보이는 변화는 PR 설명에 `CHANGELOG.md` 에 들어갈 한 줄을 적어 주세요(머지하는 사람이 넣어요).

## 커밋

작고 한 가지 일만 하는 커밋을 좋아해요. 레포의 말투를 따라요.

```
fix: 화면을 실은 질문은 AI CLI 가 세션 기록에 남기지 않게 한다
왜 그랬는지와 무엇을 바꿨는지 한두 줄 (첫 줄 바로 아래)
```

- 머리말: `feat`, `fix`, `docs`, `test`, `build`, `refactor`, `chore`
- 제목은 한국어 평서문("…한다"), 끝에 마침표 없이. 영어로 써도 괜찮아요.
- 시험을 같이 넣거나 고쳐 주세요 (`src/**/*.test.ts`, `node --test`).

## PR

1. `main` 에서 가지를 따서 고치고 `npm run check` 와 `npm run build` 가 통과하는지 봐요.
2. 화면이 바뀌면 전후 화면(지어낸 데이터로)을 붙여 주세요.
3. PR 템플릿의 체크리스트를 채워 주세요. CI(`check.yml`)가 리눅스, 윈도우, 맥에서 돌아요.

---

## English

Thanks for your interest! This repository accepts **code and documentation contributions**.

> **Pets are not accepted into the repository.** The pet gallery lists official pets only. To share a pet you made, use Settings → Data → **Export pet** and send the `.jjpet` file to your friend directly. PRs that add pet art, `.jjpet` files or gallery entries will be closed.

### Setup

- Node 24 (`.nvmrc`; 22.18+ works — tests run TypeScript directly).
- `npm ci`, `npm run dev`, `npm run check` (typecheck + biome + tests, required before a PR), `npx biome check --write src scripts`, `npm run build`.
- Packaging (`npm run dist*`) needs a **real** `node_modules` directory. A symlinked `node_modules` (common in git worktrees) makes electron-builder produce a broken app.
- Smoke-test a Linux build with `xvfb-run -a node scripts/dev/smoke-packaged.mjs dist/linux-unpacked/jjakkung`.

### Test window rules (CLAUDE.md)

When launching the app for testing, follow [CLAUDE.md](CLAUDE.md): always `JJ_NO_FOCUS=1` with an **empty** `JJ_USER_DATA` folder, drive and screenshot it over CDP (never the real mouse or keyboard), and delete the folder and any Claude session history the test created afterwards.

### Ground rules

- **No third-party characters or borrowed art.** Only art you made or that is clearly licensed for this project.
- Use made-up sample data only (no real names, emails, phone numbers, tokens or home paths).
- Report security issues privately as described in [SECURITY.md](SECURITY.md), not in public issues.
- UI text must exist in both Korean and English (`src/shared/i18n/`).
- Mention a one-line `CHANGELOG.md` entry in your PR for user-visible changes.

### Commits

Small, single-purpose commits: `feat|fix|docs|test|build|refactor|chore: summary`, with a short "why" in the body. Korean or English is fine. Add or update tests (`src/**/*.test.ts`).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
