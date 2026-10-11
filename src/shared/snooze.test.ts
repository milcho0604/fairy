import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  choiceOfAction,
  parseRemindIn,
  remindInAt,
  snoozeAction,
  snoozeAt,
  snoozeChoices,
} from './snooze.ts';

const MIN = 60_000;
const local = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

test('미루기 때: 10분, 1시간, 내일은 다음 날 아침 9시 (새벽이면 그날 아침)', () => {
  const now = local(2026, 10, 7, 15, 20);
  assert.equal(snoozeAt('10m', now), now + 10 * MIN);
  assert.equal(snoozeAt('1h', now), now + 60 * MIN);
  assert.equal(snoozeAt('tomorrow', now), local(2026, 10, 8, 9));
  // 달이 바뀌는 날
  assert.equal(snoozeAt('tomorrow', local(2026, 10, 31, 23, 50)), local(2026, 11, 1, 9));
  assert.equal(snoozeAt('tomorrow', local(2026, 10, 8, 2)), local(2026, 10, 8, 9));
});

test('고를 수 있는 미루기: 할 일만이면 셋, 일정이 섞이면 아직 쓸모 있는 것만', () => {
  const now = local(2026, 10, 7, 15);
  assert.deepEqual(snoozeChoices({ now, stale: now + MIN, todosOnly: true }), ['10m', '1h', 'tomorrow']);
  assert.deepEqual(snoozeChoices({ now, stale: now + 30 * MIN, todosOnly: false }), ['10m']);
  assert.deepEqual(snoozeChoices({ now, stale: now + 3 * 60 * MIN, todosOnly: false }), ['10m', '1h']);
  assert.deepEqual(snoozeChoices({ now, stale: now + 5 * MIN, todosOnly: false }), []);
  assert.equal(snoozeAction('1h'), 'snooze:1h');
  assert.equal(choiceOfAction('snooze:tomorrow'), 'tomorrow');
  assert.equal(choiceOfAction('snooze'), undefined);
  assert.equal(choiceOfAction('snooze:2h'), undefined);
  assert.equal(choiceOfAction(undefined), undefined);
});

test('빠른 입력 "N분 뒤 알려 줘": 한국어', () => {
  assert.deepEqual(parseRemindIn('30분 뒤 알려 줘'), { title: '', minutes: 30 });
  assert.deepEqual(parseRemindIn('1시간 후에'), { title: '', minutes: 60 });
  assert.deepEqual(parseRemindIn('빨래 꺼내기 30분 뒤에 알려줘'), { title: '빨래 꺼내기', minutes: 30 });
  assert.deepEqual(parseRemindIn('1시간 반 후에 스트레칭 알림'), { title: '스트레칭', minutes: 90 });
  assert.deepEqual(parseRemindIn('2시간 30분 뒤 약 먹으라고 알려 줘'), { title: '약 먹', minutes: 150 });
  assert.deepEqual(parseRemindIn('한 시간 뒤에 청소하라고 말해 줘'), { title: '청소하기', minutes: 60 });
  assert.deepEqual(parseRemindIn('반 시간 있다가 알려줘'), { title: '', minutes: 30 });
  assert.deepEqual(parseRemindIn('30분뒤알려줘'), { title: '', minutes: 30 });
  // 제목만 있고 알림 말이 없으면 일정 ("30분 뒤 빨래"는 예전처럼)
  assert.equal(parseRemindIn('30분 뒤 빨래'), null);
  // 상대 시각이 없으면 아니다
  assert.equal(parseRemindIn('내일 3시 알려 줘'), null);
  assert.equal(parseRemindIn('보고서 알려 줘'), null);
  // 너무 멀거나 0분
  assert.equal(parseRemindIn('0분 뒤 알려 줘'), null);
  assert.equal(parseRemindIn('200시간 뒤 알려 줘'), null);
  // "3시간 전" 같은 미리 알림 말은 아니다
  assert.equal(parseRemindIn('회의 3시간 전 알려 줘'), null);
});

test('빠른 입력 "in 30 minutes": 영어', () => {
  assert.deepEqual(parseRemindIn('in 30 minutes'), { title: '', minutes: 30 });
  assert.deepEqual(parseRemindIn('remind me in an hour to stretch'), { title: 'stretch', minutes: 60 });
  assert.deepEqual(parseRemindIn('Take pills in 1.5 hours, remind me'), { title: 'Take pills', minutes: 90 });
  assert.deepEqual(parseRemindIn('ping me in half an hour'), { title: '', minutes: 30 });
  assert.deepEqual(parseRemindIn('remind me to call mom 20 minutes from now'), {
    title: 'call mom',
    minutes: 20,
  });
  assert.equal(parseRemindIn('laundry in 30 min'), null); // 일정으로 둔다
  assert.equal(parseRemindIn('remind me tomorrow'), null);
});

test('알림 때는 분 단위로 올린다', () => {
  const now = local(2026, 10, 7, 15, 0) + 20_000;
  assert.equal(remindInAt(now, 30), local(2026, 10, 7, 15, 31));
  assert.equal(remindInAt(local(2026, 10, 7, 15), 30), local(2026, 10, 7, 15, 30));
});
