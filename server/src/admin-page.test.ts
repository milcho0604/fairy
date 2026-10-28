import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { grantInput, legacyPlace, Refused } from './admin';
import {
  ADMIN_CELLS,
  type AdminView,
  adminCss,
  adminJs,
  CELL_SUBS,
  LEGACY_PLACES,
  mainPage,
  todoOf,
  usersTable,
} from './admin-page';

describe('운영자 다섯 칸과 지급 폼', () => {
  test('옛 탭 주소는 새 자리로 가고 모르는 주소는 없다', () => {
    assert.equal(legacyPlace('/admin'), 'home');
    assert.equal(legacyPlace('/admin/users'), 'users/list');
    assert.equal(legacyPlace('/admin/grants'), 'users/grants');
    assert.equal(legacyPlace('/admin/notices'), 'announce/posts');
    assert.equal(legacyPlace('/admin/events'), 'announce/posts');
    assert.equal(legacyPlace('/admin/features'), 'settings/features');
    assert.equal(legacyPlace('/admin/ai'), 'settings/ai');
    assert.equal(legacyPlace('/admin/log'), 'settings/log');
    assert.equal(legacyPlace('/admin/private'), undefined);
    assert.equal(legacyPlace('/admin/constructor'), undefined);
    assert.equal(legacyPlace('/admin/__proto__'), undefined);
  });

  test('옛 여덟 탭이 가던 자리는 모두 실제 칸과 하위다', () => {
    for (const place of Object.values(LEGACY_PLACES)) {
      const [cell, sub] = place.split('/');
      assert.ok((ADMIN_CELLS as readonly string[]).includes(cell ?? ''), place);
      if (sub)
        assert.ok(
          CELL_SUBS[cell as (typeof ADMIN_CELLS)[number]].some(([id]) => id === sub),
          place,
        );
    }
    assert.equal(ADMIN_CELLS.length, 5);
  });

  test('칸 보이기 규칙은 칸과 하위마다 하나씩 있고 스크립트가 없으면 모두 보인다', () => {
    for (const c of ADMIN_CELLS) {
      assert.match(adminCss, new RegExp(`html\\[data-cell="${c}"\\] #cell-${c} \\{ display: block; \\}`));
      for (const [id] of CELL_SUBS[c])
        assert.ok(adminCss.includes(`html[data-sub="${c}/${id}"] #sub-${c}-${id} { display: block; }`));
    }
    assert.ok(adminCss.includes('html[data-cell] .panel, html[data-cell] .sub { display: none; }'));
    assert.ok(!adminCss.includes('html .panel'));
    // 스크립트는 머리에서 바로 돌고 인라인이 아니다
    assert.match(adminJs, /root\.dataset\.cell = c/);
  });

  test('할 일 카드: 신고, 예산 50%와 80%, 3일 안에 끝나는 것만', () => {
    const now = Date.UTC(2026, 9, 23);
    const day = 86_400_000;
    const base = { reports: 0, costMicros: 0, budgetMicros: 10_000_000, events: [], coupons: [], now };
    assert.deepEqual(todoOf(base), []);
    assert.deepEqual(todoOf({ ...base, reports: 3 }), [
      { kind: 'reports', level: 'warn', n: 3, place: 'reports' },
    ]);
    assert.deepEqual(todoOf({ ...base, costMicros: 5_000_000 }), [
      { kind: 'budget', level: 'warn', n: 50, place: 'settings/ai' },
    ]);
    assert.equal(todoOf({ ...base, costMicros: 8_000_000 })[0]?.level, 'bad');
    assert.equal(todoOf({ ...base, costMicros: 4_999_999 }).length, 0);
    assert.equal(todoOf({ ...base, budgetMicros: 0 })[0]?.n, -1);
    const todo = todoOf({
      ...base,
      events: [
        { starts: now - day, ends: now + 2 * day },
        { starts: now - day, ends: now + 4 * day },
        { starts: now - 3 * day, ends: now - day },
        { starts: now + day, ends: now + 2 * day },
      ],
      coupons: [
        { starts: now - day, ends: now + day, disabled: false },
        { starts: now - day, ends: now + day, disabled: true },
      ],
    });
    assert.deepEqual(
      todo.map((x) => [x.kind, x.n]),
      [
        ['ending_events', 1],
        ['ending_coupons', 1],
      ],
    );
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
    // 찾기, 쪽 넘기기는 한 화면 안의 이용자 자리로 돌아온다
    assert.match(html, /href="\/admin\?[^"]*#users\/list"/);
    assert.match(html, /action="\/admin#users\/list"/);
  });
});

describe('운영자 화면 CSS 접근성 규칙', () => {
  test('흐리게 하는 일은 opacity 대신 색 토큰으로 한다 (대비 4.5 대 1)', () => {
    assert.doesNotMatch(adminCss, /tr\.off[^{]*\{[^}]*opacity/);
    assert.doesNotMatch(adminCss, /button:disabled \{[^}]*opacity/);
    assert.match(adminCss, /tr\.off td \{ color: var\(--muted\)/);
  });

  test('거친 포인터(손가락)에서는 누르는 곳이 44px 이상이다', () => {
    const coarse = adminCss.slice(adminCss.indexOf('@media (pointer: coarse) {'));
    assert.match(coarse, /\.subnav a/);
    assert.match(coarse, /td a:not\(\.button-link\)/);
    assert.match(coarse, /label\.confirm/);
    assert.match(coarse, /min-height: 44px/);
  });
});
