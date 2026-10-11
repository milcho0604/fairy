; 윈도우 설치 파일(NSIS)에 덧붙이는 것. electron-builder 가 build/installer.nsh 를 저절로 읽는다 (electron-builder.yml nsis).
; 지울 때 데이터는 남긴다고 알린다. 지우기는 deleteAppDataOnUninstall: false 라 %APPDATA%\fairy (앱 데이터 폴더,
; productName) 를 두는데, 한 번 누르면 끝나는 설치(oneClick)는 지우기 화면이 없어 그 사실을 알릴 곳이 없었다.
; oneClick 지우기는 파일을 지운 뒤 바로 끝나서(quitSuccess) 뒤에 붙일 자리가 없다. 그래서 지우기 직전에 알린다.
; 업데이트로 옛 판을 지울 때(--updated)와 조용히 지울 때(/S)는 알리지 않는다 (/SD IDOK).
; 말은 설치 파일이 고른 언어를 따른다: 윈도우 언어가 한국어(1042)면 한국어, 아니면 영어 (nsis.installerLanguages)
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${if} $LANGUAGE == 1042
      MessageBox MB_OK|MB_ICONINFORMATION "페어리를 지울게요.$\r$\n$\r$\n할 일, 메모, 설정, 페어리는 지우지 않고 남겨 둬요. 다시 설치하면 이어서 쓸 수 있어요.$\r$\n$\r$\n모두 지우려면 지운 뒤 이 폴더도 지워 주세요:$\r$\n$APPDATA\fairy" /SD IDOK
    ${else}
      MessageBox MB_OK|MB_ICONINFORMATION "fairy will now be uninstalled.$\r$\n$\r$\nYour to-dos, notes, settings and fairies are kept, so you can pick up where you left off if you install fairy again.$\r$\n$\r$\nTo remove everything, also delete this folder afterwards:$\r$\n$APPDATA\fairy" /SD IDOK
    ${endIf}
  ${endIf}
!macroend
