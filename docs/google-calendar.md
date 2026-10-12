# 구글 캘린더 연결 (페어리 일정을 구글로, 구글 일정을 페어리로)

페어리에서 넣은 일정을 사용자의 구글 캘린더에도 넣고, 페어리에서 고치거나 지우면 구글에서도 바뀌게 한다.
고른 캘린더에 원래 있던 일정도 읽어 와 페어리에 "구글에서" 표식을 달아 보인다 (이슈 #54, 읽기 전용).
`.ics` 비공개 주소로 읽는 캘린더 가져오기는 OAuth 없이 따로 된다. 구글 API 는 **만든 사람이 구글에 OAuth 클라이언트를 한 번 등록해야** 한다. 돈은 들지 않는다.

클라이언트가 들어 있지 않은 빌드에서는 설정의 "구글 캘린더" 칸이 숨는다.

## 1. 만든 사람이 할 일: OAuth 클라이언트 등록 (무료)

구글 클라우드 콘솔(<https://console.cloud.google.com/>)에서 한다. 결제 계정은 필요 없다. 콘솔 메뉴 이름은 가끔 바뀐다 (2026년 기준 "Google Auth Platform").

1. **프로젝트 만들기**: 위쪽 프로젝트 고르기 → 새 프로젝트 → 이름 `fairy` (아무것이나).
2. **Calendar API 켜기**: API 및 서비스 → 라이브러리 → "Google Calendar API" → 사용.
3. **동의 화면(브랜딩)**: Google Auth Platform → 시작하기
   - 앱 이름: `페어리` (사용자가 허락 화면에서 본다)
   - 사용자 지원 메일, 개발자 연락처 메일: 내 메일
   - 대상(Audience): **외부(External)**. 내부는 Google Workspace 조직 안에서만 된다
4. **권한(Data access)**: 범위 추가 → `https://www.googleapis.com/auth/calendar.events` **하나만**.
   "모든 캘린더의 일정 보기 및 수정" 이다. 캘린더 목록, 공유 설정, 다른 캘린더 정보는 못 본다. 구글 분류로는 "민감한 범위(sensitive)"이고 "제한된 범위(restricted)"가 아니다
   - **왜 더 좁은 범위가 아닌가 (2026-10-11 점검):** 더 좁은 `calendar.app.created`(페어리가 만든 캘린더만)가 있지만, 그러면 사용자가 고른 기존 캘린더(기본 캘린더 포함)에 넣을 수 없고 페어리 전용 캘린더를 새로 만들어야 한다. 지금 쓰는 사람들의 "기본 캘린더로 보내기"와 이미 보낸 일정이 끊기므로 이번에는 범위를 그대로 둔다. 후속 과제: "페어리 캘린더 만들기"를 기본으로 하고 `calendar.app.created` 로 옮기는 것(옮길 때 이미 보낸 일정은 새 캘린더로 events.move, 범위가 바뀌어 모두 한 번 다시 연결). 그 전까지 페어리는 `calendar.events` 로도 자기가 넣은 일정(`google_id` 가 있는 것)만 고치고 지운다
   - **읽어 오기도 같은 범위다 (2026-10-12, 이슈 #54):** `calendar.events` 는 이미 "보기 및 수정"이라 `events.list` 가 된다. 읽기 때문에 `calendar.events.readonly` 나 `calendar.readonly` 를 더하지 않는다 (범위를 더하면 모두 다시 연결해야 하고 검수 범위도 넓어진다). 나중에 `calendar.app.created` 로 옮기면 그 캘린더 밖의 일정은 못 읽으니, 그때 읽어 오기를 어떻게 할지 같이 정한다
5. **대상 → 테스트 사용자**: 게시 상태는 **테스트(Testing)** 로 둔다. 쓸 사람의 구글 메일을 넣는다 (**100명까지**).
   테스트 사용자가 아닌 계정으로 연결하면 구글이 "액세스 차단됨"을 보인다
6. **클라이언트 만들기**: 클라이언트 → 클라이언트 만들기 → 애플리케이션 유형 **데스크톱 앱** → 이름 `fairy desktop` → 만들기.
   **클라이언트 ID**(`숫자-글자.apps.googleusercontent.com`)와 **클라이언트 보안 비밀**(`GOCSPX-...`)을 적어 둔다.
   - 데스크톱 앱 클라이언트는 리디렉션 주소를 따로 적지 않는다. 페어리는 `http://127.0.0.1:<빈 포트>` 루프백 주소를 쓰고 구글이 아무 포트나 받는다
   - 데스크톱 앱의 "보안 비밀"은 앱 안에 들어가 누구나 꺼낼 수 있어서 구글도 비밀로 보지 않는다 ([구글 문서](https://developers.google.com/identity/protocols/oauth2/native-app)). 페어리는 PKCE(S256)로 code 가로채기를 막는다. 그래도 레포에 그대로 올리지 말고 아래처럼 빌드할 때 넣는다

### 페어리에 넣기

- **릴리스 빌드**: GitHub 레포 Settings → Secrets and variables → Actions 에 `JJ_GOOGLE_CLIENT_ID`, `JJ_GOOGLE_CLIENT_SECRET` 을 넣는다.
  릴리스 워크플로(`.github/workflows/release.yml`)가 빌드 환경 변수로 넘기고 `electron.vite.config.ts` 의 `define` 이 메인 코드에 박는다.
- **내 컴퓨터에서 빌드**: `JJ_GOOGLE_CLIENT_ID=... JJ_GOOGLE_CLIENT_SECRET=... npm run build`
- **개발, 시험**: 실행할 때 같은 환경 변수를 주면 빌드에 넣은 값보다 먼저 쓴다 (`src/main/gcal-auth.ts` `googleClient`).
  `JJ_GOOGLE_CLIENT_ID=... JJ_GOOGLE_CLIENT_SECRET=... npx electron .`

클라이언트 ID 모양이 틀리면 없는 것으로 본다 (기능이 숨는다).

## 2. 테스트 모드의 한계와 검수

| | 테스트(Testing) | 프로덕션, 검수 전 | 프로덕션, 검수 뒤 |
|---|---|---|---|
| 누가 연결하나 | 테스트 사용자로 넣은 100명 | 아무나 (새 사용자 100명까지) | 아무나 |
| 허락 화면 | "Google에서 확인하지 않은 앱" 경고 → 고급 → 계속 | 같은 경고 | 경고 없음 |
| 연결 유지 | **7일마다 끝난다** (refresh token 만료) | 계속 | 계속 |
| 비용 | 무료 | 무료 | 무료 (민감한 범위 검수는 무료) |

- **7일 만료**: 테스트 모드에서 받은 연결은 7일 뒤 끝난다. 페어리는 `invalid_grant` 를 받으면 연결을 지우고 말풍선으로 "구글 캘린더 연결이 끝났어. 설정에서 다시 연결해 줄래?"라고 알린다 (놓치면 패널의 놓친 알림에 남는다). 못 보낸 일정은 저장 파일에 그대로 있어서 다시 연결하면 이어서 보낸다.
- **검수(verification)** 를 받으면 경고와 7일 만료가 없어진다. `calendar.events` 는 민감한 범위라서 필요한 것:
  - 내가 가진 도메인의 **홈페이지** 와 **개인정보처리방침** 주소 (구글 서치 콘솔로 도메인 소유 확인). 처리방침에는 "일정 제목, 시각, 알림만 사용자의 구글 캘린더에 쓰고, 고른 캘린더 일정의 제목과 시각만 읽어 이 컴퓨터에만 두며, 사용자가 'AI가 구글 일정도 볼 수 있게'를 켠 경우에만 사용자가 고른 AI로 보내고, 페어리 서버는 없고 토큰은 사용자 컴퓨터에만 둔다"를 적는다 (`site/privacy`, 2026-10-12 판)
  - 앱 이름, 로고 (동의 화면에 보일 것)
  - 범위가 왜 필요한지 설명. 제출할 글 (영어, 2026-10-12 읽어 오기를 더해 고침):
    > fairy is a desktop companion app with a to-do list and a calendar. It uses `calendar.events` for two user-facing features in one calendar the user picks (primary by default): (1) events the user creates in fairy are inserted into that calendar, and updated or deleted there when the user edits or deletes them in fairy; fairy only modifies events it created itself. (2) The user's existing events in that calendar (from 7 days ago to 60 days ahead) are read with `events.list` (title, start/end time, ids and status only) and shown read-only in fairy's event list and calendar with reminders. fairy never edits or deletes events it did not create. All data stays on the user's computer; there is no fairy server. Google data is not sent to any AI model or third party by default. Only if the user turns on the opt-in setting "Let AI see Google events too" (off by default) are the titles and times of the read events passed to the AI assistant the user picked (a cloud AI or a local model), so it can help the user plan their day; turning it off stops this immediately. Google data is never used to train AI models. A narrower scope does not fit: `calendar.events.readonly` cannot write, and `calendar.app.created` cannot read or write the user's existing calendars.
  - **시연 영상** (YouTube, 비공개 목록 가능): 페어리 설정에서 연결 → 구글 허락 화면(주소창의 client_id 가 보이게) → 페어리에서 일정 넣기 → 구글 캘린더에 생긴 것까지 → 구글 캘린더에서 넣은 일정이 페어리에 "구글에서" 표식을 달아 보이는 것 → 구글에서 지우면 페어리에서도 사라지는 것
  - **다시 검수를 받아야 하나 (2026-10-12):** 범위가 그대로(`calendar.events` 하나)라 새 범위 검수는 없다. 다만 구글은 검수 때 적은 쓰임새와 실제 쓰임새가 같아야 하므로, 이미 검수를 냈거나 받았다면 위 설명과 시연 영상을 새 쓰임새(읽어 오기, 켠 경우에만 고른 AI로 보내기)로 바꿔 동의 화면 정보를 고쳐 다시 제출한다 (콘솔에서 "변경 사항 저장" 뒤 검수 다시 요청). 아직 테스트 모드면 처리방침과 설명만 고쳐 두면 된다
  - 며칠에서 몇 주. 제한된 범위가 아니라 유료 보안 평가(CASA)는 없다
- Calendar API 사용량은 무료다 (기본 하루 100만 번, 사용자별 초당 제한). 페어리는 바뀐 일정만 보낸다.

## 3. 사용자가 보는 것

1. 설정 → **구글 캘린더** → **구글 계정 연결**
2. 기본 브라우저에 구글 로그인과 허락 화면이 열린다. 테스트 모드면 "Google에서 확인하지 않은 앱" → 고급 → 페어리(으)로 이동.
   "모든 캘린더의 일정 보기 및 수정" 을 **체크**하고 계속. (체크를 풀면 페어리가 "캘린더 권한이 체크되지 않았어"라고 알리고 받은 권한을 바로 돌려준다)
3. 브라우저에 "페어리가 구글 캘린더에 연결됐어. 이 창은 닫아도 돼." 가 보인다. 3분 안에 끝내지 않으면 그만둔다
4. 설정에 "페어리 일정을 구글 캘린더로 보내기"와 "구글 캘린더 일정 가져오기"가 켜진다. 어제 이후 일정부터 보내고, 그 뒤 페어리에서 넣고 고치고 지우는 일정이 따라간다.
   가져오기는 고른 캘린더의 지난 7일부터 앞으로 60일까지를 15분마다(그리고 "지금 맞추기"에서) 읽어 와 "구글에서" 표식을 달아 보인다. 둘은 따로 끌 수 있다. 예전에 연결한 사람은 가져오기가 꺼져 있다 (설정에서 켠다)
5. **보낼 캘린더**: 비우면 기본 캘린더. 다른 캘린더는 구글 캘린더 설정 → 그 캘린더 → 캘린더 통합의 "캘린더 ID" 를 붙여 넣는다. 캘린더를 바꾸면 이미 보낸 일정도 새 캘린더로 옮긴다(events.move). 옛 캘린더를 쓸 수 없으면 새 캘린더에 새로 넣는다 (옛 캘린더에 남은 것은 손으로 지워야 한다)
   (`calendar.events` 범위로는 캘린더 목록을 못 읽어서 고르는 목록 대신 ID 를 받는다)
6. **연결 끊기**: 이 컴퓨터의 토큰을 지우고 구글에서도 권한을 거둔다 (`oauth2.googleapis.com/revoke`). 이미 보낸 일정은 구글에 그대로 둔다.
   구글 계정 → 보안 → 서드 파티 연결에서 거둬도 된다 (그러면 다음에 보낼 때 연결이 끝난 것으로 알린다)

## 4. 어떻게 도나 (만든 사람용)

- 코드: `src/main/gcal-auth.ts`(OAuth, API 부르기, 루프백 서버), `src/main/gcal-sync.ts`(한 차례 보내기), `src/main/gcal.ts`(토큰 보관, 일정 맞추기, 설정 창 IPC), `src/shared/gcal.ts`(일정 → 구글 일정, 지문, 다시 하기 간격), `src/shared/gcal-store.ts`(저장 파일), 설정 창 `src/renderer/src/settings/GoogleCalendarBox.tsx`
- **OAuth**: 설치 앱용 Authorization Code + PKCE(S256). `127.0.0.1` 빈 포트에 잠깐 서버를 열고, `state` 를 맞춰 본 뒤(틀리면 무시), code 를 토큰으로 바꾸고 서버를 닫는다. `access_type=offline` + `prompt=consent` 로 refresh token 을 받는다
- **토큰**: refresh token 만 사용자 데이터 폴더의 `google-token.json`(0600)에 둔다. 운영체제 열쇠(맥 키체인, 윈도우 DPAPI, 리눅스 libsecret)로 암호화할 수 있으면 Electron safeStorage 로 암호화해 두고, 예전 평문 파일은 읽을 때 바꿔 쓴다(`src/main/secret-file.ts`). 리눅스에서 열쇠고리가 없으면 평문 0600 그대로. 다른 컴퓨터로 옮긴 파일은 풀 수 없어 다시 연결해야 한다. access token 은 메모리에만. 설정, 백업(`backup.ts` FILES), 기록, 창에는 넘기지 않는다 (창은 상태만 받는다). 켜고 끄기와 캘린더 ID 는 `google-calendar.json`
- **네트워크**: 모두 메인에서 Electron `net.fetch`, 하나에 20초 제한
- **저장 파일 10판**: `event.google_id`(페어리가 미리 정해 보내는 구글 id, `jjk` + base32hex), `google_cal`(보낸 캘린더), `google_hash`(마지막으로 보낸 내용의 지문, 구글에서 지웠으면 `deleted`), `google_uid`(구글이 준 iCalUID)
- **보낼 것 = 저장 파일**: 따로 줄을 두지 않는다. 페어리가 넣은 일정(`source = local`) 중 지금 내용의 지문이 마지막으로 보낸 것과 다르면 보내고, 지운 일정에 구글 id 가 있으면 구글에서도 지운다. 그래서 앱이 꺼지거나 인터넷이 끊겨도, 페어리 MCP 서버(다른 프로세스)가 고쳐도 그대로 따라간다. 일정이 바뀌면 1.5초 뒤, 아니면 5분마다
- **겹침 막기**: id 를 넣기 전에 정해 적어 둔다. 대답을 못 받고 다시 보내면 409 → 고치기. 구글에서 지운 일정(404/410)은 새 id 로 다시 넣는다
- **다시 하기**: 인터넷 끊김, 429, 5xx, 사용량 초과는 30초부터 두 배씩 30분까지 (일정마다, 흔들기 0~20%). 구글이 받지 않는 일정(400)은 6시간, 고치면 바로
- **읽어 오기 (이슈 #54, `src/main/gcal-pull.ts`, `src/shared/gcal-pull.ts`)**: `events.list` 를 `timeMin`(지난 7일) ~ `timeMax`(앞으로 60일), `singleEvents=true`(반복 일정은 회차마다), `showDeleted=false`, `fields`(id, iCalUID, status, summary, start, end, 짝꿍 표시만)로 쪽마다 다 읽은 뒤 저장 파일(`source = google`, `external_id` = 구글 일정 id, `google_uid` = iCalUID)과 맞춘다. 범위 안인데 이번에 없는 것은 지운 것으로 둔다(구글에서 지움, 취소됨). `syncToken` 대신 범위를 통째로 다시 읽는 까닭: `syncToken` 은 `timeMin`/`timeMax` 와 같이 쓸 수 없어 반복 일정이 끝없이 펼쳐질 수 있고, 토큰이 끝나면(410) 다시 다 읽어야 해서 길이 둘이 된다. 60일이면 보통 한두 쪽이라 15분마다 다시 읽어도 사용량이 작다. 다 못 읽으면(인터넷, 권한, 쪽이 20개 넘음) 아무것도 바꾸지 않는다. 읽는 사이 끄거나 캘린더를 바꾸면 버린다
  - 페어리가 보낸 일정은 다시 가져오지 않는다: 짝꿍 표시(`extendedProperties.private.jjakkung`), 보낸 기록의 iCalUID
  - **읽기 전용**: 구글로 PATCH 하지 않는다. 고친 것이 구글에서 바뀐 것과 엇갈리는 문제, 남의 캘린더(읽기만 되는 공유 캘린더)에서 실패하는 문제, 페어리가 남이 만든 일정을 고칠 수 있다는 검수 설명이 다 없어진다. 제목, 시각, 종일은 패널과 MCP 어디서도 바뀌지 않고(`EventStore.update`), 알림과 고정만 페어리 것. ×는 페어리에서만 숨긴다(다음 읽기가 되살리지 않는다)
  - 끄기, 캘린더 바꾸기, 연결 끊기, 연결 끝남: 읽어 온 일정을 다 걷는다(맞추기가 지운 것이라 다시 켜면 되살아난다)
  - **캘린더 가져오기(.ics)와 겹침**: 같은 구글 캘린더를 `.ics` 로도 읽으면, 구글에서 읽어 온 일정의 iCalUID 와 같은 `.ics` 일정(반복 회차 포함)을 걷고 다음 `.ics` 가져오기도 거른다. 구글 읽어 오기를 끄면 `.ics` 쪽이 다음 가져오기에서 되살아난다
  - **AI 로는 사용자가 켠 경우에만**: 읽어 온 일정은 구글 사용자 데이터라 기본으로 AI 대화 자료, "오늘 뭐부터" 자료, 계획 다듬기, 페어리 도구(MCP)에서 뺀다(`aiSafeEvent`). 설정 구글 칸의 "AI가 구글 일정도 볼 수 있게"(기본 꺼짐, 가져오기를 켰을 때 보인다)를 켜면 넣는다(`aiEventFilter`). 값은 `google-calendar.json` 의 `ai` 이고, 메인(`gcalAiAllowed`)과 페어리 MCP 서버(다른 프로세스)가 부를 때마다 이 파일을 읽어 끄면 바로 뺀다. 켜도 MCP 에서는 읽기 전용(고치기, 지우기는 거절, 목록에 "구글 캘린더, 읽기 전용")이다. 켤 때 설정 칸에 "구글 일정 제목과 시각이 고른 AI로 간다(클라우드 AI면 이 컴퓨터 밖)"를 보인다. 처리방침 Limited Use 와 같다: 사용자가 켠, 화면에 보이는 기능을 위해 사용자가 고른 곳으로만 넘긴다
- **가져온 일정은 보내지 않는다**: `.ics` 로 가져온 일정(`source = ics`)은 구글로 되돌려 보내지 않는다. 거꾸로, 페어리가 보낸 일정이 같은 캘린더 가져오기로 되돌아오면 iCalUID 로 걸러 둘씩 보이지 않게 한다
- **누가 맞나**: 페어리가 넣은 일정은 페어리가 맞다. 구글에서 고쳐도 페어리에서 다시 고치면 페어리 것으로 덮는다 (구글에서 고친 것을 페어리로 가져오지 않는다). 구글에 원래 있던 일정은 구글이 맞다 (읽기 전용)
- **일정 바꾸기**: 제목 → summary, 시각 일정은 UTC 시각 + 이 컴퓨터 시간대, 끝이 없으면 30분. 종일은 현지 날짜(`date`), 끝 날은 들지 않는다. 알림은 팝업으로, 구글이 못 받는 값(종일 일정의 당일 아침 같은 음수, 4주 넘게)은 빼고 시작에 가까운 5개
- **시간대가 바뀌면** (여행 등): 보낸 일정의 지문에 시간대가 들어 있어 다음 보내기에서 모두 새 시간대로 다시 고친다. 시각 일정은 같은 순간이라 그대로지만, 종일 일정은 이 컴퓨터가 보이는 날짜로 구글에서도 옮겨진다 (페어리 화면과 같게)
- **다시 맞추기**: 연결을 끊거나 연결이 끝나면, 또 백업을 가져오면 보낸 기록을 "확인 전"으로 되돌린다. 다음 보내기가 같은 id 로 다시 넣기부터 해서, 같은 계정이면 409 → 고치기로 겹치지 않고, 다른 계정이면 새로 들어간다
- **시험**: `node --test src/shared/gcal*.test.ts src/main/gcal*.test.ts` (네트워크는 흉내). 앱으로 보려면 가짜 클라이언트 ID 로 띄우고 설정 창을 연다. 연결된 화면은 사용자 데이터 폴더에 가짜 `google-token.json` 을 두면 보인다 (보내기는 구글이 받지 않아 연결이 끝난 것으로 바뀐다)
