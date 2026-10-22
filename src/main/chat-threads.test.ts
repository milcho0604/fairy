import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SavedChat } from '../shared/chat-state.ts';
import { createThreadStore } from './chat-threads.ts';

const EMPTY: SavedChat = { messages: [], sessions: {} };

function chat(q: string, prefix = 'm'): SavedChat {
  return {
    messages: [
      { id: `${prefix}1`, role: 'user', text: q },
      { id: `${prefix}2`, role: 'pet', text: `${q} 답`, status: 'done', provider: 'claude' },
    ],
    sessions: { claude: { id: `S-${prefix}`, turns: 1 } },
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'fairy-threads-'));
  let n = 0;
  let clock = 1000;
  const make = (history: SavedChat = EMPTY, historyAt?: number) =>
    createThreadStore(dir, {
      history,
      historyAt,
      isolated: true,
      now: () => clock,
      newId: () => `thread-${String(++n).padStart(4, '0')}`,
    });
  return {
    dir,
    make,
    tick: (ms = 1000) => {
      clock += ms;
    },
    files: () => (existsSync(join(dir, 'chat-threads')) ? readdirSync(join(dir, 'chat-threads')).sort() : []),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('옛 판 대화(chat-history 만 있음)는 켤 때 목록 첫 항목이 되고 지금 대화로 이어 간다', () => {
  const t = setup();
  try {
    const old = chat('옛 판 질문');
    const s = t.make(old, 500);
    const list = s.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.title, '옛 판 질문');
    assert.equal(list[0]?.createdAt, 500);
    assert.equal(s.current, list[0]?.id);
    assert.deepEqual(s.read(list[0]?.id ?? ''), old);
    // 다시 켜도 두 번 넣지 않는다
    const again = t.make(old, 500);
    assert.equal(again.list().length, 1);
    assert.equal(again.current, list[0]?.id);
  } finally {
    t.done();
  }
});

test('새 대화를 해도 지난 대화는 목록에 남고, 다음 답은 새 항목이 된다', () => {
  const t = setup();
  try {
    const s = t.make();
    s.saveCurrent(EMPTY, true);
    assert.equal(s.list().length, 0, '빈 대화는 목록에 넣지 않는다');
    s.saveCurrent(chat('첫 대화', 'a'), true);
    const first = s.current;
    s.detach();
    assert.equal(s.current, undefined);
    t.tick();
    s.saveCurrent(chat('둘째 대화', 'b'), true);
    assert.notEqual(s.current, first);
    assert.deepEqual(
      s.list().map((m) => m.title),
      ['둘째 대화', '첫 대화'],
    );
    // 지난 대화를 열면 그 항목으로 이어 저장한다
    assert.ok(first && s.attach(first));
    t.tick();
    s.saveCurrent({ ...chat('첫 대화', 'a'), messages: [...chat('첫 대화', 'a').messages] }, true);
    assert.equal(s.list()[0]?.id, first);
    assert.equal(s.list().length, 2);
  } finally {
    t.done();
  }
});

test('지우면 목차와 파일이 진짜 사라지고 다시 켜도 돌아오지 않는다', () => {
  const t = setup();
  try {
    const s = t.make();
    s.saveCurrent(chat('비밀 이야기', 'a'), true);
    const id = s.current ?? '';
    s.detach();
    s.saveCurrent(chat('다른 이야기', 'b'), true);
    assert.equal(t.files().length, 2);
    assert.equal(s.remove(id), false, '지금 대화가 아니다');
    assert.deepEqual(t.files(), [`${s.current}.json`]);
    const raw = readFileSync(join(t.dir, 'chat-threads.json'), 'utf8');
    assert.ok(!raw.includes('비밀'), '목차에도 남지 않는다');
    assert.equal(s.read(id), undefined);
    // 지금 대화를 지우면 true, current 비움
    assert.equal(s.remove(s.current ?? ''), true);
    assert.equal(s.current, undefined);
    assert.deepEqual(t.files(), []);
    assert.equal(t.make().list().length, 0);
  } finally {
    t.done();
  }
});

test('목차에 없는 대화 파일은 켤 때 치운다. 목차가 깨졌으면 아무것도 지우지 않는다', () => {
  const t = setup();
  try {
    const s = t.make();
    s.saveCurrent(chat('남길 것', 'a'), true);
    const stray = join(t.dir, 'chat-threads', 'thread-9999.json');
    writeFileSync(stray, JSON.stringify(chat('지우다 꺼진 것')));
    t.make(chat('남길 것', 'a'));
    assert.equal(existsSync(stray), false);
    assert.equal(t.files().length, 1);
    // 목차가 깨지면 대화 파일을 지우지 않는다 (목차를 못 읽은 것이지 대화가 없는 것이 아니다)
    writeFileSync(join(t.dir, 'chat-threads.json'), '{깨짐');
    t.make();
    assert.equal(t.files().length, 1);
  } finally {
    t.done();
  }
});

test('이름 바꾸기, 경로 문자 id 는 받지 않는다', () => {
  const t = setup();
  try {
    const s = t.make();
    s.saveCurrent(chat('질문'), true);
    const id = s.current ?? '';
    assert.ok(s.rename(id, '새 이름'));
    assert.equal(s.list()[0]?.title, '새 이름');
    assert.ok(s.rename(id, ''));
    assert.equal(s.list()[0]?.title, '질문');
    assert.equal(s.rename('../../settings', 'x'), false);
    assert.equal(s.remove('../../settings'), false);
    assert.equal(s.read('../../settings'), undefined);
  } finally {
    t.done();
  }
});

test('대화 500개: 목차 하나로 목록을 그리고 찾기도 빠르다', () => {
  const t = setup();
  try {
    // 저장은 한 번에 17ms 쯤(fsync 두 번)이라 500번 저장하는 대신 목차를 바로 쓴다
    const threads = Array.from({ length: 500 }, (_, i) => ({
      id: `thread-${String(i).padStart(4, '0')}`,
      title: `질문 ${i} ${i % 7 === 0 ? '여행' : '일'}`,
      provider: 'claude',
      createdAt: i,
      updatedAt: i,
      count: 2,
      first: `질문 ${i}`,
    }));
    writeFileSync(join(t.dir, 'chat-threads.json'), JSON.stringify({ threads }));
    const t0 = performance.now();
    const again = t.make();
    const all = again.list();
    const found = again.list('여행');
    const ms = performance.now() - t0;
    assert.equal(all.length, 500);
    assert.equal(found.length, 72);
    assert.equal(all[0]?.title, '질문 499 일');
    // 목차 하나 읽기 + 정렬. 느린 CI 에서도 넉넉한 상한
    assert.ok(ms < 500, `${ms}ms`);
  } finally {
    t.done();
  }
});

test('이름 바꾸기 저장이 디스크 오류로 실패하면 false, 메모리 목록도 옛 이름 그대로', () => {
  const t = setup();
  try {
    const s = t.make();
    s.saveCurrent(chat('질문'), true);
    const id = s.current ?? '';
    chmodSync(t.dir, 0o500);
    let ok: boolean | undefined;
    try {
      ok = s.rename(id, '새 이름');
    } finally {
      chmodSync(t.dir, 0o700);
    }
    assert.equal(ok, false);
    assert.equal(s.list()[0]?.title, '질문');
    assert.ok(s.rename(id, '새 이름'));
    assert.equal(s.list()[0]?.title, '새 이름');
  } finally {
    t.done();
  }
});
