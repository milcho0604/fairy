import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from './i18n/index.ts';
import {
  applyPatch,
  cleanPetName,
  clipPetName,
  DEFAULT_SETTINGS,
  defaultPetName,
  followKindName,
  PET_KINDS,
  PET_NAME_MAX,
  parseSettings,
  petNameLength,
  photoPetName,
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

test('예전 펫 설정 파일(pet-settings.json)의 값도 읽는다', () => {
  assert.deepEqual(parseSettings({ chatter: 'quiet', hideHints: 2 }), {
    ...DEFAULT_SETTINGS,
    chatter: 'quiet',
    hideHints: 2,
    // 그때 조용히면 회고가 안 왔다. 같은 동작으로 읽는다
    review: false,
  });
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
  assert.equal(PET_KINDS[0]?.label, '콩');
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

test('부스트 모드: 옛 설정 파일엔 없어서 끔, 틀린 값은 지금 값', () => {
  assert.equal(parseSettings({ petName: '밤' }).boost, false);
  assert.equal(applyPatch(DEFAULT_SETTINGS, { boost: true }).boost, true);
  assert.equal(applyPatch({ ...DEFAULT_SETTINGS, boost: true }, { boost: 'yes' }).boost, true);
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

test('기본 이름은 모습을 따른다: 콩이, 냥이, 삐약이, 멍멍이, 토순이 (영어도)', () => {
  assert.deepEqual(
    PET_KINDS.map((k) => defaultPetName(k.id)),
    ['콩이', '냥이', '삐약이', '멍멍이', '토순이'],
  );
  setLang('en');
  try {
    assert.deepEqual(
      PET_KINDS.map((k) => defaultPetName(k.id)),
      ['Kongi', 'Kitty', 'Peeps', 'Buddy', 'Bunbun'],
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
    applyPatch(now, { shortcuts: { hide: 'CommandOrControl+Alt+Shift+J' } }).shortcuts.hide,
    'CommandOrControl+Alt+Shift+J',
  );
});
