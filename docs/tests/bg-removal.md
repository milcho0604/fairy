# 배경 제거 모델 고르기 (P1-07)

사진으로 페어리를 만들 때 쓸 배경 제거 모델을 실제 사진으로 비교했다. 2026-10-02, 맥(Apple Silicon), Electron 44.5.1 렌더러에서 onnxruntime-web 1.30.0 으로 돌렸다. 앱이 쓸 방식 그대로다.

## 후보

| 모델 | 코드 라이선스 | 학습 데이터 | 크기 | 입력 | 받은 곳 |
| --- | --- | --- | --- | --- | --- |
| U²-Net 작은 판 (u2netp) | Apache 2.0 | DUTS (연구용) | 4.4MB | 320px | rembg 배포본 |
| U²-Net (u2net) | Apache 2.0 | DUTS (연구용) | 168MB | 320px | rembg 배포본 |
| IS-Net 일반 (isnet-general-use) | Apache 2.0 | DIS5K (비상업 연구, 교육용) | 170MB | 1024px | rembg 배포본 |
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

- 앱에 넣지 않고 처음 페어리를 만들 때 원래 배포처에서 받는다(170MB). 받은 뒤 SHA-256 을 맞춰 보고 사용자 데이터 폴더에 둔다
- **라이선스 위험 (진행표 D7)**: IS-Net 코드는 Apache 2.0 이지만 학습에 쓴 DIS5K 데이터 이용 약관은 "비상업 연구, 교육용, 복사나 가공 뒤에도 상업 사용 금지"다(`DIS5K-Dataset-Terms-of-Use.pdf` 2항). 학습한 가중치에도 적용되는지는 약관에 적혀 있지 않다. U²-Net 도 연구용 데이터(DUTS)로 학습했다. 지금은 비공개 개인 프로젝트이고 베타도 무료라 IS-Net 을 쓰되, 판매나 공개 배포 전에 다시 정한다(저자 문의, 상업 사용이 분명한 모델로 바꾸기, 직접 학습)
- BiRefNet(MIT)은 이 판의 onnxruntime-web 에서 돌지 않았다. 새 판이 나오면 다시 본다

## 다시 돌리는 법

평가 도구는 `scripts/bg-eval/` 에 있다. 모델 파일을 `<폴더>/models/`, 사진을 `<폴더>/photos/` 에 두고 `<폴더>/out/` 을 만든 뒤 `BG_DIR=<폴더> npx electron scripts/bg-eval` 로 돌린다. 도구 구성: 숨긴 창에서 onnxruntime-web 을 WebGPU 와 wasm 으로 각각 불러 사진마다 잘라 바둑판 위에 얹어 저장하고, 걸린 시간을 `result.json` 에 적는다.
