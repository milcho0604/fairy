import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from './i18n/index.ts';
import {
  applyPatch,
  bodyKey,
  cleanPetName,
  clipPetName,
  DEFAULT_SETTINGS,
  defaultPetName,
  followKindName,
  gaitPatch,
  isPersonalPet,
  PET_KINDS,
  PET_NAME_MAX,
  parseSettings,
  petNameLength,
  photoPetName,
  pickedGait,
  resetPreferencesOf,
  type Settings,
} from './settings.ts';

test('저장 파일이 없거나 깨졌으면 기본값', () => {
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('x'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings({ chatter: 'loud', wander: 'yes', hideHints: -3 }), {
    ...DEFAULT_SETTINGS,
    hideHints: 0,
  });
});

test('설정 초기화는 화면 환경설정을 기본값으로 돌리고 페어리와 사용자 콘텐츠는 보존한다', () => {
  const current: Settings = {
    ...DEFAULT_SETTINGS,
    chatter: 'quiet',
    wander: false,
    petName: '모찌',
    petKind: 'cat',
    petLibrary: [{ id: 'saved', name: '친구', image: 'pet.png', poses: {} }],
    petFacts: [{ kind: 'birthday', value: '05-01', at: 1 }],
    icsUrl: 'https://example.test/calendar.ics',
  };
  const reset = resetPreferencesOf(current);
  assert.equal(reset.chatter, DEFAULT_SETTINGS.chatter);
  assert.equal(reset.wander, DEFAULT_SETTINGS.wander);
  assert.equal(reset.petName, '모찌');
  assert.equal(reset.petKind, 'cat');
  assert.deepEqual(reset.petLibrary, current.petLibrary);
  assert.deepEqual(reset.petFacts, current.petFacts);
  assert.equal(reset.icsUrl, current.icsUrl);
});

test('예전 펫 설정 파일(pet-settings.json)의 값도 읽는다', () => {
  assert.deepEqual(parseSettings({ chatter: 'quiet', hideHints: 2 }), {
    ...DEFAULT_SETTINGS,
    chatter: 'quiet',
    hideHints: 2,
    // 그때 조용히면 회고가 안 왔다. 같은 동작으로 읽는다
    review: false,
  });
});

test('첫 안내의 보던 쪽은 완료 여부와 별도로 저장하고 범위 밖 값은 거절한다', () => {
  assert.equal(parseSettings({ onboarded: false }).onboardPage, 0);
  for (const onboardPage of [0, 1, 2, 3, 4]) {
    const next = applyPatch(DEFAULT_SETTINGS, { onboardPage });
    assert.equal(next.onboardPage, onboardPage);
    assert.equal(next.onboarded, false);
    assert.equal(parseSettings(next).onboardPage, onboardPage);
  }
  for (const onboardPage of [-1, 5, 1.5, NaN, Infinity, '2', null]) {
    assert.equal(parseSettings({ onboardPage }).onboardPage, 0);
  }
  const before = { ...DEFAULT_SETTINGS, onboardPage: 2 };
  assert.equal(applyPatch(before, { onboardPage: 99 }).onboardPage, 2);
});

test('펫 이름: 공백 정리, 제어 문자 제거, 12자까지, 빈 이름은 안 받는다', () => {
  assert.equal(cleanPetName('  밤  '), '밤');
  assert.equal(cleanPetName('콩\n이'), '콩이');
  assert.equal(cleanPetName('가 나'), '가 나');
  assert.equal(cleanPetName('일이삼사오육칠팔구십일이삼'), '일이삼사오육칠팔구십일이');
  assert.equal(cleanPetName('🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶'), '🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶🐶');
  assert.equal(cleanPetName('   '), undefined);
  assert.equal(cleanPetName(3), undefined);
});

test('바꾸기는 준 값만, 틀린 값은 지금 값을 지킨다', () => {
  const now = { ...DEFAULT_SETTINGS, petName: '밤', chatter: 'chatty' as const };
  assert.deepEqual(applyPatch(now, { wander: false }), { ...now, wander: false });
  assert.deepEqual(applyPatch(now, { petName: '', chatter: 'nope' }), now);
  assert.deepEqual(applyPatch(now, { persona: 'polite', aiKnowsTodos: true }), {
    ...now,
    persona: 'polite',
    aiKnowsTodos: true,
  });
  assert.deepEqual(applyPatch(now, { persona: 'evil', aiKnowsTodos: 'yes' }), now);
  assert.deepEqual(applyPatch(now, { restDays: [6, 0, 0, 9, 'x'], petKind: 'cat', spicy: true }), {
    ...now,
    restDays: [0, 6],
    petKind: 'cat',
    spicy: true,
  });
  assert.equal(applyPatch(now, { petKind: 'dragon' }).petKind, 'kong');
  assert.deepEqual(applyPatch(now, { petName: ' 콩 ' }), { ...now, petName: '콩' });
});

test('사진 펫 파일 이름은 pets 폴더 안 이름만, 비우면 기본 펫', () => {
  assert.equal(parseSettings({ petImage: 'pet-123.png' }).petImage, 'pet-123.png');
  assert.equal(parseSettings({ petImage: '../../etc/passwd' }).petImage, undefined);
  assert.equal(parseSettings({ petImage: '/tmp/pet-1.png' }).petImage, undefined);
  const withPet = { ...DEFAULT_SETTINGS, petImage: 'pet-1.png' };
  assert.equal(applyPatch(withPet, { petImage: null }).petImage, undefined);
  assert.equal(applyPatch(withPet, { petImage: 'x.png' }).petImage, 'pet-1.png');
});

test('사진 펫과 포즈 파일 이름: 규칙에 맞는 것만, null 은 지우기, 빠진 포즈는 그대로', () => {
  const now = { ...DEFAULT_SETTINGS, petImage: 'pet-a.png', petPoses: { happy: 'pose-h.png' } };
  assert.equal(applyPatch(now, { petImage: 'pet-b.gif' }).petImage, 'pet-b.gif');
  assert.equal(applyPatch(now, { petImage: '../etc/passwd' }).petImage, 'pet-a.png');
  assert.equal(applyPatch(now, { petImage: null }).petImage, undefined);
  assert.deepEqual(applyPatch(now, { petPoses: { sleepy: 'pose-s.webp' } }).petPoses, {
    happy: 'pose-h.png',
    sleepy: 'pose-s.webp',
  });
  assert.deepEqual(applyPatch(now, { petPoses: { happy: null } }).petPoses, {});
  assert.deepEqual(applyPatch(now, { petPoses: { happy: '/tmp/x.png' } }).petPoses, {});
});

test('v2 설정: 회고 시각, 단축키(겹치면 거절), 캘린더 주소(https 만), 내 MCP', () => {
  const now = { ...DEFAULT_SETTINGS };
  assert.equal(applyPatch(now, { reviewMinute: 17 * 60 }).reviewMinute, 1020);
  assert.equal(applyPatch(now, { reviewMinute: 2000 }).reviewMinute, now.reviewMinute);
  assert.equal(
    applyPatch(now, { shortcuts: { hide: 'CommandOrControl+Alt+J' } }).shortcuts.hide,
    'CommandOrControl+Alt+J',
  );
  assert.deepEqual(applyPatch(now, { shortcuts: { hide: now.shortcuts.quickAdd } }).shortcuts, now.shortcuts);
  assert.deepEqual(applyPatch(now, { shortcuts: { hide: 'rm -rf' } }).shortcuts, now.shortcuts);
  assert.equal(
    applyPatch(now, { icsUrl: ' https://calendar.google.com/x.ics ' }).icsUrl,
    'https://calendar.google.com/x.ics',
  );
  assert.equal(applyPatch(now, { icsUrl: 'http://x/a.ics' }).icsUrl, undefined);
  // webcal:// 은 버리지 않고 https 로 받는다 (버그잡이 6차)
  assert.equal(
    applyPatch(now, { icsUrl: ' webcal://p01-calendars.icloud.com/published/2/abc ' }).icsUrl,
    'https://p01-calendars.icloud.com/published/2/abc',
  );
  assert.equal(applyPatch(now, { icsUrl: 'webcal://' }).icsUrl, undefined);
  const withIcs = applyPatch(now, { icsUrl: 'https://a/b.ics' });
  assert.equal(applyPatch(withIcs, { icsUrl: null }).icsUrl, undefined);
  assert.equal(applyPatch(now, { myMcp: true }).myMcp, true);
  assert.equal(DEFAULT_SETTINGS.aiPetTools, false);
  assert.equal(applyPatch(now, { aiPetTools: true }).aiPetTools, true);
  assert.equal(applyPatch(now, { aiPetTools: 'yes' }).aiPetTools, false);
});

test('친구 펫: 규칙에 맞는 것만, 같은 id 는 한 번, 3마리까지', () => {
  const now = { ...DEFAULT_SETTINGS };
  const r = applyPatch(now, {
    friends: [
      { id: 'f-1', name: '  밤 ', kind: 'cat' },
      { id: 'f-1', name: '중복', kind: 'cat' },
      { id: '../x', name: '나쁨', kind: 'cat' },
      { id: 'f-2', name: '', kind: 'cat' },
      { id: 'f-3', name: '삐', kind: 'dragon', image: '/etc/x.png' },
      { id: 'f-4', name: '넷', kind: 'chick', image: 'pet-a.png' },
      { id: 'f-5', name: '다섯', kind: 'kong' },
    ],
  });
  assert.deepEqual(r.friends, [
    { id: 'f-1', name: '밤', kind: 'cat' },
    { id: 'f-3', name: '삐', kind: 'kong' },
    { id: 'f-4', name: '넷', kind: 'chick', image: 'pet-a.png' },
  ]);
});

test('화면 말: 자동, 한국어, 영어만. 기본은 자동', () => {
  assert.equal(DEFAULT_SETTINGS.lang, 'auto');
  assert.equal(parseSettings({ lang: 'en' }).lang, 'en');
  assert.equal(parseSettings({ lang: 'ko' }).lang, 'ko');
  assert.equal(parseSettings({ lang: 'fr' }).lang, 'auto');
  const en = { ...DEFAULT_SETTINGS, lang: 'en' as const };
  assert.equal(applyPatch(en, { lang: 'ja' }).lang, 'en');
  assert.equal(applyPatch(en, { lang: 'auto' }).lang, 'auto');
});

test('펫 모양 이름은 지금 말로 읽는다', () => {
  setLang('en');
  try {
    assert.equal(PET_KINDS[0]?.label, 'Bean');
  } finally {
    setLang('ko');
  }
  assert.equal(PET_KINDS[0]?.label, '콩이');
});

test('AI 모델 고르기: 모양이 맞는 것만, 옵션처럼 보이는 값은 버린다', () => {
  const s = parseSettings({
    aiModels: { claude: 'sonnet', codex: '--x', local: 'qwen3-0.6b', 'Bad Key': 'a' },
  });
  assert.deepEqual(s.aiModels, { claude: 'sonnet', local: 'qwen3-0.6b' });
  assert.deepEqual(parseSettings({ aiModels: 'x' }).aiModels, {});
});

test('입체 모습 파일 이름: 규칙에 맞는 것만, null 이면 지운다 (6단계)', () => {
  const now = parseSettings({});
  const s = applyPatch(now, { petModel: 'model-1791-ab12.json', petDepth: 'depth-1791.png' });
  assert.equal(s.petModel, 'model-1791-ab12.json');
  assert.equal(s.petDepth, 'depth-1791.png');
  assert.equal(
    applyPatch(s, { petModel: '../x.json', petDepth: 'depth-1.jpg' }).petModel,
    'model-1791-ab12.json',
  );
  const cleared = applyPatch(s, { petModel: null, petDepth: null });
  assert.equal(cleared.petModel, undefined);
  assert.equal(cleared.petDepth, undefined);
  assert.equal(now.pet3d, true);
});

test('보관함과 규칙: 규칙에 맞는 것만, 상한까지 (6단계)', () => {
  const s = parseSettings({
    petLibrary: [
      {
        id: 'p-a1',
        name: '치즈',
        image: 'pet-1.png',
        model: 'model-1.json',
        poses: { happy: 'pose-happy-1.png' },
      },
      { id: 'p-a2', name: '바둑', image: '../etc/passwd' },
      { id: 'bad', name: '이름', image: 'pet-2.png' },
      { id: 'p-a3', name: '', image: 'pet-3.png' },
    ],
    petRules: `${'가'.repeat(5000)}\r\n`,
    petKind: 'bunny',
  });
  assert.deepEqual(s.petLibrary, [
    {
      id: 'p-a1',
      name: '치즈',
      image: 'pet-1.png',
      model: 'model-1.json',
      poses: { happy: 'pose-happy-1.png' },
    },
  ]);
  assert.equal(s.petRules.length, 4000);
  assert.equal(s.petKind, 'bunny');
  assert.equal(parseSettings({ petKind: 'dragon' }).petKind, 'kong');
});

test('집중 길이와 커서 바라보기: 옛 설정 파일엔 없어서 기본값(25분, 켬), 틀린 값은 지금 값', () => {
  const old = parseSettings({ petName: '밤', chatter: 'chatty' });
  assert.equal(old.focusMin, 25);
  assert.equal(old.lookAtCursor, true);
  assert.equal(parseSettings({ focusMin: 50 }).focusMin, 50);
  assert.equal(applyPatch({ ...DEFAULT_SETTINGS, focusMin: 15 }, { focusMin: 40 }).focusMin, 15);
  assert.equal(applyPatch(DEFAULT_SETTINGS, { focusMin: '50' }).focusMin, 25);
  assert.equal(applyPatch(DEFAULT_SETTINGS, { lookAtCursor: false }).lookAtCursor, false);
  assert.equal(applyPatch(DEFAULT_SETTINGS, { lookAtCursor: 'no' }).lookAtCursor, true);
});

test('하루 리듬: 옛 설정 파일엔 없어서 켬, 틀린 값은 지금 값', () => {
  assert.equal(parseSettings({ petName: '밤' }).dayRhythm, true);
  assert.equal(parseSettings({ dayRhythm: false }).dayRhythm, false);
  assert.equal(applyPatch(DEFAULT_SETTINGS, { dayRhythm: false }).dayRhythm, false);
  assert.equal(applyPatch(DEFAULT_SETTINGS, { dayRhythm: 'off' }).dayRhythm, true);
});

test('부스트 모드: 옛 설정 파일엔 없어서 끔, 틀린 값은 지금 값', () => {
  assert.equal(parseSettings({ petName: '밤' }).boost, false);
  assert.equal(applyPatch(DEFAULT_SETTINGS, { boost: true }).boost, true);
  assert.equal(applyPatch({ ...DEFAULT_SETTINGS, boost: true }, { boost: 'yes' }).boost, true);
});

test('AI 일러스트 그리는 곳: 옛 설정 파일엔 없어서 무료 서버, 옛 mac 은 local, 틀린 값은 지금 값', () => {
  assert.equal(parseSettings({ petName: '밤' }).illustEngine, 'cloud');
  assert.equal(parseSettings({ illustEngine: 'local' }).illustEngine, 'local');
  // 내 Mac에서(옛 값 mac)를 고른 사람은 내 컴퓨터에서로 그대로 남는다
  assert.equal(parseSettings({ illustEngine: 'mac' }).illustEngine, 'local');
  assert.equal(applyPatch(DEFAULT_SETTINGS, { illustEngine: 'local' }).illustEngine, 'local');
  assert.equal(applyPatch(DEFAULT_SETTINGS, { illustEngine: 'mac' }).illustEngine, 'local');
  assert.equal(
    applyPatch({ ...DEFAULT_SETTINGS, illustEngine: 'local' }, { illustEngine: 'gpu' }).illustEngine,
    'local',
  );
  assert.equal(parseSettings({ illustEngine: 7 }).illustEngine, 'cloud');
});

test('하루 회고 받기: 예전 저장 파일은 그때 동작대로(조용히면 끔), 그 뒤로는 수다 빈도와 따로', () => {
  assert.equal(parseSettings({ chatter: 'quiet' }).review, false);
  assert.equal(parseSettings({ chatter: 'normal' }).review, true);
  assert.equal(parseSettings({}).review, true);
  assert.equal(parseSettings({ chatter: 'quiet', review: true }).review, true);
  // 켜 둔 채 조용히로 바꿔도 회고는 그대로
  const on = parseSettings({ chatter: 'normal', review: true });
  assert.equal(applyPatch(on, { chatter: 'quiet' }).review, true);
  assert.equal(applyPatch(on, { review: false }).review, false);
});

test('이름 글자 수: 사람이 보는 글자로 센다 (이모지 묶음, 국기, 풀어 쓴 한글도 한 글자)', () => {
  const family = '👨‍👩‍👧'; // 코드 포인트 5개, UTF-16 8칸
  const flag = '🇰🇷'; // 코드 포인트 2개
  const nfd = '한'.normalize('NFD'); // ㅎ ㅏ ㄴ 세 코드 포인트
  assert.equal(petNameLength(family), 1);
  assert.equal(petNameLength(flag), 1);
  assert.equal(petNameLength(nfd), 1);
  assert.equal(petNameLength('👍🏽'), 1);
  assert.equal(petNameLength('콩이'), 2);
  // 12개 묶음은 그대로, 13개면 12개에서 멈추고 묶음이 깨지지 않는다
  assert.equal(cleanPetName(family.repeat(12)), family.repeat(12));
  assert.equal(cleanPetName(family.repeat(13)), family.repeat(12));
  assert.equal(cleanPetName(flag.repeat(13)), flag.repeat(12));
  // 풀어 쓴 한글은 모아 쓴 한글로 저장한다 (같은 이름이 둘로 보이지 않게)
  assert.equal(cleanPetName(nfd.repeat(13)), '한'.repeat(12));
  // 입력 칸 자르기(clip)와 저장 자르기(clean)가 같은 곳에서 끊는다
  for (const raw of [family.repeat(14), `${'가'.repeat(11)}${flag}${flag}`, '🐶'.repeat(20), nfd.repeat(15)])
    assert.equal(cleanPetName(clipPetName(raw)), cleanPetName(raw), raw);
  assert.equal(petNameLength(clipPetName('🐶'.repeat(20))), PET_NAME_MAX);
  // 상한 안이면 입력 그대로 둔다 (앞뒤 공백 포함, 저장할 때 다듬는다)
  assert.equal(clipPetName(' 콩 '), ' 콩 ');
  // 결합 문자를 잔뜩 붙인 한 글자로 이름이 커지지 않게 코드 포인트도 막는다
  const zalgo = `a${'\u0301'.repeat(500)}`;
  assert.ok([...(cleanPetName(zalgo.repeat(3)) ?? '')].length <= PET_NAME_MAX * 8);
});

test('기본 이름은 모습을 따른다: 콩이, 냥이, 삐약이, 멍멍이, 토순이, 햄찌, 뒤뚱이, 곰돌이 (영어도)', () => {
  assert.deepEqual(
    PET_KINDS.map((k) => defaultPetName(k.id)),
    ['콩이', '냥이', '삐약이', '멍멍이', '토순이', '햄찌', '뒤뚱이', '곰돌이'],
  );
  setLang('en');
  try {
    assert.deepEqual(
      PET_KINDS.map((k) => defaultPetName(k.id)),
      ['Kongi', 'Kitty', 'Peeps', 'Buddy', 'Bunbun', 'Nibbles', 'Waddles', 'Teddy'],
    );
  } finally {
    setLang('ko');
  }
});

test('이름을 손대지 않았으면 기본 펫 모습을 바꿀 때 이름이 따라간다', () => {
  const fresh: Settings = { ...DEFAULT_SETTINGS };
  const follow = (prev: Settings, patch: Record<string, unknown>) =>
    followKindName(prev, applyPatch(prev, patch), patch);
  // 첫 안내에서 냥이를 고르면 냥이
  const cat = follow(fresh, { petKind: 'cat', petImage: null });
  assert.equal(cat.petName, '냥이');
  assert.equal(follow(cat, { petKind: 'bunny' }).petName, '토순이');
  // 모습이 그대로면(다른 설정만 바뀌면) 이름도 그대로
  assert.equal(follow({ ...fresh, petName: '아무개' }, { wander: false }).petName, '아무개');
  // 이름을 손댔으면 그대로
  const named = { ...fresh, petName: '몽실이', petNameEdited: true };
  assert.equal(follow(named, { petKind: 'dog' }).petName, '몽실이');
  // 이름을 같이 바꾸는 변경(보관한 사진 펫 꺼내기)은 그 이름
  assert.equal(follow(fresh, { petKind: 'dog', petName: '바둑이' }).petName, '바둑이');
  // 사진 펫으로 바꾸는 변경은 건드리지 않는다
  assert.equal(follow(fresh, { petImage: 'pet-1.png' }).petName, '콩이');
  // 사진 펫에서 기본 펫으로 돌아오면(같은 모습이어도) 그 모습의 기본 이름
  const photo = { ...fresh, petImage: 'pet-1.png', petName: '찰칵이' };
  assert.equal(follow(photo, { petImage: null }).petName, '콩이');
});

test('사진 펫(밀크)에서 기본 펫으로 돌아오면 손댄 이름 표시가 있어도 그 모습의 기본 이름', () => {
  const follow = (prev: Settings, patch: Record<string, unknown>) =>
    followKindName(prev, applyPatch(prev, patch), patch);
  // 예전에 이름을 지은 적이 있어 표시가 남은 채 밀크를 골랐다. 밀크 이름은 밀크와 같이 보관함으로 간다
  const milk: Settings = {
    ...DEFAULT_SETTINGS,
    petImage: 'pet-milk-1.png',
    petName: '밀크',
    petNameEdited: true,
  };
  const back = follow(milk, { petKind: 'cat', petImage: null });
  assert.equal(back.petName, '냥이');
  // 그 뒤 기본 펫끼리 바꾸면 이름이 따라간다 (새 이름은 아직 손대지 않았다)
  assert.equal(back.petNameEdited, false);
  assert.equal(follow(back, { petKind: 'dog' }).petName, '멍멍이');
  // 기본 펫에 지은 이름은 기본 펫끼리 바꿔도 지킨다
  const named = { ...DEFAULT_SETTINGS, petName: '몽실이', petNameEdited: true };
  assert.equal(follow(named, { petKind: 'dog' }).petName, '몽실이');
  // 기본 펫으로 오면서 이름을 같이 주면 그 이름
  assert.equal(follow(milk, { petImage: null, petName: '뭉치' }).petName, '뭉치');
});

test('손댄 이름 표시: 저장 파일 값을 읽고, 이상한 값은 그대로 둔다', () => {
  assert.equal(DEFAULT_SETTINGS.petNameEdited, false);
  assert.equal(parseSettings({ petNameEdited: true }).petNameEdited, true);
  assert.equal(
    applyPatch({ ...DEFAULT_SETTINGS, petNameEdited: true }, { petNameEdited: 'no' }).petNameEdited,
    true,
  );
});

test('사진 펫 기본 이름: 찰칵이, 겹치면 찰칵이 2, 3', () => {
  assert.equal(photoPetName([]), '찰칵이');
  assert.equal(photoPetName(['콩이']), '찰칵이');
  assert.equal(photoPetName(['콩이', '찰칵이']), '찰칵이 2');
  assert.equal(photoPetName(['찰칵이', '찰칵이 2', '찰칵이 3']), '찰칵이 4');
  setLang('en');
  try {
    assert.equal(photoPetName(['Snappy']), 'Snappy 2');
  } finally {
    setLang('ko');
  }
});

test('설정 파일의 시스템 단축키(복사, 종료)는 등록하지 않는다 (두 운영체제 모두 막는 조합)', () => {
  const now = DEFAULT_SETTINGS;
  assert.deepEqual(applyPatch(now, { shortcuts: { hide: 'CommandOrControl+C' } }).shortcuts, now.shortcuts);
  assert.deepEqual(
    applyPatch(now, { shortcuts: { quickAdd: 'CommandOrControl+V' } }).shortcuts,
    now.shortcuts,
  );
  assert.equal(
    applyPatch(now, { shortcuts: { hide: 'CommandOrControl+Alt+Shift+K' } }).shortcuts.hide,
    'CommandOrControl+Alt+Shift+K',
  );
});

test('걸음새 고르기: 옛 설정 파일엔 없어서 자동, 몸마다 따로, 틀린 값과 안 쓰는 몸은 버린다', () => {
  // 옛 설정 파일 (칸 없음) → 자동
  const old = parseSettings({ petKind: 'cat' });
  assert.deepEqual(old.petGaits, {});
  assert.deepEqual(old.petWishes, {});
  assert.equal(pickedGait(old), undefined);
  // 기본 펫은 kind:<모양>, 2D 와 입체가 같은 값
  assert.equal(bodyKey(old), 'kind:cat');
  const two = applyPatch(old, gaitPatch(old, 'biped'));
  assert.deepEqual(two.petGaits, { 'kind:cat': 'biped' });
  assert.equal(pickedGait(two), 'biped');
  // 다른 모양으로 바꾸면 그 모양 값(자동), 돌아오면 다시 고른 값
  assert.equal(pickedGait({ ...two, petKind: 'dog' }), undefined);
  // 자동을 고르면 키를 지운다
  assert.deepEqual(applyPatch(two, gaitPatch(two, 'auto')).petGaits, {});
  // 입체 사진 펫은 설계도 파일 이름이 열쇠, 보관한 펫은 자기 설계도 열쇠로 따로
  const photo = parseSettings({
    petImage: 'pet-1.png',
    petModel: 'model-1.json',
    petLibrary: [{ id: 'p-a', name: '초코', image: 'pet-2.png', model: 'model-2.json', poses: {} }],
    petGaits: {
      'model-1.json': 'quadruped',
      'model-2.json': 'biped',
      // 아무도 안 쓰는 설계도, 모르는 모양, 틀린 값은 버린다
      'model-9.json': 'biped',
      'kind:dragon': 'biped',
      'kind:dog': 'flying',
      '../x.json': 'biped',
    },
    petWishes: { 'model-1.json': '  졸린 눈\n', 'model-9.json': '없는 펫', 'kind:cat': '사진 없음' },
  });
  assert.equal(bodyKey(photo), 'model-1.json');
  assert.deepEqual(photo.petGaits, { 'model-1.json': 'quadruped', 'model-2.json': 'biped' });
  assert.deepEqual(photo.petWishes, { 'model-1.json': '졸린 눈' });
  assert.equal(pickedGait(photo), 'quadruped');
  // 평면 사진(설계도 없음)은 다리가 없어 고를 수 없다
  const flat = parseSettings({ petImage: 'pet-1.png', petGaits: { 'kind:cat': 'biped' } });
  assert.equal(bodyKey(flat), undefined);
  assert.equal(pickedGait(flat), undefined);
  assert.equal(gaitPatch(flat, 'quadruped'), undefined);
  // 몸을 다시 만들어 설계도 파일이 바뀌면 옛 열쇠는 빠진다
  const remade = applyPatch(photo, { petModel: 'model-3.json' });
  assert.deepEqual(remade.petGaits, { 'model-2.json': 'biped' });
  assert.deepEqual(remade.petWishes, {});
  // 객체가 아닌 값은 지금 값을 지킨다
  assert.deepEqual(applyPatch(photo, { petGaits: 'quadruped' }).petGaits, photo.petGaits);
});

test('친구 펫 걸음새: 친구마다 따로, 틀린 값은 자동', () => {
  const s = parseSettings({
    friends: [
      { id: 'f-a', name: '보리', kind: 'cat', gait: 'biped' },
      { id: 'f-b', name: '두부', kind: 'kong', gait: 'hop' },
      { id: 'f-c', name: '콩떡', kind: 'kong' },
    ],
  });
  assert.equal(s.friends[0]?.gait, 'biped');
  assert.equal(s.friends[1]?.gait, undefined);
  assert.equal('gait' in (s.friends[2] ?? {}), false);
});

test('AI 일러스트 나이 단계: 사진 펫에만, 보관함에도. 옛 설정은 없이 읽는다', () => {
  const old = parseSettings({
    petImage: 'pet-1.png',
    petLibrary: [{ id: 'p-a', name: '콩', image: 'pet-2.png' }],
  });
  assert.equal(old.petAge, undefined);
  assert.equal(old.petLibrary[0]?.age, undefined);
  const s = parseSettings({
    petImage: 'pet-1.png',
    petAge: 'baby',
    petLibrary: [
      { id: 'p-a', name: '콩', image: 'pet-2.png', age: 'teen' },
      { id: 'p-b', name: '팥', image: 'pet-3.png', age: 'ancient' },
    ],
  });
  assert.equal(s.petAge, 'baby');
  assert.equal(s.petLibrary[0]?.age, 'teen');
  assert.equal(s.petLibrary[1]?.age, undefined);
  assert.equal(parseSettings({ petAge: 'baby' }).petAge, undefined, '사진 펫이 없으면 나이도 없다');
  assert.equal(parseSettings({ petImage: 'pet-1.png', petAge: 'giant' }).petAge, undefined);
  assert.equal(applyPatch(s, { petAge: null }).petAge, undefined);
  assert.equal(applyPatch(s, { petAge: 'adult' }).petAge, 'adult');
  assert.equal(applyPatch(s, { petName: '두부' }).petAge, 'baby');
  assert.equal(applyPatch(s, { petImage: null }).petAge, undefined, '기본 펫으로 가면 나이도 지운다');
});

test('짝꿍이 기억하는 것: 기본 비어 있고, 옛 설정 파일에는 없어도 빈 목록, 다듬어 30개까지', () => {
  assert.deepEqual(DEFAULT_SETTINGS.petMemory, []);
  // 이 칸이 생기기 전 설정 파일
  assert.deepEqual(parseSettings({ petName: '콩이', petRules: '짧게' }).petMemory, []);
  assert.deepEqual(parseSettings({ petMemory: 'x' }).petMemory, []);
  assert.deepEqual(
    parseSettings({ petMemory: [' 커피\n좋아함 ', 3, '', '커피 좋아함', '가'.repeat(120)] }).petMemory,
    ['커피 좋아함', '가'.repeat(100)],
  );
  const many = Array.from({ length: 35 }, (_, i) => `기억 ${i}`);
  const kept = parseSettings({ petMemory: many }).petMemory;
  assert.equal(kept.length, 30);
  assert.equal(kept[0], '기억 5');
  // 화면에서 바꾸기 (applyPatch): 틀린 값이면 그대로
  const now = parseSettings({ petMemory: ['커피'] });
  assert.deepEqual(applyPatch(now, { petMemory: ['커피', '차'] }).petMemory, ['커피', '차']);
  assert.deepEqual(applyPatch(now, { petMemory: null }).petMemory, ['커피']);
  assert.deepEqual(applyPatch(now, { petMemory: [] }).petMemory, []);
});

test('단축키 옮기기: 새 기본 키가 사용자 키와 겹치면 새 쪽만 비운다 (사용자 키는 그대로)', () => {
  // 예전 파일에는 hide, quickAdd 만 있다. 사용자가 숨기기를 새 "대화" 기본 키로 바꿔 두었다
  const old = parseSettings({
    shortcuts: { hide: 'CommandOrControl+Alt+Shift+J', quickAdd: 'CommandOrControl+Alt+Shift+K' },
  });
  assert.equal(old.shortcuts.hide, 'CommandOrControl+Alt+Shift+J');
  assert.equal(old.shortcuts.quickAdd, 'CommandOrControl+Alt+Shift+K');
  assert.equal(old.shortcuts.chat, '');
  assert.equal(old.shortcuts.look, 'CommandOrControl+Alt+Shift+L');
  const both = parseSettings({
    shortcuts: { hide: 'CommandOrControl+Alt+Shift+L', quickAdd: 'CommandOrControl+Alt+Shift+J' },
  });
  assert.equal(both.shortcuts.hide, 'CommandOrControl+Alt+Shift+L');
  assert.equal(both.shortcuts.quickAdd, 'CommandOrControl+Alt+Shift+J');
  assert.equal(both.shortcuts.chat, '');
  assert.equal(both.shortcuts.look, '');
  // 겹치지 않으면 새 기본 키를 그대로 준다
  const plain = parseSettings({ shortcuts: { hide: 'CommandOrControl+Alt+Shift+K' } });
  assert.equal(plain.shortcuts.chat, 'CommandOrControl+Alt+Shift+J');
  // 비운 키는 저장하고 다시 읽어도 비어 있고, 다른 빈 키와 겹친다고 보지 않는다
  const saved = parseSettings(JSON.parse(JSON.stringify(both)));
  assert.deepEqual(saved.shortcuts, both.shortcuts);
  // 설정 창에서 빈 키에 새 키를 넣을 수 있다
  assert.equal(
    applyPatch(both, { shortcuts: { ...both.shortcuts, chat: 'CommandOrControl+Alt+Shift+O' } }).shortcuts
      .chat,
    'CommandOrControl+Alt+Shift+O',
  );
  // 일부만 바꾸는 요청은 처음부터 있던 키를 비우지 않는다
  const now = { ...DEFAULT_SETTINGS };
  assert.deepEqual(applyPatch(now, { shortcuts: { hide: now.shortcuts.quickAdd } }).shortcuts, now.shortcuts);
});

test('패널 단축키 옮기기: 예전 파일에는 없어 기본 키를 주고, 사용자 키와 겹치면 패널 쪽만 비운다', () => {
  const T = 'CommandOrControl+Alt+Shift+T';
  // 패널 키가 생기기 전 파일 (hide, quickAdd, chat, look 만)
  const before = {
    hide: 'CommandOrControl+Alt+Shift+H',
    quickAdd: 'CommandOrControl+Alt+Shift+N',
    chat: 'CommandOrControl+Alt+Shift+J',
    look: 'CommandOrControl+Alt+Shift+L',
  };
  assert.equal(parseSettings({ shortcuts: before }).shortcuts.panel, T);
  // 사용자가 같이 보기를 T 로 바꿔 두었으면 같이 보기는 그대로, 패널은 비운다 (설정에 "없음")
  const taken = parseSettings({ shortcuts: { ...before, look: T } });
  assert.equal(taken.shortcuts.look, T);
  assert.equal(taken.shortcuts.panel, '');
  // 숨기기(처음부터 있던 키)를 T 로 바꿔 두어도 마찬가지
  assert.equal(parseSettings({ shortcuts: { ...before, hide: T } }).shortcuts.panel, '');
  // 끈 패널 키는 저장하고 다시 읽어도 꺼져 있다
  const off = parseSettings({ shortcuts: { ...before, panel: '' } });
  assert.equal(off.shortcuts.panel, '');
  assert.equal(parseSettings(JSON.parse(JSON.stringify(off))).shortcuts.panel, '');
  // 비운 패널 키에 새 키를 넣을 수 있고, 다른 키와 같으면 받지 않는다
  assert.equal(
    applyPatch(taken, { shortcuts: { ...taken.shortcuts, panel: 'CommandOrControl+Alt+Shift+K' } }).shortcuts
      .panel,
    'CommandOrControl+Alt+Shift+K',
  );
  assert.equal(applyPatch(taken, { shortcuts: { ...taken.shortcuts, panel: T } }).shortcuts.panel, '');
  // 새로 깐 사람은 기본 키 그대로
  assert.equal(DEFAULT_SETTINGS.shortcuts.panel, T);
});

test('펫 고르기 단축키 옮기기: 사용자가 이미 P 를 다른 단축키에 쓰면 펫 고르기를 비운다', () => {
  const P = 'CommandOrControl+Alt+Shift+P';
  const s = parseSettings({ shortcuts: { panel: P } });
  assert.equal(s.shortcuts.panel, P);
  assert.equal(s.shortcuts.pet, '');
  assert.equal(parseSettings({}).shortcuts.pet, P);
});

test('편의 새 칸: 주소 받기, 배터리 절약, 읽어 주기, 메뉴 막대 글자', () => {
  const d = parseSettings({});
  assert.equal(d.urlScheme, true);
  assert.equal(d.batterySaver, 'auto');
  assert.equal(d.readAloud, true);
  assert.equal(d.trayTitle, false);
  const s = parseSettings({ urlScheme: false, batterySaver: 'always', readAloud: false, trayTitle: true });
  assert.deepEqual([s.urlScheme, s.batterySaver, s.readAloud, s.trayTitle], [false, 'always', false, true]);
  assert.equal(parseSettings({ batterySaver: 'max' }).batterySaver, 'auto');
});

test('펫 이름표(만든 사람, 허락): 옛 설정은 없이, 틀린 값은 버리고, 보관함에도', () => {
  const meta = { author: '짝꿍', license: 'CC-BY-4.0', created: '2026-10-11', appVersion: '1.2.0' } as const;
  const old = parseSettings({
    petImage: 'pet-1.png',
    petLibrary: [{ id: 'p-a', name: '콩', image: 'pet-2.png' }],
  });
  assert.equal(old.petMeta, undefined);
  assert.equal(old.petLibrary[0]?.meta, undefined);
  const s = parseSettings({
    petImage: 'pet-1.png',
    petMeta: meta,
    petLibrary: [
      {
        id: 'p-a',
        name: '콩',
        image: 'pet-2.png',
        meta: { license: 'CC0-1.0', created: '2026-01-02', appVersion: '1.0.0' },
      },
      {
        id: 'p-b',
        name: '팥',
        image: 'pet-3.png',
        meta: { license: 'MIT', created: '2026-01-02', appVersion: '1.0.0' },
      },
    ],
  });
  assert.deepEqual(s.petMeta, meta);
  assert.deepEqual(s.petLibrary[0]?.meta, { license: 'CC0-1.0', created: '2026-01-02', appVersion: '1.0.0' });
  assert.equal(s.petLibrary[1]?.meta, undefined, '모르는 허락은 버린다');
  assert.equal(parseSettings({ petMeta: { ...meta, created: 'yesterday' } }).petMeta, undefined);
  assert.equal(applyPatch(s, { petMeta: null }).petMeta, undefined);
  assert.deepEqual(applyPatch(s, { petName: '두부' }).petMeta, meta, '이름만 바꾸면 그대로');
  assert.deepEqual(
    applyPatch(s, { petMeta: { author: 1 } as never }).petMeta,
    meta,
    '틀린 값은 지금 것 그대로',
  );
});

test('개인 용도 페어리 표시(petPersonal): 설계도 펫에만, 켠 것만, 펫이 바뀌면 옛 열쇠는 빠진다', () => {
  const s = parseSettings({
    petImage: 'pet-1.png',
    petModel: 'model-1.json',
    petLibrary: [{ id: 'p-a', name: '구름', image: 'pet-2.png', model: 'model-2.json', poses: {} }],
    petPersonal: { 'model-1.json': true, 'model-2.json': true, 'model-9.json': true, 'kind:cat': true },
  });
  assert.deepEqual(s.petPersonal, { 'model-1.json': true, 'model-2.json': true });
  assert.equal(isPersonalPet(s), true);
  assert.deepEqual(parseSettings({ petPersonal: { 'model-1.json': 'yes' } }).petPersonal, {});
  // 설계도가 바뀌면(새 펫) 표시가 따라가지 않는다
  const next = applyPatch(s, { petModel: 'model-3.json' });
  assert.equal(isPersonalPet(next), false);
  assert.deepEqual(next.petPersonal, { 'model-2.json': true });
  // 그림 없는 기본 펫은 개인 용도가 아니다
  assert.equal(isPersonalPet(DEFAULT_SETTINGS), false);
});

test('개인 용도 표시는 그림 파일 열쇠도 받는다 (설계도 없는 Codex 펫, 이슈 #88)', () => {
  const s = parseSettings({
    petImage: 'pet-1.png',
    petLibrary: [{ id: 'p-a', name: '구름', image: 'pet-2.png', poses: {} }],
    friends: [{ id: 'f-a', name: '친구', kind: 'kong', image: 'pet-3.png' }],
    petPersonal: { 'pet-1.png': true, 'pet-2.png': true, 'pet-3.png': true, 'pet-9.png': true },
  });
  assert.deepEqual(s.petPersonal, { 'pet-1.png': true, 'pet-2.png': true, 'pet-3.png': true });
  assert.equal(isPersonalPet(s), true);
  // 나중에 입체 몸을 만들어도(설계도가 생겨도) 그림이 같으면 표시가 남는다
  assert.equal(isPersonalPet(applyPatch(s, { petModel: 'model-1.json' })), true);
  // 다른 그림이면 아니다
  assert.equal(isPersonalPet(applyPatch(s, { petImage: 'pet-4.png' })), false);
});

test('말로 만든 처음 글(petTexts): 설계도 펫에만, 글만, 없던 판의 설정은 빈 칸으로', () => {
  const s = parseSettings({
    petImage: 'pet-1.png',
    petModel: 'model-1.json',
    petLibrary: [{ id: 'p-a', name: '구름', image: 'pet-2.png', model: 'model-2.json', poses: {} }],
    petTexts: { 'model-1.json': ' 하얀 고양이 ', 'model-2.json': 42, 'model-9.json': '옛 펫' },
  });
  assert.deepEqual(s.petTexts, { 'model-1.json': '하얀 고양이' });
  // 이 칸이 생기기 전 설정 파일
  assert.deepEqual(parseSettings({ petImage: 'pet-1.png', petModel: 'model-1.json' }).petTexts, {});
  assert.deepEqual(parseSettings({ petTexts: { 'model-1.json': 'x'.repeat(5000) } }).petTexts, {});
});

test('패널 고정: 기본은 꺼짐, 켜고 끄고, 틀린 값은 지금 값', () => {
  assert.equal(DEFAULT_SETTINGS.panelPin, false);
  assert.equal(parseSettings({ panelPin: true }).panelPin, true);
  assert.equal(parseSettings({ panelPin: 'yes' }).panelPin, false);
  assert.equal(parseSettings({}).panelPin, false);
  const on = applyPatch(DEFAULT_SETTINGS, { panelPin: true });
  assert.equal(on.panelPin, true);
  assert.equal(applyPatch(on, { panelPin: 1 }).panelPin, true);
  assert.equal(applyPatch(on, { panelPin: false }).panelPin, false);
});

test('패널 보기: 기본은 작은 패널, 큰 창으로 바꾸고, 모르는 값은 지금 값', () => {
  assert.equal(DEFAULT_SETTINGS.panelView, 'compact');
  assert.equal(parseSettings({}).panelView, 'compact');
  assert.equal(parseSettings({ panelView: 'window' }).panelView, 'window');
  assert.equal(parseSettings({ panelView: 'compact' }).panelView, 'compact');
  // 옛 설정 파일이나 손으로 고친 값: 작은 패널로
  for (const bad of ['big', 'Window', '', 1, true, null, {}]) {
    assert.equal(parseSettings({ panelView: bad }).panelView, 'compact', String(bad));
  }
  const win = applyPatch(DEFAULT_SETTINGS, { panelView: 'window' });
  assert.equal(win.panelView, 'window');
  // 틀린 값으로 고치려 하면 지금 값을 지킨다 (compact 로 돌아가지 않는다)
  assert.equal(applyPatch(win, { panelView: 'huge' }).panelView, 'window');
  assert.equal(applyPatch(win, { panelView: 'compact' }).panelView, 'compact');
  // 다른 칸을 고쳐도 그대로
  assert.equal(applyPatch(win, { panelPin: true }).panelView, 'window');
});

test('큰 창 열기 단축키: 기본은 비어 있다 (새 전역 키를 멋대로 잡지 않는다)', () => {
  assert.equal(DEFAULT_SETTINGS.shortcuts.home, '');
  assert.equal(parseSettings({}).shortcuts.home, '');
  // 옛 설정 파일(home 이 없는 단축키)에서도 다른 단축키는 그대로
  const old = parseSettings({ shortcuts: { hide: 'CommandOrControl+Alt+Shift+K' } });
  assert.equal(old.shortcuts.hide, 'CommandOrControl+Alt+Shift+K');
  assert.equal(old.shortcuts.home, '');
  // 사용자가 정하면 받는다
  const mine = parseSettings({ shortcuts: { home: 'CommandOrControl+Alt+Shift+O' } });
  assert.equal(mine.shortcuts.home, 'CommandOrControl+Alt+Shift+O');
});
