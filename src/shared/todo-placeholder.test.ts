// 추가 칸 예시 글(placeholder)을 그대로 넣으면 시각 마감이 잡힌다 (ko, en)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang, t } from './i18n/index.ts';
import { parseTodoLine } from './remind-parse.ts';

for (const lang of ['ko', 'en'] as const) {
  test(`${lang}: 추가 칸 예시가 시각 마감 할 일로 읽힌다`, () => {
    setLang(lang);
    const hint = t('panel.todo.placeholder');
    const example = /\((?:예|e\.g\.):? (.+)\)$/.exec(hint)?.[1]?.replace(/!$/, '');
    assert.ok(example, hint);
    const r = parseTodoLine(example, '2026-11-02', 9 * 60);
    assert.equal(r.due, '2026-11-03');
    assert.equal(r.dueMin, 15 * 60);
    assert.ok(r.title.length > 0);
  });
}
