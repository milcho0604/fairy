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
  // 제품 이름. 영어는 브랜드라 늘 소문자 fairy, 한국어는 페어리.
  // Product name per language. The English brand is always lowercase.
  name: { ko: '페어리', en: 'fairy' },

  // 소개 한 줄 (제목 옆, 검색 결과, 공유 카드)
  tagline: {
    ko: '화면 위를 걸어 다니는 작은 페어리가 할 일, 일정, 메모를 같이 챙겨 주는 데스크톱 비서',
    en: 'a tiny fairy that walks along your screen and keeps your to-dos, calendar and notes',
  },

  // 사이트 주소 (끝에 / 없이). canonical, 공유 카드, sitemap 에 들어가요.
  siteUrl: 'https://fairy.moilga.com',

  // 설치 파일을 올리는 "공개" GitHub 레포. 비공개면 사이트는 "준비 중"을 보여요 (site/README.md 참고).
  // The PUBLIC GitHub repo whose releases hold the installers. If it is private the site shows "coming soon".
  releases: { owner: 'milcho0604', repo: 'fairy-releases' },

  // 설치 파일 고르기 (릴리스 파일 이름 끝을 정규식으로). electron-builder.yml 의 artifactName
  // `<이름>-${version}-${os}-${arch}.${ext}` 기준이라 앱 이름이 바뀌어도 그대로 맞아요.
  assets: {
    macArm: '-mac-arm64\\.dmg$',
    macIntel: '-mac-x64\\.dmg$',
    win: '-win-x64\\.exe$',
    linuxAppImage: '\\.AppImage$',
    linuxTar: '-linux-x64\\.tar\\.xz$',
  },

  // 설치 안내에 보이는 파일, 앱 이름 (electron-builder.yml 의 artifactName 앞부분과 productName)
  filePrefix: 'fairy',
  appBundleName: 'fairy',

  // 페어리를 친구에게 보내는 파일의 확장자 (앱이 .fairy 로 내보낸다. 예전 .jjpet 도 열린다)
  petFileExt: '.fairy',

  // 연락처 (자리표시). 진짜 주소로 바꿔요.
  contactEmail: '', // 비우면 문의는 GitHub 이슈로 간다

  // 변경 이력 링크. 비워 두면 릴리스 페이지로 가요.
  changelogUrl: '',

  // 라이선스
  license: 'MIT',
  copyright: '© 2026 milcho0604',

  // 공유 카드에 보일 트위터(X) 계정. 없으면 비워 둬요.
  twitter: '',
};
