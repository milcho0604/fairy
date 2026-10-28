# 배경 제거 모델 고르기 (P1-07)

사진으로 페어리를 만들 때 쓸 배경 제거 모델을 실제 사진으로 비교했다. 2026-10-02, 맥(Apple Silicon), Electron 44.5.1 렌더러에서 onnxruntime-web 1.30.0 으로 돌렸다. 앱이 쓸 방식 그대로다.

## 후보

| 모델 | 코드 라이선스 | 학습 데이터 | 크기 | 입력 | 받은 곳 |
| --- | --- | --- | --- | --- | --- |
| U²-Net 작은 판 (u2netp) | Apache 2.0 | DUTS (연구용) | 4.4MB | 320px | rembg 배포본 |
| U²-Net (u2net) | Apache 2.0 | DUTS (연구용) | 168MB | 320px | rembg 배포본 |
| IS-Net 일반 (isnet-general-use) | Apache 2.0 | DIS5K (비상업 연구, 교육용) | 170MB (앱은 fp16 판 84MB) | 1024px | rembg 배포본 (앱은 fp16 판을 HF onnx-community/ISNet-ONNX 고정 커밋에서) |
| BiRefNet 가벼운 판 (swin tiny) | MIT | DIS5K 등 | 214MB | 1024px | rembg 배포본 |

- 뺀 것: MODNet(사람 전용), silueta(원 라이선스 확인 못 함), BRIA RMBG(비상업), @imgly(AGPL). 기획서 "쓰지 않을 것" 참고
- 전처리는 rembg 소스(`sessions/u2net.py`, `dis_general_use.py`, `birefnet_general.py`, `base.py` 의 `normalize`)와 같게 했다: 크기 맞춤, 가장 밝은 값으로 나눔, 채널별 평균과 표준편차, BiRefNet 만 시그모이드 뒤 최소 최대 정규화
- 모델 파일 SHA-256: u2netp `309c8469...ddd8`, u2net `8d10d2f3...b491`, isnet `60920e99...964a`, birefnet `56000243...3333`

## 시험 사진 13장

Openverse 에서 CC0 와 퍼블릭 도메인 사진만 골랐다. 털 많은 동물, 배경과 색이 비슷한 것, 여러 마리, 사람 머리카락, 그림(캐릭터), 위장색 동물을 넣었다. 사진은 저장소에 넣지 않는다.

| 파일 | 제목 | 만든 사람 | 라이선스 | 출처 |
| --- | --- | --- | --- | --- |
| dog-5.jpg | Resting Dog, Albion Street, Rotherhithe, | barry.marsh1944 | PDM | https://www.flickr.com/photos/126409951@N04/32388930117 |
| dog-1.jpg | Dog Tired | cogdogblog | CC0 | https://www.flickr.com/photos/37996646802@N01/147360429 |
| cat-0.jpg | Cat | Burnt Pineapple Productions | CC0 | https://www.flickr.com/photos/51686021@N07/42700002412 |
| cat-1.jpg | Should I Stay or Should I go?!!! - Cat A | iezalel7williams | CC0 | https://www.flickr.com/photos/181765699@N08/51566875862 |
| person-1.jpg | Young woman portrait | sandro349 | CC0 | https://www.flickr.com/photos/186236561@N02/49618047631 |
| toy-7.jpg | Teddy Bear Isolated On White Background | personalgraphic.official | CC0 | https://www.flickr.com/photos/198895458@N04/53097229211 |
| fluffy-2.jpg | Pomeranian standing grass | - | CC0 | https://www.rawpixel.com/image/6038839/photo-image-public-domain-dog-free |
| fluffy-6.jpg | AI_generated_Pomeranian-Spitz_162 | Juhele_CZ | CC0 | https://www.flickr.com/photos/96541566@N06/55033707588 |
| hamster-0.jpg | Hamster Animals | Ricky Kharawala | CC0 | https://stocksnap.io/photo/hamster-animals-1VK4P7JPG3 |
| hamster-3.jpg | He is My Ex Hamster Now -Punstagram | emilylovescoloring | PDM | https://www.flickr.com/photos/203051018@N08/54592503215 |
| bird-3.jpg | Indian Ringneck parrot. (Psittacula kram | Bernard Spragg | PDM | https://www.flickr.com/photos/88123769@N02/53786204190 |
| figure-4.jpg | Cat Figurine | Alain Pham | CC0 | https://stocksnap.io/photo/cat-figurine-B9KJIPURCF |
| rabbit-4.jpg | Cottontail rabbit | Joshua Tree National Park | PDM | https://www.flickr.com/photos/115357548@N08/51344799850 |

## 결과

**속도** (사진 한 장, 첫 장 제외 평균. WebGPU 는 13장, wasm 은 2장)

| 모델 | WebGPU | wasm (CPU) | 불러오기 |
| --- | --- | --- | --- |
| U²-Net 작은 판 | 0.05초 | 0.87초 | 0.5초 |
| U²-Net | 0.09초 | 2.4초 | 0.3초 |
| IS-Net | 0.26초 | 6.5초 | 0.1초 |
| BiRefNet | 안 돌아감 (WebGPU 셰이더 오류) | 안 돌아감 (메모리 부족 bad_alloc) | |

**품질** (사진을 겹쳐 놓고 눈으로 판정, 자연스러우면 통과)

| 사진 | U²-Net 작은 판 | U²-Net | IS-Net |
| --- | --- | --- | --- |
| 앵무새 (그러데이션 배경) | 통과 | 통과 | 실패: 빨간 부리가 반투명 |
| 줄무늬 고양이 | 실패: 몸 절반이 흐려짐 | 통과 | 통과 |
| 흰 고양이 (검은 천) | 통과 | 통과 | 통과 |
| 검은 개 (바위) | 통과 | 통과 | 통과 |
| 골든리트리버 (보도) | 통과 | 통과 | 통과 (바닥에 옅은 얼룩) |
| 복 고양이 인형 (여러 개) | 실패: 든 앞발이 잘림 | 실패: 앞발이 잘림 | 통과 (테두리 조금 흐림) |
| 포메라니안 (잔디, 털) | 통과 | 통과 | 통과 |
| 검은 개와 흰 고양이 | 실패: 흰 고양이를 뺌 | 실패: 흰 고양이를 뺌 | 통과 |
| 햄스터 | 통과 | 통과 | 통과 |
| 만화 햄스터 (카드 배경) | 실패: 카드 배경이 남음 | 실패 | 실패 |
| 사람 (머리카락) | 통과 | 통과 | 통과 |
| 토끼 (땅과 같은 색) | 통과 | 통과 | 통과 |
| 곰 인형 (흰 배경) | 통과 | 통과 | 통과 |
| **통과** | **9 / 13 (69%)** | **10 / 13 (77%)** | **11 / 13 (85%)** |

## 고른 것

**IS-Net 일반** 을 쓴다. 1단계 완료 기준(10장 중 8장, 80%)을 넘는 것은 IS-Net 하나였다. WebGPU 로 0.26초라 목표(3초)보다 훨씬 빠르다. WebGPU 가 없는 컴퓨터는 CPU 로 6.5초가 걸려 목표를 넘는다. 페어리를 만들 때 한 번이라 "조금 걸려" 안내를 띄우고, 실패한 사진은 지우개와 복원 붓으로 다듬는다.

- 앱에 넣지 않고 처음 페어리를 만들 때 원래 배포처에서 받는다(2026-10-28 부터 fp16 판 84MB, 그 전에 받은 170MB 판은 다시 받지 않고 그대로 쓴다). 받은 뒤 SHA-256 을 맞춰 보고 사용자 데이터 폴더에 둔다
- **라이선스 위험 (진행표 D7)**: IS-Net 코드는 Apache 2.0 이지만 학습에 쓴 DIS5K 데이터 이용 약관은 "비상업 연구, 교육용, 복사나 가공 뒤에도 상업 사용 금지"다(`DIS5K-Dataset-Terms-of-Use.pdf` 2항). 학습한 가중치에도 적용되는지는 약관에 적혀 있지 않다. U²-Net 도 연구용 데이터(DUTS)로 학습했다. 지금은 비공개 개인 프로젝트이고 베타도 무료라 IS-Net 을 쓰되, 판매나 공개 배포 전에 다시 정한다(저자 문의, 상업 사용이 분명한 모델로 바꾸기, 직접 학습)
- BiRefNet(MIT)은 이 판의 onnxruntime-web 에서 돌지 않았다. 새 판이 나오면 다시 본다

## 다시 돌리는 법

평가 도구는 `scripts/bg-eval/` 에 있다. 모델 파일을 `<폴더>/models/`, 사진을 `<폴더>/photos/` 에 두고 `<폴더>/out/` 을 만든 뒤 `BG_DIR=<폴더> npx electron scripts/bg-eval` 로 돌린다. 도구 구성: 숨긴 창에서 onnxruntime-web 을 WebGPU 와 wasm 으로 각각 불러 사진마다 잘라 바둑판 위에 얹어 저장하고, 걸린 시간을 `result.json` 에 적는다.

## 그림용 모델과 다시 지우기 (2026-10-28)

사진 모델(IS-Net 일반)이 만화, 그림에서 카드 배경과 글자를 남기는 문제를 줄이려고 그림용 모델 IS-Net anime(rembg 배포본 `isnet-anime.onnx`, 176MB(176,069,933 바이트. 이 문서의 MB 는 10^6 바이트))를 비교했다. 같은 환경(맥 M4 Pro, onnxruntime-web 1.30, WebGPU)에서 앱의 배경 지우기 흐름(두 번 오리기, trimHalo, solidify)을 그대로 옮겨 돌렸다. 시험 그림 16장: 사진 10장(Flickr CC0 또는 퍼블릭 도메인 9장, Wikimedia Commons 퍼블릭 도메인 1장), 그림 6장(직접 그린 3장, Commons 퍼블릭 도메인 고서 그림 2장 "Beatrix potter peter rabbit and mr mcgregor" 와 "Raper's bountiful birds", Flickr 만화 햄스터 1장). 그림은 저장소에 넣지 않는다. 판정은 눈으로(통과, 부분, 실패).

| 그림 | 사진 모델 | 그림용 모델만 | 자동 선택(앱의 규칙) |
| --- | --- | --- | --- |
| 직접 그린 고양이(줄 공책) | 통과 | 통과 | 통과 (다시 지우기 안 함) |
| 직접 그린 곰 | 통과 | 통과 | 통과 (안 함) |
| 직접 그린 새 | 통과 | 통과 | 통과 (안 함) |
| 수채 토끼 고서 그림(옅음) | 실패(몸 9%) | 실패(빈 마스크) | 실패 (다시 지웠지만 빈 결과라 막고 처음 것 유지) |
| 에뮤 고서 그림 | 부분 | 실패(빈 마스크) | 부분 (안 함) |
| 만화 햄스터(카드와 글자) | 실패 | 통과 | 통과 (다시 지운 결과 사용) |
| 사진 10장 | 통과 8, 부분 2 | 6장이 빈 마스크 | 전부 사진 모델 그대로 (다시 지우기 안 함) |

통과 수: 그림 6장 중 사진 모델 3, 그림용만 4, 자동 선택 4. 사진 10장은 자동 선택이 한 번도 끼어들지 않아 그대로다.

규칙(`src/shared/cut-retry.ts`): 지운 결과에서 덩어리(사진 넓이 0.02% 이상)가 6개 이상이거나 가장 큰 덩어리 밖 조각이 남긴 넓이의 30% 이상일 때만 그림용 모델로 다시 지운다. 아래 중 하나면 처음 결과를 지킨다: 다시 지운 결과가 사진의 4% 미만(빈 결과), 가장 큰 덩어리가 처음의 절반 미만(몸을 깎음), 남긴 넓이가 처음의 1.4배 초과(종이, 카드, 틀을 남김), 사진 가장자리 셋 이상에 닿은 덩어리가 새로 생김(틀, 종이 전체), 조각이 줄지 않음. 이 표본에서 걸린 것은 수채 토끼(막힘)와 만화 햄스터(채택) 둘뿐이다. 표본이 작아 기준값은 이 16장에 맞춘 값이다.

그림용 모델은 처음 필요할 때만 받는다. 아직 안 받았으면 저절로 받지 않고 다듬기 화면에서 "그림용으로 다시 지우기"를 권하고(176MB), 다듬기 화면 위의 "사진용 / 그림용" 단추로 언제든 바꿀 수 있다(다듬은 것이 있으면 바꾸기 전에 묻는다).

- 모델 파일 SHA-256: `f15622d8...6e99` (176,069,933 바이트)
- 라이선스: rembg 와 anime-segmentation 코드는 Apache-2.0 이다. 학습 데이터 약관은 확인하지 못했다. IS-Net 일반과 같은 위험으로 보고 비공개 무료 베타 동안만 쓴다 (진행표 D7)

**"몸 안쪽이 지워져 테두리만 남은 것 같아" 안내 (속 빔)**: 그림용 결과에서 거짓으로 떴다. 속 빔 정도(`hollowGain`)는 만화 햄스터를 그림용으로 지운 결과가 0.13(오목한 몸과 캐릭터 둘 사이 틈을 닫으면 나온다), 직접 그린 고양이, 곰, 새의 속을 일부러 지운 결과가 0.48~0.84, 멀쩡한 그림은 0.02~0.03 이다. 사진용 기준(0.08)은 그대로 두고 그림용 결과에는 0.3(`HOLLOW_GAIN_DRAWING`)을 쓴다. 햄스터에는 안 뜨고 속을 지운 그림에는 뜬다 (`mask.test.ts`, `scripts/dev/maker-kind.mjs`).
## 옵트인 도구: 종이 색 지우기와 털 다듬기 (2026-10-28)

다듬기 화면에 단추 둘을 더했다. 둘 다 기본값이 아니고 눌렀을 때만 돌며 되돌리기로 취소한다(`src/shared/mask-refine.ts`). 측정은 위와 같은 환경, 같은 사진 16장(사진 10, 그림 6)이고 앱의 지우기 결과(사진 모델) 위에 얹었다. "단단한 넓이"는 알파 200 이상인 칸이 사진에서 차지하는 비율이다.

**종이 색 지우기**: 종이 색을 지금 마스크에서 먼 바깥에서 재서 옅은 선과 칠을 살리고 속 구멍을 메운다. 쓰는 범위는 지금 마스크 둘레(짧은 변의 5%) 안이다. 종이 색이 25(RGB 10~90% 값 차) 넘게 흩어져 있으면 종이로 보지 않고 하지 않는다(안내만).

| 그림 | 단단한 넓이 (전 → 후) | 종이 색의 흩어짐 | 결과 |
| --- | --- | --- | --- |
| 옅은 수채 토끼 고서 그림 | 3.7% → 9.5% | 15 | 흐릿하던 몸이 또렷해짐 (알파 ghost 85% → 2%) |
| 직접 그린 곰, 새 | 변화 없음 | 3 | 같음, 선이 칼처럼 또렷 |
| 직접 그린 고양이(줄 공책) | 23% → 28% | 3 | 나쁨: 공책 줄이 남음 |
| 에뮤 고서 그림(틀) | 하지 않음 | 70 | 안내만 |
| 만화 햄스터(색 카드) | 하지 않음 | 89 | 안내만 |
| 사진 10장 | 8장은 하지 않음 | 36~202 | 안내만. 흰 바탕 곰 인형만 함(43.8%, 가장자리가 칼처럼 변해 털은 나빠짐) |

**털 다듬기**: 마스크가 바뀌는 둘레만 사진 밝기를 길잡이로(guided filter) 다시 계산한다. 속과 먼 바탕은 그대로다. 사진 10장에서 단단한 넓이 변화는 0.2%p 이하이고 반투명 비율이 평균 +4%p 늘어(곰 인형 6.8 → 8.5%, 토끼 8.2 → 14.2%, 머리카락 6.2 → 12.3%) 털 끝이 자연스러워지지만 흰 털과 토끼 귀 둘레에 옅은 번짐이 생긴다. 효과가 작아 옵트인으로만 둔다. 계산은 약 0.5초(1024px).
