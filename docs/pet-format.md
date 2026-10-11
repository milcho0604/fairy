# 펫 파일 형식 (.jjpet) 과 펫 갤러리

짝꿍 펫은 `.jjpet` 파일 하나로 주고받아요. 이 문서는 파일 안이 어떻게 생겼는지, 앱이 어떻게 검사하는지, 그리고 서버 없이 GitHub 로 운영하는 **펫 갤러리**에 펫을 올리는 방법을 적어요.

- JSON 스키마: [schema/jjpet-v2.schema.json](schema/jjpet-v2.schema.json), 갤러리 목록: [schema/gallery-index.schema.json](schema/gallery-index.schema.json)
- 기준 구현: `src/shared/pet-share.ts` (읽기, 쓰기, 검사), `src/shared/gallery.ts` (갤러리 목록, 올리기 검사)
- 올리는 법과 약속: [gallery/CONTRIBUTING.md](../gallery/CONTRIBUTING.md)

> English summary is at the [end of this page](#english-summary).

## 1. 한눈에

| | 판 1 (옛 앱) | 판 2 (지금) |
| --- | --- | --- |
| 모양 | JSON 한 덩어리, 칸이 평평함 | JSON, `manifest`(이름표) + `images`(그림 묶음) |
| 이름표 | 이름, 종류만 | 이름, 종류, 만든 사람(선택), 사용 허락, 만든 날, 앱 판 |
| 작은 그림 | 없음 | 있음 (갤러리 목록에 보임) |
| 앱이 쓰기 | 안 씀 | 늘 판 2 |
| 앱이 읽기 | 읽음 | 읽음 |

판 2 는 zip 이 아니라 **UTF-8 JSON 한 파일**이에요. 판 1 과 같은 읽기 길(크기를 먼저 보고, 통째로 JSON 으로 읽고, 칸마다 검사)을 그대로 쓰고, 압축 풀기 폭탄 같은 걱정이 없어서예요. 그림은 base64 data URL 로 넣어요.

## 2. 판 2 모양

```json
{
  "format": "jjakkung-pet",
  "version": 2,
  "manifest": {
    "name": "밀크",
    "species": "cat",
    "author": "짝꿍",
    "license": "CC-BY-4.0",
    "created": "2026-10-10",
    "appVersion": "0.1.0",
    "age": "adult"
  },
  "images": {
    "main": "data:image/png;base64,...",
    "poses": { "happy": "data:image/png;base64,..." },
    "thumbnail": "data:image/png;base64,..."
  },
  "blueprint": { "parts": [], "face": {} },
  "depth": "data:image/png;base64,..."
}
```

### manifest (이름표)

| 칸 | 꼭? | 내용 |
| --- | --- | --- |
| `name` | 꼭 | 펫 이름. 앞뒤 빈칸을 빼고 1~12자 |
| `species` | 꼭 | `kong`, `cat`, `chick`, `dog`, `bunny`. 그림이 없을 때 쓰는 기본 몸, 메뉴 막대 달리기 모양. 모르는 값은 `kong` |
| `author` | 선택 | 만든 사람이 보이고 싶은 이름 (40자까지). 제어 문자와 글 방향을 바꾸는 문자는 뺀다. **갤러리에서는 꼭** |
| `license` | 꼭 | `CC-BY-4.0`(기본), `CC-BY-SA-4.0`, `CC-BY-NC-4.0`, `CC0-1.0` 가운데 하나 |
| `created` | 꼭 | 만든 날. ISO 8601 날짜(`2026-10-10`)나 UTC 시각(`2026-10-10T09:00:00.000Z`), 2020년부터 |
| `appVersion` | 꼭 | 만든 앱 판 (`1.2.3`, `1.2.3-beta.1`) |
| `age` | 선택 | AI 일러스트 나이 단계 `baby`, `teen`, `adult` (아기, 청소년은 작게 보인다). 본 그림이 있을 때만 |

판 2 는 이름표를 엄격하게 봐요. `license`, `created`, `appVersion` 이 틀리거나 `author` 가 비었으면 파일을 받지 않아요. 갤러리에서 누가 무엇을 허락했는지가 중요해서예요.

### images (그림 묶음)

| 칸 | 내용 | 상한 |
| --- | --- | --- |
| `main` | 펫 그림. 없으면 `species` 의 기본 펫 | PNG, GIF, WebP data URL. 파일 8MB, 한 변 4096px, 1600만 화소 |
| `poses` | `happy`, `sleepy`, `hungry` 기분 그림. `main` 이 있을 때만 쓴다 | 그림마다 위와 같음 |
| `thumbnail` | 갤러리 목록의 작은 그림. 앱이 내보낼 때 긴 쪽 256px 로 만든다 | PNG 만, 긴 쪽 512px, 256KB |

모든 그림은 data URL 의 형식(`image/png` 등)과 실제 파일 머리말(PNG 서명, `GIF8`, `RIFF....WEBP`)이 맞아야 하고, 머리말의 가로세로가 터무니없으면(작은 파일인데 풀면 몇 GB) 받지 않아요. `main` 이 깨졌으면 파일을 받지 않고, 깨진 포즈는 그 포즈만 버려요.

### blueprint, depth (선택)

- `blueprint`: AI 가 만든 입체 피규어 설계도 (부품 + 얼굴). `src/shared/pet3d/blueprint.ts` 가 모르는 칸은 버리고 숫자는 범위 안으로 자른다. 깨졌으면 그림만 데려온다.
- `depth`: 2.5D 입체감용 회색 깊이 PNG (1MB 까지). 설계도가 없을 때만 쓴다.
- 둘 다 `main` 이 있을 때만 읽어요.

### 크기

- 파일 하나 48MB (앱 가져오기). 갤러리는 16MB.
- 앱은 파일을 열기 전에 크기부터 보고, 넘으면 읽지 않아요.

## 3. 판 1 (읽기만)

```json
{ "format": "jjakkung-pet", "version": 1, "name": "까망이", "kind": "cat",
  "image": "data:...", "poses": {}, "model": {}, "depth": "data:...", "age": "baby" }
```

판 1 은 이름표가 없어서 만든 사람, 허락, 작은 그림 없이 들어와요. 칸 검사는 판 2 와 같아요 (`kind` = `species`, `image` = `images.main`, `model` = `blueprint`). 판 번호가 앱보다 크면 "더 새 짝꿍에서 만든 파일" 이라고 알려 줘요. 옛 앱(판 1 만 아는 앱)은 판 2 파일을 받으면 같은 안내를 보여요.

## 4. 펫 갤러리

서버 비용 없이 이 레포의 `gallery/` 폴더가 갤러리예요.

```
gallery/
  index.json        목록 (스크립트가 만든다, 손으로 고치지 않는다)
  pets/<id>.jjpet   펫 파일 (판 2)
  thumbs/<id>.png   작은 그림 (펫 파일에서 꺼낸 것)
  CONTRIBUTING.md   올리는 법과 약속
```

- **목록 만들기**: `node scripts/gallery-index.mjs` 가 `pets/` 를 검사하고 `thumbs/` 와 `index.json` 을 다시 써요. `--check` 는 쓰지 않고 같은지만 봐요.
- **검사(CI)**: `node scripts/gallery-validate.mjs` (`.github/workflows/gallery.yml`). 정해진 파일만 있는지, 펫 파일마다 판 2 형식, 크기, 만든 사람, 허락, 본 그림, 작은 그림이 있는지, 앱이 조용히 버리는 것(모르는 칸, 깨진 포즈, 깨진 설계도)이 없는지, 목록의 sha256 과 크기가 파일과 같은지 봐요.
- **앱에서 보기**: 설정 → 펫 → 펫 갤러리. 앱은 `https://raw.githubusercontent.com/milcho0604/jjakkung/main/gallery/` 만 받아요 (다른 호스트, 다른 길은 막고 다른 곳으로 넘기기(redirect)도 따라가지 않는다). 목록 256KB, 작은 그림 256KB, 펫 파일은 목록에 적힌 크기(16MB 까지)를 넘으면 그 자리에서 끊어요. 받은 펫 파일의 sha256 이 목록과 다르면 버리고, 맞으면 `.jjpet` 가져오기와 같은 검사로 데려와요. 인터넷이 없거나 아직 갤러리가 열리지 않았으면(404) 그렇다고 알려 줘요.
- **올리기**: 설정 → 펫 → 펫 갤러리 → 갤러리에 올리기. 만든 사람 이름과 허락을 고르고 파일을 저장하면 올리는 방법 문서를 열어 줘요. 앱이 대신 올리지는 않아요.

개발 중에는 `JJ_GALLERY_URL=http://127.0.0.1:<포트>/` 로 내 컴퓨터에서 내려 주는 갤러리를 볼 수 있어요. 이 값은 패키지 안 된 앱(개발 실행)에서만, 그리고 `127.0.0.1`, `localhost` 의 `http` 주소만 받아요.

## English summary

- A `.jjpet` file is a single UTF-8 JSON document (not a zip), at most 48 MiB (16 MiB in the gallery). Version 2 is what the app writes; version 1 files are still read.
- Version 2 layout: `{ format: "jjakkung-pet", version: 2, manifest, images, blueprint?, depth? }`.
  - `manifest`: `name` (1-12 letters), `species` (`kong|cat|chick|dog|bunny`), optional `author` (display name, max 40 chars, control and bidi characters stripped; required in the gallery), `license` (`CC-BY-4.0` default, `CC-BY-SA-4.0`, `CC-BY-NC-4.0`, `CC0-1.0`), `created` (ISO 8601 date or UTC date-time), `appVersion` (semver), optional `age` (`baby|teen|adult`).
  - `images`: optional `main` and `poses.{happy,sleepy,hungry}` (PNG/GIF/WebP data URLs, decoded at most 8 MiB, 4096 px per side and 16 megapixels, magic bytes must match), optional `thumbnail` (PNG, longest side at most 512 px, at most 256 KiB).
  - `blueprint` (3D figure) and `depth` (grayscale relief PNG, at most 1 MiB) are optional and only read when `images.main` exists.
- Validation is strict: a broken manifest or main image rejects the file; broken poses or blueprints are dropped by the app but rejected by the gallery CI.
- Version 1 is the flat layout `{ format, version: 1, name, kind, image, poses, model, depth, age }` without manifest or thumbnail.
- The gallery is the `gallery/` folder of this repository: submit `gallery/pets/<id>.jjpet` by pull request, run `node scripts/gallery-index.mjs` to regenerate `index.json` and `thumbs/`, and CI (`scripts/gallery-validate.mjs`) checks format, sizes, sha256 and that the index is up to date. Only original pets are accepted; see [gallery/CONTRIBUTING.md](../gallery/CONTRIBUTING.md).
- The app fetches only from `https://raw.githubusercontent.com/milcho0604/jjakkung/main/gallery/` with size caps, timeouts, no redirects, and sha256 verification, then imports through the same validator as a local `.jjpet` file.
