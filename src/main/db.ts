import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, shell } from 'electron';
import { AchievementStore } from '../shared/achieve.ts';
import { StatStore } from '../shared/beta-stats.ts';
import type { Db } from '../shared/db-schema.ts';
import { EventStore } from '../shared/event-store.ts';
import { t } from '../shared/i18n/index.ts';
import { NoteStore } from '../shared/note-store.ts';
import { PetLife } from '../shared/pet-life.ts';
import { ItemStore } from '../shared/shop.ts';
import { TodoStore } from '../shared/todo-store.ts';
import { openDbFile, type StoreTrouble } from './db-open.ts';
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
  life: PetLife;
  shop: ItemStore;
  achievements: AchievementStore;
  /** 한 시점 그대로 다른 파일로 복사 (백업, v2) */
  vacuumInto: (file: string) => void;
  /** 다른 연결(펫 MCP 서버)이 쓰면 바뀌는 수. 바뀌었으면 화면을 다시 그린다 */
  dataVersion: () => number;
  /** 저장 파일을 그대로 쓰지 못했으면 그 까닭 */
  trouble?: StoreTrouble;
} {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'jjakkung.db');
  const { db, memory, trouble } = openDbFile(file, log);
  // 끄는 중에도 도는 타이머(MCP 변경 보기 등)가 닫힌 파일을 읽지 않게 연 상태를 기억한다
  let open = true;
  app.on('will-quit', () => {
    open = false;
    db.close();
  });
  const d = db as unknown as Db;
  const store = new TodoStore(d);
  return {
    store,
    stats: new StatStore(d),
    notes: new NoteStore(d),
    events: new EventStore(d),
    life: new PetLife(d),
    // 메모리에 열었으면(새 판, 못 엶) 비어 있는 메모리 대신 디스크의 원래 파일을 그대로 복사한다
    vacuumInto: (target: string) => {
      if (!memory) return d.exec(`vacuum into '${target.replace(/'/g, "''")}'`);
      if (!existsSync(file)) throw new Error('저장 파일이 없다');
      copyFileSync(file, target);
      if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${target}-wal`);
    },
    shop: new ItemStore(d, store),
    achievements: new AchievementStore(d),
    dataVersion: () =>
      open ? Number((d.prepare('pragma data_version').get() as { data_version: number }).data_version) : -1,
    ...(trouble ? { trouble } : {}),
  };
}

/** 저장 파일 문제를 펫 말로 */
export function storeTroubleText(trouble: StoreTrouble): string {
  switch (trouble.kind) {
    case 'recovered':
      return t('main.db.recovered', {
        moved: basename(trouble.moved),
        when: new Date(trouble.at).toLocaleString(),
      });
    case 'fresh':
      return t('main.db.fresh', { moved: basename(trouble.moved) });
    case 'newer':
      return t('main.db.newer');
    case 'unavailable':
      return t('main.db.unavailable');
  }
}

/** 펫 말풍선으로 알린다. 옮긴 파일이 있으면 "파일 보기"로 폴더에서 보여 준다 (오류 대화상자는 띄우지 않는다) */
export async function announceStoreTrouble(
  trouble: StoreTrouble,
  say: (o: SayOptions) => Promise<string | undefined>,
): Promise<void> {
  const moved = 'moved' in trouble ? trouble.moved : undefined;
  const action = await say({
    kind: 'answer',
    text: storeTroubleText(trouble),
    ttlMs: 30_000,
    hold: {}, // 숨어 있거나 못 띄우면 나올 때 말하고, 그래도 못 보면 패널의 놓친 알림에 남긴다
    buttons: moved
      ? [
          { id: 'show', label: t('main.db.showFile') },
          { id: 'ok', label: t('common.ok') },
        ]
      : [{ id: 'ok', label: t('common.ok') }],
  });
  if (action === 'show' && moved) shell.showItemInFolder(moved);
}
