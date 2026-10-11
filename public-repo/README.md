# 페어리 (fairy)

화면 위를 돌아다니는 작은 페어리가 할 일, 일정, 메모를 같이 챙겨 주는 데스크톱 비서예요.
쓰다듬고 밥도 주면서, 궁금한 건 페어리를 통해 내가 쓰는 AI 에게 물어볼 수 있어요. **[fairy.moilga.com](https://fairy.moilga.com)**

이 레포는 페어리 **설치 파일을 나눠 주고 버그 제보를 받는 곳**이에요. 앱 소스 코드는 여기에 없어요.

[English below](#english)

## 받기

[**Releases**](https://github.com/milcho0604/fairy-releases/releases/latest) 에서 내 컴퓨터에 맞는 파일 하나만 받으면 돼요.

| 컴퓨터 | 받을 파일 |
| --- | --- |
| 맥, 애플 실리콘(M1 이후) | `fairy-<버전>-mac-arm64.dmg` |
| 맥, 인텔 | `fairy-<버전>-mac-x64.dmg` |
| 윈도우 10 이상 (64비트) | `fairy-<버전>-win-x64.exe` |
| 리눅스 x64 (시험판) | `fairy-<버전>-linux-x64.tar.xz` 또는 `fairy-<버전>-linux-x86_64.AppImage` |

`.zip`, `.blockmap`, `latest*.yml` 은 앱이 스스로 업데이트할 때 쓰는 파일이라 따로 받지 않아도 돼요.

- **맥**: dmg 를 열고 fairy 를 응용 프로그램 폴더로 끌어 넣은 뒤 열어요. 아직 애플 개발자 서명 전이라 처음 한 번은 막혀요. 시스템 설정 → 개인정보 보호 및 보안 → 아래쪽 **그래도 열기** 를 누르면 다음부터는 그냥 열려요. 내 맥이 어느 쪽인지 모르겠다면 사과 메뉴 → 이 Mac에 관하여에서 "칩"이 Apple M 으로 시작하면 애플 실리콘이에요.
- **윈도우**: exe 를 실행해요. 파란 "Windows의 PC 보호" 창이 뜨면 **추가 정보** → **실행** 을 눌러요. 관리자 권한 없이 설치돼요.
- **리눅스**: tar.xz 는 풀어서 안의 `fairy` 를 실행하고, AppImage 는 실행 권한을 준 뒤 실행해요. 배포판에 따라 AppImage 에 `libfuse2` 가 필요해요.

  ```bash
  tar xJf fairy-<버전>-linux-x64.tar.xz && ./fairy-<버전>-linux-x64/fairy
  # 또는
  chmod +x fairy-<버전>-linux-x86_64.AppImage && ./fairy-<버전>-linux-x86_64.AppImage
  ```

새 버전이 나오면 맥과 윈도우는 페어리가 미리 받아 두고 "다시 켜서 업데이트"를 띄워요. 누를 때만 설치해요. 리눅스는 이 릴리스 페이지를 열어 줘요.

### 받은 파일 확인하기

릴리스마다 `SHA256SUMS.txt` 가 같이 올라가요. 받은 파일과 같은 폴더에 두고 견줘 보세요. 값이 같으면 올린 그대로예요.

```bash
# 리눅스
sha256sum -c SHA256SUMS.txt --ignore-missing
# 맥 (나온 값을 SHA256SUMS.txt 의 같은 파일 줄과 견줘요)
shasum -a 256 fairy-<버전>-mac-arm64.dmg
```

```powershell
# 윈도우 PowerShell (나온 값을 SHA256SUMS.txt 의 같은 파일 줄과 견줘요)
Get-FileHash .\fairy-<버전>-win-x64.exe
```

## 버그 알리기, 바라는 점

[**Issues**](https://github.com/milcho0604/fairy-releases/issues/new/choose) 에 남겨 주세요. 페어리 안에서 메뉴 막대(윈도우는 작업 표시줄) 아이콘 → **의견 보내기** 를 눌러도 여기로 와요.
설정 → 정보 → 내 기록의 **기록 복사** 를 같이 붙여 주면 원인을 찾기 쉬워요. 복사한 글에는 날짜와 숫자만 들어 있어요.

## 보안 문제

보안 문제는 공개 이슈 말고 이 레포의 **Security → Report a vulnerability**(비공개 알림)로 알려 주세요. 자세한 건 [SECURITY.md](SECURITY.md) 에 있어요.

## 이 레포에 있는 것

- **Releases**: 설치 파일, 자동 업데이트 파일, `SHA256SUMS.txt`
- `gallery/`: 앱의 페어리 갤러리 (공식 페어리만)
- `catalog/`: 앱이 읽는 AI 모델 목록

이 파일들은 소스 레포에서 자동으로 옮겨 와요. 그래서 풀 리퀘스트는 받지 않아요.

## 라이선스

페어리는 [MIT 라이선스](LICENSE)로 배포해요. 받아 쓰는 AI 모델은 각자의 라이선스를 따르고, 앱에 들어 있는 오픈소스 목록은 설정 → 정보 → 오픈소스 라이선스에서 볼 수 있어요.

---

## English

**fairy** is a desktop assistant: a tiny fairy wanders around your screen and keeps track of your to-dos, events and notes with you.
Pet it, feed it, and ask your own AI things through it. **[fairy.moilga.com](https://fairy.moilga.com)**

This repository is where fairy's **installers are published and bug reports are collected**. The app's source code is not in this repository.

### Download

Grab one file from [**Releases**](https://github.com/milcho0604/fairy-releases/releases/latest).

| Computer | File |
| --- | --- |
| Mac, Apple silicon (M1 and later) | `fairy-<version>-mac-arm64.dmg` |
| Mac, Intel | `fairy-<version>-mac-x64.dmg` |
| Windows 10+ (64-bit) | `fairy-<version>-win-x64.exe` |
| Linux x64 (experimental) | `fairy-<version>-linux-x64.tar.xz` or `fairy-<version>-linux-x86_64.AppImage` |

The `.zip`, `.blockmap` and `latest*.yml` files are for the app's auto-update; you don't need them.

- **macOS**: open the dmg and drag fairy into Applications. Builds are not signed by Apple yet, so the first launch is blocked once: open System Settings → Privacy & Security and click **Open Anyway**.
- **Windows**: run the exe. If the blue "Windows protected your PC" dialog appears, click **More info** → **Run anyway**. No admin rights needed.
- **Linux**: extract the tar.xz and run `fairy` inside, or `chmod +x` the AppImage and run it (some distros need `libfuse2`).

On macOS and Windows, fairy downloads new versions in the background and installs only when you click "Restart to update". On Linux it opens this Releases page.

### Verify your download

Every release includes `SHA256SUMS.txt`. Put it next to the downloaded file and run `sha256sum -c SHA256SUMS.txt --ignore-missing` (Linux), or `shasum -a 256 <file>` (macOS) / `Get-FileHash <file>` (Windows PowerShell) and compare the value with the matching line.

### Bugs and ideas

Please open an [**issue**](https://github.com/milcho0604/fairy-releases/issues/new/choose). In the app, the menu bar / tray icon → **Send feedback** brings you here too. Attaching Settings → About → My stats → **Copy stats** helps; it contains only dates and numbers.

### Security

Please report vulnerabilities privately via **Security → Report a vulnerability** on this repository, not as a public issue. See [SECURITY.md](SECURITY.md).

### License

fairy is distributed under the [MIT License](LICENSE). Downloaded AI models follow their own licenses; bundled open-source notices are in Settings → About → Open source licenses.
