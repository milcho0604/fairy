// 기기 간 동기화(docs/sync-plan.md 4절)가 칸마다 시각을 적는 칸과 맞추지 않는 칸.
// 24판 트리거(db-schema-sync.ts)가 적는 칸과 같아야 하고, sync-triggers.test.ts 가 둘을 맞춰 본다.

export const SYNC_KINDS = ['todo', 'todo_step', 'note', 'event'] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

/** 표 이름 (kind 와 같다) */
export const SYNC_TABLE: Record<SyncKind, string> = {
  todo: 'todo',
  todo_step: 'todo_step',
  note: 'note',
  event: 'event',
};

/** 칸 하나가 바뀔 때 sync_clock 에 시각을 적는 칸. 정수 연결 칸(아래 SYNC_INT_LINKS)도 시각은 적는다 */
export const SYNC_FIELDS: Record<SyncKind, readonly string[]> = {
  todo: [
    'title',
    'due',
    'important',
    'created_at',
    'done_at',
    'coin_paid',
    'deleted_at',
    'repeat',
    'repeat_of',
    'repeat_anchor',
    'pinned_at',
    'due_min',
  ],
  todo_step: ['todo_id', 'title', 'done', 'ord', 'created_at'],
  note: ['title', 'body', 'source', 'created_at', 'updated_at', 'deleted_at', 'pinned_at'],
  event: [
    'title',
    'start_at',
    'end_at',
    'created_at',
    'deleted_at',
    'all_day',
    'pinned_at',
    'repeat_kind',
    'repeat_series',
    'repeat_clock',
    'slot',
    'user_edited',
    'removed_by',
  ],
};

/** 표 칸이 아니라 딸린 표가 바뀔 때 부모의 이 이름으로 시각을 적는 칸 */
export const SYNC_VIRTUAL_FIELDS: Record<SyncKind, readonly string[]> = {
  todo: ['reminders'],
  todo_step: [],
  note: [],
  event: ['reminders', 'template', 'skips'],
};

/** 맞추지 않는 칸 (시각도 적지 않는다). 기기마다 따로 정하거나 다른 칸에서 다시 만든다 */
export const SYNC_EXCLUDED_FIELDS: Record<SyncKind, readonly string[]> = {
  todo: ['id', 'auto_removed', 'sort_ord', 'coins'],
  todo_step: ['id'],
  note: ['id'],
  event: [
    'id',
    'source',
    'external_id',
    'notified_at',
    'remind_min',
    'google_id',
    'google_cal',
    'google_uid',
    'google_hash',
  ],
};

/** 다른 기기에서는 번호가 다른 정수 연결. 시각만 적고, 덩어리 안에서 uid 로 바꾸는 일은 엔진이 한다 */
export const SYNC_INT_LINKS: Record<SyncKind, readonly string[]> = {
  todo: ['repeat_of'],
  todo_step: ['todo_id'],
  note: [],
  event: ['repeat_series'],
};

/** app_meta 열쇠: 다른 기기 변경을 적용하는 동안 '1' (트리거가 아무것도 적지 않는다). 기기 번호는 DB 밖에서 엔진이 붙인다 */
export const SYNC_META_APPLYING = 'sync_applying';

/** reminder 표에서 맞추는 것은 before_min 뿐이다 (notified_at 은 이 기기에서만) */
export const SYNC_REMINDER_NOT_SYNCED = ['notified_at'] as const;
