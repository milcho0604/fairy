# 페어리 파일 형식 (.fairy) 과 페어리 갤러리

페어리는 `.fairy` 파일 하나로 주고받아요. 예전 이름(짝꿍) 때 확장자 `.jjpet` 도 안이 똑같아서 그대로 열려요 (새로 내보내면 `.fairy`). 이 문서는 파일 안이 어떻게 생겼는지, 앱이 어떻게 검사하는지, 그리고 서버 없이 GitHub 로 운영하는 **공식 페어리 갤러리**가 어떻게 돌아가는지 적어요.

- JSON 스키마: [schema/jjpet-v2.schema.json](schema/jjpet-v2.schema.json), 갤러리 목록: [schema/gallery-index.schema.json](schema/gallery-index.schema.json)
- 기준 구현: `src/shared/pet-share.ts` (읽기, 쓰기, 검사), `src/shared/gallery.ts` (갤러리 목록, 공식 페어리 검사)
- 페어리 주고받기: 설정 → 페어리 → 페어리 갤러리 → **페어리 파일로 내보내기 (친구에게 보내기)**, 또는 설정 → 데이터 → 페어리 내보내기. 받은 사람은 **페어리 가져오기**나 친구 페어리 칸의 ".fairy 파일로 초대하기"로 넣어요.

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
    "author": "페어리",
    "license": "CC-BY-4.0",
    "created": "2026-10-10",
    "appVersion": "0.1.0",
    "age": "adult"
  },
  "images": {
    "main": "data:image/png;base64,...",
    "poses": { "happy": "data:image/png;base64,..." },
    "thumbnail": "data:image/png;base64,...",
    "sprites": { "idle": "data:image/png;base64,...", "walk-0": "data:image/png;base64,..." }
  },
  "blueprint": { "parts": [], "face": {} },
  "depth": "data:image/png;base64,..."
}
```

`format` 값 `"jjakkung-pet"` 은 앱 이름이 페어리로 바뀐 뒤에도 그대로 둔다 (파일 종류 표시라 바꾸면 예전 앱과 서로 못 읽는다). 확장자만 `.fairy` 로 바뀌었다.

### manifest (이름표)

| 칸 | 꼭? | 내용 |
| --- | --- | --- |
| `name` | 꼭 | 페어리 이름. 앞뒤 빈칸을 빼고 1~12자 |
| `species` | 꼭 | `kong`, `cat`, `chick`, `dog`, `bunny`. 그림이 없을 때 쓰는 기본 몸, 메뉴 막대 달리기 모양. 모르는 값은 `kong` |
| `author` | 선택 | 만든 사람이 보이고 싶은 이름 (40자까지). 제어 문자와 글 방향을 바꾸는 문자는 뺀다. **갤러리에서는 꼭** |
| `license` | 꼭 | `CC-BY-4.0`(기본), `CC-BY-SA-4.0`, `CC-BY-NC-4.0`, `CC0-1.0` 가운데 하나 |
| `created` | 꼭 | 만든 날. ISO 8601 날짜(`2026-10-10`)나 UTC 시각(`2026-10-10T09:00:00.000Z`), 2020년부터 |
| `appVersion` | 꼭 | 만든 앱 판 (`1.2.3`, `1.2.3-beta.1`) |
| `age` | 선택 | AI 일러스트 나이 단계 `baby`, `teen`, `adult` (아기, 청소년은 작게 보인다). 본 그림이 있을 때만 |
| `personalOnly` | 선택 | `true` 면 다른 사람의 캐릭터를 닮게 말로 만든 개인 용도 페어리. 앱은 그대로 읽고 다시 내보낼 때도 남긴다. **갤러리는 받지 않는다** |

판 2 는 이름표를 엄격하게 봐요. `license`, `created`, `appVersion` 이 틀리거나 `author` 가 비었으면 파일을 받지 않아요. 갤러리에서 누가 무엇을 허락했는지가 중요해서예요.

### images (그림 묶음)

| 칸 | 내용 | 상한 |
| --- | --- | --- |
| `main` | 페어리 그림. 없으면 `species` 의 기본 페어리 | PNG, GIF, WebP data URL. 파일 8MB, 한 변 4096px, 1600만 화소 |
| `poses` | `happy`, `sleepy`, `hungry` 기분 그림. `main` 이 있을 때만 쓴다 | 그림마다 위와 같음 |
| `thumbnail` | 갤러리 목록의 작은 그림. 앱이 내보낼 때 긴 쪽 256px 로 만든다 | PNG 만, 긴 쪽 512px, 256KB |
| `sprites` | 2D 그림 세트 (선택, 아래). `main` 이 있을 때만 쓴다 | PNG 만, 한 장 512KB, 한 변 1024px, 합 4MB |

모든 그림은 data URL 의 형식(`image/png` 등)과 실제 파일 머리말(PNG 서명, `GIF8`, `RIFF....WEBP`)이 맞아야 하고, 머리말의 가로세로가 터무니없으면(작은 파일인데 풀면 몇 GB) 받지 않아요. `main` 이 깨졌으면 파일을 받지 않고, 깨진 포즈는 그 포즈만 버려요.

### sprites (2D 그림 세트, 선택)

가져온 페어리도 기본 페어리처럼 자세마다 그림을 바꿔 그리게 하는 칸이에요 (2026-10-13). 이름은 기본 페어리 손그림과 같아요.

| 이름 | 언제 |
| --- | --- |
| `idle` | **꼭**. 서 있기. 없으면 세트 전체를 버린다 |
| `blink`, `look-l`, `look-r` | 서 있을 때 깜빡임, 커서 쪽(왼쪽, 오른쪽) 보기 |
| `sit`, `sleep`, `doze`, `yawn` | 앉기, 자기, 졸기, 하품 |
| `happy`, `hungry`, `grab`, `wave` | 신남(춤, 기지개도), 배고픔, 들림, 손 흔들기 |
| `sulky`, `back` | 삐짐, 많이 토라짐(등 돌림, 집 문으로 들어가기) |
| `talk-0`, `talk-1` | 말하기 (두 장을 번갈아) |
| `walk-0` ~ `walk-5` | 걷기 한 주기 (오른쪽으로 가는 모습. 왼쪽으로 갈 때는 뒤집는다) |

- **PNG 만** 받아요. SVG 는 받지 않아요: 글로 된 그림이라 밖 주소나 글꼴, 아주 무거운 필터를 품을 수 있고, 머리말로 크기를 미리 잴 수 없어서예요. 움직이는 PNG(APNG), GIF, WebP 도 받지 않아요 (한 장이 한 자세).
- 한 장 512KB, 한 변 1024px, 모든 장이 `idle` 과 같은 크기. 세트 합 4MB.
- 틀린 장은 그 장만 버리고, `idle` 이 틀렸거나 합이 넘으면 세트를 통째로 버려요 (그래도 `main` 과 `poses` 로 데려와요). 갤러리는 버려지는 장이 있으면 받지 않아요.
- 빠진 자세는 가까운 그림으로 채워요 (`sleep` 이 없으면 `doze`, `talk-1` 이 없으면 `talk-0`, 걷기는 있는 장 수로 한 주기, 끝은 `idle`).
- 그리는 자리는 앱이 그림의 불투명한 상자를 재서 정해요: 자세마다 상자 아래가 바닥선, 가운데는 `idle` 상자 가운데, 크기는 `idle` 키가 기본 페어리 키쯤 되게. 그래서 배경은 투명하게, 발은 그림 속 불투명한 부분의 맨 아래에 두면 돼요.
- 입체로 보기를 켜면 지금처럼 `blueprint` 로 그려요 (그림 세트는 2D 에서만).
- 옛 앱은 이 칸을 모르고 `main` 과 `poses` 로 보여요. 판 번호는 2 그대로예요: 판 번호는 옛 앱이 못 읽는 바뀜에만 올려요 (올리면 옛 앱이 "더 새 페어리" 라며 아예 받지 않는다).

### blueprint, depth (선택)

- `blueprint`: AI 가 만든 입체 피규어 설계도 (부품 + 얼굴). `src/shared/pet3d/blueprint.ts` 가 모르는 칸은 버리고 숫자는 범위 안으로 자른다. 깨졌으면 그림만 데려온다.
- `depth`: 2.5D 입체감용 회색 깊이 PNG (1MB 까지). 설계도가 없을 때만 쓴다.
- 둘 다 `main` 이 있을 때만 읽어요.

### 크기

- 파일 하나 56MB (앱 가져오기). 갤러리는 16MB. 그림 세트를 넣으며 48MB 에서 올렸어요 (그림 네 장, 깊이 그림, 작은 그림, 그림 세트를 다 꽉 채우면 49.7MB 쯤). 0.4.2 까지의 앱은 48MB 까지 읽어요.
- 앱은 파일을 열기 전에 크기부터 보고, 넘으면 읽지 않아요.

## 3. 판 1 (읽기만)

```json
{ "format": "jjakkung-pet", "version": 1, "name": "까망이", "kind": "cat",
  "image": "data:...", "poses": {}, "model": {}, "depth": "data:...", "age": "baby" }
```

판 1 은 이름표가 없어서 만든 사람, 허락, 작은 그림 없이 들어와요. 칸 검사는 판 2 와 같아요 (`kind` = `species`, `image` = `images.main`, `model` = `blueprint`). 판 번호가 앱보다 크면 "더 새 페어리에서 만든 파일" 이라고 알려 줘요. 옛 앱(판 1 만 아는 앱)은 판 2 파일을 받으면 같은 안내를 보여요.

## 4. 페어리 갤러리

서버 비용 없이 이 레포의 `gallery/` 폴더가 갤러리예요. **레포 주인이 고른 공식 페어리만** 들어 있어요 (지금은 페어리 앱이 직접 만든 그림 친구 밀크, 초코). 다른 사람이 페어리를 올리는 길은 없고, 사용자끼리는 `.fairy` 파일을 직접 주고받아요.

```
gallery/
  index.json        목록 (스크립트가 만든다, 손으로 고치지 않는다)
  pets/<id>.jjpet   페어리 파일 (판 2. 갤러리 주소를 바꾸지 않으려고 예전 확장자 그대로)
  thumbs/<id>.png   작은 그림 (페어리 파일에서 꺼낸 것)
  README.md         설명
```

- **목록 만들기** (주인이 공식 페어리를 넣은 뒤): `node scripts/gallery-index.mjs` 가 `pets/` 를 검사하고 `thumbs/` 와 `index.json` 을 다시 써요. `--check` 는 쓰지 않고 같은지만 봐요.
- **검사**: `node scripts/gallery-validate.mjs` (주인이 손으로 돌린다). 정해진 파일만 있는지, 페어리 파일마다 판 2 형식, 크기, 만든 사람, 허락, 본 그림, 작은 그림이 있는지, 앱이 조용히 버리는 것(모르는 칸, 깨진 포즈, 깨진 설계도)이 없는지, 목록의 sha256 과 크기가 파일과 같은지 봐요. 같은 검사는 `npm test` (`src/shared/gallery.test.ts`) 에서도 돌아요.
- **앱에서 보기**: 설정 → 페어리 → 페어리 갤러리. 앱은 `https://raw.githubusercontent.com/milcho0604/fairy-releases/main/gallery/` 만 받아요 (다른 호스트, 다른 길은 막고 다른 곳으로 넘기기(redirect)도 따라가지 않는다). 목록 256KB, 작은 그림 256KB, 페어리 파일은 목록에 적힌 크기(16MB 까지)를 넘으면 그 자리에서 끊어요. 받은 페어리 파일의 sha256 이 목록과 다르면 버리고, 맞으면 `.fairy` 가져오기와 같은 검사로 데려와요. 인터넷이 없거나 아직 갤러리가 열리지 않았으면(404) 그렇다고 알려 줘요. 이 레포의 `gallery/` 는 `main` 에 들어가면 `sync-public.yml` 이 공개 레포로 옮겨요 ([docs/release.md](release.md) "두 레포").
- **친구에게 보내기**: 갤러리에 올리는 길은 없어요. 설정 → 페어리 → 페어리 갤러리 → 페어리 파일로 내보내기에서 만든 사람(선택)과 사용 허락을 적어 판 2 `.fairy` 를 저장하고, 그 파일을 친구에게 직접 보내요.

개발 중에는 `JJ_GALLERY_URL=http://127.0.0.1:<포트>/` 로 내 컴퓨터에서 내려 주는 갤러리를 볼 수 있어요. 이 값은 패키지 안 된 앱(개발 실행)에서만, 그리고 `127.0.0.1`, `localhost` 의 `http` 주소만 받아요.

## 5. Codex 펫 파일 (.codex-pet.zip) 가져오기

Codex 앱의 펫 묶음(`pet.json` 과 그림 한 장)을 페어리로 데려와요 (이슈 #88). 형식은 openai/skills 의 `hatch-pet` 설명(SKILL.md, references/animation-rows.md, codex-pet-contract.md)을 읽고 따랐어요. 코드는 가져오지 않았어요.

- 받는 곳: 설정 → 데이터 → **페어리 가져오기**, 친구 페어리 칸의 가져오기(고르기 창에서 zip), 설정 창에 **끌어 놓기**, `.codex-pet.zip` 을 **두 번 눌러 열기**(명령줄 인자, 맥 열기 사건). 맥은 zip 을 "다음으로 열기" 목록에만 올리고(기본 앱은 그대로), 윈도우와 리눅스는 zip 을 연결하지 않아요 (zip 기본 앱을 빼앗아서). 구현: `src/main/codex-pet.ts`, `src/main/unzip.ts`, `src/main/codex-atlas.ts`, `src/shared/codex-pet.ts`
- 원본 설명은 폴더(`~/.codex/pets/<이름>/pet.json`, `spritesheet.webp`)만 정해요. zip 은 그 폴더를 묶은 것으로 보고, `pet.json` 은 맨 위나 폴더 하나 안에 딱 하나여야 해요. 맥이 넣는 `__MACOSX/`, `._이름`, `.DS_Store` 는 지나쳐요.
- `pet.json`: 이름은 `displayName`(없으면 `id`, 12자에서 자름), 그림은 `spritesheetPath`(같은 폴더의 `.webp` 나 `.png` 이름만, 없으면 `spritesheet.webp`), 설명 `description` 은 글자만(제어 문자와 방향 바꾸기 문자를 빼고 200자에서 자름) 바꿀지 묻는 창에만 보이고 저장하지 않아요.
- 그림: PNG 나 WebP, 꼭 1536x1872 (한 칸 192x208, 가로 8칸 세로 9줄). 머리말 크기가 다르면 풀지 않아요. Electron `nativeImage` 가 WebP 를 풀지 못해서, 보이지 않는 창(샌드박스, Node 없음, 빈 페이지)의 Chromium 으로 풀고 칸을 잘라요. 새 의존성은 없어요.
- 빈 칸: 칸 안 알파가 모두 8 아래면 빈 칸으로 보고 버려요. 줄마다 쓰는 장 수 밖의 칸은 보지 않아요.
- 자른 칸은 PNG 로 다시 만들어 `images.sprites` 와 같은 검사를 거쳐요 (PNG, 한 장 512KB, 모두 `idle` 과 같은 크기, 합 4MB). 본 그림(`main`)은 `idle` 이에요.
- 늘 **개인 용도**(`personalOnly`)로 데려와요: 남이 만든 그림일 수 있어서요. 다시 `.fairy` 로 내보내도 이름표에 남고 갤러리는 받지 않아요. 설계도가 없는 펫이라 표시는 그림 파일 이름으로 기억해요 (`petPersonal`, `isPersonalPet`).

### 상한

| 무엇 | 상한 | 넘으면 |
| --- | --- | --- |
| zip 파일 | 16MB | "너무 커" |
| 항목 수 | 64 | "너무 커" |
| 한 항목 풀었을 때 | 16MB (목록에 적힌 크기 + 1 바이트에서 풀기를 끊는다) | "너무 커" |
| 모든 항목 풀었을 때 합 | 32MB | "너무 커" |
| 경로 | `..`, `.`, 절대 경로, 드라이브, 역슬래시, 널이 하나라도 있으면 | 통째로 "이상한 경로" |
| 형식 | 저장, deflate 만. 암호, ZIP64 는 받지 않고 CRC 와 크기를 맞춰 본다 | "zip 으로 읽을 수 없어" |
| pet.json | 64KB, 깨졌거나 둘이거나 이름이 없으면 | "pet.json 이 없거나 깨졌어" |
| 그림 | 1536x1872 PNG, WebP 가 아니면 | "Codex 펫 그림이 아니야" |
| 서기 | `idle` 줄에 그림이 하나도 없으면 | "서 있는 그림이 비어 있어" |

### 줄을 자세로 나누기

Codex 줄 순서와 줄마다 쓰는 장 수는 원본 그대로예요. "가운데 장" 은 그 줄에서 그림이 있는 장들 가운데(`floor(n/2)`).

| 줄 | Codex 상태 | 쓰는 장 | 페어리 자세 |
| --- | --- | --- | --- |
| 0 | idle | 6 | `idle` = 첫 장, `blink` = 셋째 장 (짧게 지나가는 장, 장이 적으면 마지막) |
| 1 | running-right | 8 | `walk-0` ~ `walk-5` = 여섯 장을 고르게 (8장이면 0, 1, 2, 4, 5, 6번째). 적으면 있는 만큼, 앱이 한 주기로 돈다 |
| 2 | running-left | 8 | 쓰지 않음 (왼쪽 걷기는 오른쪽을 뒤집는다) |
| 3 | waving | 4 | `wave` = 가운데 장 (손을 든 장) |
| 4 | jumping | 5 | `happy` = 가운데 장 (꼭대기) |
| 5 | failed | 8 | `sulky` = 가운데 장 |
| 6 | waiting | 6 | `hungry` = 가운데 장 (조르는 모습이 가장 가깝다) |
| 7 | running | 6 | 쓰지 않음 (일하는 중 상태라 맞는 자세가 없다) |
| 8 | review | 6 | `talk-0` = 첫 장, `talk-1` = 가운데 장 |

나머지(`sit`, `sleep`, `doze`, `yawn`, `grab`, `back`, `look-l`, `look-r`)는 Codex 에 없어서 그리는 쪽이 가까운 그림으로 채워요 (위 sprites 설명, 끝은 `idle`).

시험용 파일은 `node scripts/dev/codex-pet-fixture.mjs <나갈.codex-pet.zip> [--webp] [--rows 0,3]` 로 도형만 그려 만들어요 (남의 펫을 쓰지 않는다).

## English summary

- A `.fairy` file (formerly `.jjpet`, same contents; both are read) is a single UTF-8 JSON document (not a zip), at most 56 MiB (16 MiB in the gallery; apps up to 0.4.2 read up to 48 MiB). Version 2 is what the app writes; version 1 files are still read.
- Version 2 layout: `{ format: "jjakkung-pet", version: 2, manifest, images, blueprint?, depth? }`. The `format` value keeps the old app name on purpose so old and new apps can read each other's files.
  - `manifest`: `name` (1-12 letters), `species` (`kong|cat|chick|dog|bunny`), optional `author` (display name, max 40 chars, control and bidi characters stripped; required in the gallery), `license` (`CC-BY-4.0` default, `CC-BY-SA-4.0`, `CC-BY-NC-4.0`, `CC0-1.0`), `created` (ISO 8601 date or UTC date-time), `appVersion` (semver), optional `age` (`baby|teen|adult`), optional `personalOnly: true` (a personal-use fairy made to look like someone else's character; the gallery rejects it).
  - `images`: optional `main` and `poses.{happy,sleepy,hungry}` (PNG/GIF/WebP data URLs, decoded at most 8 MiB, 4096 px per side and 16 megapixels, magic bytes must match), optional `thumbnail` (PNG, longest side at most 512 px, at most 256 KiB).
  - `images.sprites` (optional): a 2D sprite set keyed by the built-in fairy pose names (`idle` required; `blink`, `look-l`, `look-r`, `sit`, `sleep`, `doze`, `yawn`, `happy`, `hungry`, `grab`, `wave`, `sulky`, `back`, `talk-0`, `talk-1`, `walk-0`..`walk-5`). PNG only (SVG is refused because it is text that can reference outside URLs and fonts and cannot be size-checked from its header; animated PNG, GIF and WebP are refused too), each at most 512 KiB and 1024 px per side, all the same size as `idle`, at most 4 MiB in total. Broken sprites are dropped one by one; a set without a valid `idle` or over the total is dropped whole. Missing poses fall back to a close one, then `idle`. The app measures each sprite's opaque box to place it (bottom edge on the ground line). Used in 2D only; old apps ignore it and show `main` and `poses`. The version stays 2 because this is an additive optional field.
  - `blueprint` (3D figure) and `depth` (grayscale relief PNG, at most 1 MiB) are optional and only read when `images.main` exists.
- Validation is strict: a broken manifest or main image rejects the file; broken poses or blueprints are dropped by the app but rejected by the gallery check.
- Version 1 is the flat layout `{ format, version: 1, name, kind, image, poses, model, depth, age }` without manifest or thumbnail.
- The gallery is the `gallery/` folder of this repository and holds **official fairies only**, curated by the repository owner (currently Milk and Choco). There is no community submission flow. The owner adds `gallery/pets/<id>.jjpet`, runs `node scripts/gallery-index.mjs` to regenerate `index.json` and `thumbs/`, and `node scripts/gallery-validate.mjs` to check format, sizes and sha256.
- People share fairies peer to peer by sending `.fairy` files: Settings → Fairy → Fairy gallery → **Export as a fairy file (send to a friend)** writes a version 2 file with an optional author name and a license; the friend imports it with the normal `.fairy` import.
- The app fetches only from `https://raw.githubusercontent.com/milcho0604/fairy-releases/main/gallery/` with size caps, timeouts, no redirects, and sha256 verification, then imports through the same validator as a local `.fairy` file.
- Codex pet files (`.codex-pet.zip`: `pet.json` + a 1536x1872 PNG or WebP sheet of 8x9 cells of 192x208, per openai/skills `hatch-pet`) are imported too: unzipped in memory with entry, size and path limits, decoded in a hidden sandboxed window, empty cells dropped, rows mapped to the `images.sprites` poses (table in section 5), always marked `personalOnly`.
