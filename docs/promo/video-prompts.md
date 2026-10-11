# 홍보 영상 프롬프트

페어리 홍보 영상을 직접 만들 때 쓰는 대본, 장면 목록, AI 영상 도구용 프롬프트 모음이에요.
실제 앱 화면은 `docs/assets/screens/` 와 앱을 직접 녹화해서 쓰고, AI 도구는 그 사이를 잇는 연출 장면에만 써요.

## 공통 정보

- **한 줄 소개**: 화면 위를 돌아다니는 페어리가 할 일, 일정, 메모를 같이 챙겨 주는 데스크톱 비서.
- **타깃**: 귀여운 걸 좋아하는 20~30대 직장인, 대학생. 마감에 쫓기고 할 일 앱을 깔아 두고도 안 여는 사람.
- **톤**: 따뜻하고 귀엽게. 과장 광고 말투 대신 친구가 말 거는 느낌.
- **길이**: 세로 쇼츠/릴스 15초, 30초 두 버전. 가로판은 30초판을 다시 자르기.
- **비율**: 세로 1080x1920(9:16), 가로 1920x1080(16:9).
- **글꼴**: 자막 Jua 또는 Pretendard Bold. 크고 짧게, 한 화면에 12자 안팎.
- **색**: 크림 바탕(#faf6f1), 코코아 갈색 강조(#9a5a2c), 하늘색 바탕 화면(#dbe7f3).
- **등장 페어리**: 밀크(흰 고양이), 초코(갈색 푸들), 콩(동글한 콩 캐릭터). 그림 파일은 `resources/pets/milk.png`, `resources/pets/choco.png`.
- **쓰면 안 되는 것**: 다른 회사 캐릭터(치이카와 등), 실제 사람 이름이나 연락처, "1위", "최고" 같은 근거 없는 말.
- **윈도우**: 윈도우판은 아직 확인 중이라 영상과 글에서 "윈도우 지원"을 내세우지 않는다. 쓰려면 "윈도우 확인 중"으로 적는다.

## 장면 목록 (30초판)

| # | 길이 | 화면 | 자막 | 소스 |
|---|---|---|---|---|
| 1 | 0~2초 | 할 일 앱 알림이 쌓인 휴대폰을 엎어 두는 손 | 할 일 앱, 깔기만 했죠? | AI 영상 (프롬프트 A) |
| 2 | 2~5초 | 모니터 아래쪽에서 밀크가 걸어 나와 앉음 | 그래서 데려왔어요 | 앱 녹화 |
| 3 | 5~9초 | 페어리를 누르면 오늘 패널이 열림, 할 일 한 줄 입력 | 누르면 오늘 할 일 | 앱 녹화 (`panel.png`, `quick-add.png`) |
| 4 | 9~13초 | 말풍선 "1시간 뒤 마감이야" (마감 시각이 있는 할 일의 기본 알림은 하루 전과 1시간 전) | 마감 전에 먼저 말 걸어요 | 앱 녹화 (`desktop.png`) |
| 5 | 13~17초 | 할 일 체크 → 색종이와 코인 | 끝내면 같이 기뻐해요 | 앱 녹화 |
| 6 | 17~23초 | 우리 집 고양이 사진 → 배경 지우기 → 화면 위 페어리 | 우리 집 아이 사진 한 장이면 | 앱 녹화 (`maker-steps.png`) + AI 전환 (프롬프트 B) |
| 7 | 23~27초 | 페어리 일곱 마리가 나란히 손 흔들기 | 누구랑 일할래요? | **합성**: 앱에서 페어리를 한 마리씩 바꿔 가며 손 흔들기를 녹화하고 편집에서 나란히 놓는다 (앱은 기본 페어리 하나와 친구 셋, 네 마리까지만 같이 뜬다. `pets.png` 도 한 마리씩 찍어 붙인 그림) |
| 8 | 27~30초 | 로고 "페어리", 아래에 "무료 · 맥 (윈도우 확인 중)" | 내 화면 속 옆자리 친구 | 편집 프로그램 |

15초판은 1, 2, 4, 5, 8 만 쓰고 각 장면을 줄여요.

## AI 영상 도구 프롬프트

Sora, Veo, Kling, Runway 같은 도구에 영어로 넣는 게 결과가 안정적이에요. 페어리 그림을 첫 프레임 이미지로 같이 넣으면(이미지→영상) 페어리 모습이 덜 바뀌어요.

### 프롬프트 A: 첫 장면 (공감 후킹)

```
Close-up, soft morning light on a cozy wooden desk. A hand turns a smartphone face-down;
the screen is full of unread to-do app notifications. Shallow depth of field, warm pastel
color grade, gentle and slightly comic mood. Vertical 9:16, 2 seconds, no text, no logos,
no faces.
```

### 프롬프트 B: 사진이 페어리가 되는 전환

```
A printed photo of a fluffy white long-haired cat sits on a desk. Soft sparkles rise from
the photo and the cat lifts off the paper as a cute rounded 3D figurine with thick fluffy
fur, big shiny eyes and small paws, then hops onto the bottom edge of a computer monitor.
Pastel cream and sky blue palette, soft studio light, smooth magical transition.
Vertical 9:16, 3 seconds, no text, no logos.
```

첫 프레임 이미지: `resources/pets/milk.png` (초코판은 `choco.png`, 프롬프트의 고양이 설명을 "fluffy brown curly-haired toy poodle"로 바꿔요).

### 프롬프트 C: 페어리가 화면 위를 걷는 장면 (앱 녹화가 어려울 때)

```
A tidy desktop computer screen with a pastel sky-blue wallpaper. A tiny cute white cat
character with round head and small paws walks along the bottom edge of the screen,
stops, looks up and waves one paw. A small speech bubble pops up above it. Clean,
cozy, kawaii style, soft shadows. Vertical 9:16, 4 seconds, no readable text.
```

말풍선 글자는 AI가 망가뜨리기 쉬워서, 영상에서는 빈 말풍선으로 두고 편집에서 자막으로 얹어요.

### 프롬프트 D: 마무리 화면 배경

```
Soft cream background with gentle floating paper confetti in cocoa brown, peach and
sky blue, slow motion, lots of empty space in the center for a logo.
9:16, 3 seconds, loopable, no text.
```

## 앱 화면 녹화 방법

1. 페어리 위에 마우스를 두고 `Cmd/Ctrl + Option/Alt + =` 로 페어리를 키우고, 바탕 화면을 깔끔한 단색으로 바꿔요.
2. 할 일과 일정은 지어낸 예시만 넣어요. 예: "주간 회의 자료 정리", "치과 정기 검진 오후 4시", "보고서 제출 18:00".
3. 맥은 `Cmd + Shift + 5`, 윈도우는 `Win + Alt + R` 로 화면 일부를 녹화해요.
4. 마감 알림 장면은 마감 시각을 지금+1시간 조금 넘게 잡은 할 일을 넣고 기다려요(기본 알림이 1시간 전). 30분 전 알림을 보이려면 그 할 일의 종을 눌러 "30분 전"을 더해요.
5. 색종이 장면은 할 일을 끝낼 때 나와요. 안 나오면 할 일을 하나 더 넣고 다시 끝내 보세요.

## 자막 문구 후보

- 할 일 앱, 깔기만 했죠?
- 마감 1시간 전, 페어리가 먼저 말 걸어요
- 끝내면 같이 기뻐해 줘요
- 우리 집 아이 사진 한 장이면 화면 속 페어리
- 내 화면 속 옆자리 친구, 페어리

## 게시글 문구 예시

```
할 일 앱은 깔아 두고 안 열게 되잖아요 🥲
그래서 화면에 사는 페어리를 만들었어요.
마감 1시간 전엔 먼저 말 걸고, 다 끝내면 같이 기뻐해 줘요.
우리 집 아이 사진 한 장이면 나만의 페어리도 만들 수 있어요.

#페어리 #데스크톱페어리 #할일관리 #직장인 #반려동물 #인스타툰
```
