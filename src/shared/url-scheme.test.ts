import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADD_TEXT_MAX,
  admitUrl,
  MEMO_TEXT_MAX,
  panelTabOf,
  parseJjUrl,
  petFileFromArgv,
  URL_MAX,
  urlFromArgv,
} from './url-scheme.ts';

const ok = (raw: string) => {
  const r = parseJjUrl(raw);
  assert.ok(r.ok, `${raw} -> ${JSON.stringify(r)}`);
  return r.value;
};
const reason = (raw: unknown) => {
  const r = parseJjUrl(raw);
  assert.equal(r.ok, false, `${String(raw)} 는 거절해야 한다`);
  return r.ok ? undefined : r.reason;
};

test('add: 퍼센트 인코딩 한글과 + 공백', () => {
  assert.deepEqual(ok('jjakkung://add?text=%EB%82%B4%EC%9D%BC%203%EC%8B%9C%20%ED%9A%8C%EC%9D%98'), {
    action: 'add',
    text: '내일 3시 회의',
  });
  assert.deepEqual(ok('jjakkung://add?text=buy+milk+tomorrow'), { action: 'add', text: 'buy milk tomorrow' });
  // 슬래시 없는 꼴, 끝 슬래시, 대문자 동작도 받는다
  assert.deepEqual(ok('jjakkung:add?text=a'), { action: 'add', text: 'a' });
  assert.deepEqual(ok('jjakkung://add/?text=a'), { action: 'add', text: 'a' });
  assert.deepEqual(ok('JJAKKUNG://ADD?text=a'), { action: 'add', text: 'a' });
});

test('add 는 한 줄: 줄바꿈과 탭은 공백, 제어 문자와 방향 바꾸기 문자는 뺀다', () => {
  assert.deepEqual(ok('jjakkung://add?text=a%0Ab%09c%00d%E2%80%AEe'), { action: 'add', text: 'a b cde' });
});

test('memo 는 여러 줄을 남긴다', () => {
  assert.deepEqual(ok('jjakkung://memo?text=%EC%A0%9C%EB%AA%A9%0A%0A%EB%B3%B8%EB%AC%B8%0D%0A'), {
    action: 'memo',
    text: '제목\n\n본문',
  });
});

test('길이 상한을 넘으면 자르지 않고 거절', () => {
  assert.equal(reason(`jjakkung://add?text=${'가'.repeat(ADD_TEXT_MAX + 1)}`), 'tooLong');
  assert.equal(ok(`jjakkung://add?text=${'a'.repeat(ADD_TEXT_MAX)}`).action, 'add');
  assert.equal(reason(`jjakkung://memo?text=${'a'.repeat(MEMO_TEXT_MAX + 1)}`), 'tooLong');
  assert.equal(reason(`jjakkung://memo?text=${'a'.repeat(URL_MAX)}`), 'tooLong');
});

test('빈 글, 없는 칸', () => {
  assert.equal(reason('jjakkung://add'), 'empty');
  assert.equal(reason('jjakkung://add?text=%20%20'), 'empty');
  assert.equal(reason('jjakkung://memo?text='), 'empty');
});

test('focus: 15, 25, 50 만. 없으면 고른 길이', () => {
  assert.deepEqual(ok('jjakkung://focus?min=25'), { action: 'focus', min: 25 });
  assert.deepEqual(ok('jjakkung://focus?min=50'), { action: 'focus', min: 50 });
  assert.deepEqual(ok('jjakkung://focus'), { action: 'focus' });
  for (const bad of ['0', '24', '-25', '25.0', '1e2', 'abc', '9999', ''])
    assert.equal(reason(`jjakkung://focus?min=${bad}`), 'value', bad);
});

test('open: 아는 탭만, 없으면 오늘', () => {
  assert.deepEqual(ok('jjakkung://open?tab=calendar'), { action: 'open', tab: 'calendar' });
  assert.deepEqual(ok('jjakkung://open'), { action: 'open', tab: 'today' });
  assert.equal(reason('jjakkung://open?tab=shop'), 'value');
  assert.equal(reason('jjakkung://open?tab=../../etc'), 'value');
  assert.equal(panelTabOf('memo'), 'note');
  assert.equal(panelTabOf('calendar'), 'event');
  assert.equal(panelTabOf('todo'), 'todo');
});

test('모르는 동작, 모르는 칸, 같은 칸 두 번은 거절', () => {
  assert.equal(reason('jjakkung://delete?id=1'), 'action');
  assert.equal(reason('jjakkung://navigate?url=https://evil.example'), 'action');
  assert.equal(reason('jjakkung://file?path=/etc/passwd'), 'action');
  assert.equal(reason('jjakkung://__proto__'), 'action');
  assert.equal(reason('jjakkung://constructor'), 'action');
  assert.equal(reason('jjakkung://add?text=a&url=https://x'), 'param');
  assert.equal(reason('jjakkung://add?text=a&text=b'), 'duplicate');
  assert.equal(reason('jjakkung://open?tab=todo&path=/tmp'), 'param');
});

test('다른 스킴, 이상한 꼴은 거절', () => {
  assert.equal(reason('https://add?text=a'), 'scheme');
  assert.equal(reason('file:///etc/passwd'), 'scheme');
  assert.equal(reason('javascript:alert(1)'), 'scheme');
  assert.equal(reason('jjakkungx://add?text=a'), 'scheme');
  assert.equal(reason('jjakkung://user:pw@add?text=a'), 'malformed');
  assert.equal(reason('jjakkung://add:99?text=a'), 'malformed');
  assert.equal(reason('jjakkung://add?text=a#frag'), 'malformed');
  assert.equal(reason('jjakkung://add/more/path?text=a'), 'malformed');
  assert.equal(reason(42), 'malformed');
  assert.equal(reason(undefined), 'malformed');
});

test('명령줄에서 주소와 .jjpet 파일 찾기', () => {
  const argv = ['/app/Jjakkung', '--allow-file-access-from-files', 'jjakkung://add?text=a'];
  assert.equal(urlFromArgv(argv), 'jjakkung://add?text=a');
  assert.equal(urlFromArgv(['/app/Jjakkung', '--inspect']), undefined);
  assert.equal(
    petFileFromArgv(['C:\\Jjakkung.exe', 'C:\\Users\\me\\콩이.jjpet']),
    'C:\\Users\\me\\콩이.jjpet',
  );
  assert.equal(petFileFromArgv(['/app/Jjakkung', '/home/me/Kong.JJPET']), '/home/me/Kong.JJPET');
  // 실행 파일 자리, 스위치, 다른 확장자는 아니다
  assert.equal(petFileFromArgv(['/x/evil.jjpet']), undefined);
  assert.equal(petFileFromArgv(['/app', '--file=a.jjpet']), undefined);
  assert.equal(petFileFromArgv(['/app', '/tmp/a.jjpet.exe']), undefined);
  assert.equal(petFileFromArgv(['/app', '/tmp/a.json']), undefined);
});

test('연달아 온 주소는 10초에 8개까지', () => {
  let recent: number[] = [];
  for (let i = 0; i < 8; i++) {
    const next = admitUrl(recent, 1000 + i);
    assert.ok(next);
    recent = next;
  }
  assert.equal(admitUrl(recent, 1100), undefined);
  // 10초가 지나면 다시 받는다
  assert.ok(admitUrl(recent, 1000 + 10_000));
});
