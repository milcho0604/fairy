// 24판(기기 간 동기화 바탕)의 SQL. docs/sync-plan.md 4절.
// 한 번 낸 판은 고치지 않으므로 칸 목록은 sync-fields.ts 와 따로 여기 적는다 (그쪽이 바뀌어도 24판은 그대로).

const NOW = "cast(unixepoch('subsec') * 1000 as integer)";
const ON = "coalesce((select value from app_meta where key = 'sync_applying'), '0') <> '1'";
const UPSERT = 'on conflict (kind, uid, field) do update set t = max(excluded.t, sync_clock.t + 1)';

interface Spec {
  kind: 'todo' | 'todo_step' | 'note' | 'event';
  fields: string[];
  extra: string[]; // insert 와 편입 때 같이 적는 딸린 칸
  /** 이 행을 추적하는지. r 은 new 나 old */
  tracked: (r: string) => string;
}

const eventTracked = (r: string) =>
  `(${r}.source = 'local' and (${r}.repeat_series is null or ${r}.repeat_series = ${r}.id or ${r}.user_edited = 1 or ${r}.deleted_at is not null))`;

const SPECS: Spec[] = [
  {
    kind: 'todo',
    fields: [
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
    extra: [],
    tracked: () => '1',
  },
  {
    kind: 'todo_step',
    fields: ['todo_id', 'title', 'done', 'ord', 'created_at'],
    extra: [],
    tracked: () => '1',
  },
  {
    kind: 'note',
    fields: ['title', 'body', 'source', 'created_at', 'updated_at', 'deleted_at', 'pinned_at'],
    extra: [],
    tracked: () => '1',
  },
  {
    kind: 'event',
    fields: [
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
    extra: ['reminders'],
    tracked: eventTracked,
  },
];

function rowTriggers(s: Spec): string {
  const t = s.kind;
  const trNew = s.tracked('new');
  const trOld = s.tracked('old');
  const all = [...s.fields, ...s.extra];
  // 편입: 추적하지 않던 행이 추적 대상이 되는 순간(펼친 반복 회차를 사용자가 고침). 그때 모든 칸의 시각을 적는다
  const adopt = t === 'event' ? `(not ${trOld})` : '0';
  const diff = s.fields.map((f) => `old.${f} is not new.${f}`).join(' or ');
  const upd = s.fields.map((f) => `select '${f}' as f where ${adopt} or old.${f} is not new.${f}`);
  const adoptExtra = s.extra.map((f) => `select '${f}' as f where ${adopt}`);
  const updSel = [...upd, ...adoptExtra].join(' union all ');
  const cols = [...s.fields, ...(t === 'event' ? ['source'] : [])].join(', ');
  const stamp = (when: string) => `
    insert into sync_clock (kind, uid, field, t)
      select '${t}', new.uid, f, ${NOW} from (${when}) where true
    ${UPSERT};`;
  // 새 행은 칸 이름 목록(json_each)으로 한 번에: 문장이 짧아 INSERT 를 준비할 때 트리거 컴파일이 가볍다
  const stampAll = `
    insert into sync_clock (kind, uid, field, t)
      select '${t}', new.uid, value, ${NOW} from json_each('${JSON.stringify(all)}') where true
    ${UPSERT};`;
  // 조건은 모두 WHEN 에 둔다: 추적하지 않는 행(펼친 반복 회차 수백 개)에서 본문을 아예 돌리지 않도록
  return `
  create trigger sync_${t}_ai after insert on ${t} when new.uid is null begin
    update ${t} set uid = lower(hex(randomblob(16))) where id = new.id;
  end;
  create trigger sync_${t}_ui after update of uid on ${t}
    when old.uid is null and new.uid is not null and ${ON} and ${trNew} begin${stampAll}
    insert or ignore into sync_outbox (kind, uid) values ('${t}', new.uid);
  end;
  create trigger sync_${t}_ai2 after insert on ${t} when new.uid is not null and ${ON} and ${trNew} begin${stampAll}
    insert or ignore into sync_outbox (kind, uid) values ('${t}', new.uid);
  end;
  create trigger sync_${t}_au after update of ${cols} on ${t}
    when new.uid is not null and ${ON} and (${trNew} or ${trOld}) and (${adopt} or ${diff}) begin${stamp(updSel)}
    insert or ignore into sync_outbox (kind, uid) values ('${t}', new.uid);
  end;
  create trigger sync_${t}_ad after delete on ${t} when old.uid is not null and ${ON} and ${trOld} begin
    insert or replace into sync_tomb (kind, uid, t) values ('${t}', old.uid, ${NOW});
    insert or ignore into sync_outbox (kind, uid) values ('${t}', old.uid);
  end;`;
}

/** 부모 uid 를 한 번 찾아 칸 시각과 보낼 목록에 넣는다 (kind 는 부모 종류). uidExpr 이 null 이면 아무것도 하지 않는다 */
function bump(kindExpr: string, uidExpr: string, field: string): string {
  return `
    insert into sync_clock (kind, uid, field, t)
      select ${kindExpr}, u, '${field}', ${NOW} from (select ${uidExpr} as u) where u is not null
    ${UPSERT};
    insert or ignore into sync_outbox (kind, uid)
      select ${kindExpr}, u from (select ${uidExpr} as u) where u is not null;`;
}

function reminderTriggers(): string {
  // 일정 알림은 추적하는 일정 것만 (펼친 회차는 uid 식이 null 이 된다)
  const parent = (r: string) =>
    `case ${r}.kind when 'todo' then (select uid from todo where id = ${r}.ref_id)
      else (select uid from event where id = ${r}.ref_id and source = 'local'
        and (repeat_series is null or repeat_series = id or user_edited = 1 or deleted_at is not null)) end`;
  const mk = (name: string, on: string, r: string, extra = '') =>
    `create trigger sync_reminder_${name} ${on} when ${extra}${ON} begin${bump(`${r}.kind`, parent(r), 'reminders')}
  end;`;
  return `
  ${mk('ai', 'after insert on reminder', 'new')}
  ${mk('ad', 'after delete on reminder', 'old')}
  ${mk('au', 'after update of before_min on reminder', 'new', 'old.before_min is not new.before_min and ')}`;
}

/** 반복 시리즈의 원본 일정 (source local). 시리즈 id 는 원본 일정의 id */
function repeatTriggers(): string {
  const origin = (r: string) => `(select uid from event where id = ${r}.series_id and source = 'local')`;
  const t = (name: string, when: string, r: string, field: string) =>
    `create trigger sync_${name} ${when} begin${bump("'event'", origin(r), field)}
  end;`;
  const tplDiff = [
    'start_at',
    'repeat_kind',
    'title',
    'duration_ms',
    'repeat_clock',
    'reminders',
    'remind_min',
    'created_at',
  ]
    .map((c) => `old.${c} is not new.${c}`)
    .join(' or ');
  return `
  ${t('tpl_ai', `after insert on event_repeat_template when ${ON}`, 'new', 'template')}
  ${t('tpl_ad', `after delete on event_repeat_template when ${ON}`, 'old', 'template')}
  ${t('tpl_au', `after update on event_repeat_template when ${ON} and (${tplDiff})`, 'new', 'template')}
  ${t('skip_ai', `after insert on event_repeat_skip when ${ON}`, 'new', 'skips')}
  ${t('skip_ad', `after delete on event_repeat_skip when ${ON}`, 'old', 'skips')}`;
}

export const SYNC_MIGRATION_SQL = `
  alter table todo add column uid text;
  alter table todo_step add column uid text;
  alter table note add column uid text;
  alter table event add column uid text;
  alter table todo add column coin_paid integer not null default 0; -- 어느 기기에서든 이 할 일로 코인을 받음
  alter table event add column slot integer; -- 펼친 반복 회차를 만들 때의 원래 시작 시각 (옮겨도 안 바뀐다)
  update todo set coin_paid = 1
    where coins > 0 or exists (select 1 from coin_log where ref_id = todo.id and reason in ('todo', 'early'));
  update event set slot = start_at where repeat_series is not null and repeat_series <> id;
  update todo set uid = lower(hex(randomblob(16)));
  update todo_step set uid = lower(hex(randomblob(16)));
  update note set uid = lower(hex(randomblob(16)));
  update event set uid = lower(hex(randomblob(16)));
  create unique index todo_uid on todo(uid);
  create unique index todo_step_uid on todo_step(uid);
  create unique index note_uid on note(uid);
  create unique index event_uid on event(uid);

  create table sync_clock (
    kind text not null,
    uid text not null,
    field text not null,
    t integer not null,
    primary key (kind, uid, field)
  ) without rowid;
  create table sync_outbox (
    kind text not null,
    uid text not null,
    primary key (kind, uid)
  ) without rowid;
  create table sync_tomb (
    kind text not null,
    uid text not null,
    t integer not null,
    primary key (kind, uid)
  ) without rowid;
${SPECS.map(rowTriggers).join('\n')}
${reminderTriggers()}
${repeatTriggers()}
`;
