# 페어리 갤러리

앱의 **설정 → 페어리 → 페어리 갤러리**가 이 폴더의 `index.json` 을 받아 보여 줘요. 여기에는 **레포 주인이 고른 공식 페어리만** 있어요. 지금은 페어리 앱이 직접 만든 그림 친구 밀크, 초코예요 (만든 사람 "페어리", CC BY 4.0).

- `pets/<id>.jjpet`: 페어리 파일 ([형식](../docs/pet-format.md))
- `thumbs/<id>.png`, `index.json`: `node scripts/gallery-index.mjs` 가 만든다. 손으로 고치지 않아요. 넣은 뒤 `node scripts/gallery-validate.mjs` 로 검사해요

다른 사람의 페어리는 받지 않아요 (풀 리퀘스트로 페어리를 올리는 길은 없어요). 페어리를 나누고 싶으면 앱의 **페어리 파일로 내보내기 (친구에게 보내기)**로 `.fairy` 파일을 만들어 친구에게 직접 보내 주세요.

Official fairies only, curated by the repository owner. Fairy submissions are not accepted; share your fairies by sending `.fairy` files to friends directly.
