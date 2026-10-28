# 사진 모습 걷기 그림 (이슈 #24)

`resources/pets/choco-walk-0~7.webp`, `resources/pets/milk-walk-0~7.webp` 를 만든 방법, 쓴 모델과 라이선스, 검사 결과.

## 만든 순서

1. 원본: 레포의 `resources/pets/choco.png` 를 832x480 흰 바탕 가운데에 그대로 얹었다(크기만 바꿈). 옆모습을 따로 생성하지 않았다.
2. 영상: Wan 2.2 I2V A14B(공개 Space `zerogpu-aoti/wan2-2-fp8da-aoti-faster`, 로그인 없이)로 원본을 첫 장으로 5초(16fps 81장). 지시: 일어나 옆으로 돌아 오른쪽으로 걷기, 같은 얼굴, 몸 전체 촘촘한 곱슬, 혀. seed 7.
3. 배경 지우기: isnet-general-use(DIS) 를 로컬 onnxruntime 으로(SHA-256 `60920e99...0d964a`).
4. 한 주기: 걷기 구간에서 다리 마스크가 가장 잘 맞는 주기(18장, 약 1.1초)를 찾아 8장으로 고르고, 몸통 중심과 발바닥 높이를 맞춰 같은 상자로 잘랐다. 320x212 webp, 합계 약 180KB.

## 검사

| 항목 | 결과 |
|---|---|
| 원본과 같은 개체인가 | 얼굴, 검은 코, 분홍 혀, 적갈색, 몸 전체 곱슬이 유지된다. 걷기 장면의 머리 털이 원본보다 조금 밝다. [choco-compare.webp](choco-compare.webp) |
| 루프 이음새 | 이웃 장 차이 평균 0.130(최대 0.154), 8장째에서 1장째 0.141. 이웃 장 사이 범위 안이라 튀지 않는다 |
| 앱에서 | 시험 인스턴스에서 좌우로 걷는 모습 CDP 캡처: [오른쪽](choco-app-walk-right.webp), [왼쪽](choco-app-walk-left.webp) |
| 영상 전체 | [choco-video-sheet.webp](choco-video-sheet.webp), 고른 8장 [choco-walk-frames.webp](choco-walk-frames.webp) |

## 밀크 (2026-10-14)

초코와 같은 순서로 만들었다. 다른 점만 적는다.

1. 원본: `resources/pets/milk.png` 를 832x480 흰 바탕에 그대로 얹었다(크기만 바꿈).
2. 영상: 같은 Space, 같은 설정(6단계, 5초 81장). 지시: "처음 1초 안에 일어나 몸을 오른쪽으로 돌리고, 몸은 옆모습으로 곧게 서서 걷되 고개를 살짝 이쪽으로 돌려 얼굴과 호박색 두 눈이 내내 보이게". 부정 지시에 웅크림, 낮은 몸, 고개 돌림 반복, 얼굴 숨김. seed 33.
3. 배경 지우기: 같은 isnet.
4. 한 주기: 영상 56~77장(24장, 1.5초)에서 3장 간격으로 8장. 다리 마스크 차이가 가장 작은 주기다. 자르기 상자는 불투명(알파 128 이상) 기준으로 잡았다. 흐린 바닥 그림자 기운까지 넣으면 발 밑에 23px 빈 줄이 생겨 앱에서 발이 그림자 위로 떠 보였다. 320x222 webp, 합계 약 113KB.

| 항목 | 결과 |
|---|---|
| 원본과 같은 개체인가 | 흰 긴 털, 분홍 귀 안쪽, 분홍 코, 호박색 눈, 가슴 털이 유지된다. 걷는 동안 고개를 이쪽으로 돌려 얼굴이 보인다. [milk-compare.webp](milk-compare.webp), 앱 크기(160pt) 그대로 원본 옆에 8장: [milk-160.webp](milk-160.webp) |
| 루프 이음새 | 이웃 장 차이 평균 0.126(최대 0.184), 8장째에서 1장째 0.172. 이웃 장 범위 안. 꼬리가 말렸다 펴지는 움직임이 커서 이웃 장 차이 자체가 초코보다 들쭉날쭉하다 |
| 앱에서 | 시험 인스턴스(JJ_NO_FOCUS=1, CDP 캡처): [오른쪽](milk-app-walk-right.webp), [왼쪽](milk-app-walk-left.webp). 왼쪽은 뒤집혀서 얼굴이 그대로 이쪽을 본다 |
| 영상 전체 | [milk-video-sheet.webp](milk-video-sheet.webp), 고른 8장 [milk-walk-frames.webp](milk-walk-frames.webp) |

시도 기록:
- 1번째(seed 21, "옆모습으로 머리 들고 곧게 걷기"): 일어나 옆으로 걷지만 걷는 구간 앞쪽은 옆얼굴(눈 하나만 살짝), 끝에서 고개를 이쪽으로 돌려 한 주기 안에서 얼굴이 바뀐다. 쓰지 않았다.
- 2번째(위 지시, seed 33): Space 가 내용 없는 오류(`event: error`, `data: null`)를 돌려줬다.
- 3번째(같은 요청을 queue 로 다시, 오류 문구를 보려고): 정상 완성. 이것을 썼다.

### 예전에 넣지 않은 밀크 (2026-10-12, 10-13)

같은 방법으로 처음 만든 밀크 영상은 돌아서는 데 3초 넘게 쓰고, 걷는 구간 대부분에서 머리를 돌려 얼굴(호박색 눈)이 안 보이며 몸을 웅크렸다. 이음새도 이웃 장 평균의 2배(0.090 대 0.040). [milk-compare-rejected.webp](milk-compare-rejected.webp), [milk-video-sheet-rejected.webp](milk-video-sheet-rejected.webp). 10-13 다시 뽑기는 "ZeroGPU quota exceeded"(로그인 없는 사용량 끝)로 거절됐다. LoRA 없는 5B Space(`KingNish/wan2-2-fast`)도 같은 오류였다(무료 사용량은 Space 마다가 아니라 함께 깎인다).

## 쓴 모델과 라이선스 (2026-10-13 원문 확인)

| 모델 | 라이선스 | 생성물 | 무료 배포 앱 | 나중에 유료, 후원 | 판정 |
|---|---|---|---|---|---|
| Wan 2.2 I2V A14B (Wan-AI) | Apache-2.0 | README: "We claim no rights over the your generated contents." | 허용 | 허용(수익 상한 조항 없음) | 사용 |
| lightx2v 증류 LoRA (Space 가 6단계로 빠르게 돌리려 섞음) | 원본 `lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v` 는 Apache-2.0. Space 가 받는 파일은 `Kijai/WanVideo_comfy` 의 `Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors` 이고, 이 저장소 안내에 원본에서 추출했다고 적혀 있다(아래). 추출본에 따로 붙은 라이선스나 조건은 없다 | 원본 README: "We claim no rights over the your generate contents" | 허용 | 허용 | 사용 (아래 판단) |
| isnet-general-use (DIS, 배경 지우기. 앱은 fp16 판 84MB, 받는 곳 HF `onnx-community/ISNet-ONNX` 고정 커밋 `3fe6e3db`, 그 카드는 AGPL-3.0 표기. 같은 가중치) | 코드 Apache-2.0, 받는 곳 카드 AGPL-3.0, 학습 데이터 DIS5K 비상업 약관 (진행표 D7) | 조항 없음 | 비공개 무료 베타에서만 | 공개 전에 다시 정함 | 사용 (D7) |
| isnet-anime (그림용 배경 지우기, 176MB = 176,069,933 바이트, 처음 필요할 때만 받는다. 받는 곳 `github.com/danielgatis/rembg` v0.0.0 배포 파일) | 가중치는 SkyTNT `anime-segmentation` (코드 Apache-2.0). 학습 데이터 약관은 확인하지 못했다 | 조항 없음 | 비공개 무료 베타에서만 | 공개 전에 다시 정함 | 사용 (D7, 확인 전까지 위험) |
| rembg (예전 fp32 판 170MB 와 그림용 isnet-anime 의 받는 곳, `github.com/danielgatis/rembg` v0.0.0 배포 파일) | MIT (모델 가중치는 각자) | 해당 없음 | 허용 | 허용 | 모델 파일 받기만 |
| LTX-Video | LTX Open Weights License | "Licensor claims no rights in the Output" | 사용 제한(Attachment A)을 따라야 하고 기계 생성 표시 요구 | 연 매출 1천만 달러 이상은 별도 상업 계약 | 안 씀 |
| CogVideoX-5B-I2V | CogVideoX License | "generated content belong to the user" | 상업이면 등록 필요 | "must not exceed 1 million visits per month" | 안 씀 |
| HunyuanVideo-I2V | Tencent Hunyuan Community | "Tencent claims no rights in Outputs" | Territory 가 "excluding ... European Union, United Kingdom and South Korea" | 같은 이유로 불가 | 안 씀 |
| FLUX.1 Kontext [dev] (PR #25 가 쓴 것) | FLUX.1 [dev] Non-Commercial | 2(d) 와 4(a)(i) 가 엇갈림 | 회색 | 불가에 가까움 | 안 씀, PR #25 그림 재사용 안 함 |

### 속도용 LoRA 판단 (2026-10-13)

- Space 코드(`app.py` 51~65줄)는 `Kijai/WanVideo_comfy` 에서 위 rank128 파일을 받아 두 변환기에 합친다(`fuse_lora`, 높은 잡음 쪽 3배, 낮은 잡음 쪽 1배).
- Kijai 저장소 `Lightx2v/README.md`: I2V 480P 파일은 "Extracted from: https://huggingface.co/lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v/tree/main/distill_models". 즉 lightx2v 의 증류 모델에서 원래 Wan 2.1 과의 차이를 LoRA 로 뽑아낸 것이다.
- 원본 저장소는 `LICENSE.txt`, `distill_models/LICENSE.txt` 모두 Apache-2.0 이고, README 의 License Agreement 에 "We claim no rights over the your generate contents" 가 있다.
- Kijai 저장소에는 라이선스 표기도 LICENSE 파일도 없다. 추출본은 원본의 2차 저작물이라 Apache-2.0 4절의 재배포 의무("give any other recipients ... a copy of this License")를 지킬 쪽은 Kijai 이고, Kijai 가 더한 조건이 없으니 생성물에 붙는 제한도 없다. 우리는 LoRA 파일을 배포하지 않고 생성물만 쓴다.
- 판단: 생성물 사용은 원본 Apache-2.0 기준으로 허용. 남는 것은 Kijai 저장소의 표기 누락이며, 추출에 쓰인 원본과 조항이 원문으로 확인돼 미확정으로 두지 않는다.
- 더 깔끔히 하려면 lightx2v 가 직접 낸 LoRA(`lightx2v/Wan2.1-Distill-Loras`, `lightx2v/Wan2.2-Lightning`, 둘 다 Apache-2.0)를 쓰는 길이 있다. 지금 공개 Space 중 이걸 그대로 받는 곳은 찾지 못했다.
- LoRA 없이 만들려면: Wan 2.2 I2V A14B 공식 설정은 40단계에 CFG 3.5(`wan/configs/wan_i2v_A14B.py`)라 한 단계에 두 번 돌고, 지금 Space(6단계, CFG 1)보다 계산이 약 13배다. 이 Space 의 GPU 시간 식(`get_duration`)으로 832x480 5초가 약 70초이니 LoRA 없이는 같은 식으로 약 14분(80번 x 약 10초)이 되어 무료 사용량으로는 어렵다(추정). LoRA 없이 빠른 공개 Space 로는 `KingNish/wan2-2-fast`(FastVideo 의 `FastWan2.2-TI2V-5B-FullAttn`, Apache-2.0, 증류된 5B 전체 모델이라 LoRA 없음, 4단계)가 있으나 14B 보다 작은 모델이다.

출처:
- Wan 2.2: https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B , https://github.com/Wan-Video/Wan2.2/blob/main/LICENSE.txt
- lightx2v: https://huggingface.co/lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v , Kijai 추출본 안내: https://huggingface.co/Kijai/WanVideo_comfy/blob/main/Lightx2v/README.md , lightx2v 직접 배포 LoRA: https://huggingface.co/lightx2v/Wan2.2-Lightning
- Wan 2.2 기본 설정: https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/wan_i2v_A14B.py , LoRA 없는 5B Space: https://huggingface.co/spaces/KingNish/wan2-2-fast
- Space 코드: https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster/blob/main/app.py
- DIS: https://github.com/xuebinqin/DIS/blob/main/LICENSE.md , rembg: https://github.com/danielgatis/rembg/blob/main/LICENSE.txt
- LTX-Video: https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt
- CogVideoX: https://huggingface.co/zai-org/CogVideoX-5b-I2V/blob/main/LICENSE
- HunyuanVideo-I2V: https://huggingface.co/tencent/HunyuanVideo-I2V/blob/main/LICENSE

Space 에 보낸 것은 레포의 초코, 밀크 사진과 글 지시뿐이다(계정, 토큰, 개인 정보 없음).
