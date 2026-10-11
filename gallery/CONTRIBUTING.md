# 펫 갤러리에 올리기

내가 만든 펫을 짝꿍 펫 갤러리에 올리면 다른 사람이 앱의 **설정 → 펫 → 펫 갤러리**에서 보고 데려갈 수 있어요. 서버 없이 이 레포의 `gallery/` 폴더가 갤러리라서, 올리기는 GitHub 풀 리퀘스트(PR)로 해요.

> English: see [Submitting a pet](#submitting-a-pet-english) below.

## 약속 (꼭 읽어 주세요)

- **직접 만든 펫만** 올려요. 내 반려동물 사진으로 만든 펫, 내가 그린 그림, 짝꿍 펫 만들기로 만든 펫은 좋아요.
- **남의 캐릭터는 안 돼요.** 만화, 애니메이션, 게임, 영화, 브랜드 마스코트, 다른 사람 작품의 캐릭터나 그것을 닮게 만든 펫은 받지 않아요. 허락을 받았다고 해도 마찬가지예요 (확인할 길이 없어요).
- **실제 사람 얼굴**이나 다른 사람의 반려동물 사진은 그 사람의 허락 없이 쓰지 않아요.
- 폭력적이거나 성적인 그림, 누군가를 놀리거나 미워하는 그림은 안 돼요.
- 만든 사람 이름(`author`)은 모두에게 보여요. 실명 대신 별명을 써도 돼요. 이메일이나 연락처는 넣지 마세요.
- 고른 사용 허락으로 누구나 펫을 쓸 수 있어요. 기본 CC BY 4.0 은 "만든 사람 이름만 밝히면 누구나 쓰고 고칠 수 있다" 는 뜻이에요.

관리자는 약속에 맞지 않는 펫을 언제든 내릴 수 있어요. 내 펫을 내리고 싶으면 이슈를 열어 주세요.

## 올리는 순서

1. 짝꿍에서 **설정 → 펫 → 펫 갤러리 → 갤러리에 올리기**를 열어요.
2. 만든 사람 이름과 사용 허락을 고르고 **파일 만들고 올리는 방법 보기**를 눌러 `.jjpet` 파일을 저장해요. (그림이 있는 펫만 올릴 수 있어요.)
3. 이 레포를 포크하고, 파일 이름을 영어 소문자, 숫자, `-` 로 바꿔 `gallery/pets/` 에 넣어요. 예: `gallery/pets/kkamang-cat.jjpet`. 이 이름이 갤러리 id 가 돼요.
4. Node 22.18 이상에서 목록을 다시 만들어요.

   ```bash
   node scripts/gallery-index.mjs
   node scripts/gallery-validate.mjs
   ```

   `gallery/index.json` 과 `gallery/thumbs/<id>.png` 가 바뀌어요. 이것도 같이 올려요.
5. PR 을 열어요. PR 본문에 "직접 만든 펫이고 남의 캐릭터가 아니에요" 라고 한 줄 적어 주세요. CI(`gallery`)가 형식, 크기, sha256 을 검사하고, 사람이 그림을 보고 합쳐요.

## 검사하는 것

- `gallery/` 에는 `index.json`, `README.md`, `CONTRIBUTING.md`, `pets/*.jjpet`, `thumbs/*.png` 만 있어요.
- 펫 파일은 [판 2 형식](../docs/pet-format.md)이고 16MB 아래예요. 만든 사람, 사용 허락, 본 그림, 작은 그림이 꼭 있어요.
- 앱이 조용히 버리는 것(모르는 칸, 깨진 포즈, 깨진 설계도)도 없어야 해요.
- 같은 이름의 펫은 하나만.
- `index.json` 과 작은 그림이 펫 파일에서 다시 만든 것과 같아요 (sha256, 크기).

## Submitting a pet (English)

- **Only pets you made yourself.** No characters from comics, anime, games, films, brands or anyone else's work, and nothing made to look like them, even with permission. No real people's faces or other people's pets without their consent. Nothing violent, sexual or hateful.
- `author` is public; use a nickname if you like and never add contact details. The license you pick (default CC BY 4.0) applies to everyone.
- Steps: in the app open **Settings → Pet → Pet gallery → Share to the gallery**, pick your name and license and save the `.jjpet` file. Fork this repo, put the file at `gallery/pets/<id>.jjpet` (`id` = lowercase letters, digits and `-`), run `node scripts/gallery-index.mjs` and `node scripts/gallery-validate.mjs` (Node 22.18+), commit the updated `index.json` and `thumbs/`, and open a pull request stating that the pet is your own original work.
- CI checks the format (version 2), size (16 MiB), required fields (author, license, main image, PNG thumbnail), unknown fields, sha256 and that the index is up to date. A maintainer reviews the picture before merging and may remove any pet that breaks these rules.
