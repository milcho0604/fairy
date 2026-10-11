import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSettings } from './settings.ts';
import {
  applyStyle,
  CALL_MAX,
  DEFAULT_STYLE,
  describeStyle,
  fillLine,
  LINE_MAX,
  LINES_MAX,
  parseStyle,
  type SpeechStyle,
} from './speech-style.ts';

const ko = (text: string, style: Partial<SpeechStyle>, me = '', greet = false) =>
  applyStyle(text, { ...DEFAULT_STYLE, ...style }, { lang: 'ko', me, greet });

test('말끝은 문장 끝 말에만 붙는다: 따옴표 안 제목, 괄호 속 시각, 이름으로 끝난 문장에는 안 붙는다', () => {
  assert.equal(ko('좋은 아침! 오늘도 같이 하자.', { ending: '냥' }), '좋은 아침! 오늘도 같이 하자냥.');
  assert.equal(
    ko('"보고서 끝냈어. 다 했다!" 끝내느라 수고했어!', { ending: '냥' }),
    '"보고서 끝냈어. 다 했다!" 끝내느라 수고했어냥!',
  );
  assert.equal(
    ko('지금 회의 시작이야! (오전 10:00)', { ending: '멍' }),
    '지금 회의 시작이야멍! (오전 10:00)',
  );
  assert.equal(
    ko('"보고서" 마감까지 2시간 남았어 (오후 3:00)', { ending: '멍' }),
    '"보고서" 마감까지 2시간 남았어멍 (오후 3:00)',
  );
  // 이름이나 이름씨로 끝난 문장, 숫자 조각에는 붙이지 않는다
  assert.equal(
    ko('하나 끝! 앞으로도 잘 부탁해! 너의 짝꿍 콩이', { ending: '냥' }),
    '하나 끝! 앞으로도 잘 부탁해냥! 너의 짝꿍 콩이',
  );
  assert.equal(
    ko("먼저 '디자인 회의 준비해'부터 해 볼까?", { ending: '뿌' }),
    "먼저 '디자인 회의 준비해'부터 해 볼까뿌?",
  );
});

test('말 높이: 해요체 말을 합쇼체와 하오체로 (물음, 같이 하자는 말, 시키는 말, 받침)', () => {
  const hap = (t: string) => ko(t, { level: 'hapsyo' });
  const hao = (t: string) => ko(t, { level: 'hao' });
  assert.equal(
    hap('오늘 일정이 3개 있어요. 첫 일정은 10시 회의예요.'),
    '오늘 일정이 3개 있습니다. 첫 일정은 10시 회의입니다.',
  );
  assert.equal(hap('잘 쉬셨어요? 코인 5개 드려요.'), '잘 쉬셨습니까? 코인 5개 드립니다.');
  assert.equal(hap('푹 쉬세요! 대단하세요!'), '푹 쉬십시오! 대단하십니다!');
  assert.equal(hap('옆에 있을게요. 물 한 잔 드실래요?'), '옆에 있겠습니다. 물 한 잔 드시겠습니까?');
  assert.equal(hap('반가워요. 오늘도 같이 시작해요.'), '반갑습니다. 오늘도 같이 시작합시다.');
  assert.equal(hap('함께한 날이 모두 좋았어요.'), '함께한 날이 모두 좋았습니다.');
  assert.equal(
    hap('지금 "보고서 써요" 마감이에요! (오전 10:00)'),
    '지금 "보고서 써요" 마감입니다! (오전 10:00)',
  );
  assert.equal(hao('오셨네요! 반가워요. 푹 쉬세요.'), '오셨구려! 반갑소. 푹 쉬시오.');
  assert.equal(hao('오늘 마감 3개가 남았어요. 내일로 넘길까요?'), '오늘 마감 3개가 남았소. 내일로 넘기리까?');
  assert.equal(hao('하나예요. 잘 먹겠습니다.'), '하나이오. 잘 먹겠소.');
});

test('부르는 말: 반말의 너, 네를 바꾸고 인사 앞에서 부른다. 내 이름은 반말이면 아/야, 높이면 님', () => {
  assert.equal(
    ko('콩이는 오늘도 네 편이야. 너도 얼른 자.', { call: 'butler' }, '집사'),
    '콩이는 오늘도 집사 편이야. 집사도 얼른 자.',
  );
  assert.equal(ko('좋은 아침!', { call: 'master' }, '주인님', true), '주인님, 좋은 아침!');
  assert.equal(ko('좋은 아침!', { call: 'name', callText: '민지' }, '민지', true), '민지야, 좋은 아침!');
  assert.equal(
    ko('좋은 아침이에요!', { call: 'name', callText: '지민', level: 'haeyo' }, '지민', true),
    '지민님, 좋은 아침이에요!',
  );
});

test('이모지와 느낌표', () => {
  const sun = { lang: 'ko' as const, me: '', emoji: '☀️' };
  assert.equal(applyStyle('좋은 아침! 🎉', { ...DEFAULT_STYLE, emoji: 'none' }, sun), '좋은 아침!');
  assert.equal(applyStyle('좋은 아침!', { ...DEFAULT_STYLE, emoji: 'many' }, sun), '좋은 아침! ☀️');
  assert.equal(applyStyle('좋은 아침!', { ...DEFAULT_STYLE, emoji: 'some' }, sun), '좋은 아침!');
  assert.equal(ko('좋은 아침! 반가워.', { bang: 'soft' }), '좋은 아침. 반가워.');
  assert.equal(ko('좋은 아침! 반가워. 회의 10시.', { bang: 'strong' }), '좋은 아침! 반가워! 회의 10시.');
  assert.equal(ko('정말?! 그래?', { bang: 'soft' }), '정말? 그래?');
});

test('직접 쓴 말의 자리 표시를 채운다', () => {
  assert.equal(
    fillLine('{me}, {name}가 깨웠어! {todo}부터 하자', { name: '콩이', me: '집사', todo: '보고서' }),
    '집사, 콩이가 깨웠어! 보고서부터 하자',
  );
  assert.equal(fillLine('{todo}', { name: '', me: '', todo: '' }), '');
});

test('내 말투 읽기: 길이 제한, 제어 문자 지우기, 모르는 값은 기본값', () => {
  const s = parseStyle({
    level: 'hao',
    ending: '냥냥냥냥!',
    call: 'custom',
    callText: `우리\u0000집\u202e사님${'x'.repeat(40)}`,
    emoji: 'lots',
    bang: 'strong',
    lines: {
      morning: ['  안녕\n잘 잤어?  ', '', 3, 'y'.repeat(200), 'a', 'b', 'c', 'd', 'e'],
      praise: 'no',
      weird: ['x'],
    },
  });
  assert.equal(s.level, 'banmal'); // 하오체는 프리셋만
  assert.equal(s.ending, '냥냥냥');
  assert.equal(s.call, 'custom');
  assert.ok([...s.callText].length <= CALL_MAX);
  assert.equal(s.callText, '우리 집 사님xxx');
  assert.equal(s.emoji, 'some');
  assert.equal(s.bang, 'strong');
  assert.equal(s.lines.morning.length, LINES_MAX);
  assert.equal(s.lines.morning[0], '안녕 잘 잤어?');
  assert.equal([...(s.lines.morning[1] ?? '')].length, LINE_MAX);
  assert.deepEqual(s.lines.praise, []);
  assert.deepEqual(parseStyle(undefined), DEFAULT_STYLE);
  assert.deepEqual(parseStyle('junk'), DEFAULT_STYLE);
});

test('설정: 옛 설정(말투 칸 없음)은 그대로 읽고 내 말투는 기본값, 새 성격도 읽는다', () => {
  const old = parseSettings({ persona: 'polite', petName: '콩이' });
  assert.equal(old.persona, 'polite');
  assert.deepEqual(old.speech, DEFAULT_STYLE);
  const next = parseSettings({ persona: 'custom', speech: { level: 'haeyo', ending: '용' } });
  assert.equal(next.persona, 'custom');
  assert.equal(next.speech.level, 'haeyo');
  assert.equal(next.speech.ending, '용');
  assert.equal(parseSettings({ persona: 'cat' }).persona, 'cat');
  assert.equal(parseSettings({ persona: 'robot' }).persona, 'friend');
});

test('AI 성격 지시에 내 말투를 글로 적는다', () => {
  const d = describeStyle(
    {
      ...DEFAULT_STYLE,
      level: 'haeyo',
      ending: '냥',
      call: 'butler',
      lines: { ...DEFAULT_STYLE.lines, morning: ['좋은 아침이에요 "집사"'] },
    },
    'ko',
  );
  assert.match(d, /해요체/);
  assert.match(d, /냥/);
  assert.match(d, /집사/);
  assert.match(d, /좋은 아침이에요 '집사'/);
  assert.match(describeStyle(DEFAULT_STYLE, 'en'), /casual/);
});
