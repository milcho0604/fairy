import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.TZ = 'Asia/Seoul';
const { eventPreview } = await import('./event-preview.ts');
const { resolveEventLine } = await import('../../../shared/event-line.ts');
const { parseEventInput } = await import('../../../shared/event-store.ts');
const { parseTodoLine, splitRemind } = await import('../../../shared/remind-parse.ts');
const { localDay } = await import('../../../shared/todo-store.ts');
const { setLang } = await import('../../../shared/i18n/index.ts');

// 2026-10-28 (수) 오전 9시
const NOW = new Date(2026, 9, 28, 9, 0).getTime();

// 입력, 미리보기 한 줄 (ko, en). null 은 조용히 숨긴다
const TABLE: [string, string | null, string | null][] = [
  [
    '매주 월요일 10시 팀 회의',
    '이렇게 넣을게: 11월 2일 (월), 오전 10:00, 매주, “팀 회의”',
    'Will add: Mon, Nov 2, 10:00 AM, Weekly, “팀 회의”',
  ],
  [
    '매일 오전 8시 약 먹기',
    '이렇게 넣을게: 내일, 오전 8:00, 매일, “약 먹기”',
    'Will add: Tomorrow, 8:00 AM, Daily, “약 먹기”',
  ],
  [
    '평일 9시 스탠드업',
    '이렇게 넣을게: 내일, 오전 9:00, 평일, “스탠드업”',
    'Will add: Tomorrow, 9:00 AM, Weekdays, “스탠드업”',
  ],
  ['내일 3시 회의', '이렇게 넣을게: 내일, 오후 3:00, “회의”', 'Will add: Tomorrow, 3:00 PM, “회의”'],
  [
    '내일 제주도 여행',
    '이렇게 넣을게: 내일, 종일, “제주도 여행”',
    'Will add: Tomorrow, All day, “제주도 여행”',
  ],
  ['내일 종일 휴가', '이렇게 넣을게: 내일, 종일, “휴가”', 'Will add: Tomorrow, All day, “휴가”'],
  [
    '내일 점심',
    '이렇게 넣을게: 내일, 오후 12:00 (1시간), “점심”',
    'Will add: Tomorrow, 12:00 PM (1 h), “점심”',
  ],
  [
    '내일 2시부터 4시까지 워크숍',
    '이렇게 넣을게: 내일, 오후 2:00 (2시간), “워크숍”',
    'Will add: Tomorrow, 2:00 PM (2 h), “워크숍”',
  ],
  // 알림 말은 뗀 뒤 읽는다 (제목에 남지 않는다)
  [
    '내일 3시 회의 1시간 전에 알려줘',
    '이렇게 넣을게: 내일, 오후 3:00, “회의”',
    'Will add: Tomorrow, 3:00 PM, “회의”',
  ],
  ['gym 3pm', '이렇게 넣을게: 오늘, 오후 3:00, “gym”', 'Will add: Today, 3:00 PM, “gym”'],
  [
    'weekly monday 10am team meeting',
    '이렇게 넣을게: 11월 2일 (월), 오전 10:00, 매주, “team meeting”',
    'Will add: Mon, Nov 2, 10:00 AM, Weekly, “team meeting”',
  ],
  // 읽지 못하면 숨긴다
  ['25시 회의', null, null],
  ['장보기', null, null],
  ['매주 월요일 팀 회의', null, null],
  ['   ', null, null],
  ['', null, null],
];

test('입력 해석 미리보기: 표의 입력마다 한 줄 (ko, en), 못 읽으면 null', () => {
  for (const [lang, col] of [
    ['ko', 1],
    ['en', 2],
  ] as const) {
    setLang(lang);
    for (const row of TABLE) assert.equal(eventPreview(row[0], NOW), row[col], `${lang} ${row[0]}`);
  }
  setLang('ko');
});

// 일정을 넣을 때 쓰던 해석(리팩터 전 메인 핸들러의 순서 그대로)을 시험 안에 따로 적어 둔다
function legacy(line: string, now: number, picked?: string) {
  const d = new Date(now);
  const base = picked ?? localDay(now);
  const minute = base === localDay(now) ? d.getHours() * 60 + d.getMinutes() : 0;
  const { rest: text } = splitRemind(line);
  const rt = parseTodoLine(text, base, minute);
  const repeat =
    rt.dueMin !== null && (rt.repeat === 'daily' || rt.repeat === 'weekdays' || rt.repeat === 'weekly')
      ? rt.repeat
      : undefined;
  const eventText = repeat
    ? `${String(Math.floor((rt.dueMin ?? 0) / 60)).padStart(2, '0')}:${String((rt.dueMin ?? 0) % 60).padStart(2, '0')} ${rt.title}`
    : text;
  const ev =
    parseEventInput(eventText, repeat ? (rt.due ?? base) : base, repeat ? 0 : minute) ??
    (!repeat && picked ? parseEventInput(`오늘 ${text}`, base, minute) : null);
  if (!ev || (repeat && 'allDay' in ev) || (rt.repeat && !repeat)) return null;
  return { ev, repeat };
}

test('미리보기가 읽은 것과 넣을 때 읽는 것이 같다 (오늘 기준과 달력에서 고른 날 기준)', () => {
  const picks = [undefined, '2026-11-05', '2026-10-28'];
  for (const [line] of TABLE)
    for (const picked of picks) {
      const a = resolveEventLine(line, NOW, picked);
      const b = legacy(line, NOW, picked);
      if (!b) {
        assert.equal(a.ok, false, `${line} ${picked}`);
        continue;
      }
      assert.ok(a.ok, `${line} ${picked}`);
      if (a.ok) {
        assert.deepEqual(a.ev, b.ev, `${line} ${picked}`);
        assert.equal(a.repeat, b.repeat, `${line} ${picked}`);
      }
    }
});

test('달력에서 고른 날은 그날을 기준으로 미리 보인다', () => {
  setLang('ko');
  assert.equal(
    eventPreview('3시 회의', NOW, '2026-11-05'),
    '이렇게 넣을게: 11월 5일 (목), 오후 3:00, “회의”',
  );
  // 날짜도 시각도 없는 글은 그날 종일 (일정을 넣을 때와 같다)
  assert.equal(eventPreview('장보기', NOW, '2026-11-05'), '이렇게 넣을게: 11월 5일 (목), 종일, “장보기”');
});
