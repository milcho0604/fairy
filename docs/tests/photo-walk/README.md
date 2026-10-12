# 사진 모습 걷기 그림 (이슈 #24)

`resources/pets/choco-walk-0~7.webp` 를 만든 방법, 쓴 모델과 라이선스, 검사 결과.

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

## 밀크는 넣지 않았다

같은 방법으로 만든 밀크 영상은 돌아서는 데 3초 넘게 쓰고, 걷는 구간 대부분에서 머리를 돌려 얼굴(호박색 눈)이 안 보이며 몸을 웅크린다. 이음새도 이웃 장 평균의 2배(0.090 대 0.040). [milk-compare.webp](milk-compare.webp), [milk-video-sheet.webp](milk-video-sheet.webp). 다시 뽑으려 했지만 무료 사용량이 끝나 오류가 났다. 밀크는 지금처럼 사진 한 장으로 걷는다.

## 쓴 모델과 라이선스 (2026-10-13 원문 확인)

| 모델 | 라이선스 | 생성물 | 무료 배포 앱 | 나중에 유료, 후원 | 판정 |
|---|---|---|---|---|---|
| Wan 2.2 I2V A14B (Wan-AI) | Apache-2.0 | README: "We claim no rights over the your generated contents." | 허용 | 허용(수익 상한 조항 없음) | 사용 |
| lightx2v 증류 LoRA (Space 가 4~6단계로 빠르게 돌리려 섞음) | 원본 `lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v` 는 Apache-2.0. Space 가 받는 `Kijai/WanVideo_comfy` 의 rank128 추출본은 라이선스 표기 없음 | 조항 없음 | Apache 원본 기준 허용 | 같음 | 사용, 추출본 표기는 미확정으로 적어 둔다 |
| isnet-general-use (DIS, 배경 지우기) | Apache-2.0 | 조항 없음 | 허용 | 허용 | 사용 |
| rembg (isnet 받은 곳) | MIT | 해당 없음 | 허용 | 허용 | 모델 파일 받기만 |
| LTX-Video | LTX Open Weights License | "Licensor claims no rights in the Output" | 사용 제한(Attachment A)을 따라야 하고 기계 생성 표시 요구 | 연 매출 1천만 달러 이상은 별도 상업 계약 | 안 씀 |
| CogVideoX-5B-I2V | CogVideoX License | "generated content belong to the user" | 상업이면 등록 필요 | "must not exceed 1 million visits per month" | 안 씀 |
| HunyuanVideo-I2V | Tencent Hunyuan Community | "Tencent claims no rights in Outputs" | Territory 가 "excluding ... European Union, United Kingdom and South Korea" | 같은 이유로 불가 | 안 씀 |
| FLUX.1 Kontext [dev] (PR #25 가 쓴 것) | FLUX.1 [dev] Non-Commercial | 2(d) 와 4(a)(i) 가 엇갈림 | 회색 | 불가에 가까움 | 안 씀, PR #25 그림 재사용 안 함 |

출처:
- Wan 2.2: https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B , https://github.com/Wan-Video/Wan2.2/blob/main/LICENSE.txt
- lightx2v: https://huggingface.co/lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v , https://huggingface.co/Kijai/WanVideo_comfy
- Space 코드: https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster/blob/main/app.py
- DIS: https://github.com/xuebinqin/DIS/blob/main/LICENSE.md , rembg: https://github.com/danielgatis/rembg/blob/main/LICENSE.txt
- LTX-Video: https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt
- CogVideoX: https://huggingface.co/zai-org/CogVideoX-5b-I2V/blob/main/LICENSE
- HunyuanVideo-I2V: https://huggingface.co/tencent/HunyuanVideo-I2V/blob/main/LICENSE

Space 에 보낸 것은 레포의 초코, 밀크 사진과 글 지시뿐이다(계정, 토큰, 개인 정보 없음).
