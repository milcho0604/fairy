import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { grantInput, Refused, tabFromPath } from './admin';
import { type AdminView, usersTable } from './admin-page';

describe('운영자 탭과 지급 폼', () => {
  test('탭 주소는 정해진 주소만 받는다', () => {
    assert.equal(tabFromPath('/admin'), 'overview');
    assert.equal(tabFromPath('/admin/users'), 'users');
    assert.equal(tabFromPath('/admin/grants'), 'grants');
    assert.equal(tabFromPath('/admin/notices'), 'notices');
    assert.equal(tabFromPath('/admin/events'), 'events');
    assert.equal(tabFromPath('/admin/features'), 'features');
    assert.equal(tabFromPath('/admin/ai'), 'ai');
    assert.equal(tabFromPath('/admin/log'), 'log');
    assert.equal(tabFromPath('/admin/private'), undefined);
  });

  test('지급 폼은 확인, 인원, 양과 사유 상한을 검사한다', () => {
    assert.deepEqual(
      grantInput({
        accounts: 'F-1111-1111\nF-2222-2222',
        coins: '10',
        chat_passes: '2',
        reason: '보상 지급',
        confirm: 'yes',
      }),
      {
        refs: ['F-1111-1111', 'F-2222-2222'],
        coins: 10,
        passes: 2,
        reason: '보상 지급',
        days: 30,
      },
    );
    for (const fields of [
      { accounts: 'F-1111-1111', coins: '1', reason: '사유' },
      { accounts: 'F-1111-1111', coins: '10001', reason: '사유', confirm: 'yes' },
      { accounts: 'F-1111-1111', chat_passes: '1001', reason: '사유', confirm: 'yes' },
      { accounts: 'F-1111-1111', coins: '1', reason: '', confirm: 'yes' },
      {
        accounts: Array.from({ length: 21 }, (_, i) => `F-1111-${String(i).padStart(4, '0')}`).join('\n'),
        coins: '1',
        reason: '사유',
        confirm: 'yes',
      },
    ])
      assert.throws(() => grantInput(fields), Refused);
  });

  test('이용자 표는 닉네임을 이스케이프하고 공개 열만 그린다', () => {
    const view = {
      users: {
        rows: [
          {
            id: '7',
            code: 'F-1111-2222',
            nickname: '<b>고양이</b>',
            logins: ['google'],
            age: '18+',
            balance: 30,
            tickets: 4,
            lastActive: Date.UTC(2026, 9, 16),
            created: Date.UTC(2026, 9, 1),
            appVersion: '1.2.3',
          },
        ],
        total: 51,
        page: 1,
        pages: 2,
        query: '',
        sort: 'active',
        direction: 'desc',
      },
      query: undefined,
    } as AdminView;
    const html = usersTable(view);
    assert.doesNotMatch(html, /<b>고양이<\/b>/);
    assert.match(html, /&lt;b&gt;고양이&lt;\/b&gt;/);
    assert.match(html, /F-1111-2222/);
    assert.match(html, /구글/);
    assert.match(html, /1 \/ 2/);
    assert.doesNotMatch(html, /name="email"|token_hash|google-sub-secret/i);
  });
});
