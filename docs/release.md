# 릴리스 올리기

`v*` 태그를 올리면 `release.yml` 이 맥과 윈도우 설치 파일, 자동 업데이트용 파일(윈도우 `latest.yml` 과 `.exe.blockmap`, 맥 `latest-mac.yml` 과 `.zip`, `.zip.blockmap`)을 GitHub Releases 초안으로 올린다. 초안을 확인한 뒤 발행한다. 릴리스 레포는 `src/shared/update-policy.ts` 의 `RELEASE_REPO` 와 `electron-builder.yml` 의 `publish` 두 곳이고 서로 같아야 한다(다르면 `npm test` 가 깨진다).

- 태그는 `package.json` 의 `version` 앞에 `v` 를 붙인 것과 똑같아야 한다(`0.2.0` 이면 `v0.2.0`). 다르면 빌드 전에 멈춘다. 버전을 안 올리고 태그만 달면 새 앱이 스스로를 옛 버전으로 보고 업데이트 안내가 끝나지 않기 때문이다.
- 태그에 `-beta.1` 같은 꼬리가 있으면 사전 릴리스로 올린다. 앱은 사전 릴리스를 업데이트로 보지 않는다.
- 초안과 사전 릴리스는 GitHub 의 "최신 릴리스"(`/releases/latest`)에 잡히지 않는다. 발행할 때 "Set as the latest release" 를 끄면 앱이 그 릴리스를 못 본다.

## 자동 업데이트

설치판은 새 버전을 미리 받아 두고 펫이 "다시 켜서 업데이트"를 띄운다.

- 윈도우: 누르면 바로, 안 누르면 끝낼 때 설치한다.
- 맥: 누를 때만 설치한다. 맥의 업데이트 장치(Squirrel.Mac)는 한 번 넘겨받으면 끝낼 때 반드시 설치해서 "건너뛰기"를 되돌릴 수 없기 때문이다. 새 앱의 서명이 지금 앱의 서명 조건(앱 ID + 아래 자체 인증서)을 만족해야 받아들인다. 다른 인증서나 임시 서명으로 만든 빌드는 거절되고, 그때 펫은 릴리스 페이지를 연다(2026-10-09 실험: 같은 인증서는 설치, 임시 서명은 "did not pass validation" 으로 거절).
- 이 기능이 없는 0.1.0 은 맥에서 한 번은 직접 받아 설치해야 한다(펫의 "받으러 가기"). 그 뒤부터 자동이다.
- 앱이 읽기 전용 위치(dmg 안, 다운로드 폴더에서 격리된 채)에서 돌면 설치가 거절된다. 이때도 릴리스 페이지로 돌아간다.

## 맥 서명 인증서

맥 앱은 electron-builder 가 임시 서명을 한 뒤 `scripts/mac-sign.mjs` 가 자체 인증서 `Jjakkung Self Signed` 로 다시 서명한다. 맥은 애플 서명 없는 앱의 화면 기록 권한을 서명 조건으로 기억하는데, 임시 서명은 빌드마다 바뀌어 업데이트할 때마다 권한이 풀린다(L23). 같은 인증서면 조건이 "앱 ID + 인증서"로 고정되어 업데이트해도 유지되고, 맥 자동 업데이트도 이 조건으로 새 앱을 확인한다. 애플 개발자 서명(D4)을 붙이면 이 단계는 빼도 되지만, 그때는 서명 조건이 바뀌어 자체 인증서 판에서 개발자 서명 판으로는 자동 업데이트가 안 된다(한 번은 직접 설치).

- 인증서 지문(SHA1): `45DAB97976E727D42955956ED8DC2B5ED6D12714`. 스크립트에 박혀 있어 다른 인증서면 빌드가 멈춘다.
- 위치: 만든 사람 컴퓨터 `~/.config/jjakkung/mac-sign.p12`, 암호는 같은 폴더 `mac-sign.password`. GitHub Actions 는 비밀값 `JJ_MAC_SIGN_P12`(p12 를 base64 로)와 `JJ_MAC_SIGN_PASSWORD`.
- **잃어버리면 안 된다.** 새로 만들면 모든 사용자가 권한을 한 번 다시 줘야 하고 자동 업데이트도 끊긴다. p12 와 암호를 비밀번호 관리자 같은 곳에 따로 보관한다.
- 비밀값 넣기는 아래 "공개 전환 체크리스트" 4.
- 권한과 상관없는 시험 빌드만 `JJ_ALLOW_ADHOC=1` 로 임시 서명에 둘 수 있다. 그 빌드는 배포하지 않는다.
- 빌드하는 동안 잠깐 만든 키체인을 사용자 키체인 검색 목록에 넣었다가 끝나면 원래대로 돌린다(자체 인증서는 codesign 이 검색 목록에서만 찾는다).
- 다른 컴퓨터에서 열 때 뜨는 "확인되지 않은 개발자" 경고는 임시 서명 때와 같다. 공증(D4) 전까지 남는다.

## 꼭 필요한 업데이트 (min-version)

이전 버전을 더 쓰면 안 될 때(데이터를 망가뜨리는 결함, 보안 문제)만 레포의 `release/min-version` 에 `1.4.0` 처럼 한 줄로 적고 커밋한다. 태그를 올리면 `release.yml` 이 값을 검사하고(숫자 셋, 이 릴리스 버전 이하, 한 줄) 릴리스 본문 맨 위에 사람이 읽는 문장과 앱이 읽는 표시 `<!-- min-version: 1.4.0 -->` 를 넣는다. 값이 잘못되었으면 빌드 전에 멈춘다. 본문에 손으로 적지 않는다.

- 이보다 낮은 버전의 짝꿍은 건너뛰기 없이 업데이트 안내를 띄우고 업데이트 전까지 AI 대화를 잠근다.
- 앱은 최신 릴리스 하나만 본다. 파일에 값이 남아 있는 동안은 다음 릴리스에도 계속 붙는다. 풀려면 값 줄을 지운다.
- 잠그려면 따로 받은 두 응답(10초 간격)이 같은 최소 버전을 말해야 한다. 확인에 실패하거나 오프라인이면 잠그지 않으니 잠금은 보안 장치가 아니라 안내다.
- 앱이 읽는 규칙(본문을 손으로 고칠 때): 줄 전체가 `min-version: 1.4.0` 또는 `<!-- min-version: 1.4.0 -->` 여야 하고, 값이 최신 릴리스보다 높거나, 서로 다른 값이 둘이거나, 코드 블록(```) 안이면 무시된다.

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
2. **README 와 라이선스:** `README.md` 는 있다. `LICENSE` 가 없으면 공개해도 남이 쓰거나 고칠 권리가 없다(보기만 가능). 공개 목적에 맞는 라이선스(예: MIT)를 정해 넣을지 결정한다. README 의 "지금 되는 것"과 설치 안내(P4-03)도 첫 공개 전에 한 번 본다.
3. **첫 릴리스 버전은 `0.2.0` 을 권한다.** 지금 쓰는 설치본(사설 빌드)이 모두 `0.1.0` 이라 `0.1.0` 으로 올리면 새 버전으로 보이지 않는다. 최소 버전(`release/min-version`)은 비워 둔다. 사설 빌드를 모두 강제로 올려야 할 결함이 있을 때만 `0.2.0` 을 적는다(사설 빌드는 모두 `0.1.0` 이라 서로 구분할 수 없다).
4. **비밀값 넣기 (맥 빌드에 필요, 값은 화면에 찍지 않는다):**

   ```bash
   base64 -i ~/.config/jjakkung/mac-sign.p12 | gh secret set JJ_MAC_SIGN_P12 --repo milcho0604/jjakkung
   gh secret set JJ_MAC_SIGN_PASSWORD --repo milcho0604/jjakkung < ~/.config/jjakkung/mac-sign.password
   gh secret list --repo milcho0604/jjakkung
   ```

5. **공개 전환:** `gh repo edit milcho0604/jjakkung --visibility public --accept-visibility-change-consequences`. 공개 레포는 Actions 맥 러너 시간이 깎이지 않으니 태그는 공개 뒤에 올린다.
6. **버전 올리기와 태그:** `package.json` 의 `version` 을 `0.2.0` 으로(`npm version 0.2.0 --no-git-tag-version`), `CHANGELOG.md` 의 Unreleased 를 `0.2.0` 으로 정리해 커밋하고 `main` 에 푸시한다. 그다음 `git tag v0.2.0 && git push origin v0.2.0`, 진행은 `gh run watch --repo milcho0604/jjakkung`.
7. **초안 확인:** `gh release view v0.2.0 --repo milcho0604/jjakkung` 로 파일 목록(dmg 2, zip 2, zip.blockmap 2, latest-mac.yml, exe, exe.blockmap, latest.yml)과 본문 머리(최소 버전을 적었으면 그 문장)를 본다.
8. **발행:** `gh release edit v0.2.0 --repo milcho0604/jjakkung --draft=false --latest`.
9. **공개 후 밖에서 확인 (토큰 없이):**

   ```bash
   curl -s https://api.github.com/repos/milcho0604/jjakkung/releases/latest | grep -E '"(tag_name|draft|prerelease)"'
   curl -sIL -o /dev/null -w '%{http_code}\n' https://github.com/milcho0604/jjakkung/releases/latest/download/latest-mac.yml
   curl -sIL -o /dev/null -w '%{http_code}\n' https://github.com/milcho0604/jjakkung/releases/latest/download/latest.yml
   GIT_TERMINAL_PROMPT=0 git clone --depth 1 https://github.com/milcho0604/jjakkung "$(mktemp -d)/jj"
   ```

   `tag_name` 이 `v0.2.0`, `draft` 와 `prerelease` 가 `false`, 두 파일이 `200` 이면 된다. 쓰던 `0.1.0` 짝꿍의 설정에서 업데이트 확인을 누르면 "새 버전 0.2.0" 이 떠야 한다.
