/*
 * 사이트 설정 — 이름, 소개 한 줄, 주소, 릴리스 레포는 여기 한 곳에서만 바꿔요.
 * Site settings — the product name, tagline, domain and release repo live here and only here.
 *
 * 바꾼 뒤에는 저장소 루트에서 한 번 돌려 주세요 (Node 18+, 설치할 것 없음):
 * After editing, run once from the repo root (Node 18+, nothing to install):
 *
 *   node site/tools/build.mjs     # <head> 메타, 미리 그린 한국어 글, sitemap.xml, robots.txt, manifest
 *   node site/tools/og.mjs        # (선택) 공유 카드 그림 assets/og.png 를 새 이름으로 다시 그리기
 *
 * 브라우저는 이 파일을 그대로 읽어요 (window.SITE). build.mjs 도 같은 파일을 읽어요.
 */
window.SITE = {
  // 제품 이름. 한국어 화면과 영어 화면에서 보일 이름. 영어 이름이 정해지면 en 을, 한국어로도 그 이름을 쓸 거면 ko 도 바꿔요.
  // Product name per language. When the English name is decided, change `en` (and `ko` if Korean pages should use it too).
  name: { ko: '짝꿍', en: 'Jjakkung' },

  // 소개 한 줄 (제목 옆, 검색 결과, 공유 카드)
  tagline: {
    ko: '화면 위를 돌아다니는 펫이 할 일, 일정, 메모를 같이 챙겨 주는 데스크톱 비서',
    en: 'A desktop pet that walks around your screen and keeps your to-dos, calendar and notes',
  },

  // 사이트 주소 (끝에 / 없이). canonical, 공유 카드, sitemap 에 들어가요.
  siteUrl: 'https://jjakkung.moilga.com',

  // 설치 파일을 올리는 "공개" GitHub 레포. 비공개면 사이트는 "준비 중"을 보여요 (site/README.md 참고).
  // The PUBLIC GitHub repo whose releases hold the installers. If it is private the site shows "coming soon".
  releases: { owner: 'milcho0604', repo: 'jjakkung' },

  // 설치 파일 고르기 (릴리스 파일 이름 끝을 정규식으로). electron-builder.yml 의 artifactName
  // `<이름>-${version}-${os}-${arch}.${ext}` 기준이라 앱 이름이 바뀌어도 그대로 맞아요.
  assets: {
    macArm: '-mac-arm64\\.dmg$',
    macIntel: '-mac-x64\\.dmg$',
    win: '-win-x64\\.exe$',
    linuxAppImage: '\\.AppImage$',
    linuxTar: '-linux-x64\\.tar\\.gz$',
  },

  // 설치 안내에 보이는 파일, 앱 이름 (electron-builder.yml 의 artifactName 앞부분과 productName)
  filePrefix: 'jjakkung',
  appBundleName: 'Jjakkung',

  // 연락처 (자리표시). 진짜 주소로 바꿔요.
  contactEmail: 'hello@example.com',

  // 변경 이력 링크. 비워 두면 릴리스 페이지로 가요.
  changelogUrl: '',

  // 라이선스
  license: 'MIT',
  copyright: '© 2026 milcho0604',

  // 공유 카드에 보일 트위터(X) 계정. 없으면 비워 둬요.
  twitter: '',
};
