# PR #37 맥 설치 안내 (홈페이지, 960폭 데스크톱, 2배로 찍음)

site/ 를 로컬 정적 서버로 띄워 Electron(Chromium) 숨은 창에서 요소 단위로 찍었다. 전 = origin/main(33e6abd) 의 site/, 후 = feat/mac-install-guide(09d126f) 의 site/. dmg 창은 리눅스에서 열 수 없어 빼고 설정 좌표로 그린 그림만 넣었다.

- 01-before-ko-faq-mac-open.png: [전] ko, 첫 화면 FAQ "맥에서 악성 코드가 없음을…" 답 펼친 상태
- 02-after-ko-faq-mac-open.png: [후] ko, 같은 답. "손상되었기 때문에 열 수 없습니다" 창이 뜰 때(취소 뒤 명령), 새 버전을 직접 받아 다시 깔면 한 번 더 뜬다는 두 문단이 더해짐
- 03-before-ko-download-mac-steps.png: [전] ko, 받기 페이지 "맥에 설치하기" 칸
- 04-after-ko-download-mac-steps.png: [후] ko, 같은 칸. 마지막 안내가 "그래도 안 열리거나 손상… 창이 뜨면 휴지통으로 옮기지 말고…" 로 바뀜
- 05-before-en-faq-mac-open.png: [전] en, FAQ 맥 답 펼친 상태
- 06-after-en-faq-mac-open.png: [후] en, "is damaged" 문단과 다시 설치 문단이 더해짐
- 07-before-en-download-mac-steps.png: [전] en, 받기 페이지 Install on Mac
- 08-after-en-download-mac-steps.png: [후] en, "Still won't open, or it says the app is damaged? Don't move it to the Trash…"
- 09-dmg-layout-sketch.png: [전/후] electron-builder.yml dmg 설정을 그린 그림 (실제 dmg 화면 아님). 창 높이 380 → 440, 아래 가운데 (270, 340) 에 "열리지 않으면 여기 (If it won't open).webloc"

못 찍은 것: 받기 단추를 누른 뒤 FAQ 가 저절로 펼쳐지고 스크롤되는 동작(app.js)은 GitHub 릴리스 목록을 받아야(REL.state ok) 움직여서 이 환경(외부 접속 막힘)에서는 재현하지 않았다. 실제 dmg 창도 맥이 없어 못 찍었다.
