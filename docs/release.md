# 릴리스 올리기

`v*` 태그를 올리면 `release.yml` 이 맥, 윈도우, 리눅스(`tar.xz`, `AppImage`) 설치 파일, 자동 업데이트용 파일(윈도우 `latest.yml` 과 `.exe.blockmap`, 맥 `latest-mac.yml` 과 `.zip`, `.zip.blockmap`)을 **공개 레포 `milcho0604/fairy-releases`** 의 GitHub Releases 초안으로 올린다(아래 "두 레포"). 초안을 확인한 뒤 발행한다. 릴리스 레포는 `src/shared/update-policy.ts` 의 `PUBLIC_REPO`(= `RELEASE_REPO`), `electron-builder.yml` 의 `publish`, `release.yml` 과 `sync-public.yml` 의 `PUBLIC_REPO` 네 곳이고 서로 같아야 한다(다르면 `npm test` 가 깨진다).

- 태그는 `package.json` 의 `version` 앞에 `v` 를 붙인 것과 똑같아야 한다(`0.2.0` 이면 `v0.2.0`). 다르면 빌드 전에 멈춘다. 버전을 안 올리고 태그만 달면 새 앱이 스스로를 옛 버전으로 보고 업데이트 안내가 끝나지 않기 때문이다.
- `CHANGELOG.md` 에 `## [0.2.0] - 2026-10-20` 처럼 날짜가 붙은 이 버전의 절과 항목이 있어야 한다. 그 절이 릴리스 본문에 들어간다(아래 "릴리스 사전 점검").
- 태그에 `-beta.1` 같은 꼬리가 있으면 사전 릴리스로 올린다. 앱은 사전 릴리스를 업데이트로 보지 않는다.
- 초안과 사전 릴리스는 GitHub 의 "최신 릴리스"(`/releases/latest`)에 잡히지 않는다. 발행할 때 "Set as the latest release" 를 끄면 앱이 그 릴리스를 못 본다.

## 두 레포 (소스와 공개)

레포가 둘이다. 소스 레포를 언제든 비공개로 바꿀 수 있도록, 설치된 앱과 사용자가 GitHub 에서 쓰는 것은 모두 공개 레포에 둔다.

| 레포 | 무엇 | 누가 읽나 |
| --- | --- | --- |
| `milcho0604/fairy` (소스, `SOURCE_REPO`) | 코드, 개발 문서, `public-repo/`(공개 레포의 틀), `gallery/`, `catalog/` 원본 | 개발자만 |
| `milcho0604/fairy-releases` (공개, `PUBLIC_REPO`) | 릴리스(설치 파일, `latest*.yml`, `SHA256SUMS.txt`), `README.md`, `SECURITY.md`, `LICENSE`, 이슈 양식, `gallery/`, `catalog/` | 앱(업데이트 확인, 자동 설치, 갤러리, 모델 목록, 문제 알리기)과 사용자(받기, 이슈, 보안 알림) |

- `sync-public.yml`: `main` 에 `public-repo/**`, `gallery/**`, `catalog/**` 가 바뀌면 `scripts/sync-public.mjs` 로 공개 레포 `main` 을 소스와 똑같이 맞추고, 바뀐 것이 있을 때만 `sync from source <sha>` 로 커밋해 푸시한다. 공개 레포에서 손으로 고친 파일은 다음 옮기기 때 덮인다(이슈와 릴리스는 건드리지 않는다). 내 컴퓨터에서 미리 보기: `node scripts/sync-public.mjs <빈 폴더>`.
- `release.yml`: 빌드와 점검은 소스 레포에서 하고, 릴리스 초안은 공개 레포에 만든다. 발행하면 공개 레포 `main` 의 끝 커밋에 태그가 붙는다(소스 레포의 태그와 다른 커밋이다).
- 공개 레포에는 워크플로를 두지 않는다(`public-repo/.github/workflows/` 를 넣으면 `sync-public.mjs` 가 멈춘다). 토큰에 Workflows 권한을 줄 까닭을 없애려고.

### 처음 한 번 (레포 주인)

1. **공개 레포 만들기:** `gh repo create milcho0604/fairy-releases --public --description "페어리 설치 파일과 버그 제보 (fairy downloads and issues)"`. 비어 있어도 된다(첫 옮기기가 `main` 을 만든다). README 를 넣어 만들었다면 기본 브랜치가 `main` 인지만 본다. 앱은 `main` 브랜치의 `gallery/`, `catalog/` 를 읽는다.
2. **공개 레포 설정:** Settings → General → Features 에서 **Issues** 를 켠다(Wiki, Projects, Discussions 는 꺼도 된다). Settings → Advanced Security(Code security) → **Private vulnerability reporting** 을 켠다(`SECURITY.md` 가 이 길로 받는다).
3. **토큰 만들기:** GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Resource owner `milcho0604`, Repository access **Only select repositories** → `milcho0604/fairy-releases` 하나만
   - Repository permissions **Contents: Read and write** 만(Metadata: Read 는 저절로 붙는다). Workflows, Issues, Administration 은 주지 않는다
   - 만료일을 정하고(최대 1년) 만료 전에 새로 만들어 비밀값을 바꾼다. 만료되면 릴리스와 옮기기가 실패한다(실패 메일이 간다)
4. **비밀값 넣기 (소스 레포):** `gh secret set RELEASES_TOKEN --repo milcho0604/fairy` 를 돌리고 토큰을 붙여 넣는다. `preflight` 가 값의 유무만 확인하고, `sync-public.yml` 과 릴리스 게시 작업이 이 토큰을 쓴다. 태그 ruleset 은 `v*` 태그 생성·변경·삭제를 관리자에게만 허용한다.
5. **첫 옮기기:** `public-repo/**`, `gallery/**`, `catalog/**` 중 하나를 바꾸어 소스 레포 `main` 에 올리면 `sync-public` 이 공개 레포에 README, SECURITY.md, LICENSE, 이슈 양식, `gallery/`, `catalog/` 를 맞춘다. 변경 경로를 올리기 어려우면 `node scripts/sync-public.mjs <빈 폴더>` 로 만든 내용을 공개 레포 `main` 에 직접 푸시한다.
6. 그다음부터 `v*` 태그를 올리면 릴리스가 공개 레포에 올라간다. 확인: `curl -sI https://raw.githubusercontent.com/milcho0604/fairy-releases/main/catalog/models.json` 이 `200`.

### 소스 레포를 비공개로 바꾸기

위를 마치고 첫 릴리스가 공개 레포에 발행되면 소스 레포는 비공개로 바꿔도 된다(`gh repo edit milcho0604/fairy --visibility private --accept-visibility-change-consequences`). 앱은 소스 레포를 읽지 않는다(`update-policy.test.ts` 가 주소를, `sync-public.test.ts` 가 공개 레포 문서에 소스 레포 링크가 없는지 확인한다).

공개 레포 없이 소스 레포를 비공개로 바꾸면 이렇게 깨진다:

- 업데이트 확인(`/releases/latest`)과 자동 설치(`latest.yml`, `latest-mac.yml`)가 404 가 되어 새 버전을 영영 못 받는다(확인만 조용히 건너뛴다).
- 페어리 갤러리가 "아직 열리지 않음"으로 보이고, 모델 목록은 앱에 들어 있는 옛 목록에 머문다.
- "문제 알리기", 이슈 양식, `SECURITY.md` 의 보안 알림 주소, 홈페이지와 문서의 받기 링크가 404 가 된다.

비공개로 바꾸기 전에 볼 것:

- **옛 판:** 0.1.0(사설 빌드)과 이 변경 전 판은 소스 레포를 본다. 공개 레포의 새 버전을 스스로 찾지 못하니 한 번은 직접 받아 설치해야 한다(`docs/install.md` "업데이트"). 그런 판을 쓰는 사람이 많으면, 소스 레포가 공개인 동안 같은 릴리스를 소스 레포에도 손으로 올려 다리를 놓는다(`gh release create vX.Y.Z <파일들> --repo milcho0604/fairy`).
- 홈페이지(`site/`)의 받기 링크가 공개 레포를 가리키는지.
- 소스 레포의 열린 이슈는 공개 레포로 옮기거나 닫는다(비공개가 되면 제보한 사람이 못 본다).
- Actions 시간: 비공개 레포는 무료 시간이 깎인다(맥 러너는 10배). 태그 릴리스가 시간을 다 쓰면 빌드가 멈춘다.

## 릴리스 사전 점검

`scripts/release-check.mjs` 가 틀린 릴리스를 비싼 빌드 전에, 그리고 올리기 전에 한 번 더 막는다. 규칙은 `src/shared/release-meta.ts`(시험 `release-meta.test.ts`).

| 언제 | 명령 | 보는 것 |
| --- | --- | --- |
| 태그를 올리기 전(손으로)과 `release.yml` 의 첫 작업 `preflight` | `node scripts/release-check.mjs tag v0.2.0` | 태그 = `v` + `package.json` 버전, `release/min-version` 값, `CHANGELOG.md` 의 `## [0.2.0] - 날짜` 절과 항목. 사전 릴리스 태그(`-beta.1`)는 CHANGELOG 절 없이도 된다 |
| 빌드가 다 끝나고 초안을 만들기 전(`release` 작업) | `node scripts/release-check.mjs files v0.2.0 <폴더>` | 파일 12개의 이름과 개수(빠진 것, 다른 버전 이름), 비지 않았는지, `latest.yml` 과 `latest-mac.yml` 의 버전과 각 파일 sha512 가 실제 파일과 같은지. 통과하면 `SHA256SUMS.txt` 를 써서 같이 올린다 |
| 릴리스 본문 | `node scripts/release-check.mjs notes v0.2.0` | 최소 버전 머리 + CHANGELOG 절 (그 아래 체크섬 안내). GitHub 자동 변경 목록은 넣지 않는다(공개 레포의 커밋은 옮기기 기록뿐이고, 소스 레포는 비공개일 수 있다) |

`preflight` 는 태그 커밋이 `main` 에 포함됐는지와 릴리스 메타데이터를 확인한다. 둘 중 하나라도 틀리면 어떤 운영체제 빌드도 시작되지 않는다. 빌드는 한 운영체제라도 깨지면 나머지를 바로 멈춘다(`fail-fast`). Actions 에서 수동 빌드를 실행하지 않으며, 로컬 빌드는 `npm run dist` 와 `npm run dist:mac`, `npm run dist:win`, `npm run dist:linux` 을 쓴다.

받는 사람은 `SHA256SUMS.txt` 로 내려받은 파일을 확인할 수 있다: 같은 폴더에서 `sha256sum -c SHA256SUMS.txt --ignore-missing`(맥은 `shasum -a 256 <파일>`, 윈도우 PowerShell 은 `Get-FileHash <파일>` 이 보이는 값을 목록과 견준다). GitHub 릴리스 화면도 파일마다 sha256 을 보인다.

## 자동 업데이트

설치판은 새 버전을 미리 받아 두고 페어리가 "다시 켜서 업데이트"를 띄운다.

- 윈도우: 누를 때만 설치한다(2026-10-11부터). 윈도우 설치 파일은 코드 서명이 없어(아래 "윈도우 서명") 받은 파일의 게시자를 운영체제가 확인할 수 없다. 받은 파일은 `latest.yml` 의 sha512 로만 확인하므로, 끝낼 때 몰래 설치하지 않고 사용자가 "다시 켜서 업데이트"를 누른 때만 설치한다.
- 리눅스: 자동 설치가 없다. 새 버전이 나오면 페어리가 릴리스 페이지를 연다.
- 맥: 누를 때만 설치한다. 맥의 업데이트 장치(Squirrel.Mac)는 한 번 넘겨받으면 끝낼 때 반드시 설치해서 "건너뛰기"를 되돌릴 수 없기 때문이다. 새 앱의 서명이 지금 앱의 서명 조건(앱 ID + 아래 자체 인증서)을 만족해야 받아들인다. 다른 인증서나 임시 서명으로 만든 빌드는 거절되고, 그때 페어리는 릴리스 페이지를 연다(2026-10-09 실험: 같은 인증서는 설치, 임시 서명은 "did not pass validation" 으로 거절).
- 이 기능이 없는 0.1.0 은 맥에서 한 번은 직접 받아 설치해야 한다(페어리의 "받으러 가기"). 그 뒤부터 자동이다.
- 앱이 읽기 전용 위치(dmg 안, 다운로드 폴더에서 격리된 채)에서 돌면 설치가 거절된다. 이때도 릴리스 페이지로 돌아간다.

## 맥 서명 인증서

맥 앱은 electron-builder 가 임시 서명을 한 뒤 `scripts/mac-sign.mjs` 가 자체 인증서 `Jjakkung Self Signed` 로 다시 서명한다. 맥은 애플 서명 없는 앱의 화면 기록 권한을 서명 조건으로 기억하는데, 임시 서명은 빌드마다 바뀌어 업데이트할 때마다 권한이 풀린다(L23). 같은 인증서면 조건이 "앱 ID + 인증서"로 고정되어 업데이트해도 유지되고, 맥 자동 업데이트도 이 조건으로 새 앱을 확인한다. 애플 개발자 서명(D4)을 붙이면 이 단계는 빼도 되지만, 그때는 서명 조건이 바뀌어 자체 인증서 판에서 개발자 서명 판으로는 자동 업데이트가 안 된다(한 번은 직접 설치).

- 인증서 지문(SHA1): `45DAB97976E727D42955956ED8DC2B5ED6D12714`. 스크립트에 박혀 있어 다른 인증서면 빌드가 멈춘다.
- 위치: 만든 사람 컴퓨터 `~/.config/jjakkung/mac-sign.p12`(이름이 페어리로 바뀌어도 이 폴더 이름은 그대로, `scripts/mac-sign.mjs`), 암호는 같은 폴더 `mac-sign.password`. GitHub Actions 는 비밀값 `JJ_MAC_SIGN_P12`(p12 를 base64 로)와 `JJ_MAC_SIGN_PASSWORD`.
- **잃어버리면 안 된다.** 새로 만들면 모든 사용자가 권한을 한 번 다시 줘야 하고 자동 업데이트도 끊긴다. p12 와 암호를 비밀번호 관리자 같은 곳에 따로 보관한다.
- 비밀값 넣기는 아래 "공개 전환 체크리스트" 4.
- 권한과 상관없는 시험 빌드만 `JJ_ALLOW_ADHOC=1` 로 임시 서명에 둘 수 있다. 그 빌드는 배포하지 않는다.
- 빌드하는 동안 잠깐 만든 키체인을 사용자 키체인 검색 목록에 넣었다가 끝나면 원래대로 돌린다(자체 인증서는 codesign 이 검색 목록에서만 찾는다).
- 다른 컴퓨터에서 열 때 뜨는 "확인되지 않은 개발자" 경고는 임시 서명 때와 같다. 공증(D4) 전까지 남는다.
- **만료 관리:** `.github/workflows/cert-expiry.yml` 이 매주 월요일 비밀값의 인증서를 열어 끝나는 날을 보고, 30일 안으로 남으면 라벨 `cert-expiry` 이슈에 레포 주인을 불러 매주 댓글을 단다(GitHub 알림). 지문이 다르거나 비밀값이 없으면 실패해 실패 메일이 간다. 암호는 env 로만 넘기고 로그에 찍지 않는다.
- 자체 인증서를 새로 만들면(기한 연장 포함) 지문이 바뀌어 위 "잃어버리면 안 된다"와 같은 일이 생긴다. 끝나기 전에 할 일은 관리 이슈 본문에 적어 둔다.

## 윈도우 서명

윈도우 설치 파일은 서명하지 않는다. 그래서 처음 열 때 SmartScreen 이 "Windows의 PC 보호" 창을 띄우고(추가 정보 → 실행), 자동 업데이트도 누를 때만 설치한다(위).

- 서명하려면 코드 서명 인증서가 필요하다(유료). 고르는 길: OV/EV 인증서(하드웨어 토큰이나 클라우드 HSM), Azure Trusted Signing(월 요금, 개인은 조건이 있다), SignPath Foundation(오픈소스 무료 심사).
- 붙일 때: `electron-builder.yml` 의 `win.signtoolOptions`(또는 `win.azureSignOptions`)와 `release.yml` 윈도우 단계 비밀값. 그 뒤 `src/main/update.ts` 의 `installOnQuit` 을 윈도우에서 다시 켤지 정한다. electron-updater 는 서명된 판부터 새 파일의 게시자 이름이 지금 앱과 같은지 확인한다(`publisherName`).

## Electron 퓨즈

`electron-builder.yml` 의 `electronFuses` 가 설치판 실행 파일의 기능 스위치를 서명 전에 바꾼다.

| 퓨즈 | 값 | 까닭 |
| --- | --- | --- |
| RunAsNode | 켬 | 페어리 MCP 서버를 페어리 실행 파일로 띄운다(`ELECTRON_RUN_AS_NODE`, `src/main/mcp-launch.ts`). 끄면 AI 대화의 페어리 도구와 "다른 AI 에 붙이기"가 멈춘다. 대가: 이 컴퓨터에서 프로그램을 돌릴 수 있는 사람은 페어리 실행 파일을 Node 처럼 쓸 수 있다. 맥 화면 기록 권한은 창을 띄운 앱 쪽에 묶여 Node 모드로는 빌릴 수 없다. 나중에 MCP 서버를 따로 묶은 실행 파일(또는 utilityProcess 중계)로 바꾸면 끈다 |
| EnableNodeOptionsEnvironmentVariable | 끔 | `NODE_OPTIONS` 로 설치판에 코드를 끼워 넣지 못하게 |
| EnableNodeCliInspectArguments | 끔 | `--inspect` 로 설치판에 디버거를 붙여 토큰, 화면 권한을 빌리지 못하게. 개발 실행(`npx electron .`)과 시험 창은 퓨즈 없는 Electron 이라 그대로 된다 |
| OnlyLoadAppFromAsar | 켬 | 앱 코드는 `app.asar` 에서만 읽는다 |
| EnableEmbeddedAsarIntegrityValidation | 켬 | 맥, 윈도우는 빌드 때 적은 `app.asar` 해시와 다르면 켜지지 않는다(리눅스는 무시) |
| 쿠키 암호화, file:// 추가 권한 | 기본값 | 쿠키 암호화는 한 번 켜면 되돌릴 수 없고, 창과 모델 파일을 file:// 에서 읽는다. 바꿀 때는 설치판으로 모든 창과 모델 받기를 시험한다 |

확인: `npx @electron/fuses read --app <설치판 실행 파일>`. CI 의 리눅스 묶음 시험(`check.yml` package-linux)은 `--inspect` 가 막혔는지와 창이 `file://` 에서 열리는지 본다(`scripts/dev/smoke-packaged.mjs`). 설치판은 `ELECTRON_RENDERER_URL` 도 읽지 않는다(`src/main/dev-url.ts`).

## 환경 승인

`release.yml` 의 공개 레포 게시 작업은 GitHub 환경 `release` 에서 돈다. 이 환경이 없거나 보호가 빠지면 태그로 실행한 코드가 `RELEASES_TOKEN` 을 쓸 수 있으므로 공개 레포에 적용한다:

1. 레포 Settings → Environments → New environment → `release`
2. Required reviewers 에 레포 주인을 넣는다(혼자면 "Prevent self-review" 는 끈다)
3. Deployment branches and tags → Selected → 태그 `v*` 만

별도로 Settings → Rules → Rulesets 에 태그 ruleset 을 만든다. 대상은 `refs/tags/v*`, 규칙은 생성·수정·삭제 제한, 우회 역할은 Repository administrators 만 둔다. 이 설정은 `release.yml` 파일 자체가 바뀐 미승인 태그에서 실행되는 것을 막는다. `preflight` 도 태그 커밋이 `main` 에 포함됐는지 다시 확인한다.

비밀값이나 쓰기 권한 토큰을 쓰는 워크플로에는 `workflow_dispatch` 를 두지 않는다. 릴리스 빌드는 보호된 태그 푸시, 서버 배포와 공개 파일 동기화는 보호된 `main` 푸시, 인증서와 서버 감시는 예약 실행만 받는다. 이렇게 해야 임의 브랜치에서 워크플로를 바꿔 비밀값이나 쓰기 권한 토큰을 빼내지 못한다.

## 꼭 필요한 업데이트 (min-version)

이전 버전을 더 쓰면 안 될 때(데이터를 망가뜨리는 결함, 보안 문제)만 레포의 `release/min-version` 에 `1.4.0` 처럼 한 줄로 적고 커밋한다. 태그를 올리면 `release.yml` 이 값을 검사하고(숫자 셋, 이 릴리스 버전 이하, 한 줄) 릴리스 본문 맨 위에 사람이 읽는 문장과 앱이 읽는 표시 `<!-- min-version: 1.4.0 -->` 를 넣는다. 값이 잘못되었으면 빌드 전에 멈춘다. 본문에 손으로 적지 않는다.

- 이보다 낮은 버전의 페어리는 건너뛰기 없이 업데이트 안내를 띄우고 업데이트 전까지 AI 대화를 잠근다.
- 앱은 최신 릴리스 하나만 본다. 파일에 값이 남아 있는 동안은 다음 릴리스에도 계속 붙는다. 풀려면 값 줄을 지운다.
- 잠그려면 따로 받은 두 응답(10초 간격)이 같은 최소 버전을 말해야 한다. 확인에 실패하거나 오프라인이면 잠그지 않으니 잠금은 보안 장치가 아니라 안내다.
- 앱이 읽는 규칙(본문을 손으로 고칠 때): 줄 전체가 `min-version: 1.4.0` 또는 `<!-- min-version: 1.4.0 -->` 여야 하고, 값이 최신 릴리스보다 높거나, 서로 다른 값이 둘이거나, 코드 블록(```) 안이면 무시된다.
- 릴리스 없이 최소 버전을 올리려면 아래 공지 파일의 `minVersion` 을 쓴다. 앱은 두 값 중 높은 쪽을 쓴다(최신 릴리스 이하인 값만).
- 잠긴 동안 안내는 닫을 수 없는 공지 창(업데이트 단추 하나)으로 뜬다. 설정의 백업 내보내기와 메뉴 막대 아이콘의 끝내기는 그대로 된다.

## 공지 올리기 (site/notices.json)

서버 4단계(#101)부터는 운영자 화면(`https://fairy-api.moilga.com/admin` 이나 앱 설정의 운영자 칸)에서 공지와 최소/권장 버전을 고친다. 서버가 `GET /v1/notices.json` 으로 내보내고 Actions `site-feeds.yml` 이 10분마다 받아 검사한 뒤 `site/notices.json` 을 main 에 올린다(막히면 `bot/site-feeds` PR, 머지하면 배포). 운영자 화면에서 한 번 저장하면 그 뒤로는 레포 파일을 손으로 고치지 않는다(다음 실행이 서버 내용으로 덮는다). 아래는 손으로 고칠 때와 파일 형식이다.

앱 자체 공지 창과 릴리스 없는 최소 버전 (`docs/server-plan.md` 23절). 레포의 `site/notices.json` 을 고쳐 main 에 머지하면 홈페이지 배포로 나가고, 앱은 켤 때(5초 뒤)와 4시간마다 `https://fairy.moilga.com/notices.json` 을 받는다. 지금 파일은 빈 목록이라 아무것도 띄우지 않는다.

```json
{
  "version": 1,
  "minVersion": "0.4.4",
  "notices": [
    {
      "id": "2026-10-event-1",
      "kind": "info",
      "title": { "ko": "이번 주 선물", "en": "Gift this week" },
      "body": { "ko": "할 일을 끝내면 코인을 두 배로 받아.", "en": "Double coins for finished to-dos." },
      "link": "https://fairy.moilga.com/news/1",
      "from": "2026-10-20T00:00:00+09:00",
      "until": "2026-10-27T00:00:00+09:00",
      "versions": "<0.5.0",
      "platforms": ["darwin", "win32"]
    }
  ]
}
```

- `kind`: `info`(알림, 한 번), `important`(중요, 켤 때마다 확인을 누를 때까지), `update`(업데이트 권장. 앱이 `recommendVersion` 보다 낮고 받을 새 버전이 있을 때 하루 한 번, 나중에 가능. `recommendVersion` 이 없으면 안 뜬다), `force`(잠긴 동안 강제 창에 쓸 글. 잠금은 `minVersion` 이 정한다).
- `title`, `body` 는 ko 와 en 둘 다, 글자만(HTML 아님). 제목 80자, 본문 1000자까지. `id` 는 영문, 숫자, `.`, `_`, `-` 로 80자까지.
- 알림과 권장은 합쳐 하루 한 번까지, 집중 중에는 강제 말고 미룬다. 한 번에 하나, 중요, 권장, 알림 순.
- 이미 닫은 알림은 다시 안 뜬다. 고칠 때는 새 `id` 로 올린다.
- `link` 는 `https://fairy.moilga.com` 과 `https://github.com/milcho0604/` 아래만 남고 나머지는 버린다(공지는 남는다).
- `versions` 는 `<0.5.0`, `>=0.4.0 <0.5.0`, `0.4.3` 처럼. `platforms` 는 `darwin`, `win32`, `linux`. 비우면 모두.
- 깨진 공지, 모르는 `kind` 는 그것만 버린다. 파일이 JSON 이 아니거나 64KB 를 넘거나 `version` 이 1 이 아니면 아무것도 띄우지 않고 잠그지도 않는다.
- `recommendVersion` 은 권장 버전이다. 이보다 낮은 앱에 `update` 공지를 띄우고 잠그지는 않는다. 보통 `minVersion` 보다 높게 둔다.
- `minVersion` 은 10초 간격으로 두 번 받아 같아야 쓰고, 최신 릴리스보다 높으면 무시, 못 받으면(오프라인) 잠그지 않는다. 내리려면 줄을 지운다.
- 시험: `npm run build && OUT=<폴더> LANG_UNDER_TEST=ko node scripts/dev/notices.mjs` (이 컴퓨터 http 서버로 공지와 릴리스를 내주고 종류 넷을 찍는다, `scripts/dev/README.md`).

## 공개 전환 체크리스트

레포를 공개로 바꾸기 전과 첫 공개 릴리스 순서. GitHub 에 쓰는 명령(공개 전환, 비밀값, 태그 푸시, 발행)은 레포 주인이 직접 돌린다. `gh` 는 개인 계정 토큰으로 부른다.

```bash
export GH_TOKEN=$(gh auth token --user milcho0604)
```

1. **이력 점검 (2026-10-09, 커밋 44개, 원격 브랜치 포함 `git log --all -p`)**
   - 토큰 모양(`ghp_`, `github_pat_`, `sk-`, `sk-ant-`, `AKIA`, `AIza`, `xox?-`, `npm_`, `PRIVATE KEY`) 0건, 비밀번호나 키를 문자열로 넣은 줄 0건.
   - 이 컴퓨터 홈 경로 0건(시험 속 `/Users/kim` 같은 가짜 경로만).
   - `.env`, `.p12`, `.pem`, `.key`, `password`, `secret` 이름의 파일이 커밋된 적 없음. 큰 파일은 `build/icon.png`, `package-lock.json`, `spike/test.png`(구성도 그림)뿐.
   - 이메일은 커밋 작성자 정보에만 있다. **공개하면 커밋 작성자 이메일(개인 Gmail)이 누구에게나 보인다.** 괜찮지 않으면 공개 전에 정한다(이력을 다시 쓰려면 강제 푸시가 필요하다).
   - 다시 점검: `git log --all -p | grep -nE 'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-ant-|AKIA[0-9A-Z]{16}|PRIVATE KEY|/Users/'"$USER"`
   - **다시 점검 (2026-10-11, 커밋 279개, 모든 브랜치):** 토큰 모양(구글 `GOCSPX-`, `ya29.`, `1//0`, HF `hf_` 포함) 0건(시험 속 가짜 값만), 홈 경로는 가짜(`/Users/kim`, `/Users/kimcs`, `C:\Users\Kimcs`)와 CI 러너 경로만, 전화번호와 주민등록번호는 가리기 시험의 가짜 값만. 이메일은 시험 속 가짜(`me@gmail.com`, `kim.cs+jj@gmail.com` 등)와 **커밋 작성자 정보**뿐인데, 작성자 정보에 실명과 개인 Gmail 이 34개 커밋에 있다. 내용 속 개인 흔적은 codex 출력 예시의 별명 하나였고 지금 판에서는 뺐다(이력에는 남는다). 이력을 다시 쓸지는 레포 주인이 정한다
2. **README 와 라이선스:** `README.md` 는 있다. `LICENSE` 가 없으면 공개해도 남이 쓰거나 고칠 권리가 없다(보기만 가능). 공개 목적에 맞는 라이선스(예: MIT)를 정해 넣을지 결정한다. README 의 "지금 되는 것"과 설치 안내(P4-03)도 첫 공개 전에 한 번 본다.
3. **첫 릴리스 버전은 `0.2.0` 을 권한다.** 지금 쓰는 설치본(사설 빌드)이 모두 `0.1.0` 이라 `0.1.0` 으로 올리면 새 버전으로 보이지 않는다. 최소 버전(`release/min-version`)은 비워 둔다. 사설 빌드를 모두 강제로 올려야 할 결함이 있을 때만 `0.2.0` 을 적는다(사설 빌드는 모두 `0.1.0` 이라 서로 구분할 수 없다).
4. **비밀값 넣기 (맥 빌드에 필요, 값은 화면에 찍지 않는다):**

   ```bash
   base64 -i ~/.config/jjakkung/mac-sign.p12 | gh secret set JJ_MAC_SIGN_P12 --repo milcho0604/fairy
   gh secret set JJ_MAC_SIGN_PASSWORD --repo milcho0604/fairy < ~/.config/jjakkung/mac-sign.password
   gh secret list --repo milcho0604/fairy
   ```

   그리고 위 "환경 승인"대로 환경 `release` 와 `v*` 태그 ruleset 을 설정한다.
   공개 레포 준비(만들기, Issues 와 Private vulnerability reporting 켜기, 비밀값 `RELEASES_TOKEN`, 첫 sync-public)는 위 "두 레포" 의 "처음 한 번" 대로 한다.
5. **공개 전환:** `gh repo edit milcho0604/fairy --visibility public --accept-visibility-change-consequences`. 공개 레포는 Actions 맥 러너 시간이 깎이지 않으니 태그는 공개 뒤에 올린다.
6. **버전 올리기와 태그:** `package.json` 의 `version` 을 `0.2.0` 으로(`npm version 0.2.0 --no-git-tag-version`), `CHANGELOG.md` 의 Unreleased 를 `## [0.2.0] - <오늘 날짜>` 로 정리해 커밋하고 `main` 에 푸시한다. 태그 전에 `node scripts/release-check.mjs tag v0.2.0` 이 통과하는지 본다(CI 의 `preflight` 와 같은 점검). 그다음 `git tag v0.2.0 && git push origin v0.2.0`, 진행은 `gh run watch --repo milcho0604/fairy`.
7. **초안 확인:** `gh release view v0.2.0 --repo milcho0604/fairy-releases` 로 파일 목록(dmg 2, zip 2, zip.blockmap 2, latest-mac.yml, exe, exe.blockmap, latest.yml, tar.xz, AppImage, SHA256SUMS.txt 해서 13개)과 본문(최소 버전을 적었으면 그 문장, CHANGELOG 의 0.2.0 절)을 본다. 이름과 sha512 는 `release` 작업이 이미 맞춰 봤다.
8. **발행:** `gh release edit v0.2.0 --repo milcho0604/fairy-releases --draft=false --latest`.
9. **공개 후 밖에서 확인 (토큰 없이):**

   ```bash
   curl -s https://api.github.com/repos/milcho0604/fairy-releases/releases/latest | grep -E '"(tag_name|draft|prerelease)"'
   curl -sIL -o /dev/null -w '%{http_code}\n' https://github.com/milcho0604/fairy-releases/releases/latest/download/latest-mac.yml
   curl -sIL -o /dev/null -w '%{http_code}\n' https://github.com/milcho0604/fairy-releases/releases/latest/download/latest.yml
   curl -sIL -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/milcho0604/fairy-releases/main/gallery/index.json
   GIT_TERMINAL_PROMPT=0 git clone --depth 1 https://github.com/milcho0604/fairy "$(mktemp -d)/jj"
   ```

   `tag_name` 이 `v0.2.0`, `draft` 와 `prerelease` 가 `false`, 세 파일이 `200` 이면 된다(clone 은 소스 레포가 공개인 동안만 된다). 쓰던 `0.1.0` 페어리의 설정에서 업데이트 확인을 누르면 "새 버전 0.2.0" 이 떠야 한다.
