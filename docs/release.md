# 릴리스 올리기

`v*` 태그를 올리면 `release.yml` 이 맥과 윈도우 설치 파일, 윈도우 자동 설치용 `latest.yml` 과 `.blockmap` 을 GitHub Releases 초안으로 올린다. 초안의 본문을 고친 뒤 화면에서 발행한다. 릴리스 레포는 `src/shared/update-policy.ts` 의 `RELEASE_REPO` 와 `electron-builder.yml` 의 `publish` 두 곳이고 서로 같아야 한다(다르면 `npm test` 가 깨진다).

## 맥 서명 인증서

맥 앱은 electron-builder 가 임시 서명을 한 뒤 `scripts/mac-sign.mjs` 가 자체 인증서 `Jjakkung Self Signed` 로 다시 서명한다. 맥은 애플 서명 없는 앱의 화면 기록 권한을 서명 조건으로 기억하는데, 임시 서명은 빌드마다 바뀌어 업데이트할 때마다 권한이 풀린다(L23). 같은 인증서면 조건이 "앱 ID + 인증서"로 고정되어 업데이트해도 유지된다. 애플 개발자 서명(D4)을 붙이면 이 단계는 빼도 된다.

- 인증서 지문(SHA1): `45DAB97976E727D42955956ED8DC2B5ED6D12714`. 스크립트에 박혀 있어 다른 인증서면 빌드가 멈춘다.
- 위치: 만든 사람 컴퓨터 `~/.config/jjakkung/mac-sign.p12`, 암호는 같은 폴더 `mac-sign.password`. GitHub Actions 는 비밀값 `JJ_MAC_SIGN_P12`(p12 를 base64 로)와 `JJ_MAC_SIGN_PASSWORD`.
- **잃어버리면 안 된다.** 새로 만들면 모든 사용자가 권한을 한 번 다시 줘야 한다. p12 와 암호를 비밀번호 관리자 같은 곳에 따로 보관한다.
- 비밀값 넣기: `base64 -i ~/.config/jjakkung/mac-sign.p12 | gh secret set JJ_MAC_SIGN_P12`, `gh secret set JJ_MAC_SIGN_PASSWORD < ~/.config/jjakkung/mac-sign.password`.
- 권한과 상관없는 시험 빌드만 `JJ_ALLOW_ADHOC=1` 로 임시 서명에 둘 수 있다. 그 빌드는 배포하지 않는다.
- 빌드하는 동안 잠깐 만든 키체인을 사용자 키체인 검색 목록에 넣었다가 끝나면 원래대로 돌린다(자체 인증서는 codesign 이 검색 목록에서만 찾는다).
- 다른 컴퓨터에서 열 때 뜨는 "확인되지 않은 개발자" 경고는 임시 서명 때와 같다. 공증(D4) 전까지 남는다.

## 꼭 필요한 업데이트 (min-version)

이전 버전을 더 쓰면 안 될 때(데이터를 망가뜨리는 결함, 보안 문제)만 릴리스 본문 아무 곳에 한 줄로 `min-version: 1.4.0` 을 적는다. 화면에 안 보이게 하려면 `<!-- min-version: 1.4.0 -->` 로 적어도 된다. 그 줄에는 다른 글을 섞지 않고, 숫자는 `1.4.0` 처럼 셋을 다 쓴다. 이보다 낮은 버전의 짝꿍은 건너뛰기 없이 업데이트 안내를 띄우고 업데이트 전까지 AI 대화를 잠근다. 값은 이 릴리스 버전 이하여야 하고(더 높으면 무시된다), 서로 다른 값을 두 줄 적거나 코드 블록(```) 안에 적으면 무시된다. 최신 릴리스 하나만 보므로 다음 릴리스에도 계속 막아야 하면 그 본문에도 다시 적는다. 확인에 실패하거나 오프라인이면 잠그지 않으니 잠금은 보안 장치가 아니라 안내다.
