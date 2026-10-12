import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, shell } from 'electron';
import { AchievementStore } from '../shared/achieve.ts';
import { StatStore } from '../shared/beta-stats.ts';
import type { Db } from '../shared/db-schema.ts';
import { EventStore, repairAllDayZone, repairEventTimes } from '../shared/event-store.ts';
import { type ExportTodo, readExportTodos } from '../shared/export.ts';
import { GcalStore } from '../shared/gcal-store.ts';
import { HabitStore } from '../shared/habit.ts';
import { locale, t } from '../shared/i18n/index.ts';
import type { MissedMsg } from '../shared/missed-msg.ts';
import { NoteStore } from '../shared/note-store.ts';
import { PetLife } from '../shared/pet-life.ts';
import { ItemStore } from '../shared/shop.ts';
import { TodoStore } from '../shared/todo-store.ts';
import { copyDbFile, openDbFile, type StoreTrouble } from './db-open.ts';
import type { JsonTrouble } from './json-file.ts';
import type { SayOptions } from './pet-window.ts';

/**
 * 저장 파일(jjakkung.db)을 열고 최신 판으로 올린다 (P2-01).
 * WAL 로 쓰므로 앱이 갑자기 꺼져도 끝난 쓰기는 남는다. 판을 올리기 전에 파일을 한 벌 복사해 둔다.
 * 깨졌거나 새 판이어도 던지지 않는다: 던지면 펫과 메뉴 막대만 뜨고 패널, 단축키 없이 멈췄다 (버그잡이 6차).
 * 그때는 trouble 을 돌려주고 펫이 말풍선으로 알린다 (announceStoreTrouble).
 */
export function openStore(log: (tag: string, ...rest: unknown[]) => void): {
  store: TodoStore;
  stats: StatStore;
  notes: NoteStore;
  events: EventStore;
  /** 구글 캘린더로 보낸 일정 (6단계 쓰기) */
  gcalLinks: GcalStore;
  life: PetLife;
  shop: ItemStore;
  achievements: AchievementStore;
  /** 습관 (반복 할 일 사슬, shared/habit.ts) */
  habits: HabitStore;
  /** 내보낼 할 일 (shared/export.ts) */
  exportTodos: () => ExportTodo[];
  /** 한 시점 그대로 다른 파일로 복사 (백업, v2) */
  vacuumInto: (file: string) => void;
  /** 다른 연결(펫 MCP 서버)이 쓰면 바뀌는 수. 바뀌었으면 화면을 다시 그린다 */
  dataVersion: () => number;
  /** 이 앱이 저장 파일에 쓸 때마다 (쓴 SQL). 플래너가 할 일, 일정, 알림이 바뀌면 다음에 깰 때를 다시 잡는다 */
  onWrite: (listener: (sql: string) => void) => void;
  /** 저장 파일을 그대로 쓰지 못했으면 그 까닭 */
  trouble?: StoreTrouble;
} {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'jjakkung.db');
  const { db, memory, trouble } = openDbFile(file, log);
  // 읽을 때마다 던지는 일정 시각(너무 큰 수)을 먼저 고친다. 못 고쳐도 켜기는 멈추지 않는다
  try {
    const fixed = repairEventTimes(db as unknown as Db, Date.now());
    if (fixed > 0) log('db', '일정 시각 고침', fixed);
  } catch (err) {
    log('db', '일정 시각 못 고침', err instanceof Error ? err.message : String(err));
  }
  // 시간대를 바꿔 켰으면 종일 일정을 만든 날로 되돌린다 (현지 0시로 저장해 하루 앞뒤로 밀려 보였다)
  try {
    const moved = repairAllDayZone(db as unknown as Db);
    if (moved > 0) log('db', '종일 일정 시간대 맞춤', moved);
  } catch (err) {
    log('db', '종일 일정 시간대 못 맞춤', err instanceof Error ? err.message : String(err));
  }
  // 끄는 중에도 도는 타이머(MCP 변경 보기 등)가 닫힌 파일을 읽지 않게 연 상태를 기억한다
  let open = true;
  app.on('will-quit', () => {
    open = false;
    db.close();
  });
  const writes = new Set<(sql: string) => void>();
  const d = watchWrites(db as unknown as Db, (sql) => {
    for (const w of writes) w(sql);
  });
  const store = new TodoStore(d);
  const events = new EventStore(d);
  return {
    store,
    stats: new StatStore(d),
    notes: new NoteStore(d),
    events,
    gcalLinks: new GcalStore(d, events),
    life: new PetLife(d),
    // 메모리에 열었으면(새 판, 못 엶) 비어 있는 메모리 대신 디스크의 원래 파일을 WAL 까지 합쳐 한 파일로 복사한다
    vacuumInto: (target: string) => {
      if (!memory) return d.exec(`vacuum into '${target.replace(/'/g, "''")}'`);
      copyDbFile(file, target);
    },
    shop: new ItemStore(d, store),
    achievements: new AchievementStore(d),
    habits: new HabitStore(d),
    exportTodos: () => readExportTodos(d),
    dataVersion: () =>
      open ? Number((d.prepare('pragma data_version').get() as { data_version: number }).data_version) : -1,
    onWrite: (listener) => writes.add(listener),
    ...(trouble ? { trouble } : {}),
  };
}

/** 읽기(select, pragma)가 아닌 문장을 돌린 뒤 알린다. 읽기는 감싸지 않아 그대로다 */
export function watchWrites(db: Db, onWrite: (sql: string) => void): Db {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const st = db.prepare(sql);
      if (/^\s*(select|pragma)\b/i.test(sql)) return st;
      const after = <T>(r: T): T => {
        onWrite(sql);
        return r;
      };
      return {
        run: (...p) => after(st.run(...p)),
        get: (...p) => after(st.get(...p)),
        all: (...p) => after(st.all(...p)),
      };
    },
  };
}

/** 저장 파일 문제를 펫 말로 */
export function storeTroubleText(trouble: StoreTrouble): string {
  switch (trouble.kind) {
    case 'recovered':
      return t('main.db.recovered', {
        moved: basename(trouble.moved),
        when: new Date(trouble.at).toLocaleString(locale()),
      });
    case 'fresh':
      return t('main.db.fresh', { moved: basename(trouble.moved) });
    case 'newer':
      return t('main.db.newer');
    case 'unavailable':
      return t('main.db.unavailable');
  }
}

/** 놓친 알림에 남길 말 열쇠 (언어를 바꿔도 따라가게). 되살린 때는 만들 때 언어의 날짜 글 그대로 */
function storeTroubleMsg(trouble: StoreTrouble): MissedMsg {
  switch (trouble.kind) {
    case 'recovered':
      return {
        key: 'main.db.recovered',
        vars: { moved: basename(trouble.moved), when: new Date(trouble.at).toLocaleString(locale()) },
      };
    case 'fresh':
      return { key: 'main.db.fresh', vars: { moved: basename(trouble.moved) } };
    case 'newer':
      return { key: 'main.db.newer' };
    case 'unavailable':
      return { key: 'main.db.unavailable' };
  }
}

/** 펫 말풍선으로 알린다. 옮긴 파일이 있으면 "파일 보기"로 폴더에서 보여 준다 (오류 대화상자는 띄우지 않는다) */
export async function announceStoreTrouble(
  trouble: StoreTrouble,
  say: (o: SayOptions) => Promise<string | undefined>,
): Promise<void> {
  const moved = 'moved' in trouble ? trouble.moved : undefined;
  const showFile = (action: string | undefined) => {
    if (action === 'show' && moved) shell.showItemInFolder(moved);
  };
  const action = await say({
    kind: 'answer',
    text: storeTroubleText(trouble),
    ttlMs: 30_000,
    // 숨어 있거나 못 띄우면 나올 때 말하고, 그래도 못 보면 패널의 놓친 알림에 남긴다.
    // 다른 말에 밀렸다 다시 나와도 "파일 보기"는 그대로 달리고 누르면 폴더를 연다
    hold: { onAction: showFile, missedMsgs: [storeTroubleMsg(trouble)] },
    buttons: moved
      ? [
          { id: 'show', label: t('main.db.showFile') },
          { id: 'ok', label: t('common.ok') },
        ]
      : [{ id: 'ok', label: t('common.ok') }],
  });
  showFile(action);
}

/** 깨진 JSON 저장 파일(설정 등)을 펫 말풍선으로 알린다. 조용히 기본값으로 돌아가지 않게 (json-file.ts) */
export async function announceJsonTrouble(
  trouble: JsonTrouble,
  say: (o: SayOptions) => Promise<string | undefined>,
): Promise<void> {
  const vars = { file: basename(trouble.file), moved: basename(trouble.moved) };
  const key = trouble.restored ? 'main.json.restored' : 'main.json.reset';
  const action = await say({
    kind: 'answer',
    text: t(key, vars),
    ttlMs: 30_000,
    hold: {
      onAction: (a) => {
        if (a === 'show') shell.showItemInFolder(trouble.moved);
      },
      missedMsgs: [{ key, vars }],
    },
    buttons: [
      { id: 'show', label: t('main.db.showFile') },
      { id: 'ok', label: t('common.ok') },
    ],
  });
  if (action === 'show') shell.showItemInFolder(trouble.moved);
}
